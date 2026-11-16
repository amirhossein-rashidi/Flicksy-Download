"use strict";

/*
 * Flicksy-Download — web UI (design from the "index" prototype, wired to the real local API).
 * Data access only through window.Api (api-client.js). The original mock-data prototype is kept in
 * fixtures/design-prototype/ for reference.
 */

const PAGE_SIZE = 24;
const pageNames = ["home", "movies", "series", "search", "browse", "detail"];

const STATUS_TEXT = { working: "کار می‌کند", unavailable: "در دسترس نیست", unverified: "بررسی‌نشده" };
const SUB_TEXT = { "hardsub-fa": "هاردساب فارسی", "softsub-fa": "زیرنویس فارسی", "dubbed-fa": "دوبله فارسی" };

const state = {
  currentPage: "home",
  previousPage: "home",
  selectedGenre: { movies: "", series: "" },   // genre id as string, "" = all
  facets: null,
  selectedTitle: null,
  catalog: {
    movies: { offset: 0, abort: null, timer: null },
    series: { offset: 0, abort: null, timer: null },
    search: { offset: 0, abort: null, timer: null },
    browse: { offset: 0, abort: null, timer: null }
  }
};

/* ---------------- helpers ---------------- */

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

function safeURL(value) {
  if (!value) return "";
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

const kindOfPage = page => (page === "movies" ? "movie" : "series");
const getTypeLabel = type => (type === "movie" ? "فیلم" : "سریال");

function fmtSize(bytes) {
  if (!bytes) return "";
  return "‎" + (bytes >= 1073741824
    ? (bytes / 1073741824).toFixed(2) + " GB"
    : (bytes / 1048576).toFixed(0) + " MB");
}

function gradientFor(id) {
  const hue = (Number(id) * 47) % 360;
  return `linear-gradient(145deg,hsl(${hue} 55% 32%),hsl(${(hue + 40) % 360} 40% 12%) 60%,#111827)`;
}

/** API summary -> card model */
function toCard(t) {
  return {
    id: t.id,
    type: t.kind,
    title: t.titleFa || t.title,
    original: t.title,
    year: t.year || "—",
    rating: t.imdbScore > 0 ? Number(t.imdbScore).toFixed(1) : "—",
    image: t.image,
    genres: t.genres || "",
    synopsis: t.synopsis || "",
    gradient: gradientFor(t.id)
  };
}

function showError(elementId, error) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.innerHTML = `
    <div class="empty-state">
      <strong>خطا در دریافت اطلاعات</strong>
      <p>${escapeHTML(error && error.message ? error.message : "نامشخص")}</p>
    </div>`;
}

// images that fail to load fall back to the gradient + title (no inline handlers: CSP)
document.addEventListener("error", event => {
  const img = event.target;
  if (img && img.tagName === "IMG" && img.dataset.fallback) {
    img.style.display = "none";
    if (img.nextElementSibling) img.nextElementSibling.hidden = false;
  }
}, true);

/* ---------------- navigation ---------------- */

function navigate(page) {
  if (!pageNames.includes(page)) return;
  state.currentPage = page;

  document.querySelectorAll(".page").forEach(section => {
    section.classList.toggle("active", section.id === `page-${page}`);
  });
  document.querySelectorAll("[data-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  const titles = {
    home: "Flicksy | آرشیو فیلم و سریال",
    movies: "آرشیو فیلم‌ها | Flicksy",
    series: "آرشیو سریال‌ها | Flicksy",
    search: "جست‌وجو | Flicksy",
    browse: "نتایج دسته‌بندی | Flicksy",
    detail: state.selectedTitle ? `${state.selectedTitle.title} | Flicksy` : "جزئیات | Flicksy"
  };
  document.title = titles[page];
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setupNavigation() {
  document.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      const page = button.dataset.page;
      if (page === "movies" || page === "series") loadCatalog(page, true);
      if (location.hash) history.replaceState(null, "", location.pathname + location.search);
      navigate(page);
    });
  });

  document.getElementById("detail-back").addEventListener("click", goBack);

  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      navigate("search");
      document.getElementById("global-search").focus();
    }
    if (event.key === "Escape" && state.currentPage === "detail") goBack();
  });

  window.addEventListener("popstate", () => {
    const m = location.hash.match(/^#title-(\d+)$/);
    if (m) openDetails(Number(m[1]), false);
    else if (state.currentPage === "detail") navigate(state.previousPage || "home");
  });
}

function goBack() {
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  navigate(state.previousPage || "home");
}

/* ---------------- cards & grids ---------------- */

function posterHTML(item) {
  const url = safeURL(item.image);
  const fallback = `<div class="poster-image-fallback" ${url ? "hidden" : ""}>${escapeHTML(item.original)}</div>`;
  const img = url
    ? `<img class="poster-image" data-fallback="1" src="${escapeHTML(url)}" alt="پوستر ${escapeHTML(item.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : "";
  return img + fallback;
}

function createMovieCard(item) {
  const typeLabel = item.type === "movie" ? "FILM" : "SERIES";
  return `
    <article class="movie-card" data-id="${item.id}" tabindex="0" role="button" aria-label="${escapeHTML(item.title)}">
      <div class="poster" style="--poster-gradient:${escapeHTML(item.gradient)}">
        <span class="poster-year">${escapeHTML(item.year)}</span>
        <span class="poster-type">${typeLabel}</span>
        ${posterHTML(item)}
      </div>
      <div class="movie-info">
        <div class="movie-title">${escapeHTML(item.title)}</div>
        <div class="movie-subtitle">${escapeHTML(item.original)}</div>
        <div class="movie-card-meta">
          <span class="movie-rating">★ ${escapeHTML(item.rating)}</span>
          <span class="movie-kind">${getTypeLabel(item.type)}</span>
        </div>
      </div>
    </article>`;
}

function renderGrid(elementId, items, append) {
  const element = document.getElementById(elementId);
  if (!element) return;
  if (!append) element.innerHTML = "";
  if (!items.length && !append) {
    element.innerHTML = `
      <div class="empty-state">
        <strong>موردی پیدا نشد</strong>
        <p>عبارت یا فیلتر دیگری را امتحان کن.</p>
      </div>`;
    return;
  }
  element.insertAdjacentHTML("beforeend", items.map(createMovieCard).join(""));
}

function wireGrid(elementId) {
  const element = document.getElementById(elementId);
  const open = card => card && openDetails(Number(card.dataset.id), true);
  element.addEventListener("click", event => open(event.target.closest(".movie-card")));
  element.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      const card = event.target.closest(".movie-card");
      if (card) { event.preventDefault(); open(card); }
    }
  });
  // "load more" button right after the grid
  const more = document.createElement("button");
  more.className = "outline-button load-more";
  more.type = "button";
  more.hidden = true;
  more.id = `${elementId}-more`;
  more.textContent = "نمایش بیشتر";
  element.insertAdjacentElement("afterend", more);
  return more;
}

/* ---------------- genres ---------------- */

const GENRE_LIMIT = 12;
// site tags that are not real genres: shown only after the real ones (under "show more")
const EDITORIAL_TAGS = new Set(["پیشنهاد سردبیر", "تازه های باحال", "محبوب ترین ها", "بیشترین دانلود ها", "سریال های بروز شده", "سریال های برتر", "چینی ژاپنی", "کره ای"]);
const genreExpanded = {};

function renderGenreButtons(containerId, type) {
  const container = document.getElementById(containerId);
  if (!container || !state.facets) return;
  const kind = kindOfPage(type);
  const all = [...(state.facets.genresByKind[kind] || [])].sort((a, b) => (EDITORIAL_TAGS.has(a.title) - EDITORIAL_TAGS.has(b.title)) || b.count - a.count || a.title.localeCompare(b.title, "fa"));
  const selected = state.selectedGenre[type];
  const total = state.facets.totals[kind] || 0;
  const expanded = Boolean(genreExpanded[containerId]);

  // always keep the selected genre visible even if it is beyond the first ones
  let shown = expanded ? all : all.slice(0, GENRE_LIMIT);
  const sel = all.find(g => String(g.id) === selected);
  if (sel && !shown.includes(sel)) shown = [...shown, sel];

  const button = g => `
    <button class="genre-button ${selected === String(g.id) ? "active" : ""}" data-genre="${g.id}" data-genre-type="${type}">
      <span>${escapeHTML(g.title)}</span><span class="genre-count">${g.count}</span>
    </button>`;

  container.innerHTML = `
    <button class="genre-button ${selected === "" ? "active" : ""}" data-genre="" data-genre-type="${type}">
      <span>همه ژانرها</span><span class="genre-count">${total}</span>
    </button>` + shown.map(button).join("") +
    (all.length > GENRE_LIMIT
      ? `<button class="genre-more" type="button" data-genre-toggle="1">${expanded ? "نمایش کمتر ↑" : `نمایش بیشتر (${all.length - GENRE_LIMIT} ژانر دیگر) ↓`}</button>`
      : "");

  container.querySelectorAll("[data-genre]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.selectedGenre[type] = btn.dataset.genre;
      renderAllGenres();
      loadCatalog(type, true);
      navigate(type);
    });
  });
  const toggle = container.querySelector("[data-genre-toggle]");
  if (toggle) toggle.addEventListener("click", () => {
    genreExpanded[containerId] = !expanded;
    renderGenreButtons(containerId, type);
  });
}

function renderAllGenres() {
  renderGenreButtons("movie-genres", "movies");
  renderGenreButtons("series-genres", "series");
  renderGenreButtons("catalog-movie-genres", "movies");
  renderGenreButtons("catalog-series-genres", "series");
}

/* ---------------- catalog + search (server-side, paged) ---------------- */

const CATALOG = {
  movies: { grid: "movies-grid", count: "movie-count", filter: "movie-active-filter", search: "movie-search", year: "movie-year" },
  series: { grid: "series-grid", count: "series-count", filter: "series-active-filter", search: "series-search", year: "series-year" }
};

async function fetchInto(slot, params, gridId, countId, reset, moreButton) {
  const s = state.catalog[slot];
  if (reset) s.offset = 0;
  if (s.abort) s.abort.abort();
  s.abort = new AbortController();
  try {
    const r = await Api.titles({ ...params, limit: PAGE_SIZE, offset: s.offset }, s.abort.signal);
    renderGrid(gridId, r.items.map(toCard), !reset);
    s.offset += r.items.length;
    moreButton.hidden = !r.hasMore;
    const shown = s.offset;
    if (countId) document.getElementById(countId).textContent = shown ? `${shown} عنوان${r.hasMore ? " و بیشتر" : ""}` : "";
    return r;
  } catch (e) {
    if (e.name !== "AbortError") showError(gridId, e);
  }
}

function loadCatalog(type, reset) {
  const c = CATALOG[type];
  const params = {
    q: document.getElementById(c.search).value.trim(),
    kind: kindOfPage(type),
    year: document.getElementById(c.year).value,
    genre: state.selectedGenre[type]
  };

  const filterElement = document.getElementById(c.filter);
  const g = (state.facets.genresByKind[params.kind] || []).find(x => String(x.id) === params.genre);
  filterElement.innerHTML = g
    ? `<button class="filter-chip" id="clear-genre-${type}">${escapeHTML(g.title)} <span>×</span></button>` : "";
  const clear = document.getElementById(`clear-genre-${type}`);
  if (clear) clear.addEventListener("click", () => {
    state.selectedGenre[type] = "";
    renderAllGenres();
    loadCatalog(type, true);
  });

  return fetchInto(type, params, c.grid, c.count, reset, document.getElementById(`${c.grid}-more`));
}

function setupCatalogFilters() {
  for (const type of ["movies", "series"]) {
    const c = CATALOG[type];
    const debounced = () => {
      clearTimeout(state.catalog[type].timer);
      state.catalog[type].timer = setTimeout(() => loadCatalog(type, true), 250);
    };
    document.getElementById(c.search).addEventListener("input", debounced);
    document.getElementById(c.year).addEventListener("change", () => loadCatalog(type, true));
    document.getElementById(`${c.grid}-more`).addEventListener("click", () => loadCatalog(type, false));
  }
}

function runGlobalSearch(reset) {
  const input = document.getElementById("global-search");
  const query = input.value.trim();
  const empty = document.getElementById("search-empty");
  const grid = document.getElementById("search-grid");
  const more = document.getElementById("search-grid-more");
  if (!query) {
    if (state.catalog.search.abort) state.catalog.search.abort.abort();
    grid.innerHTML = "";
    more.hidden = true;
    document.getElementById("search-count").textContent = "";
    empty.style.display = "flex";
    return;
  }
  empty.style.display = "none";
  return fetchInto("search", { q: query }, "search-grid", "search-count", reset, more);
}

function setupSearch() {
  const input = document.getElementById("global-search");
  input.addEventListener("input", () => {
    clearTimeout(state.catalog.search.timer);
    state.catalog.search.timer = setTimeout(() => runGlobalSearch(true), 250);
  });
  document.getElementById("search-grid-more").addEventListener("click", () => runGlobalSearch(false));
}

/* ---------------- details ---------------- */

function mapLink(l) {
  return {
    quality: [l.resolution ? l.resolution + "p" : l.qualityText, l.sourceTag, l.codec, l.audio].filter(Boolean).join(" · "),
    format: l.container ? String(l.container).toUpperCase() : "",
    size: fmtSize(l.sizeBytes),
    language: SUB_TEXT[l.subtitle] || "",
    status: l.status,
    url: l.url,
    releaseName: l.releaseName,
    group: l.releaseGroup,
    host: l.host,
    ambiguous: l.ambiguousMatch,
    lastChecked: l.lastChecked
  };
}

function createLinkRow(link) {
  const url = safeURL(link.url);
  let action;
  if (link.status === "unavailable") {
    action = `<span class="download-action disabled">در دسترس نیست</span>`;
  } else if (!url) {
    action = `<span class="download-action disabled">لینک نمایش داده نمی‌شود</span>`;
  } else {
    const cls = link.status === "working" ? "available" : "unverified";
    action = `<a class="download-action ${cls}" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">دریافت لینک ↗</a>`;
  }
  const details = [link.format, link.size, link.language, link.group].filter(Boolean).join(" · ") || "مشخصات نامشخص";
  return `
    <div class="download-row">
      <div class="download-info">
        <strong>${escapeHTML(link.quality || "کیفیت نامشخص")}</strong>
        <small>${escapeHTML(details)}</small>
        <span class="link-status ${escapeHTML(link.status)}">${escapeHTML(STATUS_TEXT[link.status] || link.status)}${link.lastChecked ? " · " + escapeHTML(link.lastChecked.slice(0, 10)) : ""}</span>
        ${link.ambiguous ? `<span class="link-status">تطبیق نامطمئن</span>` : ""}
        ${link.releaseName ? `<span class="release-name">${escapeHTML(link.releaseName)}</span>` : ""}
      </div>
      ${action}
    </div>`;
}

function createSourceHTML(source, index) {
  const links = source.links;
  return `
    <details class="source-accordion" ${index === 0 ? "open" : ""}>
      <summary>
        <span class="source-name">
          <strong>${escapeHTML(source.name)}</strong>
          <small>${escapeHTML(source.description)}</small>
        </span>
        <span class="source-count">${links.length} نسخه</span>
      </summary>
      <div class="source-links">
        ${links.map(createLinkRow).join("") || `<div class="no-sources">هنوز نسخه‌ای برای این بخش ثبت نشده است.</div>`}
      </div>
    </details>`;
}

/** movie releases grouped by the website/host that serves them */
function groupByHost(releases) {
  const groups = new Map();
  releases.map(mapLink).forEach(link => {
    const key = link.host || "نامشخص";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(link);
  });
  return [...groups].map(([host, links]) => ({ name: host, description: "میزبان دانلود", links }));
}

function createSeasonsHTML(seasons) {
  if (!seasons.length) {
    return `<div class="no-sources">برای این سریال هنوز فصل یا قسمتی ثبت نشده است.</div>`;
  }
  const tabs = seasons.map((s, i) =>
    `<button type="button" class="season-tab ${i === 0 ? "active" : ""}" data-season="${i}">${escapeHTML(s.title || "فصل " + s.number)}</button>`).join("");
  const panels = seasons.map((s, i) => `
    <div class="season-panel" data-season-panel="${i}" ${i === 0 ? "" : "hidden"}>
      ${s.episodes.map((e, j) => createSourceHTML({
        name: e.title || ("قسمت " + e.number),
        description: e.duration ? e.duration : "قسمت",
        links: e.links.map(mapLink)
      }, -1)).join("") || `<div class="no-sources">قسمتی برای این فصل ثبت نشده است.</div>`}
    </div>`).join("");
  return `<div class="season-tabs" role="tablist">${tabs}</div>${panels}`;
}

function createDetailsHTML(t) {
  const isMovie = t.kind === "movie";
  const item = toCard(t);
  const seasons = t.seasons || [];
  const episodeCount = seasons.reduce((n, s) => n + s.episodes.length, 0);

  const genresHTML = (t.genreList || []).map(g => `<span class="detail-genre">${escapeHTML(g.title)}</span>`).join("");
  const seasonsText = seasons.length || "نامشخص";
  const episodesText = episodeCount || "نامشخص";
  const metaHTML = `
    <span class="detail-meta-item"><strong>سال:</strong>${escapeHTML(t.year || "نامشخص")}</span>
    <span class="detail-meta-item"><strong>کشور:</strong>${escapeHTML(t.countries || "نامشخص")}</span>
    ${isMovie
      ? `<span class="detail-meta-item"><strong>مدت:</strong>${escapeHTML(t.duration || "نامشخص")}</span>`
      : `<span class="detail-meta-item"><strong>فصل:</strong>${escapeHTML(seasonsText)}</span>
         <span class="detail-meta-item"><strong>قسمت:</strong>${escapeHTML(episodesText)}</span>`}`;

  const url = safeURL(t.image);
  const poster = url
    ? `<img data-fallback="1" src="${escapeHTML(url)}" alt="پوستر ${escapeHTML(item.title)}" referrerpolicy="no-referrer"><div class="detail-poster-fallback" hidden>${escapeHTML(t.title)}</div>`
    : `<div class="detail-poster-fallback">${escapeHTML(t.title)}</div>`;

  const downloads = isMovie
    ? (t.releases.length ? groupByHost(t.releases).map(createSourceHTML).join("")
                         : `<div class="no-sources">هنوز لینکی برای این فیلم ثبت نشده است.</div>`)
    : createSeasonsHTML(seasons);

  const dups = (t.possibleDuplicates || []).length
    ? `<p class="possible-dups">عنوان مشابه (ادغام نشده): ${t.possibleDuplicates.map(d => escapeHTML(d.title) + (d.year ? ` (${d.year})` : "")).join("، ")}</p>` : "";
  const hidden = t.hiddenInvalidLinks
    ? `<p class="back-note">${t.hiddenInvalidLinks} لینک نامعتبر (بدون http/https) نمایش داده نشد.</p>` : "";

  return `
    <div class="detail-hero">
      <div class="detail-poster" style="--poster-gradient:${escapeHTML(item.gradient)}">${poster}</div>
      <div class="detail-info">
        <span class="detail-type">${isMovie ? "MOVIE" : "TV SERIES"}</span>
        <h1>${escapeHTML(item.title)}</h1>
        <div class="detail-original">${escapeHTML(t.title)}</div>
        <div class="detail-rating">★ ${escapeHTML(item.rating)} <small>امتیاز IMDb</small></div>
        <div class="detail-meta">${metaHTML}</div>
        <div class="detail-genres">${genresHTML}</div>
        <p class="detail-description">${escapeHTML(t.synopsis || "توضیحی برای این عنوان ثبت نشده است.")}</p>
        ${dups}
      </div>
    </div>

    <section class="detail-section">
      <div class="detail-section-heading">
        <div><h2>مشخصات ${isMovie ? "فیلم" : "سریال"}</h2><p>اطلاعات ثبت‌شده برای این عنوان</p></div>
        <span class="section-number">01</span>
      </div>
      <div class="detail-facts">
        <div class="fact-item"><span>نام اصلی</span><strong>${escapeHTML(t.title)}</strong></div>
        <div class="fact-item"><span>سال انتشار</span><strong>${escapeHTML(t.year || "نامشخص")}</strong></div>
        <div class="fact-item"><span>کارگردان</span><strong>${escapeHTML(t.director || "نامشخص")}</strong></div>
        <div class="fact-item"><span>کشور سازنده</span><strong>${escapeHTML(t.countries || "نامشخص")}</strong></div>
        <div class="fact-item"><span>بازیگران</span><strong>${escapeHTML(t.stars || "نامشخص")}</strong></div>
        ${isMovie
          ? `<div class="fact-item"><span>مدت زمان</span><strong>${escapeHTML(t.duration || "نامشخص")}</strong></div>`
          : `<div class="fact-item"><span>تعداد فصل‌ها</span><strong>${escapeHTML(seasonsText)}</strong></div>
             <div class="fact-item"><span>تعداد قسمت‌ها</span><strong>${escapeHTML(episodesText)}</strong></div>`}
      </div>
    </section>

    <section class="detail-section">
      <div class="detail-section-heading">
        <div>
          <h2>${isMovie ? "نسخه‌ها و لینک‌های دانلود" : "فصل‌ها و قسمت‌ها"}</h2>
          <p>${isMovie ? "نسخه‌های موجود به تفکیک میزبان" : "برای هر قسمت، نسخه‌های موجود را ببین"}</p>
        </div>
        <span class="section-number">02</span>
      </div>
      <p class="download-intro">
        وضعیت هر لینک جداگانه نشان داده می‌شود: «کار می‌کند» و «در دسترس نیست» فقط پس از بررسی ثبت می‌شوند؛
        تا آن موقع لینک «بررسی‌نشده» است.
      </p>
      ${downloads}
      ${hidden}
    </section>`;
}

function wireSeasonTabs(root) {
  root.querySelectorAll(".season-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      root.querySelectorAll(".season-tab").forEach(t => t.classList.toggle("active", t === tab));
      root.querySelectorAll(".season-panel").forEach(p => { p.hidden = p.dataset.seasonPanel !== tab.dataset.season; });
    });
  });
}

async function openDetails(id, push) {
  const content = document.getElementById("detail-content");
  if (state.currentPage !== "detail") state.previousPage = state.currentPage;
  content.innerHTML = `<div class="empty-state"><strong>در حال بارگذاری…</strong></div>`;
  navigate("detail");
  try {
    const t = (await Api.title(id)).title;
    state.selectedTitle = { id: t.id, title: t.titleFa || t.title };
    content.innerHTML = createDetailsHTML(t);
    wireSeasonTabs(content);
    document.title = `${state.selectedTitle.title} | Flicksy`;
    if (push && location.hash !== `#title-${id}`) history.pushState(null, "", `#title-${id}`);
  } catch (e) {
    content.innerHTML = `<div class="empty-state"><strong>${e.status === 404 ? "عنوان پیدا نشد" : "خطا در دریافت اطلاعات"}</strong><p>${escapeHTML(e.message)}</p></div>`;
  }
}

/* ---------------- home: banner (poster background, swipe) ---------------- */

const banner = { items: [], index: 0, timer: null, dir: 1 };

function thumbHTML(item, cls) {
  const url = safeURL(item.image);
  return `<span class="${cls}" style="--poster-gradient:${escapeHTML(item.gradient)}">${url
    ? `<img class="poster-image" data-fallback="1" src="${escapeHTML(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}</span>`;
}

function bannerRender() {
  const it = banner.items[banner.index];
  const url = safeURL(it.image);
  const tags = (it.genres || "").split("،").map(x => x.trim()).filter(Boolean).slice(0, 3);
  const meta = [it.year, getTypeLabel(it.type)].filter(Boolean).join(" • ");
  const main = document.getElementById("banner-main");
  main.style.setProperty("--poster-gradient", it.gradient);
  main.innerHTML = `
    <div class="banner-slide" data-dir="${banner.dir}">
      <div class="banner-bg">${url ? `<img data-fallback="1" src="${escapeHTML(url)}" alt="" decoding="async" referrerpolicy="no-referrer">` : ""}</div>
      <div class="banner-shade"></div>
      <span class="banner-label">تازه‌های برتر</span>
      <div class="banner-text">
        <div class="banner-tags">${tags.map(t => `<span>${escapeHTML(t)}</span>`).join("")}</div>
        <h2>${escapeHTML(it.title)}</h2>
        <div class="banner-orig">${escapeHTML(it.original)}</div>
        <div class="banner-meta">${escapeHTML(meta)}${it.rating !== "—" ? ` <b class="imdb-pill">IMDb ${escapeHTML(it.rating)}</b>` : ""}</div>
        ${it.synopsis ? `<p>${escapeHTML(it.synopsis)}</p>` : ""}
        <button class="primary-button" type="button" data-open="${it.id}">مشاهدهٔ نسخه‌ها ←</button>
      </div>
    </div>
    <div class="banner-dots" aria-hidden="true">${banner.items.map((_, i) => `<i class="${i === banner.index ? "on" : ""}"></i>`).join("")}</div>`;
  document.querySelectorAll("#banner-list .banner-item").forEach((el, i) => el.classList.toggle("active", i === banner.index));
}

function bannerGo(i) {
  const n = banner.items.length;
  const next = (i + n) % n;
  banner.dir = i >= banner.index ? 1 : -1;
  banner.index = next;
  bannerRender();
}

function bannerAuto(on) {
  clearInterval(banner.timer);
  if (on && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    banner.timer = setInterval(() => bannerGo(banner.index + 1), 7000);
  }
}

function setupBanner(items) {
  const section = document.getElementById("home-banner");
  if (items.length < 3) return;                          // too few titles: keep the banner hidden
  banner.items = items.slice(0, 6);
  document.getElementById("banner-list").innerHTML = banner.items.map((it, i) => `
    <button class="banner-item" type="button" data-i="${i}">
      ${thumbHTML(it, "banner-thumb")}
      <span class="banner-item-text"><b>${escapeHTML(it.title)}</b><small>${escapeHTML([it.year, getTypeLabel(it.type)].join(" • "))}</small></span>
    </button>`).join("");
  section.hidden = false;
  bannerRender();
  bannerAuto(true);

  // swipe / drag: left = next, right = previous (page is right-to-left)
  const main = document.getElementById("banner-main");
  let x0 = null, moved = false;
  main.addEventListener("pointerdown", e => { x0 = e.clientX; moved = false; });
  main.addEventListener("pointermove", e => { if (x0 !== null && Math.abs(e.clientX - x0) > 10) moved = true; });
  main.addEventListener("pointerup", e => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 45) { bannerGo(banner.index + (dx < 0 ? 1 : -1)); bannerAuto(true); }
  });
  main.addEventListener("pointercancel", () => { x0 = null; });
  main.addEventListener("keydown", e => {
    if (e.key === "ArrowLeft") { bannerGo(banner.index + 1); bannerAuto(true); }
    if (e.key === "ArrowRight") { bannerGo(banner.index - 1); bannerAuto(true); }
  });

  section.addEventListener("click", event => {
    if (moved) { moved = false; return; }                // a drag is not a click
    const open = event.target.closest("[data-open]");
    if (open) return openDetails(Number(open.dataset.open), true);
    const item = event.target.closest(".banner-item");
    if (item) { bannerGo(Number(item.dataset.i)); bannerAuto(true); }
  });
  section.addEventListener("mouseenter", () => bannerAuto(false));
  section.addEventListener("mouseleave", () => bannerAuto(true));
  section.addEventListener("focusin", () => bannerAuto(false));
  section.addEventListener("focusout", () => bannerAuto(true));
  document.addEventListener("visibilitychange", () => bannerAuto(!document.hidden));
}

/* ---------------- home: IMDb top row + genre shelves ---------------- */

function wireClicks(element) {
  const open = card => card && openDetails(Number(card.dataset.id), true);
  element.addEventListener("click", event => open(event.target.closest("[data-id]")));
  element.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      const card = event.target.closest("[data-id]");
      if (card) { event.preventDefault(); open(card); }
    }
  });
}

function setupTop(items) {
  if (items.length < 3) return;
  const row = document.getElementById("top-row");
  row.innerHTML = items.map((it, i) => `
    <article class="top-item" data-id="${it.id}" tabindex="0" role="button" aria-label="${escapeHTML(it.title)}">
      <span class="top-rank" aria-hidden="true">${i + 1}</span>
      <div class="poster top-poster" style="--poster-gradient:${escapeHTML(it.gradient)}">${posterHTML(it)}<span class="poster-year">${escapeHTML(it.year)}</span></div>
      <div class="top-info"><b>${escapeHTML(it.title)}</b><small>★ ${escapeHTML(it.rating)} · ${getTypeLabel(it.type)}</small></div>
    </article>`).join("");
  wireClicks(row);
  document.getElementById("top-section").hidden = false;
}

function setupShelves(shelves) {
  const host = document.getElementById("genre-shelves");
  host.innerHTML = shelves.filter(s => s.items.length >= 4).map((s, k) => `
    <section class="content-section shelf" data-shelf="${k}">
      <div class="section-heading">
        <div><span class="section-kicker">TOP RATED · GENRE</span><h2>برترین‌های ${escapeHTML(s.genre.title)}</h2><p>بهترین امتیازها در ژانر ${escapeHTML(s.genre.title)}</p></div>
        <button class="text-link" type="button" data-genre="${s.genre.id}">همهٔ فیلم‌های این ژانر <span>←</span></button>
      </div>
      <div class="shelf-row">${s.items.map(it => createMovieCard(toCard(it))).join("")}</div>
    </section>`).join("");
  wireClicks(host);
  host.addEventListener("click", event => {
    const b = event.target.closest("[data-genre]");
    if (!b) return;
    state.selectedGenre.movies = b.dataset.genre;
    renderAllGenres();
    loadCatalog("movies", true);
    navigate("movies");
  });
}

/* ---------------- menu drawer + detailed filters ---------------- */

function setDrawer(open) {
  const drawer = document.getElementById("drawer");
  drawer.hidden = !open;
  document.getElementById("menu-btn").setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("drawer-open", open);
  if (open) drawer.querySelector(".drawer-panel button, .drawer-panel select")?.focus();
}

const browse = { params: {} };

function fillFilterOptions() {
  const f = state.facets;
  const opt = (v, t) => `<option value="${v}">${escapeHTML(t)}</option>`;
  const genres = [...f.genres].filter(g => !EDITORIAL_TAGS.has(g.title)).sort((a, b) => a.title.localeCompare(b.title, "fa"));
  document.getElementById("f-genre").insertAdjacentHTML("beforeend", genres.map(g => opt(g.id, g.title)).join(""));
  document.getElementById("f-country").insertAdjacentHTML("beforeend", (f.countries || []).map(c => opt(c.id, `${c.title} (${c.count})`)).join(""));
  let years = "";
  for (let y = f.yearMax; y >= f.yearMin; y--) years += opt(y, y);
  document.getElementById("f-year").insertAdjacentHTML("beforeend", years);
}

function browseChips() {
  const label = (id, value) => {
    const el = document.getElementById(id);
    const o = [...el.options].find(x => x.value === String(value));
    return o ? o.textContent.replace(/\s*\(\d+\)$/, "") : value;
  };
  const p = browse.params, chips = [];
  if (p.kind) chips.push(label("f-kind", p.kind));
  if (p.genre) chips.push("ژانر " + label("f-genre", p.genre));
  if (p.country) chips.push("کشور " + label("f-country", p.country));
  if (p.minScore) chips.push("IMDb " + p.minScore + "+");
  if (p.year) chips.push("سال " + p.year);
  document.getElementById("browse-chips").innerHTML = chips.length
    ? chips.map(c => `<span class="filter-chip">${escapeHTML(c)}</span>`).join("") : '<span class="filter-chip">بدون فیلتر</span>';
}

function runBrowse(reset) {
  browseChips();
  return fetchInto("browse", browse.params, "browse-grid", "browse-count", reset, document.getElementById("browse-grid-more"));
}

function setupDrawer() {
  document.getElementById("menu-btn").addEventListener("click", () => setDrawer(true));
  document.querySelectorAll("[data-drawer-close]").forEach(el => el.addEventListener("click", () => setDrawer(false)));
  document.querySelectorAll(".drawer-nav [data-page]").forEach(el => el.addEventListener("click", () => setDrawer(false)));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !document.getElementById("drawer").hidden) setDrawer(false); });

  document.getElementById("filter-form").addEventListener("submit", event => {
    event.preventDefault();
    const v = id => document.getElementById(id).value;
    browse.params = { kind: v("f-kind"), genre: v("f-genre"), country: v("f-country"), minScore: v("f-score"), year: v("f-year") };
    Object.keys(browse.params).forEach(k => { if (!browse.params[k]) delete browse.params[k]; });
    setDrawer(false);
    runBrowse(true);
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    navigate("browse");
  });
  document.getElementById("filter-reset").addEventListener("click", () => document.getElementById("filter-form").reset());
  document.getElementById("browse-grid-more").addEventListener("click", () => runBrowse(false));
}

/* ---------------- start ---------------- */

async function initialize() {
  setupNavigation();
  ["movies-grid", "series-grid", "search-grid", "browse-grid"].forEach(wireGrid);
  wireClicks(document.getElementById("latest-movies-grid"));
  wireClicks(document.getElementById("latest-series-grid"));
  setupDrawer();
  setupCatalogFilters();
  setupSearch();
  document.getElementById("search-empty").style.display = "flex";

  try {
    const [facets, health] = await Promise.all([Api.facets(), Api.health()]);
    state.facets = facets;

    const fill = id => {
      const select = document.getElementById(id);
      for (let y = facets.yearMax; y >= facets.yearMin; y--) select.insertAdjacentHTML("beforeend", `<option value="${y}">${y}</option>`);
    };
    fill("movie-year");
    fill("series-year");

    fillFilterOptions();
    renderAllGenres();
  } catch (e) {
    showError("latest-movies-grid", e);
    return;
  }

  Api.featured(8).then(r => setupBanner(r.items.map(toCard))).catch(() => {});
  Api.top(10).then(r => setupTop(r.items.map(toCard))).catch(() => {});
  Api.shelves(4, 12).then(r => setupShelves(r.shelves)).catch(() => {});

  const [lm, ls] = await Promise.all([
    Api.titles({ kind: "movie", limit: 14 }).catch(e => (showError("latest-movies-grid", e), null)),
    Api.titles({ kind: "series", limit: 14 }).catch(e => (showError("latest-series-grid", e), null))
  ]);
  if (lm) renderGrid("latest-movies-grid", lm.items.map(toCard));
  if (ls) renderGrid("latest-series-grid", ls.items.map(toCard));

  loadCatalog("movies", true);
  loadCatalog("series", true);

  const m = location.hash.match(/^#title-(\d+)$/);
  if (m) openDetails(Number(m[1]), false);
}

document.addEventListener("DOMContentLoaded", initialize);
