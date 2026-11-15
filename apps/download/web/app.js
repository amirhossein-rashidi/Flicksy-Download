
"use strict";

/* =========================================
   Flicksy Download - Frontend
   Independent from the main Flicksy tracker
========================================= */

const API_BASE = "https://flicksy-download.awmirmusic-907.workers.dev";
const PROVIDER = "sermovie";

/* حالت داده: offline = خواندن از JSON محلی، online = گرفتن درجا از آدرس سرور */
const MODE_KEY = "flicksy-mode";
function loadMode() {
  try { return localStorage.getItem(MODE_KEY) === "online" ? "online" : "offline"; }
  catch (e) { return "offline"; }
}
let dataMode = loadMode();

const state = {
  type: "movies",
  year: null,
  entries: [],
  filteredEntries: [],
  movieYears: [],
  seriesYears: [],
  detail: null,
  detailType: null,
  selectedSeason: null,
  seasonView: null,
  episodeView: null,
  search: "",
  loading: false,

  // File size cache: path -> sizeBytes
  sizeCache: new Map(),
  sizeLoading: new Set()
};

const app = document.getElementById("app");
const apiDot = document.getElementById("apiDot");
const apiStatus = document.getElementById("apiStatus");
const toastElement = document.getElementById("toast");

let toastTimer = null;

/* ---------- Helpers ---------- */

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1
  );

  return `${(value / Math.pow(1024, index)).toFixed(index > 1 ? 2 : 0)} ${units[index]}`;
}

function titleFromName(name) {
  return String(name || "")
    .replace(/\.(mkv|mp4|avi|mov|webm|m4v|srt|ass|ssa|vtt|sub)$/i, "")
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shortTitle(value) {
  const title = String(value || "").trim();
  if (!title) return "؟";
  return title.charAt(0).toUpperCase();
}

function imgTag(url, cls) {
  if (!url) return "";
  return `<img class="${cls}" src="${escapeHTML(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
}

function chips(list, cls = "meta-chip") {
  return (list || []).filter(Boolean).map(x => `<span class="${cls}">${escapeHTML(x)}</span>`).join("");
}

function fmtValue(v) {
  if (v === null || v === undefined || v === "") return "—";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function extraBlock(extra) {
  const keys = Object.keys(extra || {});
  if (!keys.length) return "";
  return `<div class="extra-block">${keys.map(k =>
    `<div><b>${escapeHTML(k)}</b><span>${escapeHTML(fmtValue(extra[k]))}</span></div>`
  ).join("")}</div>`;
}

function idsBlock(ids) {
  if (!Array.isArray(ids) || !ids.length) return "";
  const rows = ids.map(r => {
    const val = r.value
      ? `<span class="id-value" dir="ltr">${escapeHTML(r.value)}</span>`
      : `<span class="id-missing">در داده نیست</span>`;
    const link = r.url
      ? `<a class="id-link" href="${escapeHTML(r.url)}" target="_blank" rel="noopener">${r.search ? "جست‌وجو در " + escapeHTML(r.label) : "باز کردن"} ↗</a>`
      : "";
    const copy = r.value
      ? `<button type="button" class="id-copy" data-copy="${escapeHTML(r.value)}">کپی</button>`
      : "";
    return `<div class="id-row"><b>${escapeHTML(r.label)}</b>${val}${copy}${link}</div>`;
  }).join("");
  return `<section class="id-block"><h3>شناسه‌ها و لینک‌ها</h3>${rows}</section>`;
}

document.addEventListener("click", e => {
  const b = e.target.closest?.(".id-copy");
  if (!b) return;
  const t = b.dataset.copy;
  const done = () => showToast("کپی شد");
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(done, () => prompt("کپی کن:", t));
  else prompt("کپی کن:", t);
});

function rawBlock(raw) {
  if (!raw) return "";
  return `<details class="raw-details"><summary>همه‌ی اطلاعات ذخیره‌شده (JSON)</summary>` +
    `<div class="extra-block">${Object.keys(raw).map(k =>
      `<div><b>${escapeHTML(k)}</b><span>${escapeHTML(fmtValue(raw[k]))}</span></div>`).join("")}</div></details>`;
}

function showToast(message) {
  toastElement.textContent = message;
  toastElement.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastElement.classList.remove("show");
  }, 2600);
}

function setApiStatus(online, message) {
  apiDot.className = "status-dot " + (online ? "online" : "offline");
  apiStatus.textContent = message;
}

function showLoading(message = "در حال دریافت اطلاعات...") {
  state.loading = true;

  app.innerHTML = `
    <section class="loading-screen">
      <div class="loader"></div>
      <p>${escapeHTML(message)}</p>
    </section>
  `;
}

function showError(message, retryCallback) {
  app.innerHTML = `
    <div class="error-state">
      <div style="font-size:30px;margin-bottom:10px">!</div>
      ${escapeHTML(message)}
      <br>
      <button class="retry-button" id="retryButton">تلاش مجدد</button>
    </div>
  `;

  document.getElementById("retryButton")?.addEventListener("click", () => {
    retryCallback?.();
  });
}

async function apiRequest(endpoint) {
  const sep = endpoint.includes("?") ? "&" : "?";
  const response = await fetch(`${API_BASE}${endpoint}${sep}mode=${dataMode}`, {
    method: "GET",
    headers: {
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`API HTTP ${response.status}`);
  }

  const data = await response.json();

  if (data.success === false) {
    throw new Error(data.message || data.error || "API request failed");
  }

  return data;
}

function normalizePath(path) {
  if (!path) return "/";
  return path.endsWith("/") ? path : `${path}/`;
}

/* ---------- File size helpers ---------- */

function getKnownFileSize(item) {
  const directSize = Number(item?.sizeBytes || item?.size);

  if (Number.isFinite(directSize) && directSize > 0) {
    return directSize;
  }

  const path = item?.path;

  if (path && state.sizeCache.has(path)) {
    return state.sizeCache.get(path);
  }

  return null;
}

async function fetchFileInfo(path) {
  const endpoint =
    `/api/v1/providers/${PROVIDER}/file-info?path=${encodeURIComponent(path)}`;

  const data = await apiRequest(endpoint);

  const file = data.file || data.data?.file || null;

  if (!file) {
    throw new Error("INVALID_FILE_INFO_RESPONSE");
  }

  const size = Number(file.sizeBytes);

  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("FILE_SIZE_UNAVAILABLE");
  }

  return size;
}

function updateFileSizeInUI(path, size) {
  document.querySelectorAll("[data-file-size]").forEach(element => {
    if (element.dataset.fileSize !== path) return;

    element.textContent = formatBytes(size);
    element.classList.remove("size-loading");
    element.classList.add("size-loaded");
  });
}

function updateFileSizeFailureInUI(path) {
  document.querySelectorAll("[data-file-size]").forEach(element => {
    if (element.dataset.fileSize !== path) return;

    element.textContent = "حجم نامشخص";
    element.classList.remove("size-loading");
    element.classList.add("size-unavailable");
  });
}

async function loadOneFileSize(item) {
  const path = item?.path;

  if (!path || typeof path !== "string") return;

  if (getKnownFileSize(item) !== null) {
    const size = getKnownFileSize(item);
    updateFileSizeInUI(path, size);
    return;
  }

  if (state.sizeLoading.has(path)) return;

  state.sizeLoading.add(path);

  try {
    const size = await fetchFileInfo(path);

    state.sizeCache.set(path, size);
    updateFileSizeInUI(path, size);
  } catch (error) {
    console.warn("File size unavailable:", path, error);
    updateFileSizeFailureInUI(path);
  } finally {
    state.sizeLoading.delete(path);
  }
}

async function loadFileSizes(items) {
  const uniqueItems = [];
  const seen = new Set();

  for (const item of items || []) {
    const path = item?.path;

    if (!path || seen.has(path)) continue;

    seen.add(path);
    uniqueItems.push(item);
  }

  // Maximum three simultaneous file-info requests.
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < uniqueItems.length) {
      const item = uniqueItems[nextIndex++];
      await loadOneFileSize(item);
    }
  }

  const workerCount = Math.min(3, uniqueItems.length);

  await Promise.all(
    Array.from({ length: workerCount }, () => worker())
  );
}

/* ---------- API response helpers ---------- */

function getEntries(data) {
  if (Array.isArray(data)) return data;

  if (Array.isArray(data?.directory?.entries)) {
    return data.directory.entries;
  }

  if (Array.isArray(data?.entries)) {
    return data.entries;
  }

  if (Array.isArray(data?.data?.directory?.entries)) {
    return data.data.directory.entries;
  }

  if (Array.isArray(data?.data?.entries)) {
    return data.data.entries;
  }

  return [];
}

function getDirectories(entries) {
  return entries.filter(item =>
    item.isDirectory === true ||
    item.type === "directory" ||
    item.type === "dir"
  );
}

function getCatalogObject(data, type) {
  if (data?.[type]) return data[type];
  if (data?.data?.[type]) return data.data[type];
  return data?.data || data;
}

function getDownloads(item) {
  if (!item) return [];

  const candidates = [
    item.downloads,
    item.versions,
    item.files,
    item.downloadOptions
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  if (item.downloadUrl || item.url) return [item];

  return [];
}

function getDownloadUrl(item) {
  return item?.downloadUrl ||
    item?.downloadURL ||
    item?.directUrl ||
    item?.url ||
    null;
}

function getMetadata(item) {
  return item?.metadata || item?.technical || item?.info || {};
}

function getResolution(item) {
  const metadata = getMetadata(item);

  return metadata.resolution ||
    item.resolution ||
    item.quality ||
    "کیفیت نامشخص";
}

function getDownloadName(item) {
  return item.filename ||
    item.name ||
    item.title ||
    item.path?.split("/").filter(Boolean).pop() ||
    "فایل دانلود";
}

function getDownloadTags(item) {
  const metadata = getMetadata(item);
  const tags = [];

  const resolution = getResolution(item);

  if (resolution && resolution !== "کیفیت نامشخص") {
    tags.push(resolution);
  }

  if (metadata.codec) tags.push(metadata.codec);
  if (metadata.bitDepth) tags.push(metadata.bitDepth);
  if (metadata.source) tags.push(metadata.source);
  if (metadata.audioChannels) tags.push(metadata.audioChannels);

  if (metadata.softSub === true) tags.push("زیرنویس داخلی");
  if (metadata.hardSub === true) tags.push("زیرنویس چسبیده");

  const size = getKnownFileSize(item);

  if (size !== null) {
    tags.push(formatBytes(size));
  }

  return [...new Set(tags)];
}

function getSubtitles(item) {
  const candidates = [
    item?.subtitles,
    item?.subtitleFiles,
    item?.subtitle
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === "object") return [candidate];
  }

  return [];
}

function getCatalogPath(item) {
  return normalizePath(item?.path || item?.directory || "");
}

/* ---------- Direct links and navigation ---------- */

function makeDetailUrl(type, path, season = null, episode = null) {
  const params = new URLSearchParams();

  params.set(type === "series" ? "series" : "movie", path);
  if (season !== null && season !== undefined) params.set("season", season);
  if (episode !== null && episode !== undefined) params.set("episode", episode);

  return `${location.origin}${location.pathname}?${params.toString()}`;
}

function navigateToDetail(type, path) {
  const param = type === "series" ? "series" : "movie";
  const url = new URL(location.href);

  url.search = "";
  url.searchParams.set(param, path);

  history.pushState({ type, path }, "", url);

  loadDetail(type, path);
}

function navigateHome() {
  const url = new URL(location.href);

  url.search = "";

  history.pushState({}, "", url);

  state.detail = null;
  state.detailType = null;

  renderHome();
}

window.addEventListener("popstate", () => {
  const params = new URLSearchParams(location.search);
  const moviePath = params.get("movie");
  const seriesPath = params.get("series");

  if (moviePath) {
    loadDetail("movie", moviePath);
  } else if (seriesPath) {
    loadDetail("series", seriesPath);
  } else {
    state.detail = null;
    state.detailType = null;
    renderHome();
  }
});

/* ---------- Initial loading ---------- */

function applyModeUI() {
  document.querySelectorAll("[data-mode]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === dataMode);
  });
}

function setupModeSwitch() {
  applyModeUI();

  document.querySelectorAll("[data-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.mode === dataMode) return;

      dataMode = btn.dataset.mode;
      try { localStorage.setItem(MODE_KEY, dataMode); } catch (e) {}
      applyModeUI();
      showToast(dataMode === "online" ? "حالت آنلاین: درجا از سرور" : "حالت آفلاین: از JSON");

      // همان صفحه‌ای که باز است را با حالت جدید دوباره بگیر
      if (state.detail && state.detailType) {
        loadDetail(state.detailType, state.detail.path);
      } else {
        renderHome();
      }
    });
  });
}

async function init() {
  setupModeSwitch();

  try {
    await apiRequest("/api/v1/health");
    setApiStatus(true, "API متصل است");
  } catch (error) {
    setApiStatus(false, "عدم اتصال به API");
  }

  const params = new URLSearchParams(location.search);
  const moviePath = params.get("movie");
  const seriesPath = params.get("series");

  if (moviePath) {
    await loadDetail("movie", moviePath);
    return;
  }

  if (seriesPath) {
    await loadDetail("series", seriesPath);
    return;
  }

  await renderHome();
}

/* ---------- Home and archive browsing ---------- */

async function renderHome() {
  state.detail = null;
  state.detailType = null;
  state.year = null;
  state.entries = [];
  state.filteredEntries = [];
  state.search = "";

  showLoading("در حال دریافت آرشیو...");

  try {
    const [moviesData, seriesData] = await Promise.all([
      apiRequest(`/api/v1/providers/${PROVIDER}/list?path=${encodeURIComponent("/Movies/")}`),
      apiRequest(`/api/v1/providers/${PROVIDER}/list?path=${encodeURIComponent("/Series/")}`)
    ]);

    state.movieYears = getDirectories(getEntries(moviesData));
    state.seriesYears = getDirectories(getEntries(seriesData));

    renderHomeLayout();
  } catch (error) {
    console.error("Archive loading error:", error);

    showError(
      "دریافت آرشیو با مشکل مواجه شد. اتصال API را بررسی کن.",
      renderHome
    );
  }
}

function renderHomeLayout() {
  const years = state.type === "movies"
    ? state.movieYears || []
    : state.seriesYears || [];

  app.innerHTML = `
    <section class="hero">
      <div class="eyebrow">FLICKSY DOWNLOAD</div>

      <h1>
        دنیای فیلم و سریال،<br>
        <span>برای دانلود آماده است.</span>
      </h1>

      <p>
        آرشیو را جست‌وجو کن، کیفیت دلخواهت را انتخاب کن
        و مستقیم از منبع دانلود دریافت کن.
      </p>

      <label class="search-box">
        <span class="search-icon">⌕</span>

        <input
          id="searchInput"
          type="search"
          placeholder="نام فیلم یا سریال را جست‌وجو کن..."
          autocomplete="off"
          value="${escapeHTML(state.search)}"
        >
      </label>
    </section>

    <section class="section">
      <div class="section-heading">
        <div>
          <h2>مرور آرشیو</h2>
          <p>دسته‌بندی موردنظرت را انتخاب کن</p>
        </div>

        <div class="type-switch">
          <button
            class="type-button ${state.type === "movies" ? "active" : ""}"
            data-type="movies">
            فیلم‌ها
          </button>

          <button
            class="type-button ${state.type === "series" ? "active" : ""}"
            data-type="series">
            سریال‌ها
          </button>
        </div>
      </div>

      <div class="year-list" id="yearList">
        ${years.length
          ? years.map(item => {
              const year = item.name ||
                item.title ||
                item.path?.split("/").filter(Boolean).pop();
              const label = item.label || year;

              return `
                <button
                  class="year-button ${String(state.year) === String(year) ? "active" : ""}"
                  data-year="${escapeHTML(year)}">
                  ${escapeHTML(label)}
                </button>
              `;
            }).join("")
          : `<div class="empty-state">هنوز سالی در این دسته‌بندی پیدا نشد.</div>`
        }
      </div>
    </section>

    <section class="section" id="catalogSection">
      <div class="section-heading">
        <div>
          <h2 id="catalogTitle">انتخاب سال</h2>
          <p id="catalogSubtitle">برای مشاهده آرشیو، یک سال را انتخاب کن.</p>
        </div>
      </div>

      <div id="catalogContent">
        <div class="empty-state">ابتدا یکی از سال‌ها را انتخاب کن.</div>
      </div>
    </section>
  `;

  document.querySelectorAll("[data-type]").forEach(button => {
    button.addEventListener("click", () => {
      state.type = button.dataset.type;
      state.year = null;
      state.entries = [];
      state.search = "";

      renderHomeLayout();
    });
  });

  document.querySelectorAll("[data-year]").forEach(button => {
    button.addEventListener("click", () => {
      loadYear(button.dataset.year);
    });
  });

  const searchInput = document.getElementById("searchInput");

  searchInput.addEventListener("input", event => {
    state.search = event.target.value;
    filterEntries();
  });
}

async function loadYear(year) {
  state.year = String(year);
  state.entries = [];
  state.filteredEntries = [];

  document.querySelectorAll("[data-year]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.year === String(year)
    );
  });

  const title = document.getElementById("catalogTitle");
  const subtitle = document.getElementById("catalogSubtitle");
  const content = document.getElementById("catalogContent");

  const yearLabel = /^p\d+$/.test(year) ? `صفحه ${year.slice(1)}` : year;
  title.textContent = dataMode === "online" ? `آنلاین · ${yearLabel}` : `آرشیو ${yearLabel}`;
  subtitle.textContent = "در حال دریافت فهرست...";

  content.innerHTML = `
    <div class="loading-screen">
      <div class="loader"></div>
      <p>در حال دریافت عناوین...</p>
    </div>
  `;

  const category = state.type === "movies" ? "Movies" : "Series";
  const path = `/${category}/${year}/`;

  try {
    const data = await apiRequest(
      `/api/v1/providers/${PROVIDER}/list?path=${encodeURIComponent(path)}`
    );

    state.entries = getDirectories(getEntries(data));
    state.filteredEntries = [...state.entries];

    subtitle.textContent = `${state.entries.length} عنوان در ${dataMode === "online" ? "" : "آرشیو "}${yearLabel}`;

    filterEntries();
  } catch (error) {
    console.error("Year loading error:", error);

    content.innerHTML = `
      <div class="error-state">
        دریافت این آرشیو ناموفق بود.
        <br>
        <button class="retry-button" id="retryYear">تلاش مجدد</button>
      </div>
    `;

    document.getElementById("retryYear")?.addEventListener("click", () => {
      loadYear(year);
    });
  }
}

function filterEntries() {
  const query = state.search.trim().toLowerCase();

  state.filteredEntries = state.entries.filter(item => {
    const name = titleFromName(item.name || item.title || "");

    return !query || name.toLowerCase().includes(query);
  });

  renderCatalogCards();
}

function renderCatalogCards() {
  const content = document.getElementById("catalogContent");

  if (!content) return;

  if (!state.year) {
    content.innerHTML = `
      <div class="empty-state">
        ابتدا یک سال را انتخاب کن.
      </div>
    `;

    return;
  }

  if (!state.filteredEntries.length) {
    content.innerHTML = `
      <div class="empty-state">
        عنوانی با این نام پیدا نشد.
        <br>
        عبارت دیگری را جست‌وجو کن.
      </div>
    `;

    return;
  }

  content.innerHTML = `
    <div class="catalog-grid">
      ${state.filteredEntries.map(item => {
        const name = titleFromName(item.name || item.title || "بدون نام");
        const path = getCatalogPath(item);
        const typeLabel = state.type === "movies" ? "FILM" : "SERIES";

        return `
          <article
            class="catalog-card"
            data-open-path="${escapeHTML(path)}"
            data-open-type="${state.type === "movies" ? "movie" : "series"}">

            <div class="poster">
              <span class="poster-letter">${escapeHTML(shortTitle(name))}</span>
              ${imgTag(item.image, "poster-img")}
              <span class="poster-type">${typeLabel}</span>
              ${item.imdb ? `<span class="poster-imdb">⭐ ${escapeHTML(item.imdb)}</span>` : ""}
            </div>

            <div class="card-info">
              <div class="card-title">${escapeHTML(name)}</div>
              <div class="card-subtitle">${escapeHTML(item.year || (/^p\d+$/.test(state.year) ? "" : state.year))}${item.duration ? " · " + escapeHTML(item.duration) : ""}</div>
              ${(item.genres || []).length ? `<div class="card-genres">${escapeHTML(item.genres.slice(0, 3).join(" · "))}</div>` : ""}

              <div class="card-bottom">
                <span class="card-tag">
                  ${state.type === "movies" ? "دانلود فیلم" : "دانلود سریال"}
                </span>

                <span class="card-arrow">←</span>
              </div>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;

  content.querySelectorAll("[data-open-path]").forEach(card => {
    card.addEventListener("click", () => {
      navigateToDetail(
        card.dataset.openType,
        card.dataset.openPath
      );
    });
  });
}

/* ---------- Detail pages ---------- */

async function loadDetail(type, path) {
  if (!path || !/^\/(Movies|Series)\//.test(path)) {
    showError("آدرس این عنوان معتبر نیست.", navigateHome);
    return;
  }

  showLoading("در حال دریافت جزئیات عنوان...");

  const endpoint = type === "series" ? "series" : "movie";

  try {
    const data = await apiRequest(
      `/api/v1/providers/${PROVIDER}/${endpoint}?path=${encodeURIComponent(path)}`
    );

    const catalog = getCatalogObject(data, type);

    if (!catalog || typeof catalog !== "object") {
      throw new Error("Invalid catalog response");
    }

    state.detail = catalog;
    state.detailType = type;
    state.selectedSeason = null;

    const urlParams = new URLSearchParams(location.search);
    const seasonParam = urlParams.get("season");
    const episodeParam = urlParams.get("episode");
    state.seasonView = type === "series" && seasonParam !== null ? Number(seasonParam) : null;
    state.episodeView = type === "series" && seasonParam !== null && episodeParam !== null
      ? Number(episodeParam)
      : null;

    if (type === "series") {
      const seasons = getSeasons(catalog);

      state.selectedSeason =
        seasons[0]?.seasonNumber ??
        seasons[0]?.number ??
        null;
    }

    renderDetail();
  } catch (error) {
    console.error("Detail loading error:", error);

    showError(
      "دریافت اطلاعات این عنوان ناموفق بود. ممکن است مسیر آرشیو تغییر کرده باشد.",
      () => loadDetail(type, path)
    );
  }
}

function getSeasons(catalog) {
  return Array.isArray(catalog.seasons) ? catalog.seasons : [];
}

function getEpisodes(season) {
  return Array.isArray(season?.episodes) ? season.episodes : [];
}

function getTitle(catalog) {
  return catalog.title ||
    catalog.name ||
    titleFromName(catalog.path?.split("/").filter(Boolean).pop()) ||
    "بدون عنوان";
}

function getOriginalTitle(catalog) {
  return catalog.originalTitle ||
    catalog.original_title ||
    catalog.englishTitle ||
    "";
}

function getYear(catalog) {
  return catalog.releaseYear ||
    catalog.year ||
    catalog.archiveYear ||
    "";
}

function getDescription(catalog) {
  return catalog.overview ||
    catalog.description ||
    catalog.plot ||
    "";
}

function getMovieDownloads(catalog) {
  const downloads = getDownloads(catalog);

  if (downloads.length) return downloads;

  if (Array.isArray(catalog.qualities)) {
    return catalog.qualities.flatMap(item => getDownloads(item));
  }

  return [];
}

function getSeasonNumber(season) {
  return season.seasonNumber ?? season.number ?? season.season ?? 0;
}

function getEpisodeNumber(episode) {
  return episode.episodeNumber ?? episode.number ?? episode.episode ?? 0;
}

function renderDetail() {
  const catalog = state.detail;

  if (!catalog) return;

  const type = state.detailType;

  if (type === "series" && state.seasonView !== null) {
    renderSeasonOrEpisodePage(catalog);
    return;
  }
  const title = getTitle(catalog);
  const originalTitle = getOriginalTitle(catalog);
  const year = getYear(catalog);
  const description = getDescription(catalog);
  const path = getCatalogPath(catalog);

  const detailUrl = makeDetailUrl(type, path);

  const count = type === "series"
    ? `${catalog.seasonCount ?? getSeasons(catalog).length} فصل · ${catalog.episodeCount ?? 0} قسمت`
    : `${getMovieDownloads(catalog).length} نسخه دانلود`;

  app.innerHTML = `
    <nav class="breadcrumb">
      <button id="homeButton">خانه</button>
      <span>‹</span>
      <span>${type === "series" ? "سریال‌ها" : "فیلم‌ها"}</span>
      <span>‹</span>
      <span>${escapeHTML(title)}</span>
    </nav>

    <section class="detail-header">
      <div class="detail-poster">
        <span>${escapeHTML(shortTitle(title))}</span>
        ${imgTag(catalog.image || catalog.cover, "detail-poster-img")}
      </div>

      <div class="detail-content">
        <div class="eyebrow">
          ${type === "series" ? "SERIES DOWNLOAD" : "MOVIE DOWNLOAD"}
        </div>

        <h1>${escapeHTML(title)}</h1>

        ${originalTitle
          ? `<div class="original-title">${escapeHTML(originalTitle)}</div>`
          : ""
        }

        <div class="meta-list">
          ${year ? `<span class="meta-chip">${escapeHTML(year)}</span>` : ""}
          <span class="meta-chip">${type === "series" ? "سریال" : "فیلم"}</span>
          <span class="meta-chip">${escapeHTML(count)}</span>
          ${catalog.imdb ? `<span class="meta-chip chip-imdb">IMDb ${escapeHTML(catalog.imdb)}</span>` : ""}
          ${catalog.rating ? `<span class="meta-chip">امتیاز ${escapeHTML(catalog.rating)}</span>` : ""}
          ${catalog.duration ? `<span class="meta-chip">⏱ ${escapeHTML(catalog.duration)}</span>` : ""}
          ${catalog.itemType ? `<span class="meta-chip">${escapeHTML(catalog.itemType)}</span>` : ""}
        </div>

        ${(catalog.genres || []).length ? `<div class="meta-list">${chips(catalog.genres, "meta-chip chip-genre")}</div>` : ""}

        ${(catalog.countries || []).length ? `<div class="meta-list">${catalog.countries.map(c =>
          `<span class="meta-chip chip-country">${imgTag(c.image, "flag-img")}${escapeHTML(c.title || "")}</span>`).join("")}</div>` : ""}

        ${description
          ? `<p class="detail-description">${escapeHTML(description)}</p>`
          : `<p class="detail-description">نسخه‌های موجود در آرشیو را مشاهده و کیفیت دلخواهت را انتخاب کن.</p>`
        }

        <button class="secondary-button" id="shareButton">
          ↗ کپی لینک این عنوان
        </button>
      </div>
    </section>

    ${catalog.cover && catalog.cover !== catalog.image ? `<div class="detail-cover-wrap">${imgTag(catalog.cover, "detail-cover")}</div>` : ""}

    ${idsBlock(catalog.ids)}
    ${extraBlock(catalog.extra)}
    ${rawBlock(catalog.raw)}

    <div id="detailContent"></div>
  `;

  document.getElementById("homeButton").addEventListener("click", navigateHome);

  document.getElementById("shareButton").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(detailUrl);
      showToast("لینک صفحه کپی شد.");
    } catch {
      showToast("امکان کپی لینک وجود نداشت.");
    }
  });

  if (type === "movie") {
    renderMovieContent(catalog);
  } else {
    renderSeriesContent(catalog);
  }
}

/* ---------- Movie details ---------- */

function renderDownloadItem(item, index = 0) {
  const url = getDownloadUrl(item);
  const name = getDownloadName(item);
  const tags = getDownloadTags(item);
  const resolution = getResolution(item);

  const path = item?.path || "";
  const knownSize = getKnownFileSize(item);

  const sizeMarkup = path
    ? `<span
         class="file-size ${knownSize === null ? "size-loading" : "size-loaded"}"
         data-file-size="${escapeHTML(path)}">
         ${knownSize === null ? "در حال بررسی حجم..." : escapeHTML(formatBytes(knownSize))}
       </span>`
    : "";

  return `
    <div class="download-item">
      <div class="download-main">
        <div class="download-title">
          ${escapeHTML(resolution || name)}
        </div>

        <div class="download-meta">
          ${tags.map(tag => `<span>${escapeHTML(tag)}</span>`).join("")}
          ${sizeMarkup}
        </div>

        <div class="card-subtitle" style="direction:ltr;margin-top:8px">
          ${escapeHTML(name)}
        </div>
      </div>

      <div class="download-actions">
        ${url
          ? `<a
                class="download-button"
                href="${escapeHTML(url)}"
                target="_blank"
                rel="noopener noreferrer"
                download>
                ↓ دانلود
             </a>`
          : `<span class="meta-chip">لینک موجود نیست</span>`
        }
      </div>
    </div>
  `;
}

function renderMovieContent(catalog) {
  const container = document.getElementById("detailContent");

  const downloads = getMovieDownloads(catalog);
  const subtitles = getSubtitles(catalog);

  container.innerHTML = `
    <section class="detail-section">
      <h2>نسخه‌های دانلود</h2>

      ${downloads.length
        ? `<div class="download-list">
            ${downloads.map((item, index) => renderDownloadItem(item, index)).join("")}
           </div>`
        : `<div class="empty-state">فعلاً نسخه قابل دانلودی برای این فیلم پیدا نشد.</div>`
      }
    </section>

    ${subtitles.length
      ? `
        <section class="detail-section">
          <h2>زیرنویس‌ها</h2>

          <div class="download-list">
            ${subtitles.map(item => renderSubtitleItem(item)).join("")}
          </div>
        </section>
      `
      : ""
    }
  `;

  // Fetch sizes after the download list is already visible.
  loadFileSizes(downloads);
}

function renderSubtitleItem(item) {
  const url = getDownloadUrl(item);
  const name = getDownloadName(item);

  return `
    <div class="subtitle-item">
      <span>${escapeHTML(name)}</span>

      ${url
        ? `<a
             class="secondary-button"
             href="${escapeHTML(url)}"
             target="_blank"
             rel="noopener noreferrer">
             دانلود زیرنویس
           </a>`
        : `<span class="meta-chip">لینک موجود نیست</span>`
      }
    </div>
  `;
}

/* ---------- Series details ---------- */

function navigateSeries(season, episode = null) {
  const catalog = state.detail;
  const path = getCatalogPath(catalog);
  const url = new URL(location.href);

  url.search = "";
  url.searchParams.set("series", path);

  if (season !== null) url.searchParams.set("season", season);
  if (season !== null && episode !== null) url.searchParams.set("episode", episode);

  history.pushState({ type: "series", path, season, episode }, "", url);

  state.seasonView = season;
  state.episodeView = season !== null ? episode : null;

  renderDetail();
  window.scrollTo(0, 0);
}

/* صفحه‌ی سریال: فهرست فصل‌ها */
function renderSeriesContent(catalog) {
  const container = document.getElementById("detailContent");
  const seasons = getSeasons(catalog);

  if (!seasons.length) {
    container.innerHTML = `
      <section class="detail-section">
        <div class="empty-state">
          فصلی برای این سریال در آرشیو پیدا نشد.
          ${(catalog.warnings || []).map(w => `<br>${escapeHTML(w)}`).join("")}
        </div>
      </section>
    `;

    return;
  }

  container.innerHTML = `
    <section class="detail-section">
      <h2>فصل‌ها</h2>

      <div class="season-grid">
        ${seasons.map(season => {
          const number = getSeasonNumber(season);
          const episodes = getEpisodes(season);
          const downloads = episodes.reduce((t, e) => t + getDownloads(e).length, 0);

          return `
            <article class="season-card" data-season-open="${escapeHTML(number)}">
              <div class="season-number">${escapeHTML(number)}</div>
              <div class="season-card-info">
                <strong>${escapeHTML(season.title || ("فصل " + number))}</strong>
                <span>${episodes.length} قسمت · ${downloads} لینک دانلود</span>
              </div>
              <a class="season-newtab"
                 href="${escapeHTML(makeDetailUrl("series", getCatalogPath(catalog), number))}"
                 target="_blank" rel="noopener"
                 title="باز کردن این فصل در صفحه‌ی جدید">صفحه‌ی جدید ↗</a>
              <span class="card-arrow">←</span>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;

  container.querySelectorAll(".season-newtab").forEach(link => {
    link.addEventListener("click", e => e.stopPropagation());
  });

  container.querySelectorAll("[data-season-open]").forEach(card => {
    card.addEventListener("click", () => {
      navigateSeries(Number(card.dataset.seasonOpen));
    });
  });
}

/* صفحه‌ی فصل و صفحه‌ی دانلود قسمت */
function renderSeasonOrEpisodePage(catalog) {
  const title = getTitle(catalog);
  const seasons = getSeasons(catalog);
  const season = seasons.find(s => Number(getSeasonNumber(s)) === state.seasonView);
  const seasonNo = state.seasonView;

  const episodes = season ? getEpisodes(season) : [];
  const episode = state.episodeView !== null
    ? episodes.find(e => Number(getEpisodeNumber(e)) === state.episodeView)
    : null;

  const crumbs = `
    <nav class="breadcrumb">
      <button id="homeButton">خانه</button>
      <span>‹</span>
      <button id="seriesBackButton">${escapeHTML(title)}</button>
      <span>‹</span>
      ${state.episodeView !== null
        ? `<button id="seasonBackButton">فصل ${escapeHTML(seasonNo)}</button>
           <span>‹</span>
           <span>قسمت ${escapeHTML(state.episodeView)}</span>`
        : `<span>فصل ${escapeHTML(seasonNo)}</span>`
      }
    </nav>
  `;

  let body = "";

  if (!season) {
    body = `<div class="empty-state">این فصل پیدا نشد.</div>`;
  } else if (state.episodeView !== null && !episode) {
    body = `<div class="empty-state">این قسمت پیدا نشد.</div>`;
  } else if (!episode) {
    body = seasonPageHTML(season, seasonNo, seasons);
  } else {
    body = episodePageHTML(episode, season, seasonNo, episodes);
  }

  app.innerHTML = crumbs + body;

  document.getElementById("homeButton").addEventListener("click", navigateHome);
  document.getElementById("seriesBackButton").addEventListener("click", () => navigateSeries(null));
  document.getElementById("seasonBackButton")?.addEventListener("click", () => navigateSeries(seasonNo));

  app.querySelectorAll("[data-season-switch]").forEach(button => {
    button.addEventListener("click", () => navigateSeries(Number(button.dataset.seasonSwitch)));
  });

  app.querySelectorAll("[data-episode-open]").forEach(card => {
    card.addEventListener("click", () => navigateSeries(seasonNo, Number(card.dataset.episodeOpen)));
  });

  app.querySelectorAll("[data-copy-link]").forEach(button => {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copyLink);
        showToast("لینک کپی شد.");
      } catch {
        showToast("امکان کپی لینک وجود نداشت.");
      }
    });
  });

  if (episode) {
    loadFileSizes(getDownloads(episode));
  } else if (season) {
    // حجم فقط برای قسمت‌های همین فصل (۳ درخواست هم‌زمان)
    loadFileSizes(episodes.flatMap(e => getDownloads(e)));
  }
}

function seasonPageHTML(season, seasonNo, seasons) {
  const episodes = getEpisodes(season);
  const subtitles = getSubtitles(season);

  return `
    <section class="detail-section">
      <h2>${escapeHTML(season.title || ("فصل " + seasonNo))}</h2>

      <div class="season-tabs">
        ${seasons.map(s => {
          const n = getSeasonNumber(s);
          return `<button class="season-button ${Number(n) === Number(seasonNo) ? "active" : ""}"
                    data-season-switch="${escapeHTML(n)}">فصل ${escapeHTML(n)}</button>`;
        }).join("")}
      </div>

      ${extraBlock(season.extra)}

      <div class="episode-list">
        ${episodes.length
          ? episodes.map(e => {
              const n = getEpisodeNumber(e);
              const count = getDownloads(e).length;

              return `
                <article class="episode-card episode-link" data-episode-open="${escapeHTML(n)}">
                  <div class="episode-heading">
                    <strong>${escapeHTML(e.title || ("قسمت " + n))}</strong>
                    <span>قسمت ${escapeHTML(n)}${e.duration ? " · " + escapeHTML(e.duration) : ""}</span>
                  </div>

                  ${(e.image || e.description) ? `
                    <div class="episode-info">
                      ${imgTag(e.image, "episode-img")}
                      ${e.description ? `<p class="clamp">${escapeHTML(e.description)}</p>` : ""}
                    </div>` : ""}

                  <div class="episode-link-bottom">
                    <span class="meta-chip">${count} نسخه دانلود</span>
                    <span class="download-button">صفحه‌ی دانلود ←</span>
                  </div>
                </article>
              `;
            }).join("")
          : `<div class="empty-state">قسمتی برای این فصل پیدا نشد.</div>`
        }
      </div>
    </section>

    ${subtitles.length
      ? `<section class="detail-section">
           <h2>زیرنویس‌های فصل</h2>
           <div class="download-list">
             ${subtitles.map(item => renderSubtitleItem(item)).join("")}
           </div>
         </section>`
      : ""
    }
  `;
}

function episodePageHTML(episode, season, seasonNo, episodes) {
  const number = getEpisodeNumber(episode);
  const downloads = getDownloads(episode);
  const title = episode.title || ("قسمت " + number);
  const index = episodes.indexOf(episode);
  const prev = index > 0 ? episodes[index - 1] : null;
  const next = index >= 0 && index < episodes.length - 1 ? episodes[index + 1] : null;
  const link = makeDetailUrl("series", getCatalogPath(state.detail), seasonNo, number);

  return `
    <section class="detail-header episode-header">
      ${episode.image ? `<div class="detail-poster">${imgTag(episode.image, "detail-poster-img")}</div>` : ""}

      <div class="detail-content">
        <div class="eyebrow">EPISODE DOWNLOAD</div>
        <h1>${escapeHTML(title)}</h1>

        <div class="meta-list">
          <span class="meta-chip">فصل ${escapeHTML(seasonNo)}</span>
          <span class="meta-chip">قسمت ${escapeHTML(number)}</span>
          ${episode.duration ? `<span class="meta-chip">⏱ ${escapeHTML(episode.duration)}</span>` : ""}
          <span class="meta-chip">${downloads.length} نسخه دانلود</span>
        </div>

        ${episode.description ? `<p class="detail-description">${escapeHTML(episode.description)}</p>` : ""}

        <button class="secondary-button" data-copy-link="${escapeHTML(link)}">↗ کپی لینک این قسمت</button>
      </div>
    </section>

    ${extraBlock(episode.extra)}

    <section class="detail-section">
      <h2>نسخه‌های دانلود</h2>
      ${downloads.length
        ? `<div class="download-list">
             ${downloads.map((item, i) => renderDownloadItem(item, i)).join("")}
           </div>`
        : `<div class="empty-state">برای این قسمت لینک دانلودی پیدا نشد.</div>`
      }
    </section>

    <div class="episode-nav">
      ${prev
        ? `<button class="secondary-button" data-episode-open="${escapeHTML(getEpisodeNumber(prev))}">→ قسمت قبلی</button>`
        : `<span></span>`}
      ${next
        ? `<button class="secondary-button" data-episode-open="${escapeHTML(getEpisodeNumber(next))}">قسمت بعدی ←</button>`
        : `<span></span>`}
    </div>
  `;
}

function renderEpisode(episode) {
  const number = getEpisodeNumber(episode);
  const downloads = getDownloads(episode);
  const title = episode.title || episode.name || `قسمت ${number}`;

  return `
    <article class="episode-card">
      <div class="episode-heading">
        <strong>${escapeHTML(title)}</strong>
        <span>قسمت ${escapeHTML(number)}${episode.duration ? " · " + escapeHTML(episode.duration) : ""}</span>
      </div>

      ${(episode.image || episode.description) ? `
        <div class="episode-info">
          ${imgTag(episode.image, "episode-img")}
          ${episode.description ? `<p>${escapeHTML(episode.description)}</p>` : ""}
        </div>` : ""}
      ${extraBlock(episode.extra)}

      ${downloads.length
        ? downloads.map((item, index) => renderDownloadItem(item, index)).join("")
        : `<div class="empty-state">نسخه‌ای برای این قسمت موجود نیست.</div>`
      }
    </article>
  `;
}

/* ---------- Start ---------- */

init();
