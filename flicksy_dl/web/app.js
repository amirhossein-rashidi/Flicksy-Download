"use strict";

/*
 * Flicksy-Download — web UI (design from the "index" prototype, wired to the real local API).
 * Data access only through window.Api (api-client.js). The original mock-data prototype is kept in
 * fixtures/design-prototype/ for reference.
 */

const PAGE_SIZE = 24;
const pageNames = ["home", "movies", "series", "search", "detail"];

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
    search: { offset: 0, abort: null, timer: null }
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

const GENRE_LIMIT = 35;
const genreExpanded = {};

function renderGenreButtons(containerId, type) {
  const container = document.getElementById(containerId);
  if (!container || !state.facets) return;
  const kind = kindOfPage(type);
  const all = [...(state.facets.genresByKind[kind] || [])].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, "fa"));
  const selected = state.selectedGenre[type];
  const total = state.facets.totals[kind] || 0;
  const expanded = Boolean(genreExpanded[containerId]);

  // always keep the selected genre visible even if it is beyond the first 35
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

/* ---------------- home poster carousel ---------------- */

const hero = { items: [], index: 0, timer: null };

function heroSlideHTML(item, i) {
  const url = safeURL(item.image);
  const img = url
    ? `<img class="poster-image" data-fallback="1" src="${escapeHTML(url)}" alt="پوستر ${escapeHTML(item.title)}" ${i < 5 ? "" : 'loading="lazy"'} decoding="async" referrerpolicy="no-referrer">`
    : "";
  const imdb = item.rating !== "—" ? `<span>IMDb ${escapeHTML(item.rating)}</span>` : "";
  return `
    <article class="hero-slide" data-i="${i}" data-pos="9" style="--poster-gradient:${escapeHTML(item.gradient)}" role="button" tabindex="-1" aria-label="${escapeHTML(item.title)}">
      ${img}<div class="poster-image-fallback" ${url ? "hidden" : ""}>${escapeHTML(item.original)}</div>
      <div class="hero-slide-info">${imdb}<b>${escapeHTML(item.original)}</b></div>
    </article>`;
}

function heroRender() {
  const n = hero.items.length;
  document.querySelectorAll("#hero-track .hero-slide").forEach((el, i) => {
    let d = (i - hero.index + n) % n;
    if (d > n / 2) d -= n;
    el.dataset.pos = Math.abs(d) > 2 ? "9" : String(d);
    el.tabIndex = d === 0 ? 0 : -1;
  });
  document.querySelectorAll("#hero-dots i").forEach((dot, i) => dot.classList.toggle("on", i === hero.index));
}

function heroGo(i) {
  const n = hero.items.length;
  hero.index = (i + n) % n;
  heroRender();
}

function heroAuto(on) {
  clearInterval(hero.timer);
  if (on && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    hero.timer = setInterval(() => heroGo(hero.index + 1), 5000);
  }
}

function setupHero(items) {
  const section = document.getElementById("poster-hero");
  if (items.length < 5) return;                         // not enough posters: keep the carousel hidden
  hero.items = items;
  document.getElementById("hero-track").innerHTML = items.map(heroSlideHTML).join("");
  document.getElementById("hero-dots").innerHTML = items.map((_, i) => `<i data-d="${i}"></i>`).join("");
  section.hidden = false;
  heroRender();
  heroAuto(true);

  section.addEventListener("click", event => {
    const dot = event.target.closest("[data-d]");
    if (dot) return heroGo(Number(dot.dataset.d));
    const slide = event.target.closest(".hero-slide");
    if (!slide) return;
    const i = Number(slide.dataset.i);
    if (i === hero.index) openDetails(hero.items[i].id, true); else heroGo(i);
  });
  section.addEventListener("keydown", event => {
    if (event.key === "Enter" && event.target.closest(".hero-slide")) openDetails(hero.items[hero.index].id, true);
    if (event.key === "ArrowLeft") heroGo(hero.index - 1);
    if (event.key === "ArrowRight") heroGo(hero.index + 1);
  });
  document.getElementById("hero-prev").addEventListener("click", () => heroGo(hero.index - 1));
  document.getElementById("hero-next").addEventListener("click", () => heroGo(hero.index + 1));
  section.addEventListener("mouseenter", () => heroAuto(false));
  section.addEventListener("mouseleave", () => heroAuto(true));
  section.addEventListener("focusin", () => heroAuto(false));
  section.addEventListener("focusout", () => heroAuto(true));
  let x0 = null;
  section.addEventListener("pointerdown", e => { x0 = e.clientX; });
  section.addEventListener("pointerup", e => {
    if (x0 !== null && Math.abs(e.clientX - x0) > 50) heroGo(hero.index + (e.clientX < x0 ? 1 : -1));
    x0 = null;
  });
  document.addEventListener("visibilitychange", () => heroAuto(!document.hidden));
}

/* ---------------- start ---------------- */

async function initialize() {
  setupNavigation();
  ["latest-movies-grid", "latest-series-grid", "movies-grid", "series-grid", "search-grid"].forEach(wireGrid);
  document.getElementById("latest-movies-grid-more").remove();
  document.getElementById("latest-series-grid-more").remove();
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

    renderAllGenres();
  } catch (e) {
    showError("latest-movies-grid", e);
    return;
  }

  Api.featured(12).then(r => setupHero(r.items.map(toCard))).catch(() => {});

  const [lm, ls] = await Promise.all([
    Api.titles({ kind: "movie", limit: 4 }).catch(e => (showError("latest-movies-grid", e), null)),
    Api.titles({ kind: "series", limit: 4 }).catch(e => (showError("latest-series-grid", e), null))
  ]);
  if (lm) renderGrid("latest-movies-grid", lm.items.map(toCard));
  if (ls) renderGrid("latest-series-grid", ls.items.map(toCard));

  loadCatalog("movies", true);
  loadCatalog("series", true);

  const m = location.hash.match(/^#title-(\d+)$/);
  if (m) openDetails(Number(m[1]), false);
}

document.addEventListener("DOMContentLoaded", initialize);
