const form = document.getElementById("form");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const submitBtn = document.getElementById("submit");

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
              <th>Street</th>
              <th class="num">HOA / mo</th>
              <th class="num">List</th>
              <th class="num">Beds</th>
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
                const hoaCell =
                  r.saleHoaMonthly != null && Number.isFinite(r.saleHoaMonthly)
                    ? money(r.saleHoaMonthly)
                    : "—";
                return `<tr${rowAttrs}>
                  <td>${streetInner}</td>
                  <td class="num">${hoaCell}</td>
                  <td class="num">${money(r.salePrice)}</td>
                  <td class="num">${r.saleBeds ?? "—"}</td>
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
        Comps exclude the subject (rent zpids are separate from sale zpids). Street and
        monthly HOA come from Zillow card JSON when present—search results often omit HOA.
        Hover a street cell to see the full formatted address when available. Not
        underwriting: no vacancy, taxes beyond HOA, or debt service.
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
      if (ev.target.closest("a.listing-link")) return;

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

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(form);
  const zip = (fd.get("zip") || "").toString().trim();
  const city = (fd.get("city") || "").toString().trim();
  const state = (fd.get("state") || "").toString().trim();
  const limit = fd.get("limit");
  const minComps = fd.get("minComps");
  const preferType = fd.get("preferType") === "on" ? "1" : "";
  const headed = fd.get("headed") === "on" ? "1" : "";
  const useChrome = fd.get("useChrome") === "on";
  const timeoutMs = fd.get("timeoutMs");

  const params = new URLSearchParams();
  if (zip) params.set("zip", zip);
  if (city) params.set("city", city);
  if (state) params.set("state", state);
  if (limit) params.set("limit", String(limit));
  if (minComps) params.set("minComps", String(minComps));
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
    statusEl.textContent = `Done — ${body.rows?.length ?? 0} sale rows compared.`;
    renderTable(body);
  } catch (e) {
    statusEl.textContent = e instanceof Error ? e.message : String(e);
  } finally {
    form.classList.remove("is-loading");
    form.removeAttribute("aria-busy");
    submitBtn.disabled = false;
  }
});
