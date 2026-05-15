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
