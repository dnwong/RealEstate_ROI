#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { scrapeZillowListings } from "./zillowScrape.js";
import { summarizePrices } from "./stats.js";
import { cashOnCashReturn, grossRentalYield } from "./roi.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  try {
    const p = join(__dirname, "..", ".env");
    const raw = readFileSync(p, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // optional .env
  }
}

function parseArgs(argv) {
  const out = {};
  const rest = [...argv];
  while (rest.length) {
    const a = rest.shift();
    if (a === "--zip" || a === "-z") out.zip = rest.shift();
    else if (a === "--city" || a === "-c") out.city = rest.shift();
    else if (a === "--state" || a === "-s") out.state = rest.shift();
    else if (a === "--bedrooms" || a === "-b") out.bedrooms = rest.shift();
    else if (a === "--property-type" || a === "-p") out.propertyType = rest.shift();
    else if (a === "--limit" || a === "-l") out.limit = Number(rest.shift());
    else if (a === "--down-percent") out.downPercent = Number(rest.shift());
    else if (a === "--closing-costs") out.closingCosts = Number(rest.shift());
    else if (a === "--annual-expenses") out.annualExpenses = Number(rest.shift());
    else if (a === "--headed") out.headed = true;
    else if (a === "--no-chrome") out.useChromeChannel = false;
    else if (a === "--timeout") out.timeoutMs = Number(rest.shift());
    else if (a === "--output" || a === "-o") out.output = rest.shift();
    else if (a === "--quiet" || a === "-q") out.quiet = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function usage() {
  return `Real estate ROI helper — Zillow web scraping (testing)

Uses Playwright: waits for network JSON (search page state XHRs), then __NEXT_DATA__, then large inline script JSON. Zillow may still block; use --headed and clear consent/captcha if shown.

Requires Chromium once: npm run install-browser | npx playwright install chromium | node node_modules/playwright/cli.js install chromium
(Installing Google Chrome is recommended — the scraper uses it automatically when available.)

Usage:
  node src/cli.js --zip <5-digit> [options]
  node src/cli.js --city <City> --state <ST> [options]

Options:
  --bedrooms, -b        Keep listings with this bedroom count when known
  --property-type, -p  Substring match on home type when known (e.g. Single)
  --limit, -l          Max listings per category (default 200)
  --headed             Show browser (debug captchas / layout)
  --no-chrome          Use Playwright Chromium only (skip installed Google Chrome channel)
  --timeout            Page timeout ms (default 60000)
  --down-percent       Down payment %% for cash-on-cash (default 20)
  --closing-costs      Dollar closing costs on purchase (default 0)
  --annual-expenses    Annual operating costs (tax, insur., maint., etc.)
  --output, -o         Write full JSON report to this file
  --quiet, -q          Skip printing the large stats JSON to stdout (ROI lines still print)

Optional env: ZILLOW_USER_AGENT (custom UA), ZILLOW_USE_CHROME=0 (same as --no-chrome)

Examples:
  node src/cli.js --zip 78754
  node src/cli.js --zip 78754 -o report.json -q
  node src/cli.js --city Austin --state TX --bedrooms 3 --limit 300 --headed
`;
}

function pickScenarioPrice(saleSummary) {
  return saleSummary.median ?? saleSummary.mean;
}

function pickScenarioRent(rentSummary) {
  return rentSummary.median ?? rentSummary.mean;
}

function filterListings(listings, { bedrooms, propertyType }) {
  let out = listings;
  if (bedrooms != null && bedrooms !== "") {
    const b = Number(bedrooms);
    if (Number.isFinite(b)) {
      out = out.filter((l) => l.bedrooms == null || l.bedrooms === b);
    }
  }
  if (propertyType) {
    const p = String(propertyType).toLowerCase();
    out = out.filter(
      (l) =>
        l.homeType == null ||
        String(l.homeType).toLowerCase().includes(p)
    );
  }
  return out;
}

loadDotEnv();

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(usage());
  process.exit(0);
}

const regionQuery = {};
if (args.zip) regionQuery.zip = args.zip;
if (args.city) regionQuery.city = args.city;
if (args.state) regionQuery.state = args.state;

if (!regionQuery.zip && !(regionQuery.city && regionQuery.state)) {
  console.error("Provide --zip <code> OR both --city and --state (2-letter).\n");
  console.log(usage());
  process.exit(1);
}

const maxListings = Number.isFinite(args.limit)
  ? Math.min(2000, Math.max(1, args.limit))
  : 200;

const downPercent = Number.isFinite(args.downPercent)
  ? Math.min(100, Math.max(0, args.downPercent))
  : 20;
const closingCosts = Number.isFinite(args.closingCosts)
  ? Math.max(0, args.closingCosts)
  : 0;
const annualExpenses = Number.isFinite(args.annualExpenses)
  ? Math.max(0, args.annualExpenses)
  : 0;

const timeoutMs = Number.isFinite(args.timeoutMs)
  ? Math.max(5000, args.timeoutMs)
  : 60000;

async function main() {
  const scrapeOpts = {
    ...regionQuery,
    limit: maxListings,
    headed: Boolean(args.headed),
    timeoutMs,
    ...(args.useChromeChannel === false ? { useChromeChannel: false } : {}),
  };

  const [salePage, rentPage] = await Promise.all([
    scrapeZillowListings({ ...scrapeOpts, listingType: "sale" }),
    scrapeZillowListings({ ...scrapeOpts, listingType: "rent" }),
  ]);

  const filterOpts = {
    bedrooms: args.bedrooms,
    propertyType: args.propertyType,
  };
  let sales = filterListings(salePage.listings, filterOpts);
  let rentals = filterListings(rentPage.listings, filterOpts);

  const saleSummary = summarizePrices(sales, (n) => n > 0);
  const rentSummary = summarizePrices(rentals, (n) => n > 0);

  const listPrice = pickScenarioPrice(saleSummary);
  const monthlyRent = pickScenarioRent(rentSummary);

  const region = regionQuery.zip
    ? `ZIP ${regionQuery.zip}`
    : `${regionQuery.city}, ${regionQuery.state}`;

  const yieldPct = grossRentalYield(
    monthlyRent != null ? monthlyRent * 12 : null,
    listPrice
  );
  const downPayment =
    listPrice != null ? listPrice * (downPercent / 100) : null;
  const cashInvested =
    downPayment != null ? downPayment + closingCosts : null;
  const annualGrossRent = monthlyRent != null ? monthlyRent * 12 : null;
  const annualNoiSimple =
    annualGrossRent != null ? annualGrossRent - annualExpenses : null;
  const coc =
    cashInvested != null && annualNoiSimple != null
      ? cashOnCashReturn(annualNoiSimple, cashInvested)
      : null;

  const report = {
    generatedAt: new Date().toISOString(),
    region,
    saleUrl: salePage.url,
    rentUrl: rentPage.url,
    filters: filterOpts,
    saleSummary,
    rentSummary,
    listingCounts: { sales: sales.length, rentals: rentals.length },
    listings: { sales, rentals },
    metrics:
      listPrice != null && monthlyRent != null
        ? {
            listPriceRepresentative: listPrice,
            monthlyRentRepresentative: monthlyRent,
            grossRentalYieldPercent: yieldPct,
            cashOnCashPreDebtPercent: coc,
            downPercent,
            closingCosts,
            annualExpenses,
          }
        : null,
  };

  if (!args.quiet) {
    console.log(
      JSON.stringify(
        {
          region,
          saleUrl: salePage.url,
          rentUrl: rentPage.url,
          saleSummary,
          rentSummary,
          sampleSaleZpids: sales.slice(0, 5).map((l) => l.zpid),
          sampleRentZpids: rentals.slice(0, 5).map((l) => l.zpid),
        },
        null,
        2
      )
    );
  }

  if (args.output?.trim()) {
    const outPath = args.output.trim();
    const dir = dirname(outPath);
    if (dir && dir !== ".") mkdirSync(dir, { recursive: true });
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
    console.error(`Wrote report: ${outPath}`);
  }

  if (listPrice == null || monthlyRent == null) {
    console.error(
      "\nNot enough parsed prices (sale and/or rent). Try --headed, another ZIP, or check if Zillow served a challenge page."
    );
    process.exit(2);
  }

  console.log("\n--- ROI-style metrics (illustrative) ---");
  console.log(
    `Using representative list price: $${listPrice.toFixed(0)} (median preferred)`
  );
  console.log(
    `Using representative monthly rent: $${monthlyRent.toFixed(0)} (median preferred)`
  );
  console.log(
    `Gross rental yield (annual rent / list price): ${yieldPct?.toFixed(2) ?? "n/a"}%`
  );
  console.log(
    `Cash-on-cash (pre-debt service): ${coc?.toFixed(2) ?? "n/a"}% — assumes ${downPercent}% down, closing $${closingCosts}, annual expenses $${annualExpenses} (loan payments not subtracted)`
  );
  console.log(
    "\nNote: Scraped asking prices change with Zillow's HTML/JSON. Not financial advice."
  );
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
