/**
 * File exports. The CSV path matters most: it is what a non-technical reader
 * actually opens, so it has to survive Excel and commas in the data.
 */
import { createRun, signedInPage, apiAs, BASE } from "./_helpers.mjs";

const run = createRun("exports");
const { browser, page, errors } = await signedInPage();

const ds = await apiAs(page, "POST", "/datasets", {
  name: "history-source", rows: [{ m: "2024-01-01", v: 1 }], meta: { headers: ["m", "v"] },
});
// A name containing a comma and quotes, to prove the escaping is real.
await apiAs(page, "POST", "/predictions", {
  name: 'Q1 "core" revenue, north', datasetId: ds.body.id, target: "v",
  horizon: 3, period: "Monthly", algorithm: "Prophet", accuracy: 91.5,
  forecast: [
    { i: 1, label: "2024-02-01", value: 1200.5, low: 1150, high: 1250 },
    { i: 2, label: "2024-03-01", value: 1310.25, low: 1240, high: 1380 },
    { i: 3, label: "2024-04-01", value: 1425, low: 1330, high: 1520 },
  ],
});

await page.goto(`${BASE}#/predictions`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

run.section("Forecast CSV");
// `:text-is` rather than `:has-text`, which is a substring match and would
// also hit a dataset button whose name happens to contain "csv".
run.check("a CSV button is offered", !!(await page.$('button:text-is("CSV")')));

const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.click('button:text-is("CSV")'),
]);
const stream = await download.createReadStream();
let text = "";
for await (const chunk of stream) text += chunk;

run.check("downloads a .csv", download.suggestedFilename().endsWith(".csv"), download.suggestedFilename());
run.check("strips characters illegal in Windows filenames",
  !/[\\/:*?"<>|]/.test(download.suggestedFilename()), download.suggestedFilename());
run.check("starts with a UTF-8 BOM so Excel decodes it", text.charCodeAt(0) === 0xfeff);
run.check("has the forecast table header", text.includes("Period,Forecast,Lower bound,Upper bound"));
run.check("includes every row",
  text.includes("2024-02-01,1200.5,1150,1250") && text.includes("2024-04-01,1425,1330,1520"));
run.check("carries provenance", /Accuracy,91\.50?%/.test(text) && text.includes("Prophet"), text.slice(0, 200));
run.check("escapes embedded commas and quotes",
  text.includes('"Q1 ""core"" revenue, north"'), text.split("\r\n")[0]);
run.check("uses CRLF line endings", text.includes("\r\n"));

run.section("Forecast JSON");
const [jsonDownload] = await Promise.all([
  page.waitForEvent("download"),
  page.click('button[title="Download as JSON"]'),
]);
run.check("downloads a .json", jsonDownload.suggestedFilename().endsWith(".json"), jsonDownload.suggestedFilename());

run.check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
process.exit(run.finish() ? 0 : 1);
