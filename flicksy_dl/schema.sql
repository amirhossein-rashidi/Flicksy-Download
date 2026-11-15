-- Flicksy-Download local MVP schema (SQLite). Version 1.
-- The database is DERIVED data: it can always be rebuilt from data/archive.json (+ overlays).
-- Nothing here is ever written back to the archive.

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Canonical title (movie or series). id is the archive id (ids are unique across both kinds).
CREATE TABLE media (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('movie','series')),
  title         TEXT NOT NULL,           -- original/Latin title as in the archive
  title_fa      TEXT,                    -- parsed from description (نام پارسی)
  other_titles  TEXT,                    -- parsed (سایر عناوین)
  year          INTEGER,                 -- NULL when archive has none/0
  imdb_score    REAL,                    -- archive field "imdb" (it is a score, NOT an IMDb id)
  site_rating   REAL,                    -- archive field "rating"
  duration_text TEXT,
  classification TEXT,
  director      TEXT,
  stars         TEXT,
  synopsis      TEXT,                    -- parsed (خلاصه داستان); the full original description lives in media_raw
  image         TEXT,
  cover         TEXT,
  genre_ids     TEXT NOT NULL DEFAULT '',-- ",10,12," (fast filter without a scan)
  genre_names   TEXT NOT NULL DEFAULT '',
  country_names TEXT NOT NULL DEFAULT '',
  link_count    INTEGER NOT NULL DEFAULT 0,
  dup_key       TEXT                     -- normalised title|year; shared key = possible duplicate (flag only, never merged)
);
CREATE INDEX media_kind_year ON media(kind, year DESC, id DESC);
CREATE INDEX media_kind_id   ON media(kind, id DESC);
CREATE INDEX media_dup       ON media(dup_key);

-- Every original record, complete and unchanged (unknown fields included).
CREATE TABLE media_raw (media_id INTEGER PRIMARY KEY, json TEXT NOT NULL);

CREATE TABLE genres    (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
CREATE TABLE countries (id INTEGER PRIMARY KEY, title TEXT NOT NULL, image TEXT);
CREATE TABLE media_genres    (media_id INTEGER NOT NULL, genre_id INTEGER NOT NULL, PRIMARY KEY (media_id, genre_id)) WITHOUT ROWID;
CREATE INDEX media_genres_g ON media_genres(genre_id, media_id);
CREATE TABLE media_countries (media_id INTEGER NOT NULL, country_id INTEGER NOT NULL, PRIMARY KEY (media_id, country_id)) WITHOUT ROWID;

-- External ids (IMDb/TMDB...). The archive has none; filled by future catalog sources.
CREATE TABLE external_ids (
  media_id INTEGER NOT NULL, provider TEXT NOT NULL, value TEXT NOT NULL, source TEXT,
  PRIMARY KEY (media_id, provider, value)
) WITHOUT ROWID;

-- Seasons / episodes. origin: 'archive' (inside archive.json "seasons") or 'overlay:<file>'.
CREATE TABLE seasons (
  id INTEGER PRIMARY KEY, media_id INTEGER NOT NULL, position INTEGER NOT NULL,
  number INTEGER, title TEXT, origin TEXT NOT NULL, raw TEXT NOT NULL
);
CREATE INDEX seasons_media ON seasons(media_id, position);
CREATE TABLE episodes (
  id INTEGER PRIMARY KEY, season_id INTEGER NOT NULL, media_id INTEGER NOT NULL, position INTEGER NOT NULL,
  number INTEGER, title TEXT, description TEXT, duration_text TEXT, origin TEXT NOT NULL, raw TEXT NOT NULL
);
CREATE INDEX episodes_season ON episodes(season_id, position);

-- Download/watch links = "releases/file versions". One row per file URL.
-- status: 'unverified' (never checked or check inconclusive) | 'working' | 'unavailable'.
CREATE TABLE links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id INTEGER NOT NULL, season_id INTEGER, episode_id INTEGER,
  season_no INTEGER, episode_no INTEGER,  -- set for scan links (matched by numbers, not by id)
  origin TEXT NOT NULL,                -- 'archive' | 'scan:<file>'
  origin_ref TEXT,                     -- archive source id, or sha1(url) for scan rows
  quality_text TEXT, container TEXT,
  resolution INTEGER, source_tag TEXT, codec TEXT, audio TEXT, subtitle TEXT, release_group TEXT,
  release_name TEXT, size_bytes INTEGER,
  url TEXT NOT NULL,                   -- exactly as found (never altered)
  url_clean TEXT,                      -- trimmed, NULL when not an http(s) link
  url_valid INTEGER NOT NULL,          -- 1 only if http(s) -> may be shown as a link
  host TEXT,                           -- actual hosting provider (hostname)
  ambiguous INTEGER NOT NULL DEFAULT 0,-- scan match shared by several titles (flagged, not guessed)
  status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified','working','unavailable')),
  last_checked TEXT, last_http_status INTEGER
);
CREATE INDEX links_media   ON links(media_id);
CREATE INDEX links_episode ON links(episode_id);
CREATE INDEX links_origin  ON links(origin, origin_ref);
CREATE INDEX links_dupurl  ON links(url_clean);

CREATE TABLE link_checks (id INTEGER PRIMARY KEY, link_id INTEGER NOT NULL, checked_at TEXT NOT NULL, result TEXT NOT NULL, http_status INTEGER, note TEXT);

CREATE TABLE import_runs (
  id INTEGER PRIMARY KEY, started_at TEXT, finished_at TEXT, archive_sha256 TEXT, schema_version INTEGER, summary TEXT
);

-- Title search (normalised text; rowid = media.id).
CREATE VIRTUAL TABLE search_fts USING fts5(title, title_fa, extra, tokenize='unicode61 remove_diacritics 2', prefix='2 3');
