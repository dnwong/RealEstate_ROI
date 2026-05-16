const form = document.getElementById("form");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const submitBtn = document.getElementById("submit");
const archiveStatusEl = document.getElementById("archiveStatus");
const archiveListEl = document.getElementById("archiveList");
const refreshArchivesBtn = document.getElementById("refreshArchives");
const deleteArchivesBtn = document.getElementById("deleteArchives");
const mainEl = document.querySelector(".main");
const authViewEl = document.getElementById("authView");
const authForm = document.getElementById("authForm");
const authStatusEl = document.getElementById("authStatus");
const authTitleEl = document.getElementById("authTitle");
const userBarEl = document.getElementById("userBar");
const settingsViewEl = document.getElementById("settingsView");
const adminViewEl = document.getElementById("adminView");
const profileForm = document.getElementById("profileForm");
const profileStatusEl = document.getElementById("profileStatus");
const adminStatusEl = document.getElementById("adminStatus");
const adminUsersEl = document.getElementById("adminUsers");
let currentUser = null;
let authMode = "login";
let resetPasswordStep = "request";
let selectedArchiveIds = new Set();
let archiveDeleteMode = false;
let currentArchives = [];

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

async function apiJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

function setAuthMode(mode) {
  authMode = mode;
  resetPasswordStep = "request";
  authTitleEl.textContent =
    mode === "register" ? "Register" : mode === "reset" ? "Reset password" : "Login";
  authForm.querySelector(".auth-submit").textContent =
    mode === "register" ? "Register" : mode === "reset" ? "Send reset token" : "Login";
  authForm.resetStep.value = resetPasswordStep;
  authForm.querySelectorAll("[data-auth-field]").forEach((el) => {
    const field = el.dataset.authField;
    const hidden =
      (field === "login" && mode !== "login") ||
      (field === "username" && mode !== "register") ||
      (field === "email" && mode !== "register" && mode !== "reset") ||
      (field === "token" && (mode !== "reset" || resetPasswordStep !== "confirm")) ||
      (field === "password" && mode === "reset" && resetPasswordStep !== "confirm");
    el.hidden = hidden;
    el.style.display = hidden ? "none" : "";
  });
  document.querySelectorAll("[data-auth-mode]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.authMode === mode);
  });
  authStatusEl.textContent = "";
}

function showResetConfirm(message) {
  resetPasswordStep = "confirm";
  authForm.resetStep.value = resetPasswordStep;
  authTitleEl.textContent = "Enter reset token";
  authForm.querySelector(".auth-submit").textContent = "Reset password";
  authForm.querySelectorAll("[data-auth-field]").forEach((el) => {
    const field = el.dataset.authField;
    const hidden = !["email", "token", "password"].includes(field);
    el.hidden = hidden;
    el.style.display = hidden ? "none" : "";
  });
  authStatusEl.textContent = message;
}

function renderUserBar() {
  if (!userBarEl) return;
  if (!currentUser) {
    userBarEl.hidden = true;
    userBarEl.innerHTML = "";
    return;
  }
  userBarEl.hidden = false;
  userBarEl.innerHTML = `
    <span class="user-name">${escapeHtml(currentUser.username)} (${escapeHtml(currentUser.role)})</span>
    ${currentUser.role === "admin" ? '<button type="button" data-user-action="admin">Admin</button>' : ""}
    <button type="button" data-user-action="profile">Profile</button>
    <button type="button" data-user-action="logout">Logout</button>
  `;
}

function showApp(user) {
  currentUser = user;
  if (authViewEl) authViewEl.hidden = true;
  if (settingsViewEl) settingsViewEl.hidden = true;
  if (adminViewEl) adminViewEl.hidden = true;
  if (mainEl) mainEl.hidden = false;
  renderUserBar();
  loadArchives();
}

function showAuth(message = "") {
  currentUser = null;
  if (mainEl) mainEl.hidden = true;
  if (settingsViewEl) settingsViewEl.hidden = true;
  if (adminViewEl) adminViewEl.hidden = true;
  if (authViewEl) authViewEl.hidden = false;
  renderUserBar();
  setAuthMode(authMode);
  authStatusEl.textContent = message;
}

function showSettings() {
  if (!currentUser || !profileForm) return;
  if (mainEl) mainEl.hidden = true;
  if (adminViewEl) adminViewEl.hidden = true;
  if (settingsViewEl) settingsViewEl.hidden = false;
  profileForm.username.value = currentUser.username || "";
  profileForm.email.value = currentUser.email || "";
  profileForm.password.value = "";
  profileStatusEl.textContent = "";
}

function renderAdminUsers(users) {
  if (!adminUsersEl) return;
  if (!users.length) {
    adminUsersEl.innerHTML = '<p class="archive-empty">No users found.</p>';
    return;
  }
  adminUsersEl.innerHTML = users
    .map((u) => {
      const id = escapeHtml(String(u.id));
      const protectedAttr = u.is_first_admin ? " disabled title=\"The first admin user cannot be disabled or set to pending\"" : "";
      const protectedLabel = u.is_first_admin ? " · protected first admin" : "";
      return `<section class="admin-user" data-user-id="${id}">
        <div class="admin-user-head">
          <div>
            <div class="admin-user-title">${escapeHtml(u.username)} <span class="admin-user-meta">(${escapeHtml(u.role)})</span></div>
            <div class="admin-user-meta">${escapeHtml(u.email)} · ${escapeHtml(u.status)}${protectedLabel}</div>
          </div>
          <div class="admin-actions">
            <button type="button" data-admin-status="active">Activate</button>
            <button type="button" data-admin-status="pending"${protectedAttr}>Pending</button>
            <button type="button" data-admin-status="disabled"${protectedAttr}>Disable</button>
          </div>
        </div>
        <form class="form admin-edit-form">
          <label>Username<input name="username" type="text" value="${escapeHtml(u.username)}" required /></label>
          <label>Email<input name="email" type="email" value="${escapeHtml(u.email)}" required /></label>
          <label>Password<input name="password" type="password" placeholder="Leave blank to keep current password" /></label>
          <button type="submit" class="secondary-btn">Save user</button>
        </form>
      </section>`;
    })
    .join("");
}

async function loadAdminUsers() {
  if (!adminStatusEl) return;
  adminStatusEl.textContent = "Loading users…";
  try {
    const body = await apiJson("/api/admin/users");
    renderAdminUsers(body.users || []);
    adminStatusEl.textContent = `${body.users?.length ?? 0} users found.`;
  } catch (e) {
    adminStatusEl.textContent = e instanceof Error ? e.message : String(e);
  }
}

async function showAdminPanel() {
  if (mainEl) mainEl.hidden = true;
  if (settingsViewEl) settingsViewEl.hidden = true;
  if (adminViewEl) adminViewEl.hidden = false;
  await loadAdminUsers();
}

function renderArchives(searches) {
  if (!archiveListEl) return;
  currentArchives = searches;
  selectedArchiveIds = new Set([...selectedArchiveIds].filter((id) => searches.some((s) => String(s.id) === id)));
  updateDeleteArchivesButton();
  if (!searches.length) {
    archiveDeleteMode = false;
    selectedArchiveIds.clear();
    updateDeleteArchivesButton();
    archiveListEl.innerHTML = '<p class="archive-empty">No archived searches yet.</p>';
    return;
  }
  archiveListEl.innerHTML = searches
    .map((s) => {
      const id = escapeHtml(String(s.id));
      const rawId = String(s.id);
      const checked = selectedArchiveIds.has(rawId) ? " checked" : "";
      const selectHidden = archiveDeleteMode ? "" : " hidden";
      const rowCount = Number(s.row_count ?? 0);
      return `<div class="archive-item" data-archive-id="${id}">
        <label class="archive-select"${selectHidden}>
          <input type="checkbox" class="archive-checkbox" data-archive-id="${id}"${checked} />
          <span class="sr-only">Select archive</span>
        </label>
        <button type="button" class="archive-load" data-archive-id="${id}">
          <span class="archive-item-main">
            <span class="archive-item-region">${escapeHtml(String(s.region))}</span>
            <span class="archive-item-date">${escapeHtml(dateTime(s.created_at))}</span>
          </span>
          <span class="archive-item-meta">${rowCount} rows · ${s.sale_count} sales · ${s.rent_count} rentals</span>
        </button>
      </div>`;
    })
    .join("");
}

function updateDeleteArchivesButton() {
  if (!deleteArchivesBtn) return;
  deleteArchivesBtn.disabled = false;
  deleteArchivesBtn.textContent = archiveDeleteMode && selectedArchiveIds.size
    ? `Delete Selected (${selectedArchiveIds.size})`
    : "Delete";
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
      archiveDeleteMode = false;
      selectedArchiveIds.clear();
      updateDeleteArchivesButton();
      renderArchives([]);
      return;
    }
    archiveStatusEl.textContent = `${body.searches?.length ?? 0} archived searches found.`;
    renderArchives(body.searches || []);
  } catch (e) {
    archiveStatusEl.textContent = e instanceof Error ? e.message : String(e);
  }
}

async function deleteSelectedArchives() {
  if (!archiveStatusEl) return;
  if (!selectedArchiveIds.size) {
    archiveStatusEl.textContent = "Select one or more archived searches to delete.";
    return;
  }
  const ids = [...selectedArchiveIds];
  const confirmed = window.confirm(`Delete ${ids.length} selected archived search${ids.length === 1 ? "" : "es"}? This cannot be undone.`);
  if (!confirmed) return;
  archiveStatusEl.textContent = "Deleting selected archives…";
  if (deleteArchivesBtn) deleteArchivesBtn.disabled = true;
  try {
    const res = await fetch("/api/archives", {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      archiveStatusEl.textContent = body.error || `Archive delete failed (${res.status})`;
      updateDeleteArchivesButton();
      return;
    }
    archiveDeleteMode = false;
    selectedArchiveIds.clear();
    archiveStatusEl.textContent = `Deleted ${body.deletedCount ?? 0} archived search${body.deletedCount === 1 ? "" : "es"}.`;
    await loadArchives();
  } catch (e) {
    archiveStatusEl.textContent = e instanceof Error ? e.message : String(e);
    updateDeleteArchivesButton();
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

deleteArchivesBtn?.addEventListener("click", () => {
  const archiveItems = archiveListEl ? [...archiveListEl.querySelectorAll(".archive-item")] : [];
  if (!archiveItems.length) {
    if (archiveStatusEl) archiveStatusEl.textContent = "No archived searches are available to delete.";
    return;
  }
  if (!archiveDeleteMode) {
    archiveDeleteMode = true;
    selectedArchiveIds.clear();
    archiveItems.forEach((item) => {
      const select = item.querySelector(".archive-select");
      if (select) select.hidden = false;
      const checkbox = item.querySelector(".archive-checkbox");
      if (checkbox) checkbox.checked = false;
    });
    updateDeleteArchivesButton();
    if (archiveStatusEl) archiveStatusEl.textContent = "Select one or more archived searches to delete.";
    return;
  }
  deleteSelectedArchives();
});

archiveListEl?.addEventListener("click", (ev) => {
  const checkbox = ev.target.closest("input.archive-checkbox");
  if (checkbox && archiveListEl.contains(checkbox)) {
    if (checkbox.checked) {
      selectedArchiveIds.add(checkbox.dataset.archiveId);
    } else {
      selectedArchiveIds.delete(checkbox.dataset.archiveId);
    }
    updateDeleteArchivesButton();
    return;
  }
  const btn = ev.target.closest("button.archive-load");
  if (!btn || !archiveListEl.contains(btn)) return;
  loadArchivedSearch(btn.dataset.archiveId);
});

document.querySelectorAll("[data-auth-mode]").forEach((btn) => {
  btn.addEventListener("click", () => setAuthMode(btn.dataset.authMode));
});

authForm?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(authForm);
  const password = String(fd.get("password") || "");
  authStatusEl.textContent = "Working…";
  try {
    if (authMode === "login") {
      const body = await apiJson("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          login: String(fd.get("login") || "").trim(),
          password,
        }),
      });
      showApp(body.user);
    } else if (authMode === "register") {
      const body = await apiJson("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          username: String(fd.get("username") || "").trim(),
          email: String(fd.get("email") || "").trim(),
          password,
        }),
      });
      if (body.pending) {
        showAuth("Registration received. An admin must approve your account before login.");
      } else {
        showApp(body.user);
      }
    } else {
      const email = String(fd.get("email") || "").trim();
      const token = String(fd.get("token") || "").trim();
      if (resetPasswordStep === "request") {
        const body = await apiJson("/api/auth/forgot-password", {
          method: "POST",
          body: JSON.stringify({ email }),
        });
        showResetConfirm(body.resetToken
          ? `${body.message} Token: ${body.resetToken}`
          : body.message);
      } else {
        await apiJson("/api/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({ token, password }),
        });
        setAuthMode("login");
        authStatusEl.textContent = "Password reset. Log in with your new password.";
      }
    }
  } catch (e) {
    authStatusEl.textContent = e instanceof Error ? e.message : String(e);
  }
});

userBarEl?.addEventListener("click", async (ev) => {
  const action = ev.target.closest("button")?.dataset.userAction;
  if (!action) return;
  if (action === "profile") {
    showSettings();
  } else if (action === "admin") {
    showAdminPanel();
  } else if (action === "logout") {
    await apiJson("/api/auth/logout", { method: "POST" });
    showAuth("Logged out.");
  }
});

profileForm?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(profileForm);
  profileStatusEl.textContent = "Saving…";
  try {
    const body = await apiJson("/api/auth/profile", {
      method: "PUT",
      body: JSON.stringify({
        username: String(fd.get("username") || "").trim(),
        email: String(fd.get("email") || "").trim(),
        password: String(fd.get("password") || ""),
      }),
    });
    currentUser = body.user;
    renderUserBar();
    profileForm.password.value = "";
    profileStatusEl.textContent = "Settings saved.";
  } catch (e) {
    profileStatusEl.textContent = e instanceof Error ? e.message : String(e);
  }
});

adminUsersEl?.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-admin-status]");
  if (!btn || !adminUsersEl.contains(btn)) return;
  const card = btn.closest("[data-user-id]");
  const id = card?.dataset.userId;
  const status = btn.dataset.adminStatus;
  if (!id || !status) return;
  adminStatusEl.textContent = "Updating status…";
  try {
    await apiJson(`/api/admin/users/${encodeURIComponent(id)}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
    await loadAdminUsers();
  } catch (e) {
    adminStatusEl.textContent = e instanceof Error ? e.message : String(e);
  }
});

adminUsersEl?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const formEl = ev.target.closest("form.admin-edit-form");
  if (!formEl || !adminUsersEl.contains(formEl)) return;
  const card = formEl.closest("[data-user-id]");
  const id = card?.dataset.userId;
  if (!id) return;
  const fd = new FormData(formEl);
  adminStatusEl.textContent = "Saving user…";
  try {
    await apiJson(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({
        username: String(fd.get("username") || "").trim(),
        email: String(fd.get("email") || "").trim(),
        password: String(fd.get("password") || ""),
      }),
    });
    await loadAdminUsers();
  } catch (e) {
    adminStatusEl.textContent = e instanceof Error ? e.message : String(e);
  }
});

document.querySelectorAll("[data-panel-close]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (currentUser) showApp(currentUser);
    else showAuth();
  });
});

async function initAuth() {
  try {
    const body = await apiJson("/api/auth/me");
    if (!body.authEnabled) {
      if (authViewEl) authViewEl.hidden = true;
      if (mainEl) mainEl.hidden = false;
      loadArchives();
      return;
    }
    if (body.user) showApp(body.user);
    else showAuth("Log in or register to continue. First registered user becomes admin.");
  } catch (e) {
    showAuth(e instanceof Error ? e.message : String(e));
  }
}

initAuth();
