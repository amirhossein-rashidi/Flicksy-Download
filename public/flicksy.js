"use strict";

/*
 * Flicksy-Download — web UI, same design as the Flicksy Mini App (bottom navigation, cards, hero).
 * Data only through window.Api (api-client.js). Tabs: home, browse, schedule, search.
 * Deep links kept: #title-<id> opens a title page.
 */

const PAGE_SIZE = 24;
const app = document.getElementById("app");
const nav = document.getElementById("nav");

const STATUS_TEXT = { working: "کار می\u200cکند", unavailable: "در دسترس نیست", unverified: "بررسی\u200cنشده" };
const SUB_TEXT = { "hardsub-fa": "هاردساب فارسی", "softsub-fa": "زیرنویس فارسی", "dubbed-fa": "دوبله فارسی" };
// site tags that are not real genres
const EDITORIAL_TAGS = new Set(["پیشنهاد سردبیر", "تازه های باحال", "محبوب ترین ها", "بیشترین دانلود ها", "سریال های بروز شده", "سریال های برتر", "چینی ژاپنی", "کره ای"]);

let facets = null;
let token = 0;           // increases on every navigation; late answers of old pages are ignored
let timer = 0;           // hero auto-scroll
let lastTab = "home";
let credit = true;

/* ---------------- helpers ---------------- */

const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const fa = v => String(v).replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);
const enc = encodeURIComponent;
const typ = t => (t === "movie" ? "فیلم" : "سریال");

function safeURL(value) {
  if (!value) return "";
  try {
    const u = new URL(value, window.location.href);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
  } catch { return ""; }
}

function fmtSize(bytes) {
  if (!bytes) return "";
  return "\u200e" + (bytes >= 1073741824 ? (bytes / 1073741824).toFixed(2) + " GB" : (bytes / 1048576).toFixed(0) + " MB");
}

function gradientFor(id, w) {
  const h = ((Number(id) + (w || 0)) * 47) % 360;
  return `linear-gradient(160deg,hsl(${h} 55% 38%),hsl(${(h + 50) % 360} 60% 14%))`;
}

/** API summary -> card model */
function toCard(t) {
  return {
    id: t.id, type: t.kind, title: t.titleFa || t.title, original: t.title,
    year: t.year || "", rating: t.imdbScore > 0 ? Number(t.imdbScore).toFixed(1) : "",
    image: t.image, synopsis: t.synopsis || ""
  };
}

// images that fail to load fall back to the gradient + title (no inline handlers: CSP)
document.addEventListener("error", e => {
  const img = e.target;
  if (img && img.tagName === "IMG" && img.dataset.fb) {
    img.style.display = "none";
    const next = img.nextElementSibling;
    if (next && next.classList.contains("fb")) next.hidden = false;
  }
}, true);

function posterInner(c) {
  const url = safeURL(c.image);
  return (url ? `<img data-fb="1" src="${esc(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : "") +
    `<div class="fb" ${url ? "hidden" : ""}>${esc(c.original)}</div>`;
}

function tile(c) {
  return `<a class="card" href="#title-${c.id}"><div class="p" style="background:${gradientFor(c.id)}">` +
    (c.rating ? `<span class="rt">★ ${fa(c.rating)}</span>` : "") + posterInner(c) +
    `</div><div class="n">${esc(c.title)}</div><div class="y">${typ(c.type)}${c.year ? "، " + fa(c.year) : ""}</div></a>`;
}
const row = l => `<div class="row">${l.map(tile).join("")}</div>`;
const grid = l => `<div class="grid">${l.map(tile).join("")}</div>`;
const sec = (t, body, href) => `<section class="sec"><div class="sec-h"><h2>${esc(t)}</h2>${href ? `<a class="more" href="${href}">همه ‹</a>` : ""}</div>${body}</section>`;
const chip = (t, href, on, extra) => `<a class="chip${on ? " on" : ""}" href="${href}">${esc(t)}${extra ? `<small>${esc(extra)}</small>` : ""}</a>`;
const backBar = t => `<div class="back"><button class="iconbtn" data-act="back" aria-label="بازگشت">›</button>${t ? `<h1>${esc(t)}</h1>` : ""}</div>`;
const empty = (m, l, h) => `<div class="empty"><p>${esc(m)}</p>${l ? `<a class="btn" href="${h}">${esc(l)}</a>` : ""}</div>`;
const skel = n => `<div class="grid">${Array.from({ length: n || 6 }, () => `<div><div class="p sk" style="height:150px"></div><div class="sk" style="height:11px;margin-top:9px;width:80%"></div></div>`).join("")}</div>`;
const fail = () => `<div class="empty"><p>ارتباط برقرار نشد.</p><button class="btn" data-act="retry">تلاش دوباره</button></div>`;

function creditHTML() {
  return `<div class="credit"><b>TMDB</b><span>این محصول از API سایت TMDB استفاده می\u200cکند ولی توسط TMDB تأیید یا گواهی نشده است.</span>` +
    `<span>بخش «تازه\u200cها و ترندها» فقط عنوان\u200cهایی را نشان می\u200cدهد که در آرشیو ما فایل دارند. برای فهرست تماشا و پیگیری سریال\u200cها به <a href="https://t.me/flicksyrobot" target="_blank" rel="noopener">Flicksy</a> سر بزن.</span></div>`;
}

function put(html, tk, withCredit) {
  if (tk !== token) return;
  app.innerHTML = `<div class="view">${html}${withCredit === false ? "" : creditHTML()}</div>`;
}

/* ---------------- routing ---------------- */

function parseHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ""));
  let m = h.match(/^title-(\d+)$/);
  if (m) return { r: "title", id: Number(m[1]) };
  if (h.startsWith("list?")) return { r: "list", p: new URLSearchParams(h.slice(5)) };
  return { r: ["browse", "schedule", "search"].includes(h) ? h : "home" };
}

function route() {
  const R = parseHash(), tk = ++token;
  clearInterval(timer);
  if (["home", "browse", "schedule", "search"].includes(R.r)) lastTab = R.r;
  Array.from(nav.children).forEach(a => a.classList.toggle("on", a.dataset.tab === lastTab));
  document.title = "Flicksy | آرشیو فیلم و سریال";
  ({ home: vHome, browse: vBrowse, schedule: vSchedule, search: vSearch, list: vList, title: vTitle }[R.r])(R, tk);
  window.scrollTo(0, 0);
}

/* ---------------- home ---------------- */

function heroHTML(slides) {
  return `<div class="hero" id="hero">${slides.map(s => `
    <a class="slide" href="#title-${s.id}" style="background:${gradientFor(s.id, 7)}">
      ${s.bg ? `<img data-fb="1" src="${esc(s.bg)}" alt="" decoding="async" referrerpolicy="no-referrer">` : ""}
      <div class="sl"><h2>${esc(s.title)}</h2><p>${esc(s.meta)}</p></div></a>`).join("")}</div>
    <div class="dots" id="dots">${slides.map(() => "<i></i>").join("")}</div>`;
}

function initHero() {
  const h = document.getElementById("hero"), ds = document.querySelectorAll("#dots i"), n = ds.length;
  if (!h || !n) return;
  const idx = () => Math.min(n - 1, Math.round(Math.abs(h.scrollLeft) / (h.firstElementChild.offsetWidth + 10)));
  const mark = () => { const k = idx(); ds.forEach((d, i) => d.classList.toggle("on", i === k)); };
  h.addEventListener("scroll", mark, { passive: true });
  mark();
  if (matchMedia("(prefers-reduced-motion:reduce)").matches) return;
  timer = setInterval(() => h.children[(idx() + 1) % n].scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" }), 6000);
}

async function vHome(R, tk) {
  put(`<div class="topbar"><div class="logo"><span>flicksy</span></div><a class="iconbtn" href="https://t.me/flicksyrobot" target="_blank" rel="noopener" aria-label="Flicksy">↗</a></div>
    <a class="search" href="#search">🔎 جستجو در آرشیو فیلم و سریال...</a>
    <div class="sk" style="height:210px;border-radius:22px"></div>${skel(3)}`, tk, false);
  try {
    const [tm, lm, ls, top, shelves] = await Promise.all([
      Api.tmdb(),
      Api.titles({ kind: "movie", limit: 14 }),
      Api.titles({ kind: "series", limit: 14 }),
      Api.top(10).catch(() => ({ items: [] })),
      Api.shelves(4, 12).catch(() => ({ shelves: [] }))
    ]);
    if (tk !== token) return;

    // hero: TMDB trending with backdrops, otherwise the editorial picks
    let slides = [];
    if (tm && tm.banner && tm.banner.length) {
      const cards = await Api.resolve(tm.banner);
      const by = new Map(cards.map(c => [c.id, c]));
      slides = tm.banner.filter(b => by.has(b.id)).map(b => {
        const c = toCard(by.get(b.id));
        return { id: c.id, title: c.title, bg: b.backdrop.replace("/w1280/", "/w780/"), meta: [typ(c.type), c.year && fa(c.year), c.rating && "★ " + fa(c.rating)].filter(Boolean).join("، ") };
      });
    }
    if (slides.length < 3) {
      const f = await Api.featured(6).catch(() => ({ items: [] }));
      slides = f.items.map(toCard).map(c => ({ id: c.id, title: c.title, bg: c.image, meta: [typ(c.type), c.year && fa(c.year), c.rating && "★ " + fa(c.rating)].filter(Boolean).join("، ") }));
    }

    let html = `<div class="topbar"><div class="logo"><span>flicksy</span></div><a class="iconbtn" href="https://t.me/flicksyrobot" target="_blank" rel="noopener" aria-label="Flicksy">↗</a></div>
      <a class="search" href="#search">🔎 جستجو در آرشیو فیلم و سریال...</a>`;
    if (slides.length) html += heroHTML(slides);

    if (tm && tm.rows) {
      for (const r of tm.rows) {
        const cards = (await Api.resolve(r.items)).map(toCard);
        if (cards.length >= 4) html += sec(r.title, row(cards.slice(0, 14)), `#list?row=${enc(r.key)}&t=${enc(r.title)}`);
      }
    }
    if (tm && tm.networks && tm.networks.length) {
      html += sec("شبکه\u200cها و پلتفرم\u200cها", `<div class="row">${tm.networks.map(n => `<a class="net" style="background:${gradientFor(n.id)}" href="#list?net=${n.id}&t=${enc(n.name)}">${esc(n.name)}</a>`).join("")}</div>`);
    }
    html += sec("تازه\u200cهای فیلم", row(lm.items.map(toCard)), `#list?kind=movie&t=${enc("همه فیلم\u200cها")}`);
    html += sec("تازه\u200cهای سریال", row(ls.items.map(toCard)), `#list?kind=series&t=${enc("همه سریال\u200cها")}`);
    if (top.items.length >= 3) html += sec("برترین\u200cها بر اساس IMDb", row(top.items.map(toCard)));
    for (const s of shelves.shelves) {
      if (s.items.length >= 4) html += sec(`برترین\u200cهای ${s.genre.title}`, row(s.items.map(toCard)), `#list?genre=${s.genre.id}&t=${enc(s.genre.title)}`);
    }
    put(html, tk);
    initHero();
  } catch (e) {
    console.error(e);
    put(backBar() + fail(), tk, false);
  }
}

/* ---------------- browse (categories + detailed filters) ---------------- */

async function vBrowse(R, tk) {
  put(`<div class="title">دسته\u200cبندی</div>${skel(3)}`, tk, false);
  try {
    if (!facets) facets = await Api.facets();
    const tm = await Api.tmdb();
    if (tk !== token) return;
    const real = g => !EDITORIAL_TAGS.has(g.title);
    const gk = kind => [...(facets.genresByKind[kind] || [])].filter(real).sort((a, b) => b.count - a.count).slice(0, 18);
    const chipsOf = (list, kind) => `<div class="chips">${list.map(g => chip(g.title, `#list?kind=${kind}&genre=${g.id}&t=${enc(g.title)}`, false, fa(g.count))).join("")}</div>`;
    const countries = [...(facets.countries || [])].sort((a, b) => b.count - a.count).slice(0, 24);
    const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
    const allGenres = [...facets.genres].filter(real).sort((a, b) => a.title.localeCompare(b.title, "fa"));
    let years = "";
    for (let y = facets.yearMax; y >= facets.yearMin; y--) years += opt(y, fa(y));

    put(`<div class="title">دسته\u200cبندی</div>
      ${sec("فیلتر دقیق", `<form class="fform" id="fform">
        <label>نوع<select id="f-kind"><option value="">فیلم و سریال</option><option value="movie">فقط فیلم</option><option value="series">فقط سریال</option></select></label>
        <label>ژانر<select id="f-genre"><option value="">همه ژانرها</option>${allGenres.map(g => opt(g.id, g.title)).join("")}</select></label>
        <label>کشور سازنده<select id="f-country"><option value="">همه کشورها</option>${countries.map(c => opt(c.id, c.title)).join("")}</select></label>
        <label>حداقل امتیاز IMDb<select id="f-score"><option value="">بدون محدودیت</option>${[5, 6, 7, 8, 9].map(n => opt(n, fa(n) + " به بالا")).join("")}</select></label>
        <label>سال ساخت<select id="f-year"><option value="">همه سال\u200cها</option>${years}</select></label>
        <button class="btn" type="submit">نمایش نتایج</button></form>`)}
      ${sec("ژانر فیلم\u200cها", chipsOf(gk("movie"), "movie"))}
      ${sec("ژانر سریال\u200cها", chipsOf(gk("series"), "series"))}
      ${sec("کشورها", `<div class="chips">${countries.map(c => chip(c.title, `#list?country=${c.id}&t=${enc(c.title)}`, false, fa(c.count))).join("")}</div>`)}
      ${tm && tm.networks && tm.networks.length ? sec("شبکه\u200cها و پلتفرم\u200cها", `<div class="chips">${tm.networks.map(n => chip(n.name, `#list?net=${n.id}&t=${enc(n.name)}`)).join("")}</div>`) : ""}`, tk);

    document.getElementById("fform").addEventListener("submit", ev => {
      ev.preventDefault();
      const p = new URLSearchParams();
      [["kind", "f-kind"], ["genre", "f-genre"], ["country", "f-country"], ["minScore", "f-score"], ["year", "f-year"]].forEach(([k, id]) => {
        const v = document.getElementById(id).value; if (v) p.set(k, v);
      });
      p.set("t", "نتایج فیلتر");
      location.hash = "list?" + p.toString();
    });
  } catch (e) { console.error(e); put(backBar() + fail(), tk, false); }
}

/* ---------------- list (filters, TMDB rows, networks) ---------------- */

const paged = { offset: 0, params: null, abort: null, tk: 0 };

async function loadMore(reset) {
  const g = document.getElementById("lg"), m = document.getElementById("lm");
  if (!g) return;
  if (reset) { paged.offset = 0; g.innerHTML = skel(6); m.innerHTML = ""; }
  if (paged.abort) paged.abort.abort();
  paged.abort = new AbortController();
  const tk = paged.tk;
  try {
    const r = await Api.titles({ ...paged.params, limit: PAGE_SIZE, offset: paged.offset }, paged.abort.signal);
    if (tk !== token) return;
    if (reset) g.innerHTML = "<div class='grid' id='lgi'></div>";
    const inner = document.getElementById("lgi");
    if (reset && !r.items.length) { g.innerHTML = empty("موردی پیدا نشد."); return; }
    inner.insertAdjacentHTML("beforeend", r.items.map(toCard).map(tile).join(""));
    paged.offset += r.items.length;
    m.innerHTML = r.hasMore ? `<button class="btn ghost" data-act="more">نمایش بیشتر</button>` : "";
  } catch (e) {
    if (e.name !== "AbortError" && tk === token) g.innerHTML = fail();
  }
}

async function vList(R, tk) {
  const p = R.p, title = p.get("t") || "نتایج";
  document.title = `${title} | Flicksy`;
  put(backBar(title) + `<div id="lg">${skel(6)}</div><div id="lm"></div>`, tk, false);
  try {
    if (p.get("row") || p.get("net")) {                      // lists that come from TMDB (already matched, no paging)
      const tm = await Api.tmdb();
      if (tk !== token) return;
      const src = p.get("net") ? (tm && tm.networks || []).find(n => String(n.id) === p.get("net")) : (tm && tm.rows || []).find(r => r.key === p.get("row"));
      const cards = src ? (await Api.resolve(src.items)).map(toCard) : [];
      put(backBar(title) + (cards.length ? grid(cards) : empty("موردی پیدا نشد.")), tk, false);
      return;
    }
    paged.params = {};
    ["kind", "genre", "country", "minScore", "year", "q"].forEach(k => { if (p.get(k)) paged.params[k] = p.get(k); });
    paged.tk = tk;
    await loadMore(true);
  } catch (e) { console.error(e); put(backBar() + fail(), tk, false); }
}

/* ---------------- search ---------------- */

function vSearch(R, tk) {
  const hint = empty("نام فارسی یا انگلیسی فیلم یا سریال را بنویس.");
  put(`<div class="title">جستجو</div><input class="sin" id="q" type="search" placeholder="مثلاً Interstellar یا میان ستاره\u200cای" autocomplete="off" aria-label="جستجو"><div id="lg">${hint}</div><div id="lm"></div>`, tk, false);
  const q = document.getElementById("q");
  let t = 0;
  q.focus();
  q.addEventListener("input", () => {
    clearTimeout(t);
    const v = q.value.trim();
    if (!v) { if (paged.abort) paged.abort.abort(); document.getElementById("lg").innerHTML = hint; document.getElementById("lm").innerHTML = ""; return; }
    t = setTimeout(() => { paged.params = { q: v }; paged.tk = tk; loadMore(true); }, 250);
  });
}

/* ---------------- schedule (TMDB, only series we have) ---------------- */

let schedDay = 0;

async function vSchedule(R, tk) {
  put(`<div class="title">جدول پخش</div>${skel(3)}`, tk, false);
  const tm = await Api.tmdb();
  if (tk !== token) return;
  const days = tm && tm.schedule ? tm.schedule.filter(d => d.items.length) : [];
  if (!days.length) { put(`<div class="title">جدول پخش</div>` + empty("جدول پخش هنوز آماده نیست.", "برگشت به خانه", "#home"), tk); return; }
  if (schedDay >= days.length) schedDay = 0;
  const label = d => {
    const dt = new Date(d.date + "T12:00:00Z");
    return `${dt.toLocaleDateString("fa-IR", { weekday: "long", timeZone: "UTC" })}<small>${dt.toLocaleDateString("fa-IR", { month: "long", day: "numeric", timeZone: "UTC" })}</small>`;
  };
  const draw = async () => {
    document.getElementById("days").innerHTML = days.map((d, i) => `<button class="chip${i === schedDay ? " on" : ""}" data-act="day" data-d="${i}">${label(d)}</button>`).join("");
    const cards = (await Api.resolve(days[schedDay].items)).map(toCard);
    if (tk !== token) return;
    document.getElementById("sr").innerHTML = cards.length ? cards.map(c => `
      <a class="sch" href="#title-${c.id}"><div class="p" style="background:${gradientFor(c.id)}">${posterInner(c)}</div>
        <div class="t"><b>${esc(c.title)}</b><small dir="ltr" style="text-align:right">${esc(c.original)}</small><small>${c.rating ? "★ " + fa(c.rating) + "، " : ""}${c.year ? fa(c.year) : ""}</small></div>
        <span class="tag">قسمت جدید</span></a>`).join("") : empty("در این روز سریالی از آرشیو ما پخش نمی\u200cشود.");
  };
  put(`<div class="title">جدول پخش</div><p class="note" style="margin:-6px 0 12px">قسمت\u200cهای جدیدِ سریال\u200cهایی که در آرشیو ما فایل دارند.</p><div class="days" id="days"></div><div id="sr"></div>`, tk);
  window.__draw = () => { draw(); };
  draw();
}

/* ---------------- title page ---------------- */

function mapLink(l) {
  return {
    quality: [l.resolution ? l.resolution + "p" : l.qualityText, l.sourceTag, l.codec, l.audio].filter(Boolean).join(" · "),
    format: l.container ? String(l.container).toUpperCase() : "", size: fmtSize(l.sizeBytes), language: SUB_TEXT[l.subtitle] || "",
    status: l.status, url: l.url, releaseName: l.releaseName, group: l.releaseGroup, host: l.host, ambiguous: l.ambiguousMatch, lastChecked: l.lastChecked
  };
}

function dlRow(link) {
  const url = safeURL(link.url);
  let action;
  if (link.status === "unavailable") action = `<span class="off">در دسترس نیست</span>`;
  else if (!url) action = `<span class="off">لینک نمایش داده نمی\u200cشود</span>`;
  else action = `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">دریافت ↗</a>`;
  const details = [link.format, link.size, link.language, link.group].filter(Boolean).join(" · ") || "مشخصات نامشخص";
  return `<div class="dl"><div class="i"><b>${esc(link.quality || "کیفیت نامشخص")}</b><small>${esc(details)}</small>
    <small><span class="st ${esc(link.status)}">${esc(STATUS_TEXT[link.status] || link.status)}${link.lastChecked ? " · " + esc(link.lastChecked.slice(0, 10)) : ""}</span>${link.ambiguous ? " · تطبیق نامطمئن" : ""}</small>
    ${link.releaseName ? `<small class="rn">${esc(link.releaseName)}</small>` : ""}</div>${action}</div>`;
}

const accordion = (name, desc, links, open) => `<details class="acc" ${open ? "open" : ""}><summary>${esc(name)}<small>${esc(desc)}</small></summary><div class="acc-b">${links.map(dlRow).join("") || `<div class="note">هنوز نسخه\u200cای ثبت نشده است.</div>`}</div></details>`;

function groupByHost(releases) {
  const groups = new Map();
  releases.map(mapLink).forEach(l => { const k = l.host || "نامشخص"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); });
  return [...groups];
}

let seasonsData = [], season = 0;

function episodesHTML() {
  const s = seasonsData[season];
  return s.episodes.map(e => accordion(e.title || "قسمت " + e.number, e.duration || "", e.links.map(mapLink), false)).join("") || `<div class="note">قسمتی برای این فصل ثبت نشده است.</div>`;
}

function titleHTML(t) {
  const isMovie = t.kind === "movie", c = toCard(t);
  seasonsData = t.seasons || []; season = 0;
  const epCount = seasonsData.reduce((n, s) => n + s.episodes.length, 0);
  const genres = (t.genreList || []).filter(g => !EDITORIAL_TAGS.has(g.title));
  const url = safeURL(t.image);
  const facts = [["نام اصلی", t.title], ["کارگردان", t.director], ["بازیگران", t.stars], ["کشور سازنده", t.countries]].filter(f => f[1]);
  let downloads;
  if (isMovie) {
    downloads = t.releases.length ? groupByHost(t.releases).map(([h, l], i) => accordion(h, l.length + " نسخه", l, i === 0)).join("") : `<div class="note">هنوز لینکی برای این فیلم ثبت نشده است.</div>`;
  } else if (!seasonsData.length) {
    downloads = `<div class="note">برای این سریال هنوز فصل یا قسمتی ثبت نشده است.</div>`;
  } else {
    downloads = `<div class="chips sorts" id="seasons">${seasonsData.map((s, i) => `<button class="chip${i === 0 ? " on" : ""}" data-act="season" data-n="${i}">${esc(s.title || "فصل " + fa(s.number))}</button>`).join("")}</div><div id="eps">${episodesHTML()}</div>`;
  }
  const dups = (t.possibleDuplicates || []).length ? `<p class="note">عنوان مشابه (ادغام نشده): ${t.possibleDuplicates.map(d => esc(d.title) + (d.year ? ` (${fa(d.year)})` : "")).join("، ")}</p>` : "";
  const hidden = t.hiddenInvalidLinks ? `<p class="note">${fa(t.hiddenInvalidLinks)} لینک نامعتبر (بدون http/https) نمایش داده نشد.</p>` : "";
  return backBar() +
    `<div class="bd" style="background:${gradientFor(c.id, 3)}">${url ? `<img data-fb="1" src="${esc(url)}" alt="" referrerpolicy="no-referrer">` : ""}</div>
    <div class="head"><div class="pst p" style="background:${gradientFor(c.id)}">${posterInner(c)}</div>
      <div class="hi"><h1>${esc(c.title)}</h1><div class="orig">${esc(t.title)}</div>
      <div class="meta">${c.rating ? `<span>★ ${fa(c.rating)}</span>` : ""}${t.year ? `<span>${fa(t.year)}</span>` : ""}<span>${isMovie ? (t.duration ? fa(t.duration) + " دقیقه" : "فیلم") : (seasonsData.length ? fa(seasonsData.length) + " فصل، " + fa(epCount) + " قسمت" : "سریال")}</span>${t.countries ? `<span>${esc(t.countries)}</span>` : ""}</div></div></div>
    ${genres.length ? `<div class="chips g">${genres.map(g => chip(g.title, `#list?kind=${t.kind}&genre=${g.id}&t=${enc(g.title)}`)).join("")}</div>` : ""}
    <p class="ov" id="ov">${esc(t.synopsis || "توضیحی برای این عنوان ثبت نشده است.")}</p>
    <button class="more" data-act="ov">ادامهٔ خلاصه ‹</button>
    ${sec(isMovie ? "نسخه\u200cها و لینک\u200cهای دانلود" : "فصل\u200cها و دانلود", `<p class="note" style="margin:-4px 0 6px">وضعیت هر لینک جداگانه نشان داده می\u200cشود؛ «کار می\u200cکند» و «در دسترس نیست» فقط پس از بررسی ثبت می\u200cشوند و تا آن موقع لینک «بررسی\u200cنشده» است.</p>${downloads}${hidden}`)}
    ${facts.length ? sec("مشخصات", `<div class="facts">${facts.map(f => `<div class="fact"><span>${f[0]}</span><strong>${esc(f[1])}</strong></div>`).join("")}</div>${dups}`) : dups}`;
}

async function vTitle(R, tk) {
  put(backBar() + `<div class="sk" style="height:190px;border-radius:22px;margin-top:6px"></div>${skel(3)}`, tk, false);
  try {
    const t = (await Api.title(R.id)).title;
    if (tk !== token) return;
    document.title = `${t.titleFa || t.title} | Flicksy`;
    put(titleHTML(t), tk);
  } catch (e) {
    put(backBar() + empty(e.status === 404 ? "عنوان پیدا نشد." : "خطا در دریافت اطلاعات.", "برگشت به خانه", "#home"), tk, false);
  }
}

/* ---------------- events ---------------- */

document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const k = b.dataset.act;
  if (k === "back") { if (history.length > 1) history.back(); else location.hash = "#home"; }
  else if (k === "retry") route();
  else if (k === "more") loadMore(false);
  else if (k === "day") { schedDay = Number(b.dataset.d); window.__draw && window.__draw(); }
  else if (k === "season") {
    season = Number(b.dataset.n);
    document.querySelectorAll("#seasons .chip").forEach((c, i) => c.classList.toggle("on", i === season));
    document.getElementById("eps").innerHTML = episodesHTML();
  } else if (k === "ov") {
    const o = document.getElementById("ov");
    o.classList.toggle("open");
    b.textContent = o.classList.contains("open") ? "بستن ‹" : "ادامهٔ خلاصه ‹";
  }
});
window.addEventListener("hashchange", route);
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); location.hash = "#search"; }
});
document.addEventListener("DOMContentLoaded", route);
