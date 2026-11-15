"""Archive -> SQLite importer.

    python -m flicksy_dl.importer [--archive data/archive.json] [--db data/flicksy.db] [--data-dir data]

Rules (all enforced + verified at the end):
  * the archive file is opened read-only; its SHA-256 is recorded and re-checked after the import;
  * every original record is stored COMPLETE as JSON in media_raw (unknown fields can never be lost);
  * seasons/episodes found in the archive are imported with origin='archive'; extra data comes only from
    overlay files in <data-dir>/overlay/ and never replaces archive rows;
  * the new database is built in a temporary file, validated, and only then replace the old one
    (a failed import leaves the previous valid database untouched).
"""
import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
from urllib.parse import urlsplit

from .linkcheck import has_http_scheme
from . import scan as scanmod
from .releaseparse import parse_release
from .textnorm import norm, parse_description

SCHEMA_VERSION = 1
HERE = os.path.dirname(os.path.abspath(__file__))
_ORD = {'اول': 1, 'دوم': 2, 'سوم': 3, 'چهارم': 4, 'پنجم': 5, 'ششم': 6, 'هفتم': 7, 'هشتم': 8, 'نهم': 9, 'دهم': 10}


class ImportErrorFatal(Exception):
    pass


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def _season_number(title, position):
    t = norm(title or '')
    m = re.search(r'فصل\s*(\d+)', t) or re.search(r'season\s*(\d+)', t)
    if m:
        return int(m.group(1))
    for word, n in _ORD.items():
        if 'فصل ' + word in t:
            return n
    return position + 1


def _episode_number(title):
    m = re.search(r'(?:قسمت|episode|ep)\s*(\d+)', norm(title or ''))
    return int(m.group(1)) if m else None


def _host(url_clean):
    try:
        h = (urlsplit(url_clean).hostname or '').lower().rstrip('.')
        return h or None
    except ValueError:
        return None


def _link_row(media_id, origin, ref, url, quality_text, container, size, season_id=None, episode_id=None,
              season_no=None, episode_no=None, ambiguous=0):
    valid = 1 if has_http_scheme(url) else 0
    clean = url.strip() if valid else None
    rel = parse_release(url if valid else '', quality_text, container)
    return (media_id, season_id, episode_id, season_no, episode_no, origin, ref, quality_text, container,
            rel['resolution'], rel['source_tag'], rel['codec'], rel['audio'], rel['subtitle'], rel['release_group'],
            rel['release_name'], size, url, clean, valid, _host(clean) if clean else None, ambiguous)


LINK_SQL = ('INSERT INTO links (media_id,season_id,episode_id,season_no,episode_no,origin,origin_ref,quality_text,container,'
            'resolution,source_tag,codec,audio,subtitle,release_group,release_name,size_bytes,url,url_clean,url_valid,host,ambiguous) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')


def _load_overlay(path):
    if not os.path.isfile(path):
        return None
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def build(archive_path, db_path, data_dir, log=print):
    t0 = time.time()
    started = time.strftime('%Y-%m-%dT%H:%M:%S')
    sha_before = sha256_file(archive_path)
    with open(archive_path, 'rb') as f:
        data = json.loads(f.read().decode('utf-8'))
    for k in ('movie', 'serie'):
        if not isinstance(data.get(k), dict):
            raise ImportErrorFatal("archive has no '%s' object" % k)
    movies, series = data['movie'], data['serie']
    overlap = set(movies) & set(series)
    if overlap:
        raise ImportErrorFatal('ids exist as both movie and series (%d, e.g. %s); refusing to merge them' % (len(overlap), sorted(overlap)[:3]))

    tmp = db_path + '.tmp'
    for p in (tmp, tmp + '-journal'):
        if os.path.exists(p):
            os.remove(p)
    con = sqlite3.connect(tmp)
    con.execute('PRAGMA journal_mode=OFF')
    con.execute('PRAGMA synchronous=OFF')
    with open(os.path.join(HERE, 'schema.sql'), encoding='utf-8') as f:
        con.executescript(f.read())
    notes = {'anomalies': [], 'overlay_conflicts': [], 'overlay_orphans': []}

    # ---- media + raw + genres/countries + search ----
    genres, countries = {}, {}
    for kind, src in (('movie', movies), ('series', series)):
        rows, raws, mg, mc, fts = [], [], [], [], []
        for key, it in src.items():
            try:
                mid = int(it['id'])
            except (KeyError, TypeError, ValueError):
                raise ImportErrorFatal('record %r has no integer id' % key)
            if str(mid) != str(key):
                notes['anomalies'].append('key %s != id %s' % (key, mid))
            d = parse_description(it.get('description'))
            year = it.get('year') if isinstance(it.get('year'), int) and it.get('year') > 0 else None
            gl = [g for g in (it.get('genres') or []) if isinstance(g, dict) and 'id' in g]
            cl = [c for c in (it.get('country') or []) if isinstance(c, dict) and 'id' in c]
            for g in gl:
                genres[g['id']] = g.get('title') or ''
                mg.append((mid, g['id']))
            for c in cl:
                countries[c['id']] = (c.get('title') or '', c.get('image'))
                mc.append((mid, c['id']))
            title = it.get('title') or ''
            dup_key = '%s|%s' % (scanmod.strip_year(norm(title)) or ('id%d' % mid), year or '')
            rows.append((mid, kind, title, d.get('title_fa'), d.get('other_titles'), year,
                         it.get('imdb') if isinstance(it.get('imdb'), (int, float)) else None,
                         it.get('rating') if isinstance(it.get('rating'), (int, float)) else None,
                         it.get('duration'), it.get('classification'), d.get('director'), d.get('stars'),
                         d.get('synopsis'), it.get('image'), it.get('cover'),
                         ',' + ','.join(str(g['id']) for g in gl) + ',' if gl else '',
                         '، '.join(g.get('title') or '' for g in gl), '، '.join(c.get('title') or '' for c in cl), dup_key))
            raws.append((mid, json.dumps(it, ensure_ascii=False, separators=(',', ':'))))
            fts.append((mid, norm(title), norm(d.get('title_fa')), norm(' '.join(x for x in (d.get('other_titles'), d.get('director'), d.get('stars')) if x))))
        con.executemany('INSERT INTO media (id,kind,title,title_fa,other_titles,year,imdb_score,site_rating,duration_text,classification,'
                        'director,stars,synopsis,image,cover,genre_ids,genre_names,country_names,dup_key) '
                        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', rows)
        con.executemany('INSERT INTO media_raw VALUES (?,?)', raws)
        con.executemany('INSERT OR IGNORE INTO media_genres VALUES (?,?)', mg)
        con.executemany('INSERT OR IGNORE INTO media_countries VALUES (?,?)', mc)
        con.executemany('INSERT INTO search_fts(rowid,title,title_fa,extra) VALUES (?,?,?,?)', fts)
    con.executemany('INSERT INTO genres VALUES (?,?)', sorted(genres.items()))
    con.executemany('INSERT INTO countries VALUES (?,?,?)', [(k, v[0], v[1]) for k, v in sorted(countries.items())])
    media_ids = {r[0] for r in con.execute('SELECT id FROM media')}
    log('media:', len(media_ids))

    # ---- archive movie links ----
    n = 0
    for key, it in movies.items():
        for s in it.get('sources') or []:
            if not isinstance(s, dict) or not isinstance(s.get('url'), str):
                notes['anomalies'].append('movie %s: source without url kept only in media_raw' % key)
                continue
            con.execute(LINK_SQL, _link_row(int(it['id']), 'archive', str(s.get('id')), s['url'], s.get('quality'), s.get('type'), None))
            n += 1
    log('archive movie links:', n)

    # ---- seasons/episodes: archive first, then overlay (never replacing) ----
    season_ids, episode_ids = set(), set()

    def add_seasons(mid, seasons, origin):
        added = 0
        if not isinstance(seasons, list):
            return 0
        for pos, se in enumerate(seasons):
            sid = se.get('id')
            if sid in season_ids:
                notes['overlay_conflicts'].append('%s: season id %s exists, skipped' % (origin, sid))
                continue
            season_ids.add(sid)
            con.execute('INSERT INTO seasons VALUES (?,?,?,?,?,?,?)', (sid, mid, pos, _season_number(se.get('title'), pos), se.get('title'), origin,
                                                                      json.dumps(se, ensure_ascii=False, separators=(',', ':'))))
            for epos, ep in enumerate(se.get('episodes') or []):
                eid = ep.get('id')
                if eid in episode_ids:
                    notes['overlay_conflicts'].append('%s: episode id %s exists, skipped' % (origin, eid))
                    continue
                episode_ids.add(eid)
                con.execute('INSERT INTO episodes VALUES (?,?,?,?,?,?,?,?,?,?)', (eid, sid, mid, epos, _episode_number(ep.get('title')), ep.get('title'),
                                                                                  ep.get('description'), ep.get('duration'), origin,
                                                                                  json.dumps(ep, ensure_ascii=False, separators=(',', ':'))))
                for s in ep.get('sources') or []:
                    if isinstance(s, dict) and isinstance(s.get('url'), str):
                        con.execute(LINK_SQL, _link_row(mid, 'archive' if origin == 'archive' else origin, str(s.get('id')), s['url'], s.get('quality'),
                                                        s.get('type'), None, season_id=sid, episode_id=eid))
            added += 1
        return added

    arch_seasons = data.get('seasons') or {}
    for k, v in arch_seasons.items():
        if int(k) not in media_ids:
            notes['anomalies'].append('archive seasons for unknown media %s' % k)
            continue
        add_seasons(int(k), v, 'archive')
    overlay_dir = os.path.join(data_dir, 'overlay')
    ov = _load_overlay(os.path.join(overlay_dir, 'seasons.json'))
    if ov:
        for k, v in ov.items():
            if not str(k).isdigit() or int(k) not in media_ids:
                notes['overlay_orphans'].append('seasons overlay: media %s unknown' % k)
                continue
            add_seasons(int(k), v, 'overlay:seasons.json')
    log('seasons:', len(season_ids), 'episodes:', len(episode_ids))

    # ---- scan links (local only), matched by title(+year) exactly like the existing server ----
    smovies, sseries, sst = scanmod.read_scan_files(data_dir)
    midx, sidx = {}, {}
    for mid, kind, title, year in con.execute('SELECT id,kind,title,year FROM media'):
        t = scanmod.strip_year(scanmod.norm_title(title))
        if not t:
            continue
        if kind == 'movie' and year:
            midx.setdefault((t, year), []).append(mid)
        elif kind == 'series':
            sidx.setdefault(t, []).append(mid)
    sc_attached = sc_unmatched = sc_ambiguous = 0
    for (t, y), entries in smovies.items():
        ids = midx.get((t, y)) or (midx.get((t, y - 1), []) + midx.get((t, y + 1), []))
        for e in entries:
            if not ids:
                sc_unmatched += 1
                continue
            amb = 1 if len(ids) > 1 else 0
            sc_ambiguous += amb
            for mid in ids:
                con.execute(LINK_SQL, _link_row(mid, 'scan:' + e['file'], hashlib.sha1(e['url'].encode()).hexdigest(), e['url'], None, None, e['size'], ambiguous=amb))
                sc_attached += 1
    for t, entries in sseries.items():
        ids = sidx.get(t) or []
        for e in entries:
            if not ids:
                sc_unmatched += 1
                continue
            amb = 1 if len(ids) > 1 else 0
            sc_ambiguous += amb
            for mid in ids:
                con.execute(LINK_SQL, _link_row(mid, 'scan:' + e['file'], hashlib.sha1(e['url'].encode()).hexdigest(), e['url'], None, None, e['size'],
                                                season_no=e['season'], episode_no=e['episode'], ambiguous=amb))
                sc_attached += 1
    log('scan:', sst, 'attached', sc_attached, 'unmatched', sc_unmatched, 'ambiguous', sc_ambiguous)

    # ---- optional overlays: link status, external ids ----
    ls = _load_overlay(os.path.join(overlay_dir, 'link-status.json')) or {}
    applied = 0
    for ref, info in ls.items():
        origin, _, oref = ref.partition(':')
        st = (info or {}).get('status')
        if st not in ('working', 'unavailable', 'unverified'):
            notes['anomalies'].append('link-status overlay: bad status for %s' % ref)
            continue
        cur = con.execute("UPDATE links SET status=?, last_checked=?, last_http_status=? WHERE origin LIKE ? AND origin_ref=?",
                          (st, info.get('checked_at'), info.get('http_status'), origin + '%', oref))
        applied += cur.rowcount
    ex = _load_overlay(os.path.join(overlay_dir, 'external-ids.json')) or {}
    for k, v in ex.items():
        if str(k).isdigit() and int(k) in media_ids and isinstance(v, dict):
            for prov, val in v.items():
                con.execute('INSERT OR IGNORE INTO external_ids VALUES (?,?,?,?)', (int(k), prov, str(val), 'overlay:external-ids.json'))

    con.execute('UPDATE media SET link_count=(SELECT COUNT(*) FROM links WHERE links.media_id=media.id AND links.url_valid=1)')

    # ---- summary + checks ----
    cnt = lambda sql: con.execute(sql).fetchone()[0]
    summary = {
        'movies': cnt("SELECT COUNT(*) FROM media WHERE kind='movie'"), 'series': cnt("SELECT COUNT(*) FROM media WHERE kind='series'"),
        'seasons': cnt('SELECT COUNT(*) FROM seasons'), 'episodes': cnt('SELECT COUNT(*) FROM episodes'),
        'links': cnt('SELECT COUNT(*) FROM links'), 'links_invalid_scheme': cnt('SELECT COUNT(*) FROM links WHERE url_valid=0'),
        'links_archive': cnt("SELECT COUNT(*) FROM links WHERE origin='archive'"), 'links_scan': cnt("SELECT COUNT(*) FROM links WHERE origin LIKE 'scan:%'"),
        'scan': sst, 'scan_attached': sc_attached, 'scan_unmatched': sc_unmatched, 'scan_ambiguous': sc_ambiguous, 'link_status_applied': applied,
        'dup_title_groups': cnt('SELECT COUNT(*) FROM (SELECT dup_key FROM media GROUP BY dup_key HAVING COUNT(*)>1)'),
        'dup_title_records': cnt('SELECT COUNT(*) FROM media WHERE dup_key IN (SELECT dup_key FROM media GROUP BY dup_key HAVING COUNT(*)>1)'),
        'notes': {k: (v[:20] + ['... (%d total)' % len(v)] if len(v) > 20 else v) for k, v in notes.items()},
    }
    sha_after = sha256_file(archive_path)
    if sha_after != sha_before:
        raise ImportErrorFatal('archive changed while importing')
    con.executemany('INSERT INTO meta VALUES (?,?)', [('schema_version', str(SCHEMA_VERSION)), ('archive_sha256', sha_before),
                                                      ('archive_file', os.path.basename(archive_path)), ('imported_at', started)])
    con.execute('INSERT INTO import_runs VALUES (NULL,?,?,?,?,?)', (started, time.strftime('%Y-%m-%dT%H:%M:%S'), sha_before, SCHEMA_VERSION, json.dumps(summary, ensure_ascii=False)))
    con.commit()
    problems = validate(con, data, sha_before, archive_path)
    con.execute('ANALYZE')
    con.commit()
    con.close()
    if problems:
        raise ImportErrorFatal('validation failed: ' + '; '.join(problems[:5]))
    os.replace(tmp, db_path)
    summary['seconds'] = round(time.time() - t0, 1)
    return summary


def validate(con, data, sha, archive_path):
    """Checks that nothing was lost. Returns a list of problems (empty = OK)."""
    p = []
    if len(data['movie']) != con.execute("SELECT COUNT(*) FROM media WHERE kind='movie'").fetchone()[0]:
        p.append('movie count differs')
    if len(data['serie']) != con.execute("SELECT COUNT(*) FROM media WHERE kind='series'").fetchone()[0]:
        p.append('series count differs')
    if con.execute('SELECT COUNT(*) FROM media_raw').fetchone()[0] != len(data['movie']) + len(data['serie']):
        p.append('raw count differs')
    bad = 0
    for kind, src in (('movie', data['movie']), ('serie', data['serie'])):
        for key, it in src.items():
            r = con.execute('SELECT json FROM media_raw WHERE media_id=?', (int(it['id']),)).fetchone()
            if r is None or json.loads(r[0]) != it:
                bad += 1
    if bad:
        p.append('%d records differ from the archive' % bad)
    src_n = sum(len(m.get('sources') or []) for m in data['movie'].values())
    got = con.execute("SELECT COUNT(*) FROM links WHERE origin='archive' AND episode_id IS NULL").fetchone()[0]
    if got != src_n:
        p.append('movie links %d != %d' % (got, src_n))
    ep_src = sum(len(e.get('sources') or []) for s in (data.get('seasons') or {}).values() for se in s for e in se.get('episodes') or [])
    got = con.execute("SELECT COUNT(*) FROM links WHERE origin='archive' AND episode_id IS NOT NULL").fetchone()[0]
    if got != ep_src:
        p.append('episode links %d != %d' % (got, ep_src))
    n_ep = sum(len(se.get('episodes') or []) for s in (data.get('seasons') or {}).values() for se in s)
    if con.execute("SELECT COUNT(*) FROM episodes WHERE origin='archive'").fetchone()[0] != n_ep:
        p.append('archive episode count differs')
    if sha256_file(archive_path) != sha:
        p.append('archive file changed')
    return p


def main(argv=None):
    root = os.path.dirname(HERE)
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--data-dir', default=os.path.join(root, 'data'))
    ap.add_argument('--archive', default=None)
    ap.add_argument('--db', default=None)
    a = ap.parse_args(argv)
    archive = a.archive or os.path.join(a.data_dir, 'archive.json')
    db = a.db or os.path.join(a.data_dir, 'flicksy.db')
    if not os.path.isfile(archive):
        print('Archive not found:', archive)
        return 2
    try:
        s = build(archive, db, a.data_dir)
    except ImportErrorFatal as e:
        print('IMPORT FAILED (previous database, if any, is untouched):', e)
        return 1
    print(json.dumps(s, ensure_ascii=False, indent=2))
    print('OK ->', db)
    return 0


if __name__ == '__main__':
    sys.exit(main())
