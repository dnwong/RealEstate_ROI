import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { buildZillowSearchUrl } from "./zillowUrls.js";

function isDockerRuntime() {
  return (
    process.env.PLAYWRIGHT_IN_DOCKER === "1" || existsSync("/.dockerenv")
  );
}

const SEC_CH_UA =
  '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"';

function defaultUserAgent() {
  if (process.env.ZILLOW_USER_AGENT?.trim()) return process.env.ZILLOW_USER_AGENT.trim();
  if (process.platform === "darwin") {
    return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  }
  if (process.platform === "linux") {
    return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  }
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
}

function secChPlatform() {
  if (process.platform === "darwin") return '"macOS"';
  if (process.platform === "linux") return '"Linux"';
  return '"Windows"';
}

/**
 * Prefer real Google Chrome when installed (often blocked less than bundled Chromium).
 * @param {boolean} headed
 * @param {boolean} tryChromeChannel
 */
async function launchZillowBrowser(headed, tryChromeChannel) {
  const common = {
    headless: !headed,
    args: ["--disable-blink-features=AutomationControlled"],
  };
  if (tryChromeChannel) {
    try {
      return await chromium.launch({ ...common, channel: "chrome" });
    } catch {
      // Chrome not installed or channel unavailable
    }
  }
  return chromium.launch(common);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseMoney(val) {
  if (val == null) return null;
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const digits = val.replace(/[^\d]/g, "");
    if (!digits) return null;
    return Number(digits);
  }
  if (typeof val === "object" && val != null) {
    if (typeof val.value === "number") return val.value;
    if (typeof val.value === "string") return parseMoney(val.value);
  }
  return null;
}

function pickPrice(obj) {
  const candidates = [
    obj.unformattedPrice,
    obj.unformattedRent,
    obj.price,
    obj.rentZestimate,
    obj.zestimate,
    obj.hdpData?.price,
    obj.hdpData?.homeInfo?.price,
    obj.hdpData?.homeInfo?.rentZestimate,
    obj.miniCardData?.unformattedPrice,
    obj.miniCardData?.price,
  ];
  for (const c of candidates) {
    const n = parseMoney(c);
    if (n != null && n > 0) return n;
  }
  return null;
}

function pickBeds(obj) {
  const b =
    obj.beds ??
    obj.bedrooms ??
    obj.bed ??
    obj.hdpData?.homeInfo?.bedrooms ??
    obj.miniCardData?.beds;
  if (typeof b === "number" && Number.isFinite(b)) return b;
  if (typeof b === "string" && /^\d+(\.\d+)?$/.test(b)) return Number(b);
  return null;
}

function pickHomeType(obj) {
  return (
    obj.homeType ??
    obj.propertyTypeDimension ??
    obj.hdpData?.homeInfo?.homeType ??
    obj.miniCardData?.homeType ??
    null
  );
}

function pickAddress(obj) {
  if (obj.formattedAddress) return String(obj.formattedAddress);
  const parts = [
    obj.addressLine1,
    obj.addressLine2,
    obj.city,
    obj.state,
    obj.zipCode,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** First line of a comma-separated formatted address (street-only fallback). */
function streetFromFormattedAddress(addr) {
  if (addr == null || typeof addr !== "string") return null;
  const i = addr.indexOf(",");
  const line = (i === -1 ? addr : addr.slice(0, i)).trim();
  return line || null;
}

/** Street line only (no city/state), when Zillow exposes it on cards / hdpData. */
function pickStreetAddress(obj) {
  const s =
    (typeof obj.streetAddress === "string" && obj.streetAddress.trim()) ||
    (typeof obj.hdpData?.homeInfo?.streetAddress === "string" &&
      obj.hdpData.homeInfo.streetAddress.trim()) ||
    (typeof obj.miniCardData?.streetAddress === "string" &&
      obj.miniCardData.streetAddress.trim()) ||
    null;
  if (s) return s;
  const l1 = obj.addressLine1;
  if (l1) {
    const l2 = obj.addressLine2;
    return l2 ? `${l1}, ${l2}` : String(l1);
  }
  return null;
}

/** Monthly HOA in USD when present on search/detail fragments (often sparse). */
function pickHoaMonthly(obj) {
  const hi = obj.hdpData?.homeInfo;
  const rf = obj.resoFacts;
  const mini = obj.miniCardData;
  const candidates = [
    obj.monthlyHoaFee,
    obj.monthlyHoa,
    obj.hoaFee,
    obj.hoa,
    hi?.monthlyHoaFee,
    hi?.hoaFee,
    mini?.monthlyHoaFee,
    rf?.monthlyHoaFee,
    rf?.hoaFee,
  ];
  for (const c of candidates) {
    const n = parseMoney(c);
    if (n != null && n > 0) return n;
  }
  return null;
}

function createListingRow(zpid, price, obj) {
  const address = pickAddress(obj);
  const street = pickStreetAddress(obj) ?? streetFromFormattedAddress(address);
  return {
    zpid,
    price,
    bedrooms: pickBeds(obj),
    homeType: pickHomeType(obj),
    address,
    streetAddress: street,
    sqft: pickSqft(obj),
    hoaMonthly: pickHoaMonthly(obj),
  };
}

function enrichListingFromObj(row, obj) {
  if (row.bedrooms == null) {
    const b = pickBeds(obj);
    if (b != null) row.bedrooms = b;
  }
  if (row.homeType == null) row.homeType = pickHomeType(obj);
  if (row.address == null) {
    const a = pickAddress(obj);
    if (a) row.address = a;
  }
  if (row.streetAddress == null) {
    const st =
      pickStreetAddress(obj) ??
      streetFromFormattedAddress(row.address ?? pickAddress(obj));
    if (st) row.streetAddress = st;
  }
  if (row.sqft == null) {
    const sq = pickSqft(obj);
    if (sq != null) row.sqft = sq;
  }
  if (row.hoaMonthly == null) {
    const h = pickHoaMonthly(obj);
    if (h != null) row.hoaMonthly = h;
  }
}

function pickSqft(obj) {
  const s =
    obj.livingArea ??
    obj.livingAreaValue ??
    obj.squareFootage ??
    obj.area ??
    obj.sqft ??
    obj.hdpData?.homeInfo?.livingArea ??
    obj.hdpData?.homeInfo?.livingAreaValue ??
    obj.miniCardData?.livingArea;
  if (typeof s === "number" && Number.isFinite(s) && s > 0) return s;
  if (typeof s === "string" && /^\d+$/.test(s)) return Number(s);
  return null;
}

/**
 * Collect listing-like nodes from Zillow's embedded JSON (structure changes often).
 * @param {unknown} root
 * @param {number} limit
 */
export function extractListingCards(root, limit) {
  /** @type {Map<number, { zpid: number, price: number, bedrooms: number | null, homeType: string | null, address: string | null, streetAddress: string | null, sqft: number | null, hoaMonthly: number | null }>} */
  const byZpid = new Map();
  const seen = new Set();

  function walk(obj, depth = 0) {
    if (byZpid.size >= limit || depth > 40) return;
    if (obj == null || typeof obj !== "object") return;
    if (seen.has(obj)) return;
    seen.add(obj);

    if (Array.isArray(obj)) {
      for (const el of obj) {
        walk(el, depth + 1);
        if (byZpid.size >= limit) return;
      }
      return;
    }

    let zpid = null;
    if (typeof obj.zpid === "number" && Number.isFinite(obj.zpid)) zpid = obj.zpid;
    else if (typeof obj.zpid === "string" && /^\d+$/.test(obj.zpid)) zpid = Number(obj.zpid);
    if (zpid != null && zpid > 0) {
      const existing = byZpid.get(zpid);
      const price = pickPrice(obj);
      if (existing) {
        enrichListingFromObj(existing, obj);
      } else if (price != null) {
        byZpid.set(zpid, createListingRow(zpid, price, obj));
      }
    }

    for (const k of Object.keys(obj)) {
      walk(obj[k], depth + 1);
      if (byZpid.size >= limit) return;
    }
  }

  walk(root, 0);
  return [...byZpid.values()];
}

function mergeListingDuplicates(a, b) {
  const price =
    typeof a.price === "number" && a.price > 0
      ? a.price
      : typeof b.price === "number" && b.price > 0
        ? b.price
        : a.price ?? b.price;
  return {
    zpid: a.zpid,
    price,
    bedrooms: a.bedrooms ?? b.bedrooms,
    homeType: a.homeType ?? b.homeType,
    address: a.address ?? b.address,
    streetAddress: a.streetAddress ?? b.streetAddress,
    sqft: a.sqft ?? b.sqft,
    hoaMonthly: a.hoaMonthly ?? b.hoaMonthly,
  };
}

function mergeListingsByZpid(rows, limit) {
  const m = new Map();
  for (const row of rows) {
    const prev = m.get(row.zpid);
    m.set(row.zpid, prev ? mergeListingDuplicates(prev, row) : row);
  }
  return [...m.values()].slice(0, limit);
}

/** Zillow search/list JSON is returned from several XHR URLs; names change over time. */
function isLikelySearchStateUrl(url) {
  if (!/:\/\/([^/]*\.)?zillow\.com\//i.test(url)) return false;
  return /GetSearchPageState|SearchPageState|async-create-search|create-search-page-state|search-page-state|AsyncGet/i.test(
    url
  );
}

async function dismissCommonOverlays(page) {
  const candidates = [
    page.getByRole("button", { name: /accept all/i }),
    page.getByRole("button", { name: /^accept$/i }),
    page.getByRole("button", { name: /agree/i }),
    page.locator('[data-testid="cookie-banner-accept"]'),
  ];
  for (const loc of candidates) {
    await loc.first().click({ timeout: 1500 }).catch(() => {});
  }
}

async function collectNextDataText(page, waitMs) {
  try {
    await page.waitForSelector("#__NEXT_DATA__", { timeout: waitMs });
    const t = await page.locator("#__NEXT_DATA__").first().textContent();
    return t?.trim() || null;
  } catch {
    return null;
  }
}

/** Large inline JSON blocks sometimes omit id=__NEXT_DATA__ but still include listResults. */
async function collectJsonScriptBlocks(page) {
  return page.evaluate(() => {
    /** @type {string[]} */
    const out = [];
    for (const el of document.querySelectorAll(
      'script#__NEXT_DATA__, script[type="application/json"]'
    )) {
      const t = el.textContent?.trim();
      if (t && t.startsWith("{") && t.length > 500) out.push(t);
    }
    for (const el of document.querySelectorAll("script:not([src])")) {
      const t = el.textContent?.trim();
      if (!t || t.length < 800 || t.length > 6_000_000) continue;
      if (!t.startsWith("{")) continue;
      if (
        t.includes('"listResults"') ||
        t.includes('"mapResults"') ||
        t.includes('"searchResults"') ||
        (t.includes('"zpid"') && t.includes('"unformattedPrice"'))
      ) {
        out.push(t);
      }
    }
    return [...new Set(out)];
  });
}

/**
 * @param {object} opts
 * @param {"sale"|"rent"} opts.listingType
 * @param {string} [opts.zip]
 * @param {string} [opts.city]
 * @param {string} [opts.state]
 * @param {number} [opts.limit]
 * @param {boolean} [opts.headed]
 * @param {boolean} [opts.useChromeChannel] When true, try `channel: "chrome"` first. When omitted, use unless ZILLOW_USE_CHROME=0.
 * @param {number} [opts.timeoutMs]
 */
export async function scrapeZillowListings(opts) {
  const {
    listingType,
    zip,
    city,
    state,
    limit = 200,
    headed = false,
    timeoutMs = 60000,
  } = opts;
  const tryChrome = isDockerRuntime()
    ? false
    : opts.useChromeChannel !== undefined
      ? Boolean(opts.useChromeChannel)
      : process.env.ZILLOW_USE_CHROME !== "0";
  const url = buildZillowSearchUrl({ listingType, zip, city, state });
  const cap = Math.min(2000, Math.max(1, limit));

  /** @type {unknown[]} */
  const networkPayloads = [];

  const browser = await launchZillowBrowser(headed, tryChrome);
  try {
    const context = await browser.newContext({
      userAgent: defaultUserAgent(),
      locale: "en-US",
      viewport: { width: 1365, height: 900 },
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-CH-UA": SEC_CH_UA,
        "Sec-CH-UA-Mobile": "?0",
        "Sec-CH-UA-Platform": secChPlatform(),
      },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
        configurable: true,
      });
      // Many sites expect `window.chrome` to exist in real Chrome.
      // @ts-ignore
      window.chrome = { runtime: {} };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    page.on("response", async (response) => {
      try {
        if (response.status() < 200 || response.status() >= 300) return;
        if (!isLikelySearchStateUrl(response.url())) return;
        const ct = (response.headers()["content-type"] || "").toLowerCase();
        if (ct && !ct.includes("json")) return;
        const j = await response.json();
        if (j && typeof j === "object") networkPayloads.push(j);
      } catch {
        // not JSON or aborted
      }
    });

    await page.goto(url, { waitUntil: "load", timeout: timeoutMs });

    const earlyTitle = (await page.title().catch(() => "")) || "";
    if (/access.*denied|access to this page has been denied/i.test(earlyTitle)) {
      throw new Error(
        `Zillow blocked this session (page title: "${earlyTitle.trim()}"). ` +
          `Try: (1) enable "Show browser (headed)" on the web form or CLI --headed and complete any check; ` +
          `(2) install Google Chrome so the scraper can use channel "chrome" (disable with ZILLOW_USE_CHROME=0); ` +
          `(3) set ZILLOW_USER_AGENT to match your installed Chrome version; (4) retry later from a residential network.`
      );
    }

    await dismissCommonOverlays(page);
    await page
      .waitForLoadState("networkidle", { timeout: Math.min(60000, timeoutMs) })
      .catch(() => {});

    await sleep(4000);

    const nextWait = Math.min(12000, Math.max(3000, Math.floor(timeoutMs / 5)));
    let nextJson = await collectNextDataText(page, nextWait);
    if (!nextJson) {
      await dismissCommonOverlays(page);
      await sleep(2000);
      nextJson = await collectNextDataText(page, 3000);
    }

    /** @type {unknown[]} */
    const roots = [];
    if (nextJson) {
      try {
        roots.push(JSON.parse(nextJson));
      } catch {
        /* ignore */
      }
    }

    for (const p of networkPayloads) roots.push(p);

    for (const raw of await collectJsonScriptBlocks(page)) {
      try {
        roots.push(JSON.parse(raw));
      } catch {
        /* ignore */
      }
    }

    /** @type {ReturnType<typeof extractListingCards>} */
    const merged = [];
    for (const root of roots) {
      merged.push(...extractListingCards(root, cap));
    }

    const listings = mergeListingsByZpid(merged, cap);

    if (listings.length === 0) {
      const title = await page.title().catch(() => "");
      throw new Error(
        `No listing JSON parsed (page title: "${title}"). ` +
          `Zillow often blocks automation or serves a consent/captcha page without search JSON. ` +
          `Try: headed mode + complete any challenge; install Chrome for channel "chrome"; set ZILLOW_USER_AGENT; or retry later.`
      );
    }

    return { url, listings };
  } finally {
    await browser.close();
  }
}
