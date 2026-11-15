# Phase 1 — functionality inventory, change list and compatibility checklist

Baseline: the owner's original `server.py` (693 lines, SHA-256 `6b1decff59975e77f0b784830e60386c8bab08919ddc667480dd21507226522f`).
Approach: **incremental edits to the original file.** No rewrite. Business logic (scan parsing, series/season
assembly, metadata, identifiers, path handling, static files) is left as it is.

## 1. What the original `server.py` contains

### 1.1 HTTP routes (all `GET`)

| Route | Function | What it does | Network use in original |
|---|---|---|---|
| `/api/v1/health` | `health` | Counts of movies/series, `dataFile` path | none |
| `/api/v1/providers` | `providers` | Fixed list: one provider "Local JSON" | none |
| `/api/v1/providers/sermovie/list?path=` | `list_dir` | `/` → Movies, Series; `/Movies/` → years; `/Movies/<year>/` → titles. With `mode=online`: `/Movies/` → pages p1..p30, `/Movies/pN/` → live titles | online only |
| `/api/v1/providers/sermovie/movie?path=` | `movie` | One movie: metadata + download links (archive `sources` + scan TSV links) | online only (live item lookup) |
| `/api/v1/providers/sermovie/series?path=` | `series` | One series: metadata + seasons + episodes + links (archive seasons + scan TSV) | **offline too**: fetches missing seasons live, then **writes them into `archive.json`** |
| `/api/v1/providers/sermovie/file-info?path=` | `file_info` | File size via `Range: bytes=0-0` request to the real download URL | **always** (any mode) |
| `/` , `/app.js`, `/<path>` | `index`, `appjs`, `static_files` | Serves the web UI; `/app.js` has `API_BASE` rewritten to `""` | none |

There is **no search route**. "Search" in the UI is client-side filtering of the entries returned by `list`
(`entries.filter(...)` in `app.js`). It keeps working as long as `list` output is unchanged.

### 1.2 Functions and global state

- Scan links (`data/scan-*.tsv`): `norm_title`, `strip_year`, `parse_scan`, `load_scan`, `scan_movie_entries`,
  `scan_series_map`, `scan_download`, regexes, `SCAN` cache (reloaded when file mtime changes).
- JSON archive: `find_json`, `get_db` (reload on mtime change), `_cache`.
- Live fetching: `fetch_json_live`, `fetch_seasons_live`, `live_page`, `find_live_item`, `is_online`, `save_seasons`,
  `LIVE_PAGE_CACHE`, `LIVE_ITEMS`.
- Helpers: `ok`, `fail`, `year_of`, `kind_of`, `digits`, `make_download`, `extras`, `identifiers`, `meta`,
  `archive_year`, `split_path`.
- Unbounded globals: `DL_URLS`, `SIZE_CACHE`, `LIVE_PAGE_CACHE` (never expires entries), `LIVE_ITEMS`.
- Dependencies: Flask only (plus standard library: json, os, re, sys, time, urllib, concurrent.futures).
- Startup: `--data DIR`, `--port N`; `app.run(host='0.0.0.0')`.

### 1.3 What the frontend depends on

The web UI (both the repo version and the ZIP version) reads: `success`, `error`, `message`, `directory.entries`,
`movie` / `series` objects (including `warnings`), `file.sizeBytes`, `downloads[].downloadUrl`, `ids[].url`.
It never reads `health.dataFile`. A failed `file-info` call (any non-2xx) is handled as "size unavailable".

## 2. Exact sections that change (and nothing else)

| # | Original lines | Change | Effect on existing behaviour |
|---|---|---|---|
| 1 | 11-18 | add `import urlguard`, `from boundedcache import ...` (`urllib.request` import removed once unused) | none |
| 2 | 25-33 | `KEY`, `BASE`, `HELPERS`, `PORT` read from environment; `KEY` has **no default**; add `MODE`, `HOST`; `LIVE_SEASONS` kept as a name but default `False` and only effective in online mode | secret removed; live features off unless configured |
| 3 | 37-39, 228-229 | `DL_URLS`, `SIZE_CACHE`, `LIVE_PAGE_CACHE`, `LIVE_ITEMS` become bounded caches with expiry. The page cache cap equals the old worst case (full scan of both kinds), so behaviour is unchanged | same data, now capped |
| 4 | 199 | `DL_URLS.clear()` stays valid (same method name on the bounded cache) | none |
| 5 | 207-218 | `fetch_json_live`: `urllib` call replaced by `urlguard.safe_fetch` (same fallback order: main server, then helpers; same 15 s class of limits) | same results; private/unsafe targets and unsafe redirects refused |
| 6 | 221-225, 228-244, 259 | cache reads/writes adapted to bounded-cache API | none |
| 7 | 277-278 | `is_online()`: requested **and** server allows it | offline server never goes online silently |
| 8 | 281-296 | `save_seasons` (writes into `archive.json`) is no longer called | original archive is never modified |
| 9 | 323-344 | `make_download`: store URL in bounded cache; a non-http(s) URL is not offered as a link (`downloadUrl` empty, `invalidUrl: true` added) | affects exactly **1 real record**: movie 2204, whose link text is `00MBhttp://peer…` (no scheme). Links with spaces, Persian letters or a trailing tab (about 500 real links) stay links, unchanged |
| 10 | 359-391 | `identifiers`: IMDb/TMDB link from data used only if http(s) | only affects invalid links |
| 11 | 513-517, 545-573 | `movie` / `series`: warning text added when the page asked for online but the server is offline; the automatic live-season fetch + save (lines 566-573) only runs if explicitly enabled and online | series without stored seasons now return no seasons offline (previously: internet fetch + write into archive) |
| 12 | 635-658 | `file_info`: uses `urlguard.safe_fetch` (surrounding whitespace/tab is stripped first, as `urllib` did); a failed lookup is remembered for 10 minutes instead of forever; offline → no request, returns an error the UI already handles | size lookup works online exactly as before; offline it is unavailable (it is not possible without the network) |
| 13 | 684-693 | bind `127.0.0.1` by default (`FLICKSY_HOST`), refuse non-local bind without explicit switch, `debug=False` | local use identical |
| 14 | new, additive | `before_request` Host-header check (only when bound to localhost), security headers, JSON error handler without internals | no route or field removed |
| 15 | 426-431 | `health`: `dataFile` shows file name only; adds `mode`, `networkEnabled` | `dataFile` unused by the UI; fields added |

Everything not listed above (scan parsing, season/episode assembly, `meta`, `list` entry format, static serving,
`app.js` rewrite) stays **byte-for-byte unchanged**.

## 3. Intentional behaviour differences (all were approved for Phase 1)

1. No outside request without explicit online mode (offline is real).
2. Missing seasons are no longer fetched/saved automatically (this was the old behaviour that wrote into `archive.json`).
3. `file-info` makes no request offline.
4. Unsafe URLs/redirects are refused; non-http(s) links are not offered.
5. The server listens on `127.0.0.1` only.

## 4. Compatibility results (real runs)

Tool: `python tests/compat/run_compat.py ORIGINAL_SERVER.py server.py data --sample 100000`.
It loads the original and the modified server, gives each its own copy of `data/`, replays the same requests
against both, and compares status code and JSON. The internet is replaced by the same fake in both cases
(the real network is never touched; any real connection attempt aborts the run).
The fake follows the real rules (it refuses URLs that real `urllib` refuses, and applies `urlguard`'s syntax
rules to the modified server), so it cannot hide a regression the way a lazy stub would.

Run on the real 72 MB archive and the real TSV, covering **every** movie and series:

| Group | Requests | Identical |
|---|---|---|
| health (common fields) | 1 | 1 |
| providers | 1 | 1 |
| list (root, categories, years, titles; what the UI search filters) | 29 | 29 |
| list with bad paths | 7 | 7 |
| movie: all 20,524 movies | 20,524 | 20,523 |
| series: all 9,544 series | 9,544 | 9,544 |
| movie/series with unknown ids or bad paths | 10 | 10 |
| file-info follow-ups (up to 2 links per movie/series) | 38,440 | 38,439 |
| file-info with unknown path | 2 | 2 |
| static files (`/`, `/app.js`, `/style.css`, `/index.html`, unknown) | 6 | 6 |
| online mode (live lists, live movie, live series) | 11 | 11 |

The only two differences are the approved one: movie 2204 (link without scheme is no longer offered) and the
`file-info` call for that same link (original: 502 size unavailable, modified: 404 not registered). The number of
outside requests was identical on both sides (38,029 each). The archive copy of the modified server and the real
`archive.json` kept SHA-256 `dfe3001c268c1a4173c00f4f5ba538c82efc88d912e1b6aac76d5cd0f17f26c9`.

Run with `LIVE_SEASONS` switched off on the original, so the one deliberate difference below does not hide others:

**Proven deliberate difference** (real series 35881, no stored seasons, page did not ask for online mode):

| | outside requests | archive.json changed | seasons returned |
|---|---|---|---|
| original (default settings) | 1 | **yes** | 1 |
| modified (default settings) | 0 | no | 0 |

Real process check: the modified server listens on `127.0.0.1` only (read from `/proc/net/tcp`); `FLICKSY_HOST=0.0.0.0`
is refused at start; a foreign `Host:` header gets 403.

Checklist:

- [x] `health` — same fields (plus `mode`); `dataFile` now shows the file name only.
- [x] `providers` — identical.
- [x] `list` (this is what search uses) — identical for every tested path, including bad ones.
- [x] `movie` — identical for 20,523 of 20,524 movies; the one difference is approved (record 2204).
- [x] `series` with stored seasons (including id 27965) — identical; season/episode data preserved.
- [x] `series` with scan-only links — identical.
- [x] `series` without stored seasons — differs only by the documented change (no automatic internet fetch/write).
- [x] `file-info` online (fake internet) — identical for 38,439 of 38,440; offline — no request, same error code (`SIZE_UNAVAILABLE`, 502) with a clear message.
- [x] Online mode (fake internet): list, movie, series — identical.
- [x] Static files — identical.
- [x] `archive.json` unchanged after every run.
- [ ] Not yet run: a real browser session against the modified server with the repo or ZIP frontend; real internet requests (none are made in testing by design).

## 5. Known limits (not changed in Phase 1)

- `file-info` still cannot work for links that contain a space inside the address (about 480 real links); the original
  could not either. Encoding the space would fix it; this is a possible follow-up, not done here.
- In online mode a series page asks the live server for fresh seasons on every view (the original did too).
- The local server still has no login; it is protected only by listening on `127.0.0.1` and the Host check.
