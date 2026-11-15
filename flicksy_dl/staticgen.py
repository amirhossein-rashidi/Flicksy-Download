"""Static site generator (architecture B): turns the local SQLite DB into a folder of plain files that Cloudflare Pages
(or any static host) can serve with NO server code.

    python -m flicksy_dl.staticgen                      # catalog only, NO download links  (default, safest)
    python -m flicksy_dl.staticgen --publish-links      # links only for hosts listed in data/overlay/publish-hosts.json

Output (default folder ./public, safe to commit):
    index.html styles.css app.js api-client.js      the same UI, with a static API client
    data/meta.json        health + facets + featured carousel
    data/index.json       compact title index (search/filter/paging happen in the browser)
    data/t/<n>.json       title details, grouped in shards of SHARD ids (keeps the file count small)

LINK GATE: a download URL is written to the output ONLY when --publish-links is given AND the link's host matches an entry of
data/overlay/publish-hosts.json  {"allowedHosts": ["example.com", ...]}  (exact host or any subdomain). Every other link keeps its
quality/size/status text but its URL is replaced by null. The database itself is opened read-only and never changed.
"""
import argparse
import json
import os
import shutil

from . import repo

SHARD = 500
HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, 'web')
ROOT = os.path.dirname(HERE)


def host_allowed(host, allowed):
    h = (host or '').lower().strip('.')
    return bool(h) and any(h == a or h.endswith('.' + a) for a in allowed)


def load_allowed(path):
    try:
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
    except (OSError, ValueError):
        return []
    return [str(x).lower().strip().strip('.') for x in (d.get('allowedHosts') or []) if str(x).strip()]


def _gate_links(detail, allowed, stats):
    def fix(links):
        for l in links:
            if l.get('url'):
                if l['host'] and host_allowed(l['host'], allowed):
                    stats['published'] += 1
                else:
                    l['url'] = None
                    stats['withheld'] += 1
    fix(detail.get('releases') or [])
    for s in detail.get('seasons') or []:
        for e in s['episodes']:
            fix(e['links'])
    return detail


def _dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))


def generate(db_path, out_dir, publish_links=False, allowed_hosts=(), log=print):
    allowed = [a.lower() for a in allowed_hosts] if publish_links else []
    con = repo.connect(db_path)
    if os.path.isdir(out_dir):
        for name in ('data',):
            shutil.rmtree(os.path.join(out_dir, name), ignore_errors=True)
    os.makedirs(out_dir, exist_ok=True)
    # --- UI files ---
    for f in ('index.html', 'styles.css', 'app.js'):
        shutil.copyfile(os.path.join(WEB, f), os.path.join(out_dir, f))
    shutil.copyfile(os.path.join(WEB, 'api-client-static.js'), os.path.join(out_dir, 'api-client.js'))
    idx_html = os.path.join(out_dir, 'index.html')
    # --- meta ---
    meta = {'health': repo.health(con), 'facets': repo.facets(con), 'featured': repo.featured(con, 30)['items']}
    meta['health'].pop('archiveSha256', None)
    _dump(os.path.join(out_dir, 'data', 'meta.json'), meta)
    # --- index: pre-sorted like the API (year desc, nulls last, id desc); rows are arrays to stay small ---
    # [id, kind(0 movie/1 series), title, titleFa, year, imdb, image, genreIds, countries, linkCount, otherTitles]
    rows = con.execute('SELECT id,kind,title,title_fa,year,imdb_score,image,genre_ids,country_names,link_count,other_titles FROM media '
                       'ORDER BY year IS NULL, year DESC, id DESC').fetchall()
    index = []
    for r in rows:
        gids = [int(x) for x in (r['genre_ids'] or '').split(',') if x.strip().isdigit()]
        index.append([r['id'], 0 if r['kind'] == 'movie' else 1, (r['title'] or '').strip(), r['title_fa'], r['year'], r['imdb_score'], r['image'],
                      gids, r['country_names'], r['link_count'], (r['other_titles'] or '')[:120] or None])
    _dump(os.path.join(out_dir, 'data', 'index.json'), index)
    # --- details in shards ---
    stats = {'published': 0, 'withheld': 0}
    shards = {}
    for r in rows:
        d = repo.title_detail(con, r['id'], expose_links=True)
        d = _gate_links(d, allowed, stats)
        d.pop('description', None)   # raw text duplicate of synopsis: the UI never shows it (still stored in the DB)
        d.pop('cover', None)
        shards.setdefault(r['id'] // SHARD, {})[str(r['id'])] = d
    for n, items in shards.items():
        _dump(os.path.join(out_dir, 'data', 't', '%d.json' % n), items)
    report = {'titles': len(index), 'shards': len(shards), 'shardSize': SHARD, 'publishLinks': bool(publish_links), 'allowedHosts': allowed,
              'linksPublished': stats['published'], 'linksWithheld': stats['withheld']}
    _dump(os.path.join(out_dir, 'data', 'build-report.json'), report)
    con.close()
    log('OK ->', out_dir, report)
    return report


def main():
    ap = argparse.ArgumentParser(description='Generate the static site folder.')
    ap.add_argument('--data-dir', default=os.path.join(ROOT, 'data'))
    ap.add_argument('--db')
    ap.add_argument('--out', default=os.path.join(ROOT, 'public'))
    ap.add_argument('--publish-links', action='store_true', help='include download URLs, but only for hosts in data/overlay/publish-hosts.json')
    a = ap.parse_args()
    db = a.db or os.path.join(a.data_dir, 'flicksy.db')
    allowed = load_allowed(os.path.join(a.data_dir, 'overlay', 'publish-hosts.json')) if a.publish_links else []
    if a.publish_links and not allowed:
        print('NOTE: --publish-links given but data/overlay/publish-hosts.json lists no hosts -> no link will be published.')
    generate(db, a.out, a.publish_links, allowed)


if __name__ == '__main__':
    main()
