"""Read-only queries on the local SQLite database. No Flask here: this is the layer an API (or tests) call."""
import json
import sqlite3

from .textnorm import fts_query

MAX_LIMIT = 60
SUMMARY_COLS = 'm.id,m.kind,m.title,m.title_fa,m.year,m.imdb_score,m.image,m.genre_names,m.country_names,m.link_count'


def connect(db_path):
    con = sqlite3.connect('file:%s?mode=ro' % db_path, uri=True, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con


def _summary(r):
    return {'id': r['id'], 'kind': r['kind'], 'title': (r['title'] or '').strip(), 'titleFa': r['title_fa'], 'year': r['year'],
            'imdbScore': r['imdb_score'], 'image': r['image'], 'genres': r['genre_names'], 'countries': r['country_names'],
            'linkCount': r['link_count']}


def health(con):
    meta = dict(con.execute('SELECT key,value FROM meta').fetchall())
    c = lambda sql: con.execute(sql).fetchone()[0]
    return {'schemaVersion': int(meta.get('schema_version', 0)), 'archiveSha256': meta.get('archive_sha256'), 'importedAt': meta.get('imported_at'),
            'counts': {'movies': c("SELECT COUNT(*) FROM media WHERE kind='movie'"), 'series': c("SELECT COUNT(*) FROM media WHERE kind='series'"),
                       'seasons': c('SELECT COUNT(*) FROM seasons'), 'episodes': c('SELECT COUNT(*) FROM episodes'), 'links': c('SELECT COUNT(*) FROM links')}}


def facets(con):
    byk = {'movie': [], 'series': []}
    titles = dict(con.execute('SELECT id,title FROM genres'))
    rows = con.execute('SELECT m.kind, mg.genre_id, COUNT(*) FROM media_genres mg JOIN media m ON m.id=mg.media_id GROUP BY m.kind, mg.genre_id').fetchall()
    for kind, gid, n in rows:
        byk[kind].append({'id': gid, 'title': titles.get(gid, ''), 'count': n})
    for lst in byk.values():
        lst.sort(key=lambda g: g['title'])
    totals = {k: v for k, v in con.execute('SELECT kind, COUNT(*) FROM media GROUP BY kind')}
    genres = [{'id': r[0], 'title': r[1]} for r in con.execute('SELECT id,title FROM genres ORDER BY title')]
    yr = con.execute('SELECT MIN(year),MAX(year) FROM media WHERE year IS NOT NULL').fetchone()
    return {'kinds': ['movie', 'series'], 'genres': genres, 'genresByKind': byk, 'totals': totals, 'yearMin': yr[0], 'yearMax': yr[1],
            'linkStatuses': ['working', 'unverified', 'unavailable']}


def featured(con, limit=12):
    """Newest well-rated titles that have a poster (for the home carousel)."""
    limit = max(1, min(int(limit or 12), 30))
    rows = con.execute("SELECT %s FROM media m WHERE m.image IS NOT NULL AND m.image<>'' AND m.year IS NOT NULL AND m.imdb_score>=6 "
                       "AND (length(m.genre_ids)-length(replace(m.genre_ids,',','')))<=15 "   # 5 archive records are site announcements tagged with ~50 genres: never featured
                       "ORDER BY m.year DESC, m.imdb_score DESC, m.id DESC LIMIT ?" % SUMMARY_COLS, (limit,)).fetchall()
    return {'items': [_summary(r) for r in rows]}


def list_titles(con, q=None, kind=None, year=None, genre=None, limit=24, offset=0):
    limit = max(1, min(int(limit or 24), MAX_LIMIT))
    offset = max(0, int(offset or 0))
    where, args, joins = [], [], ''
    fq = fts_query(q) if q else None
    if kind in ('movie', 'series'):
        where.append('m.kind=?')
        args.append(kind)
    if year:
        where.append('m.year=?')
        args.append(int(year))
    if genre:
        joins += ' JOIN media_genres g ON g.media_id=m.id AND g.genre_id=?'
        args.insert(0, int(genre))
    if fq:
        sql = ('SELECT %s FROM search_fts f JOIN media m ON m.id=f.rowid%s WHERE search_fts MATCH ?%s ORDER BY bm25(search_fts,10,10,1), m.year DESC LIMIT ? OFFSET ?'
               % (SUMMARY_COLS, joins, ''.join(' AND ' + w for w in where)))
        # the genre join parameter comes first in the SQL text, MATCH after it
        params = (args[:1] if genre else []) + [fq] + (args[1:] if genre else args)
    else:
        sql = ('SELECT %s FROM media m%s%s ORDER BY m.year IS NULL, m.year DESC, m.id DESC LIMIT ? OFFSET ?'
               % (SUMMARY_COLS, joins, (' WHERE ' + ' AND '.join(where)) if where else ''))
        params = list(args)
    rows = con.execute(sql, params + [limit + 1, offset]).fetchall()
    return {'items': [_summary(r) for r in rows[:limit]], 'limit': limit, 'offset': offset, 'hasMore': len(rows) > limit}


def _link(r, expose):
    return {'id': r['id'], 'origin': 'scan' if r['origin'].startswith('scan') else 'archive', 'qualityText': r['quality_text'],
            'container': r['container'], 'resolution': r['resolution'], 'sourceTag': r['source_tag'], 'codec': r['codec'],
            'audio': r['audio'], 'subtitle': r['subtitle'], 'releaseGroup': r['release_group'], 'releaseName': r['release_name'],
            'sizeBytes': r['size_bytes'], 'host': r['host'], 'status': r['status'], 'lastChecked': r['last_checked'],
            'ambiguousMatch': bool(r['ambiguous']), 'seasonNo': r['season_no'], 'episodeNo': r['episode_no'],
            'url': r['url_clean'] if expose else None}


def _links(con, where, args, expose):
    rows = con.execute('SELECT * FROM links WHERE url_valid=1 AND ' + where + ' ORDER BY COALESCE(resolution,0) DESC, id', args).fetchall()
    return [_link(r, expose) for r in rows]


def title_detail(con, mid, expose_links=True):
    r = con.execute('SELECT * FROM media WHERE id=?', (mid,)).fetchone()
    if not r:
        return None
    raw = json.loads(con.execute('SELECT json FROM media_raw WHERE media_id=?', (mid,)).fetchone()[0])
    out = _summary(r)
    out.update({'siteRating': r['site_rating'], 'duration': r['duration_text'], 'classification': r['classification'],
                'director': r['director'], 'stars': r['stars'], 'otherTitles': r['other_titles'], 'synopsis': r['synopsis'],
                'description': raw.get('description'), 'cover': r['cover'],
                'genreList': [{'id': x[0], 'title': x[1]} for x in con.execute('SELECT g.id,g.title FROM media_genres mg JOIN genres g ON g.id=mg.genre_id WHERE mg.media_id=?', (mid,))],
                'externalIds': [{'provider': x[0], 'value': x[1]} for x in con.execute('SELECT provider,value FROM external_ids WHERE media_id=?', (mid,))],
                'possibleDuplicates': [{'id': x[0], 'kind': x[1], 'title': x[2], 'year': x[3]} for x in
                                       con.execute('SELECT id,kind,title,year FROM media WHERE dup_key=? AND id<>? LIMIT 10', (r['dup_key'], mid))]})
    unusable = con.execute('SELECT COUNT(*) FROM links WHERE media_id=? AND url_valid=0', (mid,)).fetchone()[0]
    out['hiddenInvalidLinks'] = unusable
    if r['kind'] == 'movie':
        out['releases'] = _links(con, 'media_id=? AND episode_id IS NULL', (mid,), expose_links)
    else:
        out['releases'] = []
        out['seasons'] = seasons(con, mid, expose_links)
    return out


def seasons(con, mid, expose_links=True):
    res = []
    scan = _links(con, "media_id=? AND origin LIKE 'scan:%' AND season_no IS NOT NULL", (mid,), expose_links)
    by_ep = {}
    for l in scan:
        by_ep.setdefault((l['seasonNo'], l['episodeNo']), []).append(l)
    used = set()
    for s in con.execute('SELECT * FROM seasons WHERE media_id=? ORDER BY position', (mid,)):
        eps = []
        for e in con.execute('SELECT * FROM episodes WHERE season_id=? ORDER BY position', (s['id'],)):
            links = _links(con, 'episode_id=?', (e['id'],), expose_links)
            extra = by_ep.get((s['number'], e['number'])) if e['number'] is not None else None
            if extra:
                used.add((s['number'], e['number']))
                links = links + extra
            eps.append({'id': e['id'], 'number': e['number'], 'title': e['title'], 'description': e['description'], 'duration': e['duration_text'], 'links': links})
        res.append({'id': s['id'], 'number': s['number'], 'title': s['title'], 'origin': s['origin'], 'episodes': eps})
    # scan-only seasons/episodes (numbers not covered by stored seasons)
    nums = {}
    for (sn, en), links in by_ep.items():
        if (sn, en) not in used:
            nums.setdefault(sn, {})[en] = links
    have = {s['number'] for s in res}
    for sn in sorted(nums):
        if sn in have:
            # stored season exists but some scan episodes are not in it -> add them as extra episodes of that season
            tgt = next(s for s in res if s['number'] == sn)
            for en in sorted(nums[sn]):
                tgt['episodes'].append({'id': None, 'number': en, 'title': 'قسمت %d' % en, 'description': None, 'duration': None, 'links': nums[sn][en]})
        else:
            res.append({'id': None, 'number': sn, 'title': 'فصل %d' % sn, 'origin': 'scan',
                        'episodes': [{'id': None, 'number': en, 'title': 'قسمت %d' % en, 'description': None, 'duration': None, 'links': nums[sn][en]} for en in sorted(nums[sn])]})
    res.sort(key=lambda s: (s['number'] is None, s['number']))
    return res
