/**
 * Shared harness for the browser tests.
 *
 * Each suite registers a throwaway account on the `.test` domain and works
 * only inside it, so running the tests never touches real data. The API
 * suites' bootstrap removes those accounts afterwards; `npm run test` does it
 * at the end of a full run.
 */
import { chromium } from "playwright";

export const BASE = process.env.AURAI_URL || "http://localhost/Aurai/aurai-forecast-sim-main/dist/";

export function createRun(name) {
  const results = [];
  return {
    check(label, ok, detail = "") {
      results.push([label, ok]);
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
      if (!ok && detail) console.log(`        ${String(detail).replace(/\s+/g, " ").slice(0, 200)}`);
      return ok;
    },
    section(title) {
      console.log(`\n${title}\n${"-".repeat(Math.max(4, title.length))}`);
    },
    finish() {
      const failed = results.filter(([, ok]) => !ok);
      console.log(
        failed.length === 0
          ? `\nAll ${results.length} checks passed.`
          : `\n${results.length - failed.length} passed, ${failed.length} failed:\n  - ${failed.map(([l]) => l).join("\n  - ")}`,
      );
      return failed.length === 0;
    },
  };
}

/** Launches a browser, registers a fresh account and lands on the dashboard. */
export async function signedInPage({ width = 1440, height = 950 } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage({ viewport: { width, height } });

  const errors = [];
  const failedRequests = [];
  page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/DevTools/i.test(m.text())) errors.push(m.text()); });
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
  });

  const email = `t${Date.now()}${Math.floor(Math.random() * 1000)}@aurai.test`;
  await page.goto(`${BASE}#/register`, { waitUntil: "networkidle" });
  await page.fill('input[placeholder="Ada Lovelace"]', "Test User");
  await page.fill('input[type="email"]', email);
  await page.fill('input[placeholder="••••••••"]', "secret123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/#\/dashboard/, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  return { browser, page, email, errors, failedRequests };
}

/** Calls the API as the signed-in user, for seeding fixtures quickly. */
export async function apiAs(page, method, path, body) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const token = localStorage.getItem("aurai_token");
      const res = await fetch(`../api${path}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { method, path, body },
  );
}

/** Reads a labelled stat tile, e.g. statTile(page, "Rows"). */
export function statTile(page, label) {
  return page.evaluate((label) => {
    const el = [...document.querySelectorAll("div")]
      .find((d) => d.children.length === 0 && d.textContent.trim() === label);
    return el ? el.parentElement.textContent.replace(label, "").trim() : null;
  }, label);
}

export function csvFixture(columns, rowCount, startYear = 2022) {
  const lines = [columns.join(",")];
  for (let i = 0; i < rowCount; i++) {
    const date = new Date(startYear, i, 1).toISOString().slice(0, 10);
    lines.push([date, ...columns.slice(1).map((_, c) => 100 + i * (c + 3))].join(","));
  }
  return lines.join("\n");
}
