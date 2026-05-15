#!/usr/bin/env node
import express from "express";
import {
  createHash,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { scrapeZillowListings } from "./zillowScrape.js";
import { compareSalesToRentComps } from "./compare.js";
import {
  getArchivedSearch,
  createUser,
  getUserById,
  getUserByUsernameOrEmail,
  initDb,
  isArchiveEnabled,
  isFirstAdminUser,
  listUsers,
  listArchivedSearches,
  resetPasswordWithToken,
  saveArchivedSearch,
  setResetToken,
  updateUserProfile,
  updateUserStatus,
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
const sessionSecret = process.env.SESSION_SECRET || process.env.AUTH_SECRET || "dev-session-secret-change-me";

function base64url(s) {
  return Buffer.from(s).toString("base64url");
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `pbkdf2$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "pbkdf2") return false;
  const candidate = hashPassword(password, parts[1]);
  const a = Buffer.from(candidate);
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sha256(s) {
  return createHash("sha256").update(String(s)).digest("hex");
}

function signPayload(payload) {
  const body = base64url(JSON.stringify(payload));
  const sig = createHash("sha256").update(`${body}.${sessionSecret}`).digest("base64url");
  return `${body}.${sig}`;
}

function readSession(req) {
  const raw = req.headers.cookie || "";
  const found = raw
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith("roi_session="));
  if (!found) return null;
  const token = decodeURIComponent(found.slice("roi_session=".length));
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHash("sha256").update(`${body}.${sessionSecret}`).digest("base64url");
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.id || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function setSessionCookie(res, user) {
  const token = signPayload({ id: Number(user.id), exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  res.setHeader("Set-Cookie", `roi_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "roi_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: Number(user.id),
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
  };
}

function validateUsername(username) {
  return /^[a-zA-Z0-9_.-]{3,40}$/.test(username);
}

function validateEmail(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

async function currentUser(req) {
  if (!isArchiveEnabled()) return null;
  const session = readSession(req);
  if (!session) return null;
  const user = await getUserById(session.id);
  return user?.status === "active" ? user : null;
}

async function requireUser(req, res, next) {
  const user = await currentUser(req);
  if (!user) {
    res.status(401).json({ error: "Login required." });
    return;
  }
  req.user = user;
  next();
}

async function requireAdmin(req, res, next) {
  const user = await currentUser(req);
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  req.user = user;
  next();
}

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

app.get("/api/auth/me", async (req, res) => {
  try {
    if (!isArchiveEnabled()) {
      res.json({ authEnabled: false, user: null });
      return;
    }
    res.json({ authEnabled: true, user: publicUser(await currentUser(req)) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    if (!isArchiveEnabled()) {
      res.status(503).json({ error: "Registration requires DATABASE_URL/Postgres." });
      return;
    }
    const username = String(req.body?.username || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!validateUsername(username)) {
      res.status(400).json({ error: "Username must be 3-40 letters, numbers, dots, dashes, or underscores." });
      return;
    }
    if (!validateEmail(email)) {
      res.status(400).json({ error: "Enter a valid email." });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters." });
      return;
    }
    const user = await createUser({ username, email, passwordHash: hashPassword(password) });
    if (user.status === "active") setSessionCookie(res, user);
    res.json({ user: publicUser(user), pending: user.status !== "active" });
  } catch (e) {
    const msg = e instanceof Error && e.message.includes("duplicate key")
      ? "Username or email is already registered."
      : e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const login = String(req.body?.login || "").trim();
    const password = String(req.body?.password || "");
    const user = await getUserByUsernameOrEmail(login);
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: "Invalid username/email or password." });
      return;
    }
    if (user.status !== "active") {
      res.status(403).json({ error: user.status === "pending" ? "Account pending admin approval." : "Account is disabled." });
      return;
    }
    setSessionCookie(res, user);
    res.json({ user: publicUser(user) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const token = randomBytes(24).toString("base64url");
    const saved = await setResetToken(email, sha256(token), new Date(Date.now() + 60 * 60 * 1000));
    res.json({
      ok: true,
      resetToken: saved ? token : null,
      message: saved
        ? "Reset token created. Use it within 1 hour."
        : "If that email exists, a reset token was created.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const password = String(req.body?.password || "");
    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters." });
      return;
    }
    const user = await resetPasswordWithToken(sha256(token), hashPassword(password));
    if (!user) {
      res.status(400).json({ error: "Invalid or expired reset token." });
      return;
    }
    res.json({ user: publicUser(user) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

app.put("/api/auth/profile", requireUser, async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const updates = {};
    if (username) {
      if (!validateUsername(username)) {
        res.status(400).json({ error: "Username must be 3-40 letters, numbers, dots, dashes, or underscores." });
        return;
      }
      updates.username = username;
    }
    if (email) {
      if (!validateEmail(email)) {
        res.status(400).json({ error: "Enter a valid email." });
        return;
      }
      updates.email = email;
    }
    if (password) {
      if (password.length < 8) {
        res.status(400).json({ error: "Password must be at least 8 characters." });
        return;
      }
      updates.passwordHash = hashPassword(password);
    }
    const user = await updateUserProfile(req.user.id, updates);
    res.json({ user: publicUser(user) });
  } catch (e) {
    const msg = e instanceof Error && e.message.includes("duplicate key")
      ? "Username or email is already in use."
      : e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
});

app.get("/api/admin/users", requireAdmin, async (_req, res) => {
  res.json({ users: await listUsers() });
});

app.post("/api/admin/users/:id/status", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || "");
  if (!Number.isSafeInteger(id) || !["active", "pending", "disabled"].includes(status)) {
    res.status(400).json({ error: "Invalid user or status." });
    return;
  }
  if (status !== "active" && await isFirstAdminUser(id)) {
    res.status(400).json({ error: "The first admin user cannot be disabled or set to pending." });
    return;
  }
  const user = await updateUserStatus(id, status);
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  res.json({ user: publicUser(user) });
});

app.put("/api/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const username = String(req.body?.username || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const updates = {};
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid user." });
      return;
    }
    if (username) {
      if (!validateUsername(username)) {
        res.status(400).json({ error: "Username must be 3-40 letters, numbers, dots, dashes, or underscores." });
        return;
      }
      updates.username = username;
    }
    if (email) {
      if (!validateEmail(email)) {
        res.status(400).json({ error: "Enter a valid email." });
        return;
      }
      updates.email = email;
    }
    if (password) {
      if (password.length < 8) {
        res.status(400).json({ error: "Password must be at least 8 characters." });
        return;
      }
      updates.passwordHash = hashPassword(password);
    }
    const user = await updateUserProfile(id, updates);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    res.json({ user: publicUser(user) });
  } catch (e) {
    const msg = e instanceof Error && e.message.includes("duplicate key")
      ? "Username or email is already in use."
      : e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
});

app.get("/api/archives", requireUser, async (req, res) => {
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

app.get("/api/archives/:id", requireUser, async (req, res) => {
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

app.get("/api/compare", requireUser, async (req, res) => {
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
