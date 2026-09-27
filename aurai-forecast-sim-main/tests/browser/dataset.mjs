/**
 * Dataset import (CSV and Excel), lazy row loading, the preview column
 * pickers, and the confirm/undo flow around cleaning.
 *
 * Cleaning rewrites stored data, so the checks here are mostly about it *not*
 * happening without consent.
 */
import { createRun, signedInPage, statTile } from "./_helpers.mjs";

const run = createRun("dataset");
const { browser, page, errors, failedRequests } = await signedInPage();

const goToDatasets = async () => {
  await page.goto(`${process.env.AURAI_URL || "http://localhost/Aurai/aurai-forecast-sim-main/dist/"}#/dataset`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
};

run.section("CSV import");
await goToDatasets();
// 10 rows with 2 duplicates, and two numeric columns for the picker.
const lines = ["month,sales,units,region"];
for (let i = 0; i < 8; i++) lines.push(`${new Date(2023, i, 1).toISOString().slice(0, 10)},${100 + i},${5 + i},North`);
lines.push(lines[1], lines[2]);
await (await page.$('input[type="file"]')).setInputFiles({
  name: "clean.csv", mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")),
});
await page.waitForTimeout(3500);
run.check("imports a CSV", (await page.textContent("body")).includes("clean.csv"));
run.check("reports the row count", (await statTile(page, "Rows")) === "10", `got ${await statTile(page, "Rows")}`);

run.section("Excel import");
const XLSX = await import("xlsx");
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
  Array.from({ length: 12 }, (_, i) => ({ Month: new Date(2022, i, 1), Revenue: 900 + i * 40 })),
), "Sales");
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ note: "second" }]), "Notes");
// Built in memory: SheetJS's ESM build has no fs binding, and the browser
// only needs the bytes anyway.
const xlsxBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

await (await page.$('input[type="file"]')).setInputFiles({
  name: "revenue.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: Buffer.from(xlsxBuffer),
});
await page.waitForTimeout(4000);
let body = await page.textContent("body");
run.check("imports a workbook", body.includes(".xlsx"), body.slice(0, 200));
run.check("reads all its rows", (await statTile(page, "Rows")) === "12", `got ${await statTile(page, "Rows")}`);
run.check("says when other sheets were skipped", body.includes("skipped"), body.slice(0, 300));

const firstCell = await page.evaluate(() => {
  const t = document.querySelector("table");
  if (!t) return null;
  const head = [...t.querySelectorAll("thead th")].map((e) => e.textContent.trim());
  const row = t.querySelector("tbody tr");
  return row ? [...row.querySelectorAll("td")][head.indexOf("Month")]?.textContent.trim() : null;
});
// Excel stores dates as serial numbers; a bare number here means they leaked through.
run.check("converts Excel dates to real dates", /^\d{4}-\d{2}-\d{2}$/.test(firstCell || ""), `got "${firstCell}"`);

run.section("Preview column pickers");
await page.click('div:has-text("clean.csv") >> nth=-1').catch(() => {});
await page.waitForTimeout(2000);
const selects = await page.$$("select");
run.check("offers value and label pickers", selects.length >= 2, `${selects.length} selects`);
const options = await page.evaluate(() => [...document.querySelectorAll("select")][0]?.options.length || 0);
run.check("lists every numeric column", options >= 2, `${options} options`);
if (selects[0]) await selects[0].selectOption({ index: 1 }).catch(() => {});
await page.waitForTimeout(600);
run.check("switching the plotted column does not error", errors.length === 0, errors.join(" | "));

run.section("Column profile");
// A deliberately messy import: a constant column, gaps, a unique id and an
// extreme outlier — each of which should be called out before forecasting.
const messy = ["month,sales,region,note,ref"];
for (let i = 0; i < 20; i++) {
  const d = new Date(2023, i, 1).toISOString().slice(0, 10);
  messy.push(`${d},${i === 7 ? 99999 : 100 + i * 5},North,${i % 4 === 0 ? "" : "ok"},id-${i}`);
}
await (await page.$('input[type="file"]')).setInputFiles({
  name: "quality.csv", mimeType: "text/csv", buffer: Buffer.from(messy.join("\n")),
});
await page.waitForTimeout(3500);
await page.click('button:has-text("columns")');
await page.waitForTimeout(1200);

const profile = await page.evaluate(() => {
  const t = [...document.querySelectorAll("table")].find((t) => t.textContent.includes("Std dev"));
  if (!t) return null;
  return Object.fromEntries([...t.querySelectorAll("tbody tr")]
    .map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim()))
    .map((cells) => [cells[0], cells]));
});
run.check("profiles every column", Object.keys(profile || {}).length === 5, Object.keys(profile || {}).join(","));
run.check("distinguishes numeric from text",
  profile?.sales?.[1] === "number" && profile?.region?.[1] === "text",
  JSON.stringify([profile?.sales?.[1], profile?.region?.[1]]));
run.check("reports the share of missing values", (profile?.note?.[2] || "").includes("25%"), profile?.note?.[2]);
run.check("computes min and max", profile?.sales?.[4] === "100" && profile?.sales?.[5] === "99,999",
  `${profile?.sales?.[4]} / ${profile?.sales?.[5]}`);
run.check("computes mean, median and standard deviation",
  profile?.sales?.[6] !== "—" && profile?.sales?.[7] !== "—" && profile?.sales?.[8] !== "—",
  JSON.stringify(profile?.sales));
run.check("counts values beyond three standard deviations", profile?.sales?.[9] === "1", profile?.sales?.[9]);

const warnings = await page.textContent("body");
run.check("warns about a constant column", warnings.includes("carries no signal"));
run.check("warns about an identifier column", warnings.includes("identifier"));
run.check("warns about missing values", warnings.includes("missing"));

// Back to the dataset the cleaning checks below expect.
await page.click('div:has-text("clean.csv") >> nth=-1');
await page.waitForTimeout(2500);

run.section("Cleaning asks before it writes");
await page.click('button:has-text("Cleaning")');
await page.waitForTimeout(800);
await page.click('button:has-text("Remove duplicates")');
await page.waitForTimeout(800);
body = await page.textContent("body");
run.check("previews the effect instead of applying it", /will remove \d+ of \d+ rows/.test(body), body.slice(0, 300));
run.check("leaves the data alone while waiting", (await statTile(page, "Rows")) === "10", `got ${await statTile(page, "Rows")}`);

await page.click('button:has-text("Cancel")');
await page.waitForTimeout(600);
run.check("cancel changes nothing", (await statTile(page, "Rows")) === "10", `got ${await statTile(page, "Rows")}`);

run.section("Apply and undo");
await page.click('button:has-text("Remove duplicates")');
await page.waitForTimeout(600);
await page.click('button:has-text("Apply")');
await page.waitForTimeout(2500);
run.check("applying removes the duplicates", (await statTile(page, "Rows")) === "8", `got ${await statTile(page, "Rows")}`);
run.check("offers an undo", (await page.textContent("body")).includes("Undo"));

await page.click('button:has-text("Undo")');
await page.waitForTimeout(2500);
run.check("undo restores the rows", (await statTile(page, "Rows")) === "10", `got ${await statTile(page, "Rows")}`);

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(3500);
// A reload selects the newest dataset, so reopen the one that was cleaned.
await page.click('div:has-text("clean.csv") >> nth=-1');
await page.waitForTimeout(2500);
run.check("the restore was persisted, not just local", (await statTile(page, "Rows")) === "10", `got ${await statTile(page, "Rows")}`);

await page.click('button:has-text("Cleaning")');
await page.waitForTimeout(700);
await page.click('button:has-text("Trim whitespace")');
await page.waitForTimeout(800);
run.check("a no-op clean says so rather than writing",
  (await page.textContent("body")).includes("already clean"), (await page.textContent("body")).slice(0, 250));

run.check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
run.check("no failed API calls", failedRequests.length === 0, failedRequests.join(" | "));

await browser.close();
process.exit(run.finish() ? 0 : 1);
