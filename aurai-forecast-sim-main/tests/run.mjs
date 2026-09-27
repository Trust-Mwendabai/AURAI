#!/usr/bin/env node
/**
 * Runs every test suite and reports a single tally.
 *
 *   node tests/run.mjs                  API + browser suites
 *   node tests/run.mjs --api            API suites only (fast)
 *   node tests/run.mjs --browser        browser suites only
 *   node tests/run.mjs --with-forecast  also train real Prophet models (slow)
 *
 * Apache and MySQL must be running. --with-forecast additionally needs the two
 * Python services; see backend/Python.
 */
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const only = args.find((a) => a === "--api" || a === "--browser");
const withForecast = args.includes("--with-forecast");

const PHP = process.env.PHP_BIN || "C:\\xampp\\php\\php.exe";

const apiSuites = [
  ["crud", "Core CRUD and per-user isolation"],
  ["workspace", "Dashboard stats, settings and the assistant"],
  ["security", "Throttling, session pruning and payload shape"],
  ["assistant", "Intent routing and conversation context"],
  ["analytics", "Segment analytics over a dataset"],
  ...(withForecast ? [["forecast", "Prophet training and model reuse"]] : []),
];

const browserSuites = [
  ["app", "Auth, dashboard, settings, chat and reports"],
  ["dataset", "Import, preview and cleaning"],
  ["predictions", "Forecast comparison"],
  ["insights", "The business adviser page"],
  ["exports", "CSV and JSON downloads"],
  ["injection", "Client-side injection defences"],
];

let failed = 0;
const ran = [];

function heading(text) {
  console.log(`\n${"=".repeat(72)}\n${text}\n${"=".repeat(72)}`);
}

function runSuite(label, command, commandArgs) {
  heading(label);
  const res = spawnSync(command, commandArgs, { stdio: "inherit", shell: false });
  const ok = res.status === 0;
  if (!ok) failed++;
  ran.push([label, ok]);
  return ok;
}

if (only !== "--browser") {
  if (!existsSync(PHP)) {
    console.error(`PHP not found at ${PHP}. Set PHP_BIN to override.`);
    process.exit(2);
  }
  for (const [file, label] of apiSuites) {
    runSuite(`API — ${label}`, PHP, [join(here, "api", `${file}.php`)]);
  }
}

if (only !== "--api") {
  for (const [file, label] of browserSuites) {
    runSuite(`Browser — ${label}`, process.execPath, [join(here, "browser", `${file}.mjs`)]);
  }
}

if (!withForecast && only !== "--browser") {
  console.log("\nSkipped the Prophet suite (slow). Run with --with-forecast to include it.");
}

// The browser suites create accounts too, and have no PHP shutdown hook to
// tidy them, so sweep once at the end. Only the .test domain is touched.
function cleanupTestAccounts() {
  const mysql = process.env.MYSQL_BIN || "C:\\xampp\\mysql\\bin\\mysql.exe";
  if (!existsSync(mysql)) return;
  const res = spawnSync(mysql, ["-u", "root", "aurai_forecast", "-e",
    "DELETE FROM users WHERE email LIKE '%@aurai.test'; DELETE FROM login_attempts;"], { shell: false });
  if (res.status === 0) console.log("\nRemoved the accounts these tests created.");
}
cleanupTestAccounts();

heading("Summary");
for (const [label, ok] of ran) console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}`);
console.log(`\n${ran.length - failed}/${ran.length} suites passed.`);
process.exit(failed === 0 ? 0 : 1);
