/**
 * The forecast comparison view: overlaying saved runs to judge them against
 * each other.
 *
 * Runs are seeded through the API with deliberately distinct shapes (rising,
 * falling, flat, spiky) so the chart and the change column have something
 * unambiguous to report.
 */
import { createRun, signedInPage, apiAs, BASE } from "./_helpers.mjs";

const run = createRun("predictions");
const { browser, page, errors } = await signedInPage({ height: 1200 });

const ds = await apiAs(page, "POST", "/datasets", {
  name: "src.csv", rows: [{ m: "2024-01-01", v: 1 }], meta: { headers: ["m", "v"] },
});
const shapes = [
  ["Rising run", (i) => 100 + i * 10],
  ["Falling run", (i) => 200 - i * 8],
  ["Flat run", () => 150],
  ["Spiky run", (i) => (i % 2 ? 90 : 210)],
  ["Fifth run", (i) => 120 + i * 2],
];
for (const [name, fn] of shapes) {
  await apiAs(page, "POST", "/predictions", {
    name, datasetId: ds.body.id, target: "v", horizon: 8, period: "Monthly",
    algorithm: "Prophet", accuracy: 85,
    forecast: Array.from({ length: 8 }, (_, i) => ({
      i: i + 1, label: `2024-0${i + 1}-01`, value: fn(i), low: fn(i) - 10, high: fn(i) + 10,
    })),
  });
}

await page.goto(`${BASE}#/predictions`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

run.section("Selecting runs");
const boxes = await page.$$('input[type="checkbox"]');
run.check("every history row can be selected", boxes.length === 5, `${boxes.length} checkboxes`);
run.check("nothing is compared until two are picked", !(await page.textContent("body")).includes("Comparing"));

// Selected by name, not position: all five are seeded within the same second
// and `created_at` is second-precision, so history order is not stable.
const tick = async (name) => {
  const box = page.locator("label", { hasText: name }).locator('input[type="checkbox"]');
  await box.check();
  await page.waitForTimeout(500);
};

await tick("Rising run");
run.check("one run is not a comparison", !(await page.textContent("body")).includes("Comparing"));

await tick("Falling run");
await page.waitForTimeout(800);
let body = await page.textContent("body");
run.check("two runs open the comparison", body.includes("Comparing 2 forecasts"), body.slice(0, 200));
run.check("each run is named in the legend", body.includes("Rising run") && body.includes("Falling run"));

run.section("The chart is actually drawn");
// Asserting on path geometry rather than a screenshot: a line element can
// exist while rendering nothing.
const curves = await page.evaluate(() =>
  [...document.querySelectorAll(".recharts-line-curve")].map((p) => ({
    length: (p.getAttribute("d") || "").length,
    stroke: p.getAttribute("stroke"),
  })));
run.check("one line per selected run", curves.length === 2, `${curves.length} curves`);
run.check("each line has real geometry", curves.every((c) => c.length > 50), JSON.stringify(curves));
run.check("lines use distinct colours", new Set(curves.map((c) => c.stroke)).size === 2, JSON.stringify(curves));

run.section("Scaling and the cap");
await tick("Flat run");
await tick("Spiky run");
run.check("scales to four runs", (await page.textContent("body")).includes("Comparing 4 forecasts"));

const fifth = page.locator("label", { hasText: "Fifth run" }).locator('input[type="checkbox"]');
run.check("a fifth is blocked at the cap", await fifth.isDisabled());

run.section("Summary table");
const changes = await page.evaluate(() => {
  const table = [...document.querySelectorAll("table")].find((t) => t.textContent.includes("Change"));
  if (!table) return null;
  return [...table.querySelectorAll("tbody tr")].map((tr) => {
    const cells = [...tr.querySelectorAll("td")].map((td) => td.textContent.trim());
    return { name: cells[0], change: cells[6] };
  });
});
run.check("reports a change per run", (changes || []).length === 4, JSON.stringify(changes));
run.check("a rising run reads positive",
  changes?.find((c) => c.name.includes("Rising"))?.change.startsWith("+"), JSON.stringify(changes));
run.check("a falling run reads negative",
  changes?.find((c) => c.name.includes("Falling"))?.change.startsWith("-"), JSON.stringify(changes));
run.check("a flat run reads as no change",
  changes?.find((c) => c.name.includes("Flat"))?.change.includes("0.0"), JSON.stringify(changes));

await page.click('button:has-text("Clear")');
await page.waitForTimeout(800);
run.check("Clear dismisses the comparison", !(await page.textContent("body")).includes("Comparing"));

run.check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
process.exit(run.finish() ? 0 : 1);
