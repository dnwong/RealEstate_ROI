#!/usr/bin/env node
import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { scrapeZillowListings } from "./zillowScrape.js";
import { compareSalesToRentComps } from "./compare.js";
import {
  getArchivedSearch,
  initDb,
  isArchiveEnabled,
  listArchivedSearches,
  saveArchivedSearch,
} from "./db.js";

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

const buildId = process.env.BUILD_ID || process.env.GITHUB_SHA || "local";

function parseZip(q) {
  if (!q || typeof q !== "string") return null;
  const z = q.replace(/\D/g, "").slice(0, 5);
  return z.length === 5 ? z : null;
}

function healthPayload() {
  const inDocker =
    process.env.PLAYWRIGHT_IN_DOCKER === "1" || existsSync("/.dockerenv");
  return { ok: true, buildId, inDocker, archiveEnabled: isArchiveEnabled(), ...playwrightInfo() };
}

app.get("/health", (_req, res) => {
  res.json(healthPayload());
});

app.get("/api/health", (_req, res) => {
  res.json(healthPayload());
});

app.use(express.static(publicDir));

app.get("/api/archives", async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
    res.json({
      archiveEnabled: isArchiveEnabled(),
      searches: await listArchivedSearches(limit),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

app.get("/api/archives/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid archive id." });
      return;
    }
    const archived = await getArchivedSearch(id);
    if (!archived) {
      res.status(404).json({ error: "Archived search not found." });
      return;
    }
    res.json({
      archiveId: archived.id,
      archivedAt: archived.created_at,
      region: archived.region,
      saleUrl: archived.sale_url,
      rentUrl: archived.rent_url,
      saleCount: archived.sale_count,
      rentCount: archived.rent_count,
      minComps: archived.min_comps,
      preferType: archived.prefer_type,
      maxAge: archived.query?.maxAge ?? null,
      rows: archived.rows,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
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
  const inDocker =
    process.env.PLAYWRIGHT_IN_DOCKER === "1" || existsSync("/.dockerenv");
  const useChrome = !inDocker && req.query.useChrome !== "0";
  const timeoutRaw = Number(req.query.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw)
    ? Math.min(120000, Math.max(15000, timeoutRaw))
    : 90000;
  const maxAgeRaw = Number(req.query.maxAge);
  const maxAge = Number.isFinite(maxAgeRaw)
    ? Math.min(300, Math.max(0, maxAgeRaw))
    : null;

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

    const currentYear = new Date().getFullYear();
    const saleListings = maxAge == null
      ? salePage.listings
      : salePage.listings.filter(
          (l) =>
            l.yearBuilt != null &&
            Number.isFinite(l.yearBuilt) &&
            Math.max(0, currentYear - l.yearBuilt) <= maxAge
        );

    if (!saleListings.length || !rentPage.listings.length) {
      res.status(422).json({
        error:
          maxAge == null
            ? "Not enough listings parsed (sale and/or rent empty). Zillow may be blocking automation—try the web form option “Show browser (headed)”, install Google Chrome, or run the CLI with --headed."
            : "No sale listings matched the max home age filter. Try increasing max age or leaving it blank.",
        saleUrl: salePage.url,
        rentUrl: rentPage.url,
        saleCount: saleListings.length,
        rentCount: rentPage.listings.length,
      });
      return;
    }

    const rows = compareSalesToRentComps(
      saleListings,
      rentPage.listings,
      { minComps, preferType }
    );

    const payload = {
      region: zip ? `ZIP ${zip}` : `${city}, ${state}`,
      saleUrl: salePage.url,
      rentUrl: rentPage.url,
      saleCount: saleListings.length,
      rentCount: rentPage.listings.length,
      minComps,
      preferType,
      maxAge,
      rows,
    };

    const archived = await saveArchivedSearch({
      ...payload,
      zip,
      city: city || null,
      state: state || null,
      query: { zip, city: city || null, state: state || null, limit, minComps, preferType, maxAge },
      saleListings,
      rentListings: rentPage.listings,
    });

    res.json({
      ...payload,
      archiveId: archived?.id ?? null,
      archivedAt: archived?.created_at ?? null,
      archiveEnabled: isArchiveEnabled(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

initDb().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`Archive DB init failed: ${msg}`);
});

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";
const server = app.listen(port, host, () => {
  const hint =
    host === "0.0.0.0"
      ? ` (all interfaces — use http://127.0.0.1:${port}/ or your host IP)`
      : "";
  console.error(`Compare UI: http://127.0.0.1:${port}/${hint}`);
  console.error(`Health: http://127.0.0.1:${port}/health (build ${buildId})`);
});
server.requestTimeout = 180000;
server.headersTimeout = 185000;
server.keepAliveTimeout = 185000;
