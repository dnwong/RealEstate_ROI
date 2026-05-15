#!/usr/bin/env node
import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { scrapeZillowListings } from "./zillowScrape.js";
import { compareSalesToRentComps } from "./compare.js";

function playwrightInfo() {
  try {
    const v = JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "playwright", "package.json"),
        "utf8"
      )
    ).version;
    return {
      playwrightVersion: v,
      browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH || null,
    };
  } catch {
    return { playwrightVersion: null, browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH || null };
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

const app = express();
app.disable("x-powered-by");
app.use(express.json());
app.use(express.static(publicDir));

function parseZip(q) {
  if (!q || typeof q !== "string") return null;
  const z = q.replace(/\D/g, "").slice(0, 5);
  return z.length === 5 ? z : null;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ...playwrightInfo() });
});

app.get("/api/compare", async (req, res) => {
  const zip = parseZip(req.query.zip);
  const city = req.query.city?.trim();
  const state = req.query.state?.trim()?.toUpperCase();
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(300, Math.max(10, limitRaw))
    : 100;
  const minCompsRaw = Number(req.query.minComps);
  const minComps = Number.isFinite(minCompsRaw)
    ? Math.min(20, Math.max(1, minCompsRaw))
    : 3;
  const preferType = String(req.query.preferType || "") === "1";
  const headed = String(req.query.headed || "") === "1";
  const useChrome = req.query.useChrome !== "0";
  const timeoutRaw = Number(req.query.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw)
    ? Math.min(120000, Math.max(15000, timeoutRaw))
    : 90000;

  if (!zip && !(city && state)) {
    res.status(400).json({
      error: "Provide zip (5 digits) or both city and state (e.g. state=TX).",
    });
    return;
  }

  const region = zip ? { zip } : { city, state: state?.toLowerCase() };

  try {
    const scrapeOpts = {
      ...region,
      limit,
      headed,
      useChromeChannel: useChrome,
      timeoutMs,
    };

    const [salePage, rentPage] = await Promise.all([
      scrapeZillowListings({ ...scrapeOpts, listingType: "sale" }),
      scrapeZillowListings({ ...scrapeOpts, listingType: "rent" }),
    ]);

    if (!salePage.listings.length || !rentPage.listings.length) {
      res.status(422).json({
        error:
          "Not enough listings parsed (sale and/or rent empty). Zillow may be blocking automation—try the web form option “Show browser (headed)”, install Google Chrome, or run the CLI with --headed.",
        saleUrl: salePage.url,
        rentUrl: rentPage.url,
        saleCount: salePage.listings.length,
        rentCount: rentPage.listings.length,
      });
      return;
    }

    const rows = compareSalesToRentComps(
      salePage.listings,
      rentPage.listings,
      { minComps, preferType }
    );

    res.json({
      region: zip ? `ZIP ${zip}` : `${city}, ${state}`,
      saleUrl: salePage.url,
      rentUrl: rentPage.url,
      saleCount: salePage.listings.length,
      rentCount: rentPage.listings.length,
      minComps,
      preferType,
      rows,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";
const server = app.listen(port, host, () => {
  const hint =
    host === "0.0.0.0"
      ? ` (all interfaces — use http://127.0.0.1:${port}/ or your host IP)`
      : "";
  console.error(`Compare UI: http://127.0.0.1:${port}/${hint}`);
});
server.requestTimeout = 180000;
server.headersTimeout = 185000;
server.keepAliveTimeout = 185000;
