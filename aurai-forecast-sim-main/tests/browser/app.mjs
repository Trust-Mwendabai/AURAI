/**
 * Cross-cutting UI behaviour: auth screens, the dashboard reading real rows,
 * settings persistence, the chat overlay, and the report editor's save
 * semantics.
 */
import { createRun, signedInPage, apiAs, statTile, BASE } from "./_helpers.mjs";

const run = createRun("app");
const { browser, page, email, errors, failedRequests } = await signedInPage();
// Navigating to the hash already showing is a same-document no-op, so the
// route never remounts and stale data stays on screen. Reload in that case.
const go = async (hash) => {
  const target = `${BASE}#/${hash}`;
  if (page.url() === target) await page.reload({ waitUntil: "networkidle" });
  else await page.goto(target, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
};

run.section("Authentication");
run.check("registering lands on the dashboard", page.url().includes("#/dashboard"), page.url());

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2500);
run.check("the session survives a reload", page.url().includes("#/dashboard"), page.url());

await page.evaluate(() => localStorage.removeItem("aurai_token"));
// Navigating to the hash we are already on is a no-op, so reload to make the
// route guard re-run.
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2500);
run.check("without a token you are sent to login", page.url().includes("#/login"), page.url());

await page.fill('input[type="email"]', email);
await page.fill('input[placeholder="••••••••"]', "secret123");
run.check("the password is masked by default",
  (await page.getAttribute('input[placeholder="••••••••"]', "type")) === "password");
await page.click('button[aria-label="Show password"]');
await page.waitForTimeout(300);
run.check("the reveal toggle shows it",
  (await page.getAttribute('input[placeholder="••••••••"]', "type")) === "text");
run.check("and keeps the typed value",
  (await page.inputValue('input[placeholder="••••••••"]')) === "secret123");
await page.click('button[aria-label="Hide password"]');
await page.click('button[type="submit"]');
await page.waitForTimeout(3500);
run.check("signing back in works", page.url().includes("#/dashboard"), page.url());

run.section("Dashboard shows real data, not placeholders");
let body = await page.textContent("body");
run.check("an empty workspace prompts rather than inventing numbers",
  body.includes("No forecasts yet") || body.includes("Import a dataset"), body.slice(0, 250));
run.check("no fabricated finance widgets", !body.includes("Retail BTC") && !body.includes("$9.3M"));

await apiAs(page, "POST", "/datasets", { name: "seed.csv", rows: [{ m: "2024-01-01", v: 1 }], meta: { headers: ["m", "v"] } })
  .then((r) => apiAs(page, "POST", "/predictions", {
    name: "Seeded forecast", datasetId: r.body.id, target: "v", horizon: 3, period: "Monthly",
    algorithm: "Prophet", accuracy: 88.25,
    // Several points: a chart needs at least two, and the embedding checks
    // below rely on this run being renderable.
    forecast: Array.from({ length: 6 }, (_, i) => ({
      i: i + 1, label: `2024-0${i + 2}-01`, value: 120 + i * 8, low: 110 + i * 8, high: 130 + i * 8,
    })),
  }));
await go("dashboard");
body = await page.textContent("body");
run.check("counts come from the database", (await statTile(page, "Forecasts run")) === "1", `got ${await statTile(page, "Forecasts run")}`);
run.check("accuracy is shown as stored", body.includes("88.25"), body.slice(0, 300));

run.section("Settings persist to the account");
await go("settings");
const nameField = (await page.$$("input"))[1];
await nameField.click({ clickCount: 3 });
await nameField.type("Acme Analytics");
await page.waitForTimeout(2500);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(3000);
run.check("a changed setting survives a reload",
  (await page.textContent("body")).includes("Acme Analytics"), (await page.textContent("body")).slice(0, 200));

run.section("Assistant");
await go("aurai");
await page.fill('input[placeholder*="Ask about"]', "how accurate are my models");
await page.click('button[aria-label="Send message"]');
// Waiting for the reply to appear, not for a fixed delay: a Gemini-reasoned
// answer takes several seconds where the deterministic fallback is instant,
// and a timeout long enough for one wastes the whole suite's time on the other.
await page.waitForSelector('[data-role="assistant"]', { timeout: 40000 });
await page.waitForTimeout(500);
body = await page.textContent("body");
// The stored accuracy is 88.25. The reasoning model quotes figures from the
// workspace but may round one on the way, so a rounded form still proves the
// answer came from this user's row rather than from invention.
run.check("answers from real rows", /88\.(2|3)/.test(body), body.slice(-250));
run.check("renders bold rather than literal asterisks", !body.includes("**"), body.slice(-200));

run.section("Conversations overlay");
const panelOpen = async () => !!(await page.$('button[aria-label="Close conversations"]'));
run.check("starts collapsed", !(await panelOpen()));
await page.click('button[aria-label="Show conversations"]');
await page.waitForTimeout(1000);
run.check("opens from the header", await panelOpen());
run.check("the thread is auto-titled from its first message",
  (await page.textContent("body")).includes("how accurate"), "");
await page.keyboard.press("Escape");
await page.waitForTimeout(1000);
run.check("Escape closes it", !(await panelOpen()));

run.section("Report editor");
await go("reports");
await page.click('button:has-text("New report")');
await page.waitForTimeout(1500);
const writes = [];
page.on("request", (r) => { if (r.url().endsWith("/reports") && r.method() === "POST") writes.push(1); });
await page.waitForTimeout(8000);
run.check("an idle editor does not write on a timer", writes.length === 0, `${writes.length} writes while idle`);

await page.click("[contenteditable]");
await page.keyboard.type("Revenue held steady through Q2.");
await page.waitForTimeout(6000);
run.check("autosave writes once something changed", writes.length >= 1, `${writes.length} writes`);

await page.click('button:has-text("Back")');
await page.waitForTimeout(2500);
run.check("the excerpt is plain text, not markup",
  !(await page.textContent("body")).includes("<p>"));

await page.click("text=Revenue held steady");
await page.waitForFunction(
  () => (document.querySelector("[contenteditable]")?.textContent || "").trim().length > 0,
  { timeout: 15000 },
).catch(() => {});
run.check("a saved report reopens with its content",
  (await page.textContent("[contenteditable]")).includes("Revenue held steady"),
  await page.textContent("[contenteditable]"));

run.section("Embedding a forecast in a report");
await page.click('button:has-text("Forecast")');
await page.waitForTimeout(1500);
run.check("the picker lists saved forecasts",
  (await page.textContent("body")).includes("Seeded forecast"), "");

await page.click('button:has-text("Chart + written advice")');
// The advice is written by the model when a key is configured, which takes
// far longer than the instant built-in version. Waiting for the embed itself
// covers both without a timeout tuned to whichever one happens to run.
await page.waitForSelector("[contenteditable] svg", { timeout: 45000 });
await page.waitForTimeout(500);
const embedded = await page.evaluate(() => {
  const ed = document.querySelector("[contenteditable]");
  const svg = ed.querySelector("svg");
  return {
    hasSvg: !!svg,
    longestPath: svg ? Math.max(0, ...[...svg.querySelectorAll("path")].map((p) => (p.getAttribute("d") || "").length)) : 0,
    caption: ed.querySelector("figcaption")?.textContent || "",
    text: ed.innerText,
    bold: ed.querySelectorAll("strong").length,
    scripts: ed.querySelectorAll("script").length,
    size: ed.innerHTML.length,
  };
});
run.check("the chart embeds as inline SVG", embedded.hasSvg);
// Asserted on geometry: an <svg> can exist while drawing nothing.
run.check("the chart has real geometry", embedded.longestPath > 50, `longest path ${embedded.longestPath}`);
run.check("a caption records the run's settings", embedded.caption.length > 0, embedded.caption);
// Length rather than phrasing: the reasoned version and the built-in one say
// the same things in different words, and both are correct here.
run.check("written advice comes with it", embedded.text.length > 200, embedded.text.slice(0, 200));
run.check("advice is formatted, not raw asterisks", embedded.bold > 0 && !embedded.text.includes("**"));
run.check("nothing executable is injected", embedded.scripts === 0);
// A rasterised chart would be two orders of magnitude larger.
run.check("the embed stays compact", embedded.size < 40000, `${embedded.size} chars`);

await page.click('button:has-text("Back")');
await page.waitForTimeout(2500);
// Reopened by position: the card excerpt now begins with the inserted advice,
// so the original body text is no longer a reliable handle.
await page.locator("div.cursor-pointer").first().click();
await page.waitForFunction(
  () => (document.querySelector("[contenteditable]")?.innerHTML || "").length > 100,
  { timeout: 15000 },
).catch(() => {});
run.check("the embedded chart survives save and reopen",
  !!(await page.$("[contenteditable] svg")));

run.check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
run.check("no failed API calls", failedRequests.length === 0, failedRequests.join(" | "));

await browser.close();
process.exit(run.finish() ? 0 : 1);
