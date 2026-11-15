"use strict";

/*
 * Flicksy-Download
 * Frontend prototype
 *
 * All content is temporary mock data.
 * No real download links are included.
 */

/* ----------------------------------
   MOCK DATA
---------------------------------- */

const movies = [
  {
    id: 1,
    type: "movie",
    title: "تلماسه: بخش دوم",
    original: "Dune: Part Two",
    year: 2024,
    rating: "8.5",
    duration: "166 دقیقه",
    country: "آمریکا",
    genres: ["علمی تخیلی", "ماجراجویی"],
    description: "پل آتریدیس در مسیر انتقام و سرنوشت خود، به فریمن‌ها می‌پیوندد و درگیر آینده‌ای بزرگ‌تر از انتظارش می‌شود.",
    director: "Denis Villeneuve",
    gradient: "linear-gradient(145deg,#b45309,#451a03 60%,#111827)",
    sources: [
      {
        name: "آرشیو نمونه اول",
        description: "منبع اول · نسخه‌های باکیفیت",
        links: [
          { quality: "BluRay 1080p", format: "MKV", size: "نامشخص", language: "زبان اصلی", status: "available", url: "" },
          { quality: "BluRay 720p", format: "MKV", size: "نامشخص", language: "زبان اصلی", status: "available", url: "" }
        ]
      },
      {
        name: "آرشیو نمونه دوم",
        description: "منبع دوم · نسخه‌های کم‌حجم",
        links: [
          { quality: "WEB-DL 720p", format: "MP4", size: "نامشخص", language: "زیرنویس فارسی", status: "unknown", url: "" }
        ]
      }
    ]
  },
  {
    id: 2,
    type: "movie",
    title: "اوپنهایمر",
    original: "Oppenheimer",
    year: 2023,
    rating: "8.3",
    duration: "180 دقیقه",
    country: "آمریکا",
    genres: ["درام", "تاریخی"],
    description: "داستان زندگی جی. رابرت اوپنهایمر و نقش او در ساخت نخستین بمب اتمی.",
    director: "Christopher Nolan",
    gradient: "linear-gradient(145deg,#b45309,#7f1d1d 55%,#111827)",
    sources: [
      {
        name: "آرشیو نمونه اول",
        description: "منبع اول",
        links: [
          { quality: "BluRay 1080p", format: "MKV", size: "نامشخص", language: "زبان اصلی", status: "available", url: "" }
        ]
      }
    ]
  },
  {
    id: 3,
    type: "movie",
    title: "بین ستاره‌ای",
    original: "Interstellar",
    year: 2014,
    rating: "8.7",
    duration: "169 دقیقه",
    country: "آمریکا",
    genres: ["علمی تخیلی", "درام"],
    description: "گروهی از کاوشگران از طریق یک کرم‌چاله به دنبال خانه‌ای جدید برای بشریت می‌گردند.",
    director: "Christopher Nolan",
    gradient: "linear-gradient(145deg,#0e7490,#172554 55%,#020617)",
    sources: [
      {
        name: "آرشیو نمونه اول",
        description: "منبع اول · کیفیت بالا",
        links: [
          { quality: "IMAX BluRay 1080p", format: "MKV", size: "نامشخص", language: "زبان اصلی", status: "available", url: "" }
        ]
      },
      {
        name: "آرشیو نمونه دوم",
        description: "منبع دوم · نسخه‌های دیگر",
        links: [
          { quality: "BluRay 720p", format: "MKV", size: "نامشخص", language: "دوبله فارسی", status: "available", url: "" }
        ]
      }
    ]
  },
  {
    id: 4,
    type: "movie",
    title: "شوالیه تاریکی",
    original: "The Dark Knight",
    year: 2008,
    rating: "9.0",
    duration: "152 دقیقه",
    country: "آمریکا",
    genres: ["اکشن", "جنایی"],
    description: "بتمن با تهدیدی تازه و غیرقابل پیش‌بینی در شهر گاتهام روبه‌رو می‌شود.",
    director: "Christopher Nolan",
    gradient: "linear-gradient(145deg,#52525b,#18181b 55%,#09090b)",
    sources: [
      {
        name: "آرشیو نمونه اول",
        description: "منبع اول",
        links: [
          { quality: "BluRay 1080p", format: "MKV", size: "نامشخص", language: "زبان اصلی", status: "available", url: "" }
        ]
      }
    ]
  },
  {
    id: 5,
    type: "movie",
    title: "میان ما",
    original: "Past Lives",
    year: 2023,
    rating: "7.8",
    duration: "105 دقیقه",
    country: "آمریکا",
    genres: ["درام", "عاشقانه"],
    description: "دو دوست دوران کودکی پس از سال‌ها دوباره با یکدیگر روبه‌رو می‌شوند.",
    director: "Celine Song",
    gradient: "linear-gradient(145deg,#be185d,#581c87 55%,#111827)",
    sources: [
      {
        name: "آرشیو نمونه اول",
        description: "منبع اول",
        links: [
          { quality: "WEB-DL 1080p", format: "MKV", size: "نامشخص", language: "زبان اصلی", status: "unknown", url: "" }
        ]
      }
    ]
  },
  {
    id: 6,
    type: "movie",
    title: "بلید رانر ۲۰۴۹",
    original: "Blade Runner 2049",
    year: 2017,
    rating: "8.0",
    duration: "164 دقیقه",
    country: "آمریکا",
    genres: ["علمی تخیلی", "معمایی"],
    description: "یک افسر جوان به رازی قدیمی پی می‌برد که می‌تواند نظم جامعه را تغییر دهد.",
    director: "Denis Villeneuve",
    gradient: "linear-gradient(145deg,#ea580c,#7e22ce 55%,#111827)",
    sources: [
      {
        name: "آرشیو نمونه اول",
        description: "منبع اول",
        links: [
          { quality: "BluRay 1080p", format: "MKV", size: "نامشخص", language: "زبان اصلی", status: "available", url: "" }
        ]
      }
    ]
  },
  {
    id: 7,
    type: "movie",
    title: "تلماسه",
    original: "Dune",
    year: 2021,
    rating: "8.0",
    duration: "155 دقیقه",
    country: "آمریکا",
    genres: ["علمی تخیلی", "ماجراجویی"],
    description: "پل آتریدیس به سیاره آراکیس سفر می‌کند؛ جایی که سرنوشت خاندانش تغییر خواهد کرد.",
    director: "Denis Villeneuve",
    gradient: "linear-gradient(145deg,#a16207,#713f12 55%,#111827)",
    sources: [
      {
        name: "آرشیو نمونه اول",
        description: "منبع اول",
        links: [
          { quality: "WEB-DL 1080p", format: "MKV", size: "نامشخص", language: "زبان اصلی", status: "available", url: "" }
        ]
      }
    ]
  },
  {
    id: 8,
    type: "movie",
    title: "مرد ایرلندی",
    original: "The Irishman",
    year: 2019,
    rating: "7.8",
    duration: "209 دقیقه",
    country: "آمریکا",
    genres: ["جنایی", "درام"],
    description: "روایتی از زندگی یک آدمکش حرفه‌ای و ارتباط او با چهره‌های مشهور دنیای جرم.",
    director: "Martin Scorsese",
    gradient: "linear-gradient(145deg,#57534e,#292524 55%,#0c0a09)",
    sources: [
      {
        name: "آرشیو نمونه اول",
        description: "منبع اول",
        links: [
          { quality: "WEB-DL 1080p", format: "MKV", size: "نامشخص", language: "زبان اصلی", status: "available", url: "" }
        ]
      }
    ]
  }
];

const series = [
  {
    id: 101,
    type: "series",
    title: "بریکینگ بد",
    original: "Breaking Bad",
    year: 2008,
    rating: "9.5",
    country: "آمریکا",
    genres: ["جنایی", "درام"],
    description: "یک معلم شیمی پس از ابتلا به بیماری، وارد دنیای تولید مواد مخدر می‌شود.",
    director: "Vince Gilligan",
    gradient: "linear-gradient(145deg,#65a30d,#365314 55%,#111827)",
    seasons: 5,
    episodes: 62,
    sources: [
      {
        name: "آرشیو نمونه اول",
        description: "منبع اول · مجموعه کامل",
        links: [
          { quality: "Season 1–5 / 1080p", format: "MKV", size: "نامشخص", language: "زبان اصلی", status: "available", url: "" }
        ]
      }
    ]
  },
  {
    id: 102,
    type: "series",
    title: "آخرین بازمانده از ما",
    original: "The Last of Us",
    year: 2023,
    rating: "8.5",
    country: "آمریکا",
    genres: ["درام", "ماجراجویی"],
    description: "در جهانی پساآخرالزمانی، دو بازمانده سفری خطرناک را آغاز می‌کنند.",
    director: "Craig Mazin",
    gradient: "linear-gradient(145deg,#4d7c0f,#14532d 55%,#111827)",
    seasons: 2,
    episodes: 16,
    sources: [
      {
        name: "آرشیو نمونه اول",
        description: "منبع اول",
        links: [
          { quality: "Season 1 / 1080p", format: "MKV", size: "نامشخص", language: "زبان اصلی", status: "available", url: "" }
        ]
      }
    ]
  },
  {
    id: 103,
    type: "series",
    title: "دارک",
    original: "Dark",
    year: 2017,
    rating: "8.7",
    country: "آلمان",
    genres: ["معمایی", "علمی تخیلی"],
    description: "ناپدیدشدن یک کودک، چهار خانواده را وارد رازهایی پیچیده می‌کند.",
    director: "Baran bo Odar",
    gradient: "linear-gradient(145deg,#1d4ed8,#312e81 55%,#020617)",
    seasons: 3,
    episodes: 26,
    sources: [
      {
        name: "آرشیو نمونه اول",
        description: "منبع اول · مجموعه کامل",
        links: [
          { quality: "Complete Series / 1080p", format: "MKV", size: "نامشخص", language: "زبان اصلی", status: "unknown", url: "" }
        ]
      }
    ]
  },
  {
    id: 104,
    type: "series",
    title: "سوپرانوها",
    original: "The Sopranos",
    year: 1999,
    rating: "9.2",
    country: "آمریکا",
    genres: ["جنایی", "درام"],
    description: "زندگی شخصی و حرفه‌ای یک رئیس مافیا در نیوجرسی.",
    director: "David Chase",
    gradient: "linear-gradient(145deg,#78716c,#292524 55%,#0c0a09)",
    seasons: 6,
    episodes: 86,
    sources: [
      {
        name: "آرشیو نمونه اول",
        description: "منبع اول",
        links: [
          { quality: "Complete Series / 1080p", format: "MKV", size: "نامشخص", language: "زبان اصلی", status: "available", url: "" }
        ]
      }
    ]
  },
  {
    id: 105,
    type: "series",
    title: "سرقت پول",
    original: "Money Heist",
    year: 2017,
    rating: "8.2",
    country: "اسپانیا",
    genres: ["اکشن", "جنایی"],
    description: "گروهی از سارقان با برنامه‌ای پیچیده دست به سرقتی بزرگ می‌زنند.",
    director: "Álex Pina",
    gradient: "linear-gradient(145deg,#dc2626,#7f1d1d 55%,#111827)",
    seasons: 5,
    episodes: 41,
    sources: [
      {
        name: "آرشیو نمونه اول",
        description: "منبع اول",
        links: [
          { quality: "Complete Series / 1080p", format: "MKV", size: "نامشخص", language: "دوبله فارسی", status: "available", url: "" }
        ]
      }
    ]
  },
  {
    id: 106,
    type: "series",
    title: "شرلوک",
    original: "Sherlock",
    year: 2010,
    rating: "9.1",
    country: "بریتانیا",
    genres: ["جنایی", "معمایی"],
    description: "بازآفرینی مدرن داستان‌های شرلوک هولمز در لندن امروزی.",
    director: "Mark Gatiss",
    gradient: "linear-gradient(145deg,#0e7490,#164e63 55%,#111827)",
    seasons: 4,
    episodes: 13,
    sources: [
      {
        name: "آرشیو نمونه اول",
        description: "منبع اول",
        links: [
          { quality: "Complete Series / 1080p", format: "MKV", size: "نامشخص", language: "زبان اصلی", status: "available", url: "" }
        ]
      }
    ]
  }
];

const allTitles = [...movies, ...series];

/* ----------------------------------
   STATE
---------------------------------- */

const pageNames = ["home", "movies", "series", "search", "detail"];

const state = {
  currentPage: "home",
  previousPage: "home",
  selectedGenre: {
    movies: "",
    series: ""
  },
  selectedTitle: null
};

/* ----------------------------------
   HELPERS
---------------------------------- */

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return entities[character];
  });
}

function safeURL(value) {
  if (!value) return "";

  try {
    const url = new URL(value, window.location.href);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
}

function getDataset(type) {
  return type === "movie" ? movies : series;
}

function getTypePage(type) {
  return type === "movie" ? "movies" : "series";
}

function getTypeLabel(type) {
  return type === "movie" ? "فیلم" : "سریال";
}

function getAllGenres(dataset) {
  return [...new Set(dataset.flatMap(item => item.genres || []))]
    .sort((a, b) => a.localeCompare(b, "fa"));
}

/* ----------------------------------
   NAVIGATION
---------------------------------- */

function navigate(page) {
  if (!pageNames.includes(page)) return;

  state.currentPage = page;

  document.querySelectorAll(".page").forEach(section => {
    section.classList.toggle("active", section.id === `page-${page}`);
  });

  document.querySelectorAll("[data-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function setupNavigation() {
  document.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();

      const page = button.dataset.page;

      if (page === "movies" || page === "series") {
        updateCatalog(page);
      }

      navigate(page);
    });
  });

  document.getElementById("detail-back").addEventListener("click", () => {
    navigate(state.previousPage || "home");
  });

  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      navigate("search");
      document.getElementById("global-search").focus();
    }

    if (event.key === "Escape" && state.currentPage === "detail") {
      navigate(state.previousPage || "home");
    }
  });
}

/* ----------------------------------
   MOVIE CARDS
---------------------------------- */

function createMovieCard(item) {
  const typeLabel = item.type === "movie" ? "FILM" : "SERIES";

  return `
    <article
      class="movie-card"
      data-id="${item.id}"
      tabindex="0"
      role="button"
      aria-label="${escapeHTML(item.title)}"
    >
      <div class="poster" style="--poster-gradient:${escapeHTML(item.gradient)}">
        <span class="poster-year">${escapeHTML(item.year)}</span>
        <span class="poster-type">${typeLabel}</span>
        <span class="poster-title">${escapeHTML(item.original)}</span>
      </div>

      <div class="movie-info">
        <div class="movie-title">${escapeHTML(item.title)}</div>
        <div class="movie-subtitle">${escapeHTML(item.original)}</div>

        <div class="movie-card-meta">
          <span class="movie-rating">★ ${escapeHTML(item.rating)}</span>
          <span class="movie-kind">${getTypeLabel(item.type)}</span>
        </div>
      </div>
    </article>
  `;
}

function renderGrid(elementId, items) {
  const element = document.getElementById(elementId);
  if (!element) return;

  if (!items.length) {
    element.innerHTML = `
      <div class="empty-state">
        <strong>موردی پیدا نشد</strong>
        <p>عبارت یا فیلتر دیگری را امتحان کن.</p>
      </div>
    `;
    return;
  }

  element.innerHTML = items.map(createMovieCard).join("");

  element.querySelectorAll(".movie-card").forEach(card => {
    const open = () => openDetails(Number(card.dataset.id));

    card.addEventListener("click", open);

    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  });
}

/* ----------------------------------
   GENRE SIDEBARS
---------------------------------- */

function renderGenreButtons(containerId, dataset, type) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const genres = getAllGenres(dataset);
  const selected = state.selectedGenre[type];

  const allButton = `
    <button
      class="genre-button ${selected === "" ? "active" : ""}"
      data-genre=""
      data-genre-type="${type}"
    >
      <span>همه ژانرها</span>
      <span class="genre-count">${dataset.length}</span>
    </button>
  `;

  const genreButtons = genres.map(genre => {
    const count = dataset.filter(item => item.genres.includes(genre)).length;

    return `
      <button
        class="genre-button ${selected === genre ? "active" : ""}"
        data-genre="${escapeHTML(genre)}"
        data-genre-type="${type}"
      >
        <span>${escapeHTML(genre)}</span>
        <span class="genre-count">${count}</span>
      </button>
    `;
  }).join("");

  container.innerHTML = allButton + genreButtons;

  container.querySelectorAll("[data-genre]").forEach(button => {
    button.addEventListener("click", () => {
      const genre = button.dataset.genre;

      state.selectedGenre[type] = genre;

      renderAllGenres();

      const page = type === "movies" ? "movies" : "series";
      updateCatalog(page);
      navigate(page);
    });
  });
}

function renderAllGenres() {
  renderGenreButtons("movie-genres", movies, "movies");
  renderGenreButtons("series-genres", series, "series");
  renderGenreButtons("catalog-movie-genres", movies, "movies");
  renderGenreButtons("catalog-series-genres", series, "series");
}

/* ----------------------------------
   CATALOG FILTERS
---------------------------------- */

function getCatalogResults(type) {
  const dataset = type === "movies" ? movies : series;

  const searchId = type === "movies" ? "movie-search" : "series-search";
  const yearId = type === "movies" ? "movie-year" : "series-year";

  const query = document.getElementById(searchId).value
    .trim()
    .toLocaleLowerCase("fa");

  const year = document.getElementById(yearId).value;
  const genre = state.selectedGenre[type];

  return dataset.filter(item => {
    const searchable = [
      item.title,
      item.original,
      String(item.year),
      ...(item.genres || [])
    ].join(" ").toLocaleLowerCase("fa");

    const matchesSearch = !query || searchable.includes(query);
    const matchesYear = !year || String(item.year) === year;
    const matchesGenre = !genre || item.genres.includes(genre);

    return matchesSearch && matchesYear && matchesGenre;
  });
}

function updateCatalog(type) {
  const results = getCatalogResults(type);

  const isMovie = type === "movies";

  const gridId = isMovie ? "movies-grid" : "series-grid";
  const countId = isMovie ? "movie-count" : "series-count";
  const filterId = isMovie ? "movie-active-filter" : "series-active-filter";

  renderGrid(gridId, results);

  document.getElementById(countId).textContent = `${results.length} عنوان`;

  const selectedGenre = state.selectedGenre[type];
  const filterElement = document.getElementById(filterId);

  filterElement.innerHTML = selectedGenre
    ? `
      <button class="filter-chip" id="clear-genre-filter">
        ${escapeHTML(selectedGenre)} <span>×</span>
      </button>
    `
    : "";

  const clearButton = document.getElementById("clear-genre-filter");

  if (clearButton) {
    clearButton.addEventListener("click", () => {
      state.selectedGenre[type] = "";
      renderAllGenres();
      updateCatalog(type);
    });
  }
}

function setupCatalogFilters() {
  document.getElementById("movie-search").addEventListener("input", () => {
    updateCatalog("movies");
  });

  document.getElementById("movie-year").addEventListener("change", () => {
    updateCatalog("movies");
  });

  document.getElementById("series-search").addEventListener("input", () => {
    updateCatalog("series");
  });

  document.getElementById("series-year").addEventListener("change", () => {
    updateCatalog("series");
  });
}

/* ----------------------------------
   SEARCH
---------------------------------- */

function searchTitles(query) {
  const normalized = query.trim().toLocaleLowerCase("fa");

  if (!normalized) return [];

  return allTitles.filter(item => {
    const searchable = [
      item.title,
      item.original,
      String(item.year),
      ...(item.genres || [])
    ].join(" ").toLocaleLowerCase("fa");

    return searchable.includes(normalized);
  });
}

function setupSearch() {
  const input = document.getElementById("global-search");

  input.addEventListener("input", () => {
    const query = input.value;
    const results = searchTitles(query);

    renderGrid("search-grid", results);

    document.getElementById("search-count").textContent =
      query.trim() ? `${results.length} نتیجه` : "";

    document.getElementById("search-empty").style.display =
      query.trim() && results.length ? "none" : "flex";

    if (!query.trim()) {
      document.getElementById("search-grid").innerHTML = "";
      document.getElementById("search-empty").style.display = "flex";
    }
  });
}

/* ----------------------------------
   DETAILS PAGE
---------------------------------- */

function createSourceHTML(source, index) {
  const links = Array.isArray(source.links) ? source.links : [];

  const linksHTML = links.map(link => {
    const url = safeURL(link.url);
    const available = link.status === "available" && Boolean(url);

    const action = available
      ? `<a class="download-action available" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">دریافت لینک ↗</a>`
      : `<span class="download-action disabled">لینک ثبت نشده</span>`;

    return `
      <div class="download-row">
        <div class="download-info">
          <strong>${escapeHTML(link.quality || "کیفیت نامشخص")}</strong>
          <small>
            ${escapeHTML(link.format || "فرمت نامشخص")}
            · ${escapeHTML(link.size || "حجم نامشخص")}
            · ${escapeHTML(link.language || "زبان نامشخص")}
          </small>
        </div>
        ${action}
      </div>
    `;
  }).join("");

  return `
    <details class="source-accordion" ${index === 0 ? "open" : ""}>
      <summary>
        <span class="source-name">
          <strong>${escapeHTML(source.name || `سرور ${index + 1}`)}</strong>
          <small>${escapeHTML(source.description || "منبع دانلود")}</small>
        </span>
        <span class="source-count">${links.length} نسخه</span>
      </summary>

      <div class="source-links">
        ${linksHTML || `<div class="no-sources">هنوز نسخه‌ای برای این منبع ثبت نشده است.</div>`}
      </div>
    </details>
  `;
}

function createDetailsHTML(item) {
  const isMovie = item.type === "movie";

  const genresHTML = (item.genres || []).map(genre => `
    <span class="detail-genre">${escapeHTML(genre)}</span>
  `).join("");

  const metaHTML = `
    <span class="detail-meta-item"><strong>سال:</strong>${escapeHTML(item.year)}</span>
    <span class="detail-meta-item"><strong>کشور:</strong>${escapeHTML(item.country || "نامشخص")}</span>
    ${isMovie
      ? `<span class="detail-meta-item"><strong>مدت:</strong>${escapeHTML(item.duration || "نامشخص")}</span>`
      : `<span class="detail-meta-item"><strong>فصل:</strong>${escapeHTML(item.seasons || "نامشخص")}</span>
         <span class="detail-meta-item"><strong>قسمت:</strong>${escapeHTML(item.episodes || "نامشخص")}</span>`
    }
  `;

  const sources = Array.isArray(item.sources) ? item.sources : [];

  const sourcesHTML = sources.length
    ? sources.map(createSourceHTML).join("")
    : `<div class="no-sources">هنوز منبع دانلودی برای این عنوان ثبت نشده است.</div>`;

  return `
    <div class="detail-hero">
      <div class="detail-poster" style="--poster-gradient:${escapeHTML(item.gradient)}">
        <span>${escapeHTML(item.original)}</span>
      </div>

      <div class="detail-info">
        <span class="detail-type">${isMovie ? "MOVIE" : "TV SERIES"}</span>

        <h1>${escapeHTML(item.title)}</h1>
        <div class="detail-original">${escapeHTML(item.original)}</div>

        <div class="detail-rating">
          ★ ${escapeHTML(item.rating)}
          <small>امتیاز نمونه</small>
        </div>

        <div class="detail-meta">
          ${metaHTML}
        </div>

        <div class="detail-genres">
          ${genresHTML}
        </div>

        <p class="detail-description">
          ${escapeHTML(item.description || "توضیحی برای این عنوان ثبت نشده است.")}
        </p>
      </div>
    </div>

    <section class="detail-section">
      <div class="detail-section-heading">
        <div>
          <h2>مشخصات ${isMovie ? "فیلم" : "سریال"}</h2>
          <p>اطلاعات ثبت‌شده برای این عنوان</p>
        </div>
        <span class="section-number">01</span>
      </div>

      <div class="detail-facts">
        <div class="fact-item">
          <span>نام اصلی</span>
          <strong>${escapeHTML(item.original)}</strong>
        </div>

        <div class="fact-item">
          <span>سال انتشار</span>
          <strong>${escapeHTML(item.year)}</strong>
        </div>

        <div class="fact-item">
          <span>کارگردان</span>
          <strong>${escapeHTML(item.director || "نامشخص")}</strong>
        </div>

        <div class="fact-item">
          <span>کشور سازنده</span>
          <strong>${escapeHTML(item.country || "نامشخص")}</strong>
        </div>

        ${isMovie ? `
          <div class="fact-item">
            <span>مدت زمان</span>
            <strong>${escapeHTML(item.duration || "نامشخص")}</strong>
          </div>
        ` : `
          <div class="fact-item">
            <span>تعداد فصل‌ها</span>
            <strong>${escapeHTML(item.seasons || "نامشخص")}</strong>
          </div>
          <div class="fact-item">
            <span>تعداد قسمت‌ها</span>
            <strong>${escapeHTML(item.episodes || "نامشخص")}</strong>
          </div>
        `}
      </div>
    </section>

    <section class="detail-section">
      <div class="detail-section-heading">
        <div>
          <h2>لینک‌های دانلود</h2>
          <p>منابع مختلف و نسخه‌های موجود برای این عنوان</p>
        </div>
        <span class="section-number">02</span>
      </div>

      <p class="download-intro">
        هر آرشیو به‌صورت جداگانه نمایش داده می‌شود.
        برای دیدن نسخه‌های هر منبع، روی نام آن کلیک کن.
        لینک‌های این نسخه آزمایشی واقعی نیستند.
      </p>

      ${sourcesHTML}
    </section>
  `;
}

function openDetails(id) {
  const item = allTitles.find(title => title.id === id);
  if (!item) return;

  if (state.currentPage !== "detail") {
    state.previousPage = state.currentPage;
  }

  state.selectedTitle = item;

  document.getElementById("detail-content").innerHTML = createDetailsHTML(item);

  document.title = `${item.title} | Flicksy`;

  navigate("detail");
}

/* ----------------------------------
   INITIALIZATION
---------------------------------- */

function initialize() {
  renderGrid("latest-movies-grid", movies.slice(0, 4));
  renderGrid("latest-series-grid", series.slice(0, 4));

  renderGrid("movies-grid", movies);
  renderGrid("series-grid", series);

  renderAllGenres();

  setupNavigation();
  setupCatalogFilters();
  setupSearch();

  updateCatalog("movies");
  updateCatalog("series");

  document.getElementById("search-empty").style.display = "flex";
}

document.addEventListener("DOMContentLoaded", initialize);