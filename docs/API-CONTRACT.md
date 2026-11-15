# Local API contract — `/api/v2` (MVP, read-only)

Same contract is meant to be served later by a Worker/static bundle and consumed by Flicksy. The web UI uses it only
through `flicksy_dl/web/api-client.js`. All responses: `{"success": true, ...}` or `{"success": false, "error": CODE, "message": "..."}`.

| Method + path | Parameters | Result |
|---|---|---|
| `GET /api/v2/health` | – | `schemaVersion`, `archiveSha256`, `importedAt`, `counts{movies,series,seasons,episodes,links}` |
| `GET /api/v2/facets` | – | `kinds[]`, `genres[{id,title}]`, `genresByKind{movie|series:[{id,title,count}]}`, `totals{movie,series}`, `yearMin`, `yearMax`, `linkStatuses[]` |
| `GET /api/v2/featured` | `limit` (1–30, default 12) | `items[]` (summary): newest titles with a poster and IMDb score ≥ 6 (home carousel) |
| `GET /api/v2/titles` | `q` (≤100 chars, Persian/Latin, prefix search), `kind` (`movie`/`series`), `year`, `genre` (id), `limit` (1–60, default 24), `offset` | `items[]` (summary), `limit`, `offset`, `hasMore` (no COUNT is computed) |
| `GET /api/v2/titles/{id}` | – | `title` = summary + details + `genreList`, `externalIds`, `possibleDuplicates`, `hiddenInvalidLinks`; movie: `releases[]`; series: `seasons[{id,number,title,origin,episodes[{id,number,title,links[]}]}]` |

Summary item: `id, kind, title, titleFa, year, imdbScore, image, genres, countries, linkCount`.

Link (release/file version): `id, origin (archive|scan), qualityText, container, resolution, sourceTag, codec, audio, subtitle, releaseGroup, releaseName, sizeBytes, host, status, lastChecked, ambiguousMatch, url`.

* `status` is exactly one of `working` | `unavailable` | `unverified`. Everything is `unverified` until a real check result is recorded; an inconclusive check must stay `unverified` (a failed HEAD request is not proof of "unavailable").
* `url` is `null` when the server runs with `FLICKSY_EXPOSE_LINKS=0`. Links without an http(s) scheme are never returned (counted in `hiddenInvalidLinks`).
* Errors: `BAD_PARAMETER` 400, `NOT_FOUND` 404, `HOST_NOT_ALLOWED` 403 (non-local `Host` header), `INTERNAL_ERROR` 500 (no internals in the message).
* Download links stay private/local: this API must not be exposed publicly or turned into public static files until link publication permission is verified.
