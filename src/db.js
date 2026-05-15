import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
const enabled = Boolean(connectionString);

const pool = enabled
  ? new Pool({
      connectionString,
      ssl: process.env.DATABASE_SSL === "1" ? { rejectUnauthorized: false } : undefined,
    })
  : null;

let initPromise = null;

export function isArchiveEnabled() {
  return enabled;
}

export async function initDb() {
  if (!pool) return false;
  if (!initPromise) {
    initPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS archived_searches (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        region TEXT NOT NULL,
        zip TEXT,
        city TEXT,
        state TEXT,
        sale_url TEXT NOT NULL,
        rent_url TEXT NOT NULL,
        sale_count INTEGER NOT NULL,
        rent_count INTEGER NOT NULL,
        min_comps INTEGER NOT NULL,
        prefer_type BOOLEAN NOT NULL,
        query JSONB NOT NULL,
        sale_listings JSONB NOT NULL,
        rent_listings JSONB NOT NULL,
        rows JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS archived_searches_created_at_idx ON archived_searches (created_at DESC);
      CREATE INDEX IF NOT EXISTS archived_searches_region_idx ON archived_searches (region);
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'pending',
        reset_token_hash TEXT,
        reset_token_expires_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS users_status_idx ON users (status);
    `).catch((e) => {
      initPromise = null;
      throw e;
    });
  }
  await initPromise;
  return true;
}

export async function saveArchivedSearch(search) {
  if (!pool) return null;
  await initDb();
  const result = await pool.query(
    `INSERT INTO archived_searches (
      region,
      zip,
      city,
      state,
      sale_url,
      rent_url,
      sale_count,
      rent_count,
      min_comps,
      prefer_type,
      query,
      sale_listings,
      rent_listings,
      rows
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING id, created_at`,
    [
      search.region,
      search.zip ?? null,
      search.city ?? null,
      search.state ?? null,
      search.saleUrl,
      search.rentUrl,
      search.saleCount,
      search.rentCount,
      search.minComps,
      search.preferType,
      JSON.stringify(search.query),
      JSON.stringify(search.saleListings),
      JSON.stringify(search.rentListings),
      JSON.stringify(search.rows),
    ]
  );
  return result.rows[0];
}

export async function listArchivedSearches(limit = 50) {
  if (!pool) return [];
  await initDb();
  const result = await pool.query(
    `SELECT id, created_at, region, zip, city, state, sale_count, rent_count, min_comps, prefer_type, jsonb_array_length(rows) AS row_count
     FROM archived_searches
     ORDER BY created_at DESC
     LIMIT $1`,
    [Math.min(200, Math.max(1, limit))]
  );
  return result.rows;
}

export async function getArchivedSearch(id) {
  if (!pool) return null;
  await initDb();
  const result = await pool.query(
    `SELECT id, created_at, region, sale_url, rent_url, sale_count, rent_count, min_comps, prefer_type, query, rows
     FROM archived_searches
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function userCount() {
  if (!pool) return 0;
  await initDb();
  const result = await pool.query("SELECT count(*)::int AS count FROM users");
  return result.rows[0]?.count ?? 0;
}

export async function createUser(user) {
  if (!pool) return null;
  await initDb();
  const first = (await userCount()) === 0;
  const result = await pool.query(
    `INSERT INTO users (username, email, password_hash, role, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at, username, email, role, status`,
    [
      user.username,
      user.email,
      user.passwordHash,
      first ? "admin" : "user",
      first ? "active" : "pending",
    ]
  );
  return result.rows[0];
}

export async function getUserByUsernameOrEmail(login) {
  if (!pool) return null;
  await initDb();
  const result = await pool.query(
    `SELECT id, username, email, password_hash, role, status
     FROM users
     WHERE lower(username) = lower($1) OR lower(email) = lower($1)
     LIMIT 1`,
    [login]
  );
  return result.rows[0] ?? null;
}

export async function getUserById(id) {
  if (!pool) return null;
  await initDb();
  const result = await pool.query(
    `SELECT id, created_at, username, email, role, status
     FROM users
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function listUsers() {
  if (!pool) return [];
  await initDb();
  const result = await pool.query(
    `WITH first_admin AS (
       SELECT id
       FROM users
       WHERE role = 'admin'
       ORDER BY created_at ASC, id ASC
       LIMIT 1
     )
     SELECT users.id, users.created_at, users.username, users.email, users.role, users.status,
            users.id = first_admin.id AS is_first_admin
     FROM users
     LEFT JOIN first_admin ON true
     ORDER BY created_at DESC`
  );
  return result.rows;
}

export async function isFirstAdminUser(id) {
  if (!pool) return false;
  await initDb();
  const result = await pool.query(
    `SELECT id
     FROM users
     WHERE role = 'admin'
     ORDER BY created_at ASC, id ASC
     LIMIT 1`
  );
  return Number(result.rows[0]?.id) === Number(id);
}

export async function updateUserStatus(id, status) {
  if (!pool) return null;
  await initDb();
  const result = await pool.query(
    `UPDATE users
     SET status = $2, updated_at = now()
     WHERE id = $1
     RETURNING id, created_at, username, email, role, status`,
    [id, status]
  );
  return result.rows[0] ?? null;
}

export async function updateUserProfile(id, updates) {
  if (!pool) return null;
  await initDb();
  const result = await pool.query(
    `UPDATE users
     SET username = COALESCE($2, username),
         email = COALESCE($3, email),
         password_hash = COALESCE($4, password_hash),
         updated_at = now()
     WHERE id = $1
     RETURNING id, created_at, username, email, role, status`,
    [id, updates.username ?? null, updates.email ?? null, updates.passwordHash ?? null]
  );
  return result.rows[0] ?? null;
}

export async function setResetToken(email, tokenHash, expiresAt) {
  if (!pool) return null;
  await initDb();
  const result = await pool.query(
    `UPDATE users
     SET reset_token_hash = $2,
         reset_token_expires_at = $3,
         updated_at = now()
     WHERE lower(email) = lower($1)
     RETURNING id, email`,
    [email, tokenHash, expiresAt]
  );
  return result.rows[0] ?? null;
}

export async function resetPasswordWithToken(tokenHash, passwordHash) {
  if (!pool) return null;
  await initDb();
  const result = await pool.query(
    `UPDATE users
     SET password_hash = $2,
         reset_token_hash = NULL,
         reset_token_expires_at = NULL,
         updated_at = now()
     WHERE reset_token_hash = $1
       AND reset_token_expires_at > now()
     RETURNING id, created_at, username, email, role, status`,
    [tokenHash, passwordHash]
  );
  return result.rows[0] ?? null;
}
