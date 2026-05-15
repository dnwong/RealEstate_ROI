import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const v = JSON.parse(
  readFileSync("node_modules/playwright/package.json", "utf8")
).version;
const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH || "(default)";

console.log(`playwright npm ${v}, browsers at ${browsersPath}`);

const browser = await chromium.launch({ headless: true });
await browser.close();
console.log("chromium launch ok");
