/**
 * Client-side injection checks.
 *
 * Several places take user-supplied text and put it somewhere that renders
 * HTML — the PDF exports, the report list excerpt, the assistant's answers.
 * Each of those has been a real defect at some point, so they are pinned here.
 *
 * The payload is stored as the profile name, which is editable in the app and
 * therefore fully under a user's control.
 */
import { chromium } from "playwright";
import { createRun, BASE, apiAs } from "./_helpers.mjs";

const PAYLOAD = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1<\/script>Eve';

const run = createRun("injection");
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto(`${BASE}#/register`, { waitUntil: "networkidle" });
await page.fill('input[placeholder="Ada Lovelace"]', PAYLOAD);
await page.fill('input[type="email"]', `t${Date.now()}@aurai.test`);
await page.fill('input[placeholder="••••••••"]', "secret123");
await page.click('button[type="submit"]');
await page.waitForTimeout(3500);

run.section("The app itself");
run.check("a hostile display name is stored verbatim", (await page.textContent("body")).includes("Eve"));
run.check("and never executes in the app", !(await page.evaluate(() => window.__pwned)));

run.section("Profile PDF export");
await page.goto(`${BASE}#/profile`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
// print() blocks the popup, so it is neutralised before the export runs.
await page.addInitScript(() => { window.print = () => {}; });
const [popup] = await Promise.all([
  context.waitForEvent("page"),
  page.click('button:has-text("Export PDF")'),
]);
await popup.waitForLoadState("domcontentloaded").catch(() => {});
await popup.waitForTimeout(1500);

const exported = await popup.evaluate(() => ({
  pwned: !!window.__pwned,
  images: document.querySelectorAll("img").length,
  scripts: document.querySelectorAll("script").length,
  heading: document.querySelector("h1")?.textContent || "",
  hasContent: /Forecasts/.test(document.body.textContent || ""),
}));
run.check("nothing executes in the exported document", !exported.pwned);
run.check("no element is created from the payload",
  exported.images === 0 && exported.scripts === 0,
  `${exported.images} img, ${exported.scripts} script`);
run.check("the payload appears as literal text", exported.heading.includes("<img"), exported.heading);
run.check("the export still carries its real content", exported.hasContent);
await popup.close();

run.section("Report list excerpt");
// The excerpt is built server-side from stored HTML; it must arrive as text.
await apiAs(page, "POST", "/reports", {
  title: "Injection check",
  body: '<p>ok</p><img src=x onerror="window.__pwned=1"><script>window.__pwned=1<\/script>',
});
await page.goto(`${BASE}#/reports`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const list = await page.evaluate(() => ({
  pwned: !!window.__pwned,
  images: document.querySelectorAll("main img").length,
  scripts: document.querySelectorAll("main script").length,
}));
run.check("a hostile report body does not execute in the list", !list.pwned);
run.check("and creates no elements there",
  list.images === 0 && list.scripts === 0, `${list.images} img, ${list.scripts} script`);

await browser.close();
process.exit(run.finish() ? 0 : 1);
