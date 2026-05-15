const form = document.getElementById("form");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const submitBtn = document.getElementById("submit");
const archiveStatusEl = document.getElementById("archiveStatus");
const archiveListEl = document.getElementById("archiveList");
const refreshArchivesBtn = document.getElementById("refreshArchives");

function money(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function pct(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function dateTime(s) {
  if (!s) return "Unknown date";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

/** Opens the for-sale property page for a numeric zpid. */
function zillowSaleListingUrl(zpid) {
  const z = Number(zpid);
  if (!Number.isFinite(z) || z <= 0) return null;
  return `https://www.zillow.com/homedetails/${z}_zpid/`;
}

/** Uses real window.open user activation (synthetic <a>.click() is often blocked after preventDefault). */
function openListingInNewTab(url) {
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (w) {
    try {
      w.opener = null;
    } catch {
      /* ignore */
    }
    return true;
  }
  return false;
}

function renderPhotoCell(photoUrl, listingUrl, altText) {
  if (!photoUrl) {
    return '<td class="col-photo"><span class="photo-placeholder" title="No photo in scrape"></span></td>';
  }
  const src = escapeHtml(String(photoUrl));
  const alt = escapeHtml(altText || "Listing photo");
  if (listingUrl) {
    const href = escapeHtml(listingUrl);
    return `<td class="col-photo"><a href="${href}" target="_blank" rel="noopener noreferrer" class="listing-photo-link"><img class="listing-thumb" src="${src}" alt="${alt}" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></a></td>`;
  }
  return `<td class="col-photo"><img class="listing-thumb" src="${src}" alt="${alt}" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></td>`;
}

function tierLabel(t) {
  const map = {
    exact_bedrooms: "Exact beds",
    bedrooms_plus_minus_1: "±1 beds",
    exact_bedrooms_sparse: "Exact beds (sparse)",
    bedrooms_plus_minus_1_sparse: "±1 beds (sparse)",
    all_rentals_in_region: "All area rents",
    no_rental_bedroom_overlap: "No overlapping bedroom data in comps",
  };
  return map[t] || t;
}

function renderTable(data) {
  const rows = data.rows
    .slice()
    .sort(
      (a, b) =>
        (b.grossYieldMedianPercent ?? -1) - (a.grossYieldMedianPercent ?? -1)
    );

  const head = `
    <div class="card results-card">
      <div class="results-head">
        <h2 class="results-title">${escapeHtml(data.region)}</h2>
        <div class="stat-chips">
          <span class="stat-chip"><b>${data.saleCount}</b> sales</span>
          <span class="stat-chip"><b>${data.rentCount}</b> rentals</span>
          <span class="stat-chip"><b>${data.minComps}</b> min comps</span>
          ${
            data.maxAge != null
              ? `<span class="stat-chip"><b>${escapeHtml(String(data.maxAge))}</b> max age</span>`
              : ""
          }
          ${
            data.preferType
              ? '<span class="stat-chip"><b>Type</b> filter on</span>'
              : ""
          }
        </div>
        <div class="results-links meta">
          <a href="${escapeHtml(data.saleUrl)}" target="_blank" rel="noreferrer">Open sale search</a>
          <span aria-hidden="true"> · </span>
          <a href="${escapeHtml(data.rentUrl)}" target="_blank" rel="noreferrer">Open rent search</a>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="col-photo" aria-label="Photo"></th>
              <th>Street</th>
              <th class="num">List</th>
              <th class="num">Beds</th>
              <th class="num">Age</th>
              <th>Type</th>
              <th class="num">n</th>
              <th class="num">Rent med</th>
              <th class="num">Rent band</th>
              <th class="num">Yield (med)</th>
              <th>Match</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map((r) => {
                const y = r.grossYieldMedianPercent;
                const yClass =
                  y == null
                    ? ""
                    : y >= 6
                      ? "high"
                      : y < 4
                        ? "low"
                        : "";
                const streetDisplay =
                  (r.saleStreet && String(r.saleStreet).trim()) ||
                  (r.saleAddress
                    ? String(r.saleAddress).split(",")[0]?.trim()
                    : "") ||
                  `zpid ${r.saleZpid}`;
                const fullAddr = r.saleAddress
                  ? String(r.saleAddress).trim()
                  : "";
                const titleAttr = fullAddr
                  ? ` title="${escapeHtml(fullAddr)}"`
                  : "";
                const listingUrl = zillowSaleListingUrl(r.saleZpid);
                const listingUrlAttr = listingUrl
                  ? escapeHtml(listingUrl)
                  : "";
                const streetInner = listingUrl
                  ? `<a class="listing-link" href="${listingUrlAttr}" target="_blank" rel="noopener noreferrer"${titleAttr}>${escapeHtml(String(streetDisplay))}</a>`
                  : escapeHtml(String(streetDisplay));
                const band =
                  r.compRentMin != null && r.compRentMax != null
                    ? `${money(r.compRentMin)}–${money(r.compRentMax)}`
                    : "—";
                const rowAttrs = listingUrl
                  ? ` class="listing-row" data-listing-url="${listingUrlAttr}"`
                  : "";
                const photoCell = renderPhotoCell(
                  r.salePhotoUrl,
                  listingUrl,
                  streetDisplay
                );
                return `<tr${rowAttrs}>
                  ${photoCell}
                  <td>${streetInner}</td>
                  <td class="num">${money(r.salePrice)}</td>
                  <td class="num">${r.saleBeds ?? "—"}</td>
                  <td class="num">${r.saleAge ?? "—"}</td>
                  <td>${escapeHtml(String(r.saleType ?? "—"))}</td>
                  <td class="num">${r.compCount}</td>
                  <td class="num">${money(r.compRentMedian)}</td>
                  <td class="num">${band}</td>
                  <td class="num yield ${yClass}">${pct(y)}</td>
                  <td class="tier">${escapeHtml(tierLabel(r.matchTier))}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
      <p class="footnote">
        Gross yield uses <strong>median comparable rent × 12 ÷ list price</strong>.
        Comps exclude the subject (rent zpids are separate from sale zpids). Thumbnails use
        Zillow photo URLs from search JSON when available. Hover a street cell for the full
        address. Not underwriting: no vacancy, taxes, HOA, or debt service.
      </p>
    </div>
  `;
  resultsEl.innerHTML = head;
  resultsEl.hidden = false;
  resultsEl.classList.remove("hidden");

  const tbody = resultsEl.querySelector("tbody");
  if (tbody) {
    tbody.addEventListener("click", (ev) => {
      if (ev.button !== 0) return;
      // Let the real <a target="_blank"> handle address clicks (works with strict popup rules).
      if (ev.target.closest("a.listing-link, a.listing-photo-link")) return;

      const tr = ev.target.closest("tr.listing-row");
      if (!tr || !tbody.contains(tr)) return;
      const url = tr.dataset.listingUrl;
      if (!url) return;

      ev.preventDefault();
      if (!openListingInNewTab(url)) {
        statusEl.textContent =
          "Could not open listing (popup blocked?). Allow pop-ups for this site or use the address link.";
      }
    });
  }
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderArchives(searches) {
  if (!archiveListEl) return;
  if (!searches.length) {
    archiveListEl.innerHTML = '<p class="archive-empty">No archived searches yet.</p>';
    return;
  }
  archiveListEl.innerHTML = searches
    .map((s) => {
      const id = escapeHtml(String(s.id));
      const rowCount = Number(s.row_count ?? 0);
      return `<button type="button" class="archive-item" data-archive-id="${id}">
        <span class="archive-item-main">
          <span class="archive-item-region">${escapeHtml(String(s.region))}</span>
          <span class="archive-item-date">${escapeHtml(dateTime(s.created_at))}</span>
        </span>
        <span class="archive-item-meta">${rowCount} rows · ${s.sale_count} sales · ${s.rent_count} rentals</span>
      </button>`;
    })
    .join("");
}

async function loadArchives() {
  if (!archiveStatusEl || !archiveListEl) return;
  archiveStatusEl.textContent = "Loading archives…";
  try {
    const res = await fetch("/api/archives?limit=50", {
      headers: { Accept: "application/json" },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      archiveStatusEl.textContent = body.error || `Archive request failed (${res.status})`;
      return;
    }
    if (!body.archiveEnabled) {
      archiveStatusEl.textContent = "Archives are disabled. Set DATABASE_URL to enable Postgres archive storage.";
      renderArchives([]);
      return;
    }
    archiveStatusEl.textContent = `${body.searches?.length ?? 0} archived searches found.`;
    renderArchives(body.searches || []);
  } catch (e) {
    archiveStatusEl.textContent = e instanceof Error ? e.message : String(e);
  }
}

async function loadArchivedSearch(id) {
  statusEl.textContent = "Loading archived search…";
  try {
    const res = await fetch(`/api/archives/${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json" },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      statusEl.textContent = body.error || `Archive request failed (${res.status})`;
      return;
    }
    statusEl.textContent = `Loaded archive from ${dateTime(body.archivedAt)}.`;
    renderTable(body);
    resultsEl.scrollIntoView({ block: "start", behavior: "smooth" });
  } catch (e) {
    statusEl.textContent = e instanceof Error ? e.message : String(e);
  }
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(form);
  const zip = (fd.get("zip") || "").toString().trim();
  const city = (fd.get("city") || "").toString().trim();
  const state = (fd.get("state") || "").toString().trim();
  const limit = fd.get("limit");
  const minComps = fd.get("minComps");
  const maxAge = fd.get("maxAge");
  const preferType = fd.get("preferType") === "on" ? "1" : "";
  const headed = fd.get("headed") === "on" ? "1" : "";
  const useChrome = fd.get("useChrome") === "on";
  const timeoutMs = fd.get("timeoutMs");

  if (!zip && !city && !state) {
    statusEl.textContent = "Enter a ZIP or select both city and state before searching.";
    return;
  }

  if (!zip && city && !state) {
    statusEl.textContent = "Select a state for the city search.";
    return;
  }

  if (!zip && state && !city) {
    statusEl.textContent = "Enter a city for the selected state.";
    return;
  }

  const params = new URLSearchParams();
  if (zip) params.set("zip", zip);
  if (city) params.set("city", city);
  if (state) params.set("state", state);
  if (limit) params.set("limit", String(limit));
  if (minComps) params.set("minComps", String(minComps));
  if (maxAge) params.set("maxAge", String(maxAge));
  if (preferType) params.set("preferType", preferType);
  if (headed) params.set("headed", headed);
  if (!useChrome) params.set("useChrome", "0");
  if (timeoutMs) params.set("timeoutMs", String(timeoutMs));

  statusEl.textContent = headed
    ? "Scraping with a visible browser — complete any prompts in the Chrome windows; this may take a few minutes."
    : "Scraping Zillow (two browser sessions)… this can take up to a couple of minutes.";
  form.classList.add("is-loading");
  form.setAttribute("aria-busy", "true");
  submitBtn.disabled = true;
  resultsEl.classList.add("hidden");
  resultsEl.hidden = true;

  try {
    const res = await fetch(`/api/compare?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      statusEl.textContent = body.error || `Request failed (${res.status})`;
      return;
    }
    statusEl.textContent = body.archiveId
      ? `Done — ${body.rows?.length ?? 0} sale rows compared and archived.`
      : `Done — ${body.rows?.length ?? 0} sale rows compared.`;
    renderTable(body);
    await loadArchives();
  } catch (e) {
    statusEl.textContent = e instanceof Error ? e.message : String(e);
  } finally {
    form.classList.remove("is-loading");
    form.removeAttribute("aria-busy");
    submitBtn.disabled = false;
  }
});

refreshArchivesBtn?.addEventListener("click", () => {
  loadArchives();
});

archiveListEl?.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button.archive-item");
  if (!btn || !archiveListEl.contains(btn)) return;
  loadArchivedSearch(btn.dataset.archiveId);
});

loadArchives();
