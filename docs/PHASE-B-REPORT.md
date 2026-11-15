# Phase B — local SQLite importer + lightweight MVP (report)

Work is local only: nothing was pushed, deployed or created on Cloudflare; the main Flicksy repo was never touched;
`data/archive.json` is unchanged (SHA-256 `dfe3001c…26c9` before and after every run).

## Decisions (as approved)
* Architecture B; SQLite is the primary DB for the local MVP; archive immutable; seasons/episodes extra data only via overlay files; no D1; links stay local.
* New code lives in the package `flicksy_dl/`; `server.py` (Phase 1) and the old frontend are untouched and still work (all 146 Phase-1 tests still pass).

## Minimum schema (`flicksy_dl/schema.sql`, version 1)
`media` (movie+series, one row each, ids unique across kinds), `media_raw` (the complete original record as JSON — unknown fields cannot be lost),
`genres/countries` + link tables, `external_ids` (empty: the archive has no IMDb/TMDB ids; its `imdb` field is a *score*), `seasons`, `episodes`
(`origin` = `archive` or `overlay:<file>`), `links` (one row per file URL: quality, resolution, source tag, codec, audio, subtitle kind, group, size,
host = actual hosting provider, `status`, `last_checked`, `ambiguous`), `link_checks` (history, empty for now), `import_runs`, `search_fts` (FTS5, Persian-normalised).
Duplicate titles are **flagged** through a shared `dup_key` (normalised title|year), never merged.

## Overlays (`data/overlay/`, all optional, never replace archive rows)
`seasons.json` (`{"<media id>": [season…]}` same shape as archive `seasons`), `link-status.json` (see `fixtures/link-status.demo.json`, demo only), `external-ids.json`.
Conflicting ids are skipped and reported; unknown media ids are reported as orphans.

## Real import result (actual run, 6–7 s)
| | |
|---|---|
| movies / series | 20,524 / 9,544 (= archive) |
| records identical to archive (every record compared) | all 30,068 |
| seasons / episodes (MobLand 27965) | 2 / 20 (11 + 9 episodes), 58 episode links |
| archive links | 54,134 movie + 58 episode = 54,192 (1 without http scheme: movie 2204, kept in DB, hidden from API) |
| scan links (local TSV) | 23,470 parsed of 24,386 lines; 21,406 attached; 2,651 unmatched; 587 attached with an "ambiguous" flag |
| possible duplicate titles | 254 groups / 513 records by title+year (1,358 groups by title only); none merged |
| DB size | ≈206 MB (local, git-ignored, rebuildable) |
| link status | all 75,598 `unverified` (no check was run — no network checks were made) |

## Tests (actual: `python -m pytest` → 162 passed)
146 earlier tests + 16 new (`tests/test_mvp.py`): record preservation incl. unknown fields; counts; movie/series separation; duplicate flagging; invalid-link hiding; trailing-tab URL handling;
release parsing; seasons/episodes; overlay add-without-replace/conflict/orphan; link-status overlay; scan matching + ambiguity; failed import keeps the previous DB;
API list/search/filter/pagination/errors/Host guard/hidden links; and a full real-archive import test (MobLand seasons, search by Latin and Persian title, movie 2204).
Browser check (headless Chromium, real DB) of the owner's design (`fixtures/design-prototype/` = original mock prototype, wired to the real API): home (4+4 latest, genre counts, real totals), catalog paging (24 → 48), year and genre filters, series search, MobLand detail with 2 season tabs / 9 episodes, movie detail with 4 releases and status badges, global search (Ctrl+K, Persian title), browser Back, 390 px mobile layout without horizontal scroll, no console errors.

UI note: Vazirmatn/Manrope fonts are loaded from Google Fonts by the browser (as in the owner's design); without internet the system font is used.

## Known limitations
* Link statuses are never checked yet (planned: lightweight checker, GET `Range: bytes=0-0` fallback when HEAD is unsupported).
* Only MobLand has stored seasons; other series show scan-derived seasons/episodes when scan links match, otherwise "no seasons".
* Scan matching is by normalised Latin title (+year ±1 for movies) like the old server; ambiguous matches are flagged, not guessed. Non-Latin titles cannot match scan links.
* Poster images are loaded from their original third-party hosts by the browser (blank placeholder offline).
* Search is title/Persian-title/people only (no description search); no sort options besides newest-first (search: relevance).
* No catalog sync, adapters or GitHub-Release packaging yet (interfaces only described in Phase A).

## Deferred on purpose
Adapters/sync/automation, static-bundle generator (Architecture B publishing step), Worker/D1, link checker, accounts/social features.

## یافته کیفیت داده: رکوردهای اطلاعیه
۵ رکورد آرشیو (مثل ids 35871, 35849, 35848, 35835, 31167) در واقع اطلاعیهٔ نسخهٔ نرم‌افزار هستند، با حدود ۵۰ ژانر و امتیاز ۱۰. این رکوردها حذف نشده‌اند (آرشیو دست‌نخورده است)، ولی `/api/v2/featured` رکوردهای با بیش از ۱۵ ژانر را نشان نمی‌دهد. این ۵ رکورد شمارش هر ژانر را هم یکی بالا می‌برند.
