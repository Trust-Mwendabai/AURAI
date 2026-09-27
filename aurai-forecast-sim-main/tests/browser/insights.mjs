/**
 * The Business Insights page: the adviser's read on one forecast.
 *
 * The seeded run has a deliberate shape — rising, with a clear peak at the end
 * and a known accuracy — so the headline figures have unambiguous correct
 * values rather than merely "some number".
 *
 * Nothing here asserts the wording of the advice. It is written by a model
 * when one is configured and from a template when not, and both are correct;
 * what must hold is that the figures beside it are this forecast's own.
 */
import { createRun, signedInPage, apiAs, BASE } from "./_helpers.mjs";

const run = createRun("insights");
const { browser, page, errors, failedRequests } = await signedInPage({ height: 1400 });

// 24 months of history, then a 6-month projection that continues it upward.
const rows = Array.from({ length: 24 }, (_, i) => ({
  month: `20${22 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`,
  units: 1000 + i * 25,
}));
const ds = await apiAs(page, "POST", "/datasets", {
  name: "units.csv", rows, meta: { headers: ["month", "units"] },
});
await apiAs(page, "POST", "/predictions", {
  name: "Units outlook", datasetId: ds.body.id, target: "units",
  horizon: 6, period: "Monthly", algorithm: "Prophet", accuracy: 88.5,
  forecast: Array.from({ length: 6 }, (_, i) => ({
    i: i + 1, label: `2024-0${i + 1}-01`,
    value: 1600 + i * 40, low: 1500 + i * 40, high: 1700 + i * 40,
  })),
});

await page.goto(`${BASE}#/insights`, { waitUntil: "networkidle" });
// The advice may be written by the model, which takes seconds; wait for the
// page's own content rather than a timeout tuned to whichever path ran.
await page.waitForSelector("text=Advising on", { timeout: 45000 });
await page.waitForTimeout(600);

let body = await page.textContent("body");

run.section("It advises on a real forecast");
run.check("the page names the forecast it is advising on", body.includes("Units outlook"), body.slice(0, 200));
run.check("and the dataset behind it", body.includes("units.csv"), "");
run.check("it says whether the model or the built-in analysis wrote this",
  /reasoning model|built-in analysis/.test(body), "");

run.section("Headline figures come from this run");
// Projection averages 1700; the last 12 recorded months average 1300.
run.check("the projected average is the forecast's own", body.includes("1,700") || body.includes("1700"), "");
run.check("the peak is the highest projected point", body.includes("1,800") || body.includes("1800"), "");
run.check("the trough is the lowest", body.includes("1,600") || body.includes("1600"), "");
run.check("the stored accuracy is shown", body.includes("88.5"), "");
run.check("growth against history is stated as a percentage", /\+\d+(\.\d+)?%\s*vs recent history/.test(body), "");

run.section("The chart separates recorded from projected");
const chart = await page.evaluate(() => {
  const svg = document.querySelector("svg.recharts-surface");
  if (!svg) return null;
  return {
    lines: svg.querySelectorAll("path.recharts-curve").length,
    longest: Math.max(0, ...[...svg.querySelectorAll("path")].map((p) => (p.getAttribute("d") || "").length)),
    reference: svg.querySelectorAll(".recharts-reference-line").length,
  };
});
run.check("a chart is rendered", !!chart, "no recharts surface");
// Asserted on geometry: an <svg> can exist while drawing nothing.
run.check("it has real geometry", (chart?.longest ?? 0) > 50, `longest path ${chart?.longest}`);
run.check("recorded and projected are drawn as separate series", (chart?.lines ?? 0) >= 2, `${chart?.lines} curves`);
run.check("a boundary marks where the forecast starts", (chart?.reference ?? 0) >= 1, `${chart?.reference}`);

run.section("The written advice is present and formatted");
const advice = await page.evaluate(() => {
  const heading = [...document.querySelectorAll("div")].find((d) => d.textContent.trim() === "The adviser's read");
  const panel = heading?.parentElement;
  return { text: panel?.innerText || "", bold: panel?.querySelectorAll("strong").length ?? 0,
           scripts: panel?.querySelectorAll("script").length ?? 0 };
});
run.check("advice is substantial prose", advice.text.length > 200, `${advice.text.length} chars`);
run.check("emphasis renders, rather than raw asterisks",
  advice.bold > 0 && !advice.text.includes("**"), advice.text.slice(0, 160));
run.check("nothing executable is rendered from it", advice.scripts === 0);

run.section("Switching between forecasts");
await apiAs(page, "POST", "/predictions", {
  name: "Second outlook", datasetId: ds.body.id, target: "units",
  horizon: 3, period: "Monthly", algorithm: "Prophet", accuracy: 64.2,
  forecast: Array.from({ length: 3 }, (_, i) => ({
    i: i + 1, label: `2025-0${i + 1}-01`, value: 900 - i * 50, low: 850 - i * 50, high: 950 - i * 50,
  })),
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("text=Advising on", { timeout: 45000 });
await page.waitForTimeout(600);

body = await page.textContent("body");
run.check("the newest run is advised on by default", body.includes("Second outlook"), body.slice(0, 200));
run.check("a weak model is flagged as weak", /weak|gather more history/i.test(body), "");

await page.selectOption("select", { label: "Units outlook — 88.5%" });
// Scoped to the "Advising on" card: a bare text match would find the picker's
// own hidden <option>, which names every run and so is true before the page
// has changed at all.
await page.waitForFunction(() => {
  const label = [...document.querySelectorAll("div")].find((d) => d.textContent.trim() === "Advising on");
  return !!label?.parentElement?.innerText.includes("Units outlook");
}, { timeout: 45000 });
await page.waitForTimeout(600);
body = await page.textContent("body");
run.check("picking an earlier run switches the whole page", body.includes("Units outlook") && body.includes("88.5"), "");

run.check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
run.check("no failed API calls", failedRequests.length === 0, failedRequests.join(" | "));

await browser.close();
process.exit(run.finish() ? 0 : 1);
