"use strict";

/*
 * Flicksy-Download — web UI, same design as the Flicksy Mini App (floating bottom bar, header, hero, cards).
 * Data only through window.Api (api-client.js). Tabs: home, browse, schedule, search.
 * Deep links kept: #title-<id> opens a title page. Language: Persian / English (saved in the browser).
 * Titles are always shown in English; Persian names stay searchable.
 */

const PAGE_SIZE = 24;
const app = document.getElementById("app");
const nav = document.getElementById("nav");

/* ---------------- language ---------------- */

const STR = {
  fa: {
    sub: "آرشیو دانلود فیلم و سریال", home: "خانه", browse: "دسته\u200cبندی", schedule: "جدول پخش", search: "جستجو", top: "برترین\u200cها", topArchive: "پرطرفدارترین\u200cها در آرشیو ما",
    searchHint: "نام فارسی یا انگلیسی فیلم یا سریال را بنویس.", searchPh: "مثلاً Interstellar یا میان\u200cستاره\u200cای",
    latestMovies: "تازه\u200cهای فیلم", latestSeries: "تازه\u200cهای سریال", topImdb: "برترین\u200cها بر اساس IMDb",
    topGenre: g => `برترین\u200cهای ${g}`, networks: "شبکه\u200cها و پلتفرم\u200cها", allMovies: "همه فیلم\u200cها", allSeries: "همه سریال\u200cها",
    genresMovies: "ژانر فیلم\u200cها", genresSeries: "ژانر سریال\u200cها", countries: "کشورها", results: "نتایج",
    movie: "فیلم", series: "سریال", min: "دقیقه", seasons: "فصل", episodes: "قسمت",
    more: "نمایش بیشتر", retry: "تلاش دوباره", failed: "ارتباط برقرار نشد.", noResult: "موردی پیدا نشد.", notFound: "عنوان پیدا نشد.", loadError: "خطا در دریافت اطلاعات.",
    backHome: "برگشت به خانه", back: "بازگشت", share: "اشتراک\u200cگذاری", copied: "پیوند کپی شد",
    schedTitle: "جدول پخش", schedNote: "قسمت\u200cهای جدیدِ سریال\u200cهایی که در آرشیو ما فایل دارند.", schedNotReady: "جدول پخش هنوز آماده نیست.",
    schedEmpty: "در این روز سریالی از آرشیو ما پخش نمی\u200cشود.", newEp: "قسمت جدید",
    readMore: "ادامهٔ خلاصه", close: "بستن", noSynopsis: "توضیحی برای این عنوان ثبت نشده است.",
    specs: "مشخصات", director: "کارگردان", cast: "بازیگران", country: "کشور سازنده",
    dlMovie: "نسخه\u200cها و لینک\u200cهای دانلود", dlSeries: "فصل\u200cها و دانلود",
    statusNote: "وضعیت هر لینک جداگانه نشان داده می\u200cشود؛ «کار می\u200cکند» و «در دسترس نیست» فقط پس از بررسی ثبت می\u200cشوند و تا آن موقع لینک «بررسی\u200cنشده» است.",
    get: "دریافت", unavailable: "در دسترس نیست", noLink: "لینک نمایش داده نمی\u200cشود", unknownQ: "کیفیت نامشخص", unknownSpec: "مشخصات نامشخص",
    working: "کار می\u200cکند", unverified: "بررسی\u200cنشده", ambiguous: "تطبیق نامطمئن",
    versions: n => `${n} نسخه`, noVersion: "هنوز نسخه\u200cای ثبت نشده است.", noLinkMovie: "هنوز لینکی برای این فیلم ثبت نشده است.",
    noSeasons: "برای این سریال هنوز فصل یا قسمتی ثبت نشده است.", noEps: "قسمتی برای این فصل ثبت نشده است.", season: n => `فصل ${n}`, episode: n => `قسمت ${n}`,
    unknown: "نامشخص", dups: "عنوان مشابه (ادغام نشده)", hidden: n => `${n} لینک نامعتبر (بدون http/https) نمایش داده نشد.`,
    ftBot: "ربات تلگرام فلیکسی", ftAbout: "دربارهٔ سایت و منابع", ftCopy: "© Flicksy — همهٔ حقوق محفوظ است.",
    fMovies: "دانلود فیلم", fSeries: "دانلود سریال", fStreamM: "پخش آنلاین فیلم\u200cها", fStreamS: "پخش آنلاین سریال\u200cها",
    fTopM: "۲۵۰ فیلم برتر تاریخ", fTopS: "۲۵۰ سریال برتر تاریخ", fBox: "باکس آفیس", fFaq: "سوالات متداول", fTerms: "قوانین و مقررات", fDmca: "DMCA POLICY",
    gDl: "دانلود و پخش", gHelp: "پشتیبانی",
    soon: "به\u200cزودی", soonNote: "این صفحه به\u200cزودی تکمیل می\u200cشود.",
    sideSeries: "سریال\u200cها", sideMovies: "فیلم\u200cها", popular: "محبوب\u200cترین",
    creditTmdb: "این محصول از API سایت TMDB استفاده می\u200cکند ولی توسط TMDB تأیید یا گواهی نشده است.",
    creditNote: "بخش «تازه\u200cها و ترندها» فقط عنوان\u200cهایی را نشان می\u200cدهد که در آرشیو ما فایل دارند. برای فهرست تماشا و پیگیری سریال\u200cها به",
    creditEnd: "سر بزن.", hardsub: "هاردساب فارسی", softsub: "زیرنویس فارسی", dubbed: "دوبله فارسی", langBtn: "EN"
  },
  en: {
    sub: "Download archive", home: "Home", browse: "Browse", schedule: "Schedule", search: "Search", top: "Top", topArchive: "Most popular in our archive",
    searchHint: "Type an English or Persian title.", searchPh: "e.g. Interstellar or a Persian name",
    latestMovies: "New movies", latestSeries: "New series", topImdb: "Top rated on IMDb",
    topGenre: g => `Top ${g}`, networks: "Networks & platforms", allMovies: "All movies", allSeries: "All series",
    genresMovies: "Movie genres", genresSeries: "Series genres", countries: "Countries", results: "Results",
    movie: "Movie", series: "Series", min: "min", seasons: "seasons", episodes: "episodes",
    more: "Show more", retry: "Try again", failed: "Connection failed.", noResult: "Nothing found.", notFound: "Title not found.", loadError: "Could not load data.",
    backHome: "Back to home", back: "Back", share: "Share", copied: "Link copied",
    schedTitle: "Schedule", schedNote: "New episodes of series we have files for.", schedNotReady: "The schedule is not ready yet.",
    schedEmpty: "No series from our archive airs on this day.", newEp: "New episode",
    readMore: "Read more", close: "Close", noSynopsis: "No description for this title.",
    specs: "Details", director: "Director", cast: "Cast", country: "Country",
    dlMovie: "Versions & download links", dlSeries: "Seasons & downloads",
    statusNote: "Each link has its own status. \"Working\" and \"Unavailable\" are only set after a check; until then a link is \"Unverified\".",
    get: "Get", unavailable: "Unavailable", noLink: "Link hidden", unknownQ: "Unknown quality", unknownSpec: "No details",
    working: "Working", unverified: "Unverified", ambiguous: "Uncertain match",
    versions: n => `${n} version${n === 1 ? "" : "s"}`, noVersion: "No version listed yet.", noLinkMovie: "No link listed for this movie yet.",
    noSeasons: "No seasons or episodes listed for this series yet.", noEps: "No episodes listed for this season.", season: n => `Season ${n}`, episode: n => `Episode ${n}`,
    unknown: "Unknown", dups: "Similar title (not merged)", hidden: n => `${n} invalid link(s) (no http/https) not shown.`,
    ftBot: "Flicksy Telegram bot", ftAbout: "About & credits", ftCopy: "© Flicksy — All rights reserved.",
    fMovies: "Download movies", fSeries: "Download series", fStreamM: "Watch movies online", fStreamS: "Watch series online",
    fTopM: "Top 250 movies of all time", fTopS: "Top 250 series of all time", fBox: "Box office", fFaq: "FAQ", fTerms: "Terms & conditions", fDmca: "DMCA POLICY",
    gDl: "Download & watch", gHelp: "Support",
    soon: "Coming soon", soonNote: "This page will be completed soon.",
    sideSeries: "Series", sideMovies: "Movies", popular: "Popular",
    creditTmdb: "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    creditNote: "The trending sections only show titles that have files in our archive. For your watchlist and series tracking, visit",
    creditEnd: ".", hardsub: "Persian hardsub", softsub: "Persian subtitles", dubbed: "Persian dub", langBtn: "FA"
  }
};

const GENRE_EN = {
  "درام": "Drama", "کمدی": "Comedy", "اکشن": "Action", "هیجان انگیز": "Thriller", "عاشقانه": "Romance", "جنایی": "Crime", "ماجراجویی": "Adventure",
  "انیمیشن + انیمه": "Animation & Anime", "فانتزی": "Fantasy", "معمایی": "Mystery", "کلاسیک": "Classic", "ترسناک": "Horror", "تاریخی": "History",
  "مستند": "Documentary", "علمی تخیلی": "Sci-Fi", "زندگی نامه": "Biography", "خانوادگی": "Family", "ورزشی": "Sports", "موزیک": "Music", "جنگی": "War",
  "رئالیتی شو": "Reality", "وسترن": "Western", "آخر الزمانی": "Post-apocalyptic", "مسابقات ورزشی": "Sports events", "هندی": "Indian", "ترکی": "Turkish",
  "ژاپنی": "Japanese", "چینی": "Chinese", "250 برتر تاریخ": "Top 250 of all time", "بهترین ها در 5 ماه گذشته": "Best of the last 5 months",
  "زیر نویس انگلیسی": "English subtitles", "پیشنهادی هفته": "Weekly pick", "آموزش زبان انگلیسی": "English learning", "صوتی": "Audio", "پخش زنده": "Live"
};
const COUNTRY_EN = {
  "امریکا": "USA", "ژاپن": "Japan", "کره جنوبی": "South Korea", "چین": "China", "هند": "India", "ترکیه": "Turkey", "انگلستان": "UK", "فرانسه": "France",
  "آلمان": "Germany", "اسپانیا": "Spain", "کانادا": "Canada", "هنگ کنگ": "Hong Kong", "ایتالیا": "Italy", "تایلند": "Thailand", "استرالیا": "Australia",
  "روسیه": "Russia", "بلژیک": "Belgium", "سوئد": "Sweden", "دانمارک": "Denmark", "مکزیک": "Mexico", "برزیل": "Brazil", "پاکستان": "Pakistan", "نروژ": "Norway",
  "آرژانتین": "Argentina", "تایوان": "Taiwan", "اندونزی": "Indonesia", "لهستان": "Poland", "لبنان": "Lebanon", "هلند": "Netherlands", "فیلیپین": "Philippines",
  "ایرلند": "Ireland", "مجارستان": "Hungary", "اوکراین": "Ukraine", "فنلاند": "Finland", "نیوزیلند": "New Zealand", "سوئیس": "Switzerland", "کلمبیا": "Colombia",
  "مصر": "Egypt", "مالزی": "Malaysia", "آفریقای جنوبی": "South Africa", "جمهوری چک": "Czechia", "رومانی": "Romania", "سوریه": "Syria", "یونان": "Greece",
  "اتریش": "Austria", "عربستان": "Saudi Arabia", "پرتغال": "Portugal", "شیلی": "Chile", "ایران": "Iran", "سنگاپور": "Singapore", "نیجریه": "Nigeria", "ویتنام": "Vietnam"
};

// tags that are not real genres: the site's editorial lists, awards and anything with a year or rank in it
const isRealGenre = g => !EDITORIAL_TAGS.has(g.title) && !/\d/.test(g.title);
const SUB_KEY = { "hardsub-fa": "hardsub", "softsub-fa": "softsub", "dubbed-fa": "dubbed" };
// site tags that are not real genres
const EDITORIAL_TAGS = new Set(["پیشنهاد سردبیر", "تازه های باحال", "محبوب ترین ها", "بیشترین دانلود ها", "سریال های بروز شده", "سریال های برتر", "چینی ژاپنی", "کره ای"]);

let lang = "fa";
try { lang = localStorage.getItem("fx-lang") === "en" ? "en" : "fa"; } catch (e) { /* private mode */ }
const t = k => STR[lang][k] ?? STR.fa[k] ?? k;
const fa = v => String(v).replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);
const num = v => (lang === "fa" ? fa(v) : String(v));
const genreName = n => (lang === "en" ? GENRE_EN[n] || n : n);
const countryName = n => (lang === "en" ? COUNTRY_EN[n] || n : n);
const countriesText = s => String(s || "").split("،").map(x => countryName(x.trim())).filter(Boolean).join(lang === "en" ? ", " : "، ");
const sep = () => (lang === "fa" ? "، " : ", ");

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
  renderNav();
}

/* ---------------- state ---------------- */

let facets = null;
let token = 0;           // increases on every navigation; late answers of old pages are ignored
let timer = 0;           // hero auto-scroll
let lastTab = "home";

/* ---------------- helpers ---------------- */

const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const enc = encodeURIComponent;
const typ = k => (k === "movie" ? t("movie") : t("series"));

const ICON = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  browse: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  schedule: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  top: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3"/><path d="M12 13v4M8.5 20h7M10 17h4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  tg: '<path d="M21 4 3 11l6 2 2 6 3-4 5 4z"/>',
  ig: '<rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.6"/><circle cx="17" cy="7" r=".6"/>',
  share: '<path d="M12 15V3m0 0L8 7m4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>'
};
const svg = (n, cls) => `<svg class="ic ${cls || ""}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;

function renderNav() {
  // phone: the floating bottom bar (tabs only). Desktop: one top bar, brand on the start side, tabs in the middle, language + search on the end side (desktop.css)
  nav.innerHTML = `<a class="nav-brand" href="#home" aria-label="Flicksy"><i class="av"></i><div><small>${esc(t("sub"))}</small><b>Flicksy</b></div></a>` +
    `<div class="nav-links">${["home", "browse", "schedule", "top"].map(k =>
      `<a href="#${k}" data-tab="${k}" aria-label="${esc(t(k))}" class="${k === lastTab ? "on" : ""}">${svg(k)}<span>${esc(t(k))}</span></a>`).join("")}</div>` +
    `<div class="nav-tools">${langBtn()}<a class="iconbtn" href="#search" aria-label="${esc(t("search"))}">${svg("search")}</a></div>`;
}

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

/** API summary -> card model (title is always the English one; the Persian name only helps search) */
function toCard(x) {
  return {
    id: x.id, type: x.kind, title: x.title || x.titleFa, year: x.year || "",
    rating: x.imdbScore > 0 ? Number(x.imdbScore).toFixed(1) : "", image: x.image, synopsis: x.synopsis || ""
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
    `<div class="fb" ${url ? "hidden" : ""}>${esc(c.title)}</div>`;
}

function tile(c) {
  return `<a class="card" href="#title-${c.id}"><div class="p" style="background:${gradientFor(c.id)}">` +
    (c.rating ? `<span class="rt">★ ${esc(num(c.rating))}</span>` : "") + posterInner(c) +
    `</div><div class="n">${esc(c.title)}</div><div class="y">${typ(c.type)}${c.year ? sep() + num(c.year) : ""}</div></a>`;
}
const row = l => `<div class="row">${l.map(tile).join("")}</div>`;
const grid = l => `<div class="grid">${l.map(tile).join("")}</div>`;
const sec = (title, body, href) => `<section class="sec"><div class="sec-h"><h2>${esc(title)}</h2><i class="ln"></i>${href ? `<a class="more" href="${href}" aria-label="${esc(title)}">${svg("chev", "flip")}</a>` : ""}</div>${body}</section>`;
const chip = (label, href, on, extra) => `<a class="chip${on ? " on" : ""}" href="${href}">${esc(label)}${extra ? `<small>${esc(extra)}</small>` : ""}</a>`;
const langBtn = () => `<button class="iconbtn" data-act="lang" aria-label="Language">${t("langBtn")}</button>`;
const topbar = withSearch => `<header class="topbar"><div class="who"><span class="av" role="img" aria-label="Flicksy"></span><div><small>${esc(t("sub"))}</small><b>Flicksy</b></div></div>
  <div class="tb">${langBtn()}${withSearch ? `<a class="iconbtn" href="#search" aria-label="${esc(t("search"))}">${svg("search")}</a>` : ""}</div></header>`;
const backBar = title => `<div class="back"><button class="iconbtn" data-act="back" aria-label="${esc(t("back"))}">${svg("back", "flip")}</button><h1>${esc(title || "")}</h1>${langBtn()}</div>`;
const empty = (m, l, h) => `<div class="empty"><p>${esc(m)}</p>${l ? `<a class="btn" href="${h}">${esc(l)}</a>` : ""}</div>`;
const skCard = () => `<div class="sk-card"><div class="p sk"></div><div class="b sk"></div><div class="b s sk"></div></div>`;
const skel = n => `<div class="grid">${Array.from({ length: n || 6 }, skCard).join("")}</div>`;
const skHome = () => `<div class="sk sk-hero"></div>` + [0, 1].map(() => `<div class="sk-sec"><div class="t sk"></div><i class="l"></i></div><div class="sk-row">${skCard().repeat(4)}</div>`).join("");
const skSec = () => `<div class="sk-sec"><div class="t sk"></div><i class="l"></i></div>`;
const skRows = n => Array.from({ length: n }, () => skSec() + `<div class="sk-row">${skCard().repeat(4)}</div>`).join("");
const skChips = () => `<div class="sk-chips">${[84, 104, 72, 96, 88, 110, 76, 92].map(w => `<div class="sk sk-chip" style="width:${w}px"></div>`).join("")}</div>`;
const skTitle = () => `<div class="sk sk-th"></div><div class="sk-head"><div class="sk sk-pst"></div><div class="sk-hi"><div class="sk"></div><div class="sk s"></div></div></div>
  <div class="sk sk-line" style="width:50%;margin-top:18px"></div><div class="sk sk-line"></div><div class="sk sk-line"></div><div class="sk sk-line" style="width:70%"></div>
  ${skSec()}<div class="sk-row">${Array.from({ length: 5 }, () => `<div class="sk" style="flex:0 0 76px;height:76px;border-radius:50%"></div>`).join("")}</div>
  ${skSec()}<div class="sk sk-acc"></div><div class="sk sk-acc"></div>`;
const fail = () => `<div class="empty"><p>${esc(t("failed"))}</p><button class="btn" data-act="retry">${esc(t("retry"))}</button></div>`;

// footer links: [page key, label key, optional real address]. Pages that are not written yet show "coming soon".
const FOOTER_LINKS = [
  ["movies", "fMovies", "#list?kind=movie"], ["series", "fSeries", "#list?kind=series"],
  ["stream-movies", "fStreamM"], ["stream-series", "fStreamS"],
  ["top250-movies", "fTopM"], ["top250-series", "fTopS"],
  ["box-office", "fBox"], ["faq", "fFaq"], ["terms", "fTerms"], ["dmca", "fDmca"], ["about", "ftAbout"]
];

const FOOTER_GROUPS = [
  ["gDl", ["movies", "series", "stream-movies", "stream-series"]],
  ["top", ["top250-movies", "top250-series", "box-office"]],
  ["gHelp", ["faq", "terms", "dmca", "about"]]
];

function creditHTML() {
  const link = k => { const l = FOOTER_LINKS.find(x => x[0] === k); return `<a href="${l[2] || "#page-" + l[0]}">${esc(t(l[1]))}</a>`; };
  return `<footer class="ft"><div class="ft-line"></div><nav class="ft-cols">` +
    FOOTER_GROUPS.map(g => `<div class="ft-col"><h3>${esc(t(g[0]))}</h3>${g[1].map(link).join("")}</div>`).join("") +
    `</nav><div class="ft-copy">${esc(t("ftCopy"))}</div></footer>`;
}

function put(html, tk, withCredit) {
  if (tk !== token) return;
  app.innerHTML = `<div class="view">${html}${withCredit === false ? "" : creditHTML()}</div>`;
}

let toastTimer = 0;
function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

/* ---------------- routing ---------------- */

function parseHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ""));
  const m = h.match(/^title-(\d+)$/);
  if (m) return { r: "title", id: Number(m[1]) };
  const pg = h.match(/^page-([a-z0-9-]+)$/);
  if (pg && FOOTER_LINKS.some(l => l[0] === pg[1])) return { r: "page", key: pg[1] };
  if (h.startsWith("list?")) return { r: "list", p: new URLSearchParams(h.slice(5)) };
  return { r: ["browse", "schedule", "search", "top"].includes(h) ? h : "home" };
}

function route(keepScroll) {
  const R = parseHash(), tk = ++token;
  clearInterval(timer);
  if (["home", "browse", "schedule", "top"].includes(R.r)) lastTab = R.r;
  else if (R.r === "search" || R.r === "page") lastTab = "";
  renderNav();
  document.title = "Flicksy | " + t("sub");
  ({ home: vHome, browse: vBrowse, schedule: vSchedule, search: vSearch, top: vTop, list: vList, title: vTitle, page: vPage }[R.r])(R, tk);
  if (keepScroll !== true) window.scrollTo(0, 0);
}

/* ---------------- home ---------------- */

function heroHTML(slides) {
  return `<div class="hero" id="hero">${slides.map((s, i) => `
    <a class="slide" href="#title-${s.id}" style="background:${gradientFor(s.id, 7)}">
      ${s.bg ? `<img data-fb="1" ${i ? 'loading="lazy"' : 'fetchpriority="high"'} src="${esc(s.bg)}" alt="" decoding="async" referrerpolicy="no-referrer">` : ""}
      <div class="sl"><h2>${esc(s.title)}</h2><p>${esc(s.meta)}</p></div></a>`).join("")}</div>
    <div class="dots" id="dots">${slides.map(() => "<i></i>").join("")}</div>`;
}

function initHero() {
  const h = document.getElementById("hero"), ds = document.querySelectorAll("#dots i"), n = ds.length;
  if (!h || !n) return;
  const rtl = getComputedStyle(h).direction === "rtl";
  const w = () => h.firstElementChild.offsetWidth + 10;
  const idx = () => Math.min(n - 1, Math.max(0, Math.round(Math.abs(h.scrollLeft) / w())));
  const mark = () => { const k = idx(); ds.forEach((d, i) => d.classList.toggle("on", i === k)); };
  h.addEventListener("scroll", mark, { passive: true });
  mark();
  if (matchMedia("(prefers-reduced-motion:reduce)").matches) return;
  // automatic slide change pauses while the user touches the banner (and for a while after), and only moves the banner itself, never the page
  let pausedUntil = 0;
  const hold = () => { pausedUntil = Date.now() + 9000; };
  ["pointerdown", "touchstart", "touchmove", "wheel", "keydown"].forEach(ev => h.addEventListener(ev, hold, { passive: true }));
  h.addEventListener("touchend", hold, { passive: true });
  timer = setInterval(() => {
    if (Date.now() < pausedUntil || document.hidden) return;
    const r = h.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return;           // banner not on screen
    h.scrollTo({ left: (rtl ? -1 : 1) * ((idx() + 1) % n) * w(), behavior: "smooth" });
  }, 6000);
}

async function vHome(R, tk) {
  put(topbar(true) + skHome(), tk, false);
  try {
    const [tm, lm, ls] = await Promise.all([
      Api.tmdb(),
      Api.titles({ kind: "movie", limit: 14 }),
      Api.titles({ kind: "series", limit: 14 })
    ]);
    if (tk !== token) return;
    if (!facets) facets = await Api.facets().catch(() => null);

    const slideMeta = c => [typ(c.type), c.year && num(c.year), c.rating && "★ " + num(c.rating)].filter(Boolean).join(sep());
    // hero: TMDB trending with backdrops, otherwise the editorial picks
    let slides = [];
    if (tm && tm.banner && tm.banner.length) {
      const cards = await Api.resolve(tm.banner);
      const by = new Map(cards.map(c => [c.id, c]));
      slides = tm.banner.filter(b => by.has(b.id)).map(b => {
        const c = toCard(by.get(b.id));
        return { id: c.id, title: c.title, bg: b.backdrop.replace("/w1280/", "/w780/"), meta: slideMeta(c) };
      });
    }
    if (slides.length < 3) {
      const f = await Api.featured(6).catch(() => ({ items: [] }));
      slides = f.items.map(toCard).map(c => ({ id: c.id, title: c.title, bg: c.image, meta: slideMeta(c) }));
    }

    let html = topbar(true) + `<div class="hm"><div class="hm-main">`;
    if (slides.length) html += heroHTML(slides);

    if (tm && tm.rows) {
      for (const r of tm.rows) {
        if (TOP_ROWS.has(r.key)) continue;                  // these live in the Top tab
        const cards = (await Api.resolve(r.items)).map(toCard);
        if (cards.length >= 4) html += sec(rowTitle(r), row(cards.slice(0, 14)), `#list?row=${enc(r.key)}`);
      }
    }
    if (tm && tm.networks && tm.networks.length) {
      // phones: a row inside the page; desktop: the same tiles live in the sidebar (desktop.css hides this one)
      html += sec(t("networks"), `<div class="row">${tm.networks.map(netTile).join("")}</div>`).replace('<section class="sec">', '<section class="sec sec-net">');
    }
    html += sec(t("latestMovies"), row(lm.items.map(toCard)), "#list?kind=movie");
    html += sec(t("latestSeries"), row(ls.items.map(toCard)), "#list?kind=series");
    html += `</div>` + (tm && tm.rows ? await sideHTML(tm) : "") + `</div>`;
    put(html, tk);
    initHero();
  } catch (e) {
    console.error(e);
    put(topbar(false) + fail(), tk, false);
  }
}

// desktop sidebar (hidden on phones): series and movies panels, each with two tabs, built from the existing TMDB lists
async function sideHTML(tm) {
  const panel = async (title, keys) => {
    const tabs = [];
    for (const [key, label] of keys) {
      const r = tm.rows.find(x => x.key === key);
      const cards = r ? (await Api.resolve(r.items)).map(toCard).slice(0, 5) : [];
      if (cards.length >= 3) tabs.push({ label, cards, href: `#list?row=${enc(key)}` });
    }
    if (!tabs.length) return "";
    const item = (c, i) => i === 0
      ? `<a class="sb-big" href="#title-${c.id}"><div class="p" style="background:${gradientFor(c.id)}">${posterInner(c)}</div><div class="cap"><b>${esc(c.title)}</b><small>${[typ(c.type), c.year && num(c.year), c.rating && "★ " + num(c.rating)].filter(Boolean).join(sep())}</small></div></a>`
      : `<a class="sb-it" href="#title-${c.id}"><div class="p" style="background:${gradientFor(c.id)}">${posterInner(c)}</div><div class="cap"><b>${esc(c.title)}</b><small>${[c.year && num(c.year), c.rating && "★ " + num(c.rating)].filter(Boolean).join(sep())}</small></div></a>`;
    return `<section class="sb"><h3>${esc(title)}</h3><div class="sb-tabs">${tabs.map((x, i) => `<button class="${i ? "" : "on"}" data-act="side" data-i="${i}">${esc(x.label)}</button>`).join("")}</div>` +
      tabs.map((x, i) => `<div class="sb-pane${i ? "" : " on"}">${x.cards.map(item).join("")}<a class="sb-all" href="${x.href}">${esc(t("more"))}</a></div>`).join("") + `</section>`;
  };
  const a = await panel(t("sideSeries"), [["popular-tv", t("popular")], ["top-tv", t("top")]]);
  const b = await panel(t("sideMovies"), [["popular-movie", t("popular")], ["top-movie", t("top")]]);
  const c = tm.networks && tm.networks.length ? `<section class="sb sb-net"><h3>${esc(t("networks"))}</h3><div class="sb-nets">${tm.networks.map(netTile).join("")}</div></section>` : "";
  return a || b || c ? `<aside class="hm-side">${a}${b}${c}</aside>` : "";
}

// network card: the network's own logo (white, one colour); the name shows if there is no logo or it fails to load
const netTile = n => `<a class="net" style="background:${gradientFor(n.id)}" href="#list?net=${n.id}" aria-label="${esc(n.name)}">${netInner(n)}</a>`;
const netInner = n => { const u = safeURL(n.logo); return u ? `<img data-fb="1" src="${esc(u)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="fb" hidden>${esc(n.name)}</span>` : esc(n.name); };
const titleCase = s => String(s || "").toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
const rowTitle = r => (lang === "en" ? r.titleEn || titleCase(r.kicker) : r.title);

/* ---------------- top (ranked lists) ---------------- */

const TOP_ROWS = new Set(["top-movie", "top-tv", "popular-movie", "popular-tv"]);

async function vTop(R, tk) {
  put(topbar(true) + `<div class="title">${esc(t("top"))}</div>${skRows(2)}`, tk, false);
  try {
    const [tm, top] = await Promise.all([Api.tmdb(), Api.top(24).catch(() => ({ items: [] }))]);
    if (tk !== token) return;
    let html = topbar(true) + `<div class="title">${esc(t("top"))}</div>`;
    if (tm && tm.rows) {
      for (const key of TOP_ROWS) {
        const r = tm.rows.find(x => x.key === key);
        if (!r) continue;
        const cards = (await Api.resolve(r.items)).map(toCard);
        if (cards.length >= 4) html += sec(rowTitle(r), row(cards.slice(0, 14)), `#list?row=${enc(r.key)}`);
      }
    }
    if (top.items.length >= 3) html += sec(t("topArchive"), grid(top.items.map(toCard)));
    if (html.indexOf('class="sec"') < 0) html += empty(t("noResult"));
    put(html, tk);
  } catch (e) { console.error(e); put(topbar(false) + fail(), tk, false); }
}

/* ---------------- browse (categories) ---------------- */

async function vBrowse(R, tk) {
  put(topbar(true) + `<div class="title">${esc(t("browse"))}</div>${skSec() + skChips() + skSec() + skChips()}`, tk, false);
  try {
    if (!facets) facets = await Api.facets();
    const tm = await Api.tmdb();
    if (tk !== token) return;
    const real = isRealGenre;
    const gk = kind => [...(facets.genresByKind[kind] || [])].filter(real).sort((a, b) => b.count - a.count).slice(0, 18);
    const chipsOf = (list, kind) => `<div class="chips">${list.map(g => chip(genreName(g.title), `#list?kind=${kind}&genre=${g.id}`, false, num(g.count))).join("")}</div>`;
    const countries = [...(facets.countries || [])].sort((a, b) => b.count - a.count).slice(0, 24);
    put(topbar(true) + `<div class="title">${esc(t("browse"))}</div>
      ${sec(t("genresMovies"), chipsOf(gk("movie"), "movie"))}
      ${sec(t("genresSeries"), chipsOf(gk("series"), "series"))}
      ${sec(t("countries"), `<div class="chips">${countries.map(c => chip(countryName(c.title), `#list?country=${c.id}`, false, num(c.count))).join("")}</div>`)}
      ${tm && tm.networks && tm.networks.length ? sec(t("networks"), `<div class="chips">${tm.networks.map(n => chip(n.name, `#list?net=${n.id}`)).join("")}</div>`) : ""}`, tk);
  } catch (e) { console.error(e); put(topbar(false) + fail(), tk, false); }
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
    if (reset && !r.items.length) { g.innerHTML = empty(t("noResult")); return; }
    if (reset) g.innerHTML = "<div class='grid' id='lgi'></div>";
    document.getElementById("lgi").insertAdjacentHTML("beforeend", r.items.map(toCard).map(tile).join(""));
    paged.offset += r.items.length;
    m.innerHTML = r.hasMore ? `<button class="btn ghost" data-act="more">${esc(t("more"))}</button>` : "";
  } catch (e) {
    if (e.name !== "AbortError" && tk === token) g.innerHTML = fail();
  }
}

async function vList(R, tk) {
  const p = R.p;
  put(backBar("") + `<div id="lg">${skel(6)}</div><div id="lm"></div>`, tk, false);
  try {
    const tm = (p.get("row") || p.get("net")) ? await Api.tmdb() : null;
    if (!facets) facets = await Api.facets().catch(() => null);
    if (tk !== token) return;
    let title = t("results");
    if (p.get("row")) { const r = (tm && tm.rows || []).find(x => x.key === p.get("row")); if (r) title = rowTitle(r); }
    else if (p.get("net")) { const n = (tm && tm.networks || []).find(x => String(x.id) === p.get("net")); if (n) title = n.name; }
    else if (p.get("genre") && facets) { const g = facets.genres.find(x => String(x.id) === p.get("genre")); if (g) title = genreName(g.title); }
    else if (p.get("country") && facets) { const c = (facets.countries || []).find(x => String(x.id) === p.get("country")); if (c) title = countryName(c.title); }
    else if (p.get("kind")) title = p.get("kind") === "movie" ? t("allMovies") : t("allSeries");
    document.title = `${title} | Flicksy`;

    if (p.get("row") || p.get("net")) {                      // lists that come from TMDB (already matched, no paging)
      const src = p.get("net") ? (tm && tm.networks || []).find(n => String(n.id) === p.get("net")) : (tm && tm.rows || []).find(r => r.key === p.get("row"));
      const cards = src ? (await Api.resolve(src.items)).map(toCard) : [];
      put(backBar(title) + (cards.length ? grid(cards) : empty(t("noResult"))), tk, false);
      return;
    }
    put(backBar(title) + `<div id="lg">${skel(6)}</div><div id="lm"></div>`, tk, false);
    paged.params = {};
    ["kind", "genre", "country", "minScore", "year", "q"].forEach(k => { if (p.get(k)) paged.params[k] = p.get(k); });
    paged.tk = tk;
    await loadMore(true);
  } catch (e) { console.error(e); put(backBar("") + fail(), tk, false); }
}

/* ---------------- search ---------------- */

function vSearch(R, tk) {
  const hint = empty(t("searchHint"));
  put(topbar(false) + `<div class="title">${esc(t("search"))}</div><input class="sin" id="q" type="search" placeholder="${esc(t("searchPh"))}" autocomplete="off" aria-label="${esc(t("search"))}"><div id="lg">${hint}</div><div id="lm"></div>`, tk, false);
  const q = document.getElementById("q");
  let timerId = 0;
  q.focus();
  q.addEventListener("input", () => {
    clearTimeout(timerId);
    const v = q.value.trim();
    if (!v) { if (paged.abort) paged.abort.abort(); document.getElementById("lg").innerHTML = hint; document.getElementById("lm").innerHTML = ""; return; }
    timerId = setTimeout(() => { paged.params = { q: v }; paged.tk = tk; loadMore(true); }, 250);
  });
}

/* ---------------- schedule (TMDB, only series we have) ---------------- */

let schedDay = 0;

async function vSchedule(R, tk) {
  put(topbar(true) + `<div class="title">${esc(t("schedTitle"))}</div><div class="sk-days">${Array.from({ length: 5 }, () => `<div class="sk sk-chip"></div>`).join("")}</div>${Array.from({ length: 4 }, () => `<div class="sk sk-sch"></div>`).join("")}`, tk, false);
  const tm = await Api.tmdb();
  if (tk !== token) return;
  const days = tm && tm.schedule ? tm.schedule.filter(d => d.items.length) : [];
  if (!days.length) { put(topbar(true) + `<div class="title">${esc(t("schedTitle"))}</div>` + empty(t("schedNotReady"), t("backHome"), "#home"), tk); return; }
  if (schedDay >= days.length) schedDay = 0;
  const loc = lang === "fa" ? "fa-IR" : "en-US";
  const label = d => {
    const dt = new Date(d.date + "T12:00:00Z");
    return `${dt.toLocaleDateString(loc, { weekday: "long", timeZone: "UTC" })}<small>${dt.toLocaleDateString(loc, { month: "long", day: "numeric", timeZone: "UTC" })}</small>`;
  };
  const draw = async () => {
    document.getElementById("days").innerHTML = days.map((d, i) => `<button class="chip${i === schedDay ? " on" : ""}" data-act="day" data-d="${i}">${label(d)}</button>`).join("");
    const cards = (await Api.resolve(days[schedDay].items)).map(toCard);
    if (tk !== token) return;
    document.getElementById("sr").innerHTML = cards.length ? cards.map(c => `
      <a class="sch" href="#title-${c.id}"><div class="p" style="background:${gradientFor(c.id)}">${posterInner(c)}</div>
        <div class="t"><b>${esc(c.title)}</b><small>${c.rating ? "★ " + esc(num(c.rating)) + sep() : ""}${c.year ? num(c.year) : ""}</small></div>
        <span class="tag">${esc(t("newEp"))}</span></a>`).join("") : empty(t("schedEmpty"));
  };
  put(topbar(true) + `<div class="title">${esc(t("schedTitle"))}</div><p class="note" style="margin:-6px 0 12px">${esc(t("schedNote"))}</p><div class="days" id="days"></div><div id="sr"></div>`, tk);
  window.__draw = () => { draw(); };
  draw();
}

/* ---------------- footer pages (content comes later) ---------------- */

function vPage(R, tk) {
  const l = FOOTER_LINKS.find(x => x[0] === R.key), title = t(l[1]);
  document.title = `${title} | Flicksy`;
  const body = R.key === "about"
    ? `<div class="ft-b"><strong>TMDB</strong><span>${esc(t("creditTmdb"))}</span><span>${esc(t("creditNote"))} <a href="https://t.me/flicksyrobot" target="_blank" rel="noopener">Flicksy</a>${esc(t("creditEnd") === "." ? "." : " " + t("creditEnd"))}</span></div>`
    : "";
  put(backBar(title) + `<div class="empty"><p><b>${esc(t("soon"))}</b></p><p>${esc(t("soonNote"))}</p></div>${body}<a class="btn ghost" href="#home">${esc(t("backHome"))}</a>`, tk);
}

/* ---------------- title page ---------------- */

const hasFa = v => /[\u0600-\u06FF]/.test(v || "");
const onlyLang = v => (lang === "en" && hasFa(v) ? "" : v);      // English view: drop Persian-only text coming from the source data
const epName = e => (!e.title || /^قسمت\s*\d+$/.test(e.title) || onlyLang(e.title) === "" ? t("episode")(num(e.number)) : e.title);

function mapLink(l) {
  return {
    quality: [l.resolution ? l.resolution + "p" : onlyLang(l.qualityText), l.sourceTag, l.codec, l.audio].filter(Boolean).join(" · "),
    format: l.container ? String(l.container).toUpperCase() : "", size: fmtSize(l.sizeBytes), language: SUB_KEY[l.subtitle] ? t(SUB_KEY[l.subtitle]) : "",
    status: l.status, url: l.url, releaseName: l.releaseName, group: onlyLang(l.releaseGroup), host: l.host, ambiguous: l.ambiguousMatch, lastChecked: l.lastChecked
  };
}

function dlRow(link) {
  const url = safeURL(link.url);
  let action;
  if (link.status === "unavailable") action = `<span class="off">${esc(t("unavailable"))}</span>`;
  else if (!url) action = `<span class="off">${esc(t("noLink"))}</span>`;
  else action = `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(t("get"))} ↗</a>`;
  const details = [link.format, link.size, link.language, link.group].filter(Boolean).join(" · ") || t("unknownSpec");
  const statusText = link.status === "working" ? t("working") : link.status === "unavailable" ? t("unavailable") : t("unverified");
  return `<div class="dl"><div class="i"><b dir="auto">${esc(link.quality || t("unknownQ"))}</b><small dir="auto">${esc(details)}</small>
    <small><span class="st ${esc(link.status)}">${esc(statusText)}${link.lastChecked ? " · " + esc(link.lastChecked.slice(0, 10)) : ""}</span>${link.ambiguous ? " · " + esc(t("ambiguous")) : ""}</small>
    ${link.releaseName ? `<small class="rn">${esc(link.releaseName)}</small>` : ""}</div>${action}</div>`;
}

const accordion = (name, desc, links, open) => `<details class="acc" ${open ? "open" : ""}><summary><span dir="auto">${esc(name)}</span><small>${esc(desc)}</small></summary><div class="acc-b">${links.map(dlRow).join("") || `<div class="note">${esc(t("noVersion"))}</div>`}</div></details>`;

function groupByHost(releases) {
  const groups = new Map();
  releases.map(mapLink).forEach(l => { const k = l.host || t("unknown"); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); });
  return [...groups];
}

let castPromise = null;
const loadCast = () => castPromise || (castPromise = fetch("data/tmdb-cast.json").then(r => (r.ok ? r.json() : null)).catch(() => null));

function castHTML(x, cd) {
  const e = cd && cd.titles && cd.titles[x.id];
  if (!e || e.t !== x.title || !e.c || !e.c.length) return "";
  const base = safeURL((cd.imgBase || "https://image.tmdb.org/t/p/") + "w185") ? (cd.imgBase || "https://image.tmdb.org/t/p/") : "https://image.tmdb.org/t/p/";
  return sec(t("cast"), `<div class="cast">${e.c.map(a => `<div class="actor"><div class="ph"><img data-fb="1" src="${esc(base + "w185" + a[2])}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div><b dir="ltr">${esc(a[0])}</b>${a[1] ? `<small dir="ltr">${esc(a[1])}</small>` : ""}</div>`).join("")}</div>`);
}

let seasonsData = [], season = 0;

function episodesHTML() {
  const s = seasonsData[season];
  return s.episodes.map(e => accordion(epName(e), onlyLang(e.duration) || "", e.links.map(mapLink), false)).join("") || `<div class="note">${esc(t("noEps"))}</div>`;
}

// description: our own synopsis, or TMDB's English overview when ours is empty (English view prefers TMDB's)
function overviewOf(x, cd) {
  const e = cd && cd.titles && cd.titles[x.id];
  const en = e && e.t === x.title && e.o ? e.o : "";
  return lang === "en" ? (en || x.synopsis) : (x.synopsis || en);
}

function titleHTML(x, tm, cd) {
  const isMovie = x.kind === "movie", c = toCard(x);
  seasonsData = x.seasons || []; season = 0;
  const epCount = seasonsData.reduce((n, s) => n + s.episodes.length, 0);
  const genres = (x.genreList || []).filter(isRealGenre);
  const poster = safeURL(x.image);
  const bdPath = tm && tm.backdrops && tm.backdrops[x.id];
  const bd = bdPath ? (tm.imgBase || "https://image.tmdb.org/t/p/") + "w780" + bdPath : "";
  const clean = v => (v ? String(v).replace(/\s+,/g, ",") : v);
  const castSec = castHTML(x, cd);          // when the cast row is shown, the plain text list of names is not repeated in the details
  const facts = [[t("director"), clean(x.director)], [t("cast"), castSec ? "" : clean(x.stars)], [t("country"), countriesText(x.countries)]].filter(f => f[1]);
  let downloads;
  if (isMovie) {
    downloads = x.releases.length ? groupByHost(x.releases).map(([h, l], i) => accordion(h, t("versions")(num(l.length)), l, i === 0)).join("") : `<div class="note">${esc(t("noLinkMovie"))}</div>`;
  } else if (!seasonsData.length) {
    downloads = `<div class="note">${esc(t("noSeasons"))}</div>`;
  } else {
    downloads = `<div class="chips sorts" id="seasons">${seasonsData.map((s, i) => `<button class="chip${i === 0 ? " on" : ""}" data-act="season" data-n="${i}">${esc(t("season")(num(s.number)))}</button>`).join("")}</div><div id="eps">${episodesHTML()}</div>`;
  }
  const dups = (x.possibleDuplicates || []).length ? `<p class="note">${esc(t("dups"))}: ${x.possibleDuplicates.map(d => esc(d.title) + (d.year ? ` (${num(d.year)})` : "")).join(sep())}</p>` : "";
  const hidden = x.hiddenInvalidLinks ? `<p class="note">${esc(t("hidden")(num(x.hiddenInvalidLinks)))}</p>` : "";
  const length = isMovie ? (x.duration ? `${num(x.duration)} ${t("min")}` : "") : (seasonsData.length ? `${num(seasonsData.length)} ${t("seasons")}${sep()}${num(epCount)} ${t("episodes")}` : "");
  const heroImg = bd || poster;
  return `<div class="th${bd ? "" : " bl"}" style="background:${gradientFor(c.id, 3)}">${heroImg ? `<img data-fb="1" src="${esc(heroImg)}" alt="" referrerpolicy="no-referrer">` : ""}
      <button class="rb s" data-act="back" aria-label="${esc(t("back"))}">${svg("back", "flip")}</button>
      <button class="rb e" data-act="share" aria-label="${esc(t("share"))}">${svg("share")}</button></div>
    <div class="tp"><div class="head"><div class="pst p" style="background:${gradientFor(c.id)}">${posterInner(c)}</div>
      <div class="hi"><h1>${esc(c.title)}</h1>
      <div class="meta"><span class="pill">${typ(x.kind)}</span>${x.year ? `<span>${num(x.year)}</span>` : ""}${length ? `<span>${esc(length)}</span>` : ""}${c.rating ? `<span class="star">★ ${esc(num(c.rating))}</span>` : ""}</div></div></div>
    ${genres.length ? `<div class="gline">${genres.map(g => `<a href="#list?kind=${x.kind}&genre=${g.id}">${esc(genreName(g.title))}</a>`).join(" · ")}</div>` : ""}
    <p class="ov" id="ov" dir="auto">${esc(overviewOf(x, cd) || t("noSynopsis"))}</p>
    <button class="textbtn" data-act="ov">${esc(t("readMore"))} ${lang === "fa" ? "‹" : "›"}</button>
    <div class="tp-cast">${castSec}</div>
    <div class="tp-facts">${facts.length ? sec(t("specs"), `<div class="facts">${facts.map(f => `<div class="fact"><span>${esc(f[0])}</span><strong dir="auto">${esc(f[1])}</strong></div>`).join("")}</div>${dups}`) : dups}</div>
    <div class="tp-dl">${sec(isMovie ? t("dlMovie") : t("dlSeries"), `${downloads}${hidden}<p class="note">${esc(t("statusNote"))}</p>`)}</div></div>`;
}

async function vTitle(R, tk) {
  put(skTitle(), tk, false);
  try {
    const [r, tm, cd] = await Promise.all([Api.title(R.id), Api.tmdb(), loadCast()]);
    if (tk !== token) return;
    const x = r.title;
    document.title = `${x.title || x.titleFa} | Flicksy`;
    put(titleHTML(x, tm, cd), tk);
  } catch (e) {
    put(backBar("") + empty(e.status === 404 ? t("notFound") : t("loadError"), t("backHome"), "#home"), tk, false);
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
  else if (k === "lang") {
    lang = lang === "fa" ? "en" : "fa";
    try { localStorage.setItem("fx-lang", lang); } catch (err) { /* ignore */ }
    applyLang();
    route(true);
  }
  else if (k === "share") {
    const data = { title: document.title, url: location.href };
    if (navigator.share) navigator.share(data).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(() => toast(t("copied")), () => {});
  }
  else if (k === "side") {
    const box = b.closest(".sb"), i = Number(b.dataset.i);
    box.querySelectorAll(".sb-tabs button").forEach((x, j) => x.classList.toggle("on", j === i));
    box.querySelectorAll(".sb-pane").forEach((x, j) => x.classList.toggle("on", j === i));
  }
  else if (k === "day") { schedDay = Number(b.dataset.d); window.__draw && window.__draw(); }
  else if (k === "season") {
    season = Number(b.dataset.n);
    document.querySelectorAll("#seasons .chip").forEach((c, i) => c.classList.toggle("on", i === season));
    document.getElementById("eps").innerHTML = episodesHTML();
  } else if (k === "ov") {
    const o = document.getElementById("ov");
    o.classList.toggle("open");
    b.textContent = (o.classList.contains("open") ? t("close") : t("readMore")) + " " + (lang === "fa" ? "‹" : "›");
  }
});
window.addEventListener("hashchange", () => route());
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); location.hash = "#search"; }
});
document.addEventListener("DOMContentLoaded", () => { applyLang(); route(); });
