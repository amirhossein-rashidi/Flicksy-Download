"""همگام‌سازی ردیف‌های TMDB (ترند، محبوب، ...) با عنوان‌های سایت.

از TMDB فهرست‌ها را می‌گیرد، هر عنوان را با نام انگلیسی + سال به عنوان‌های خود سایت وصل می‌کند،
فقط آنهایی که در سایت هستند (و لینک دارند) را نگه می‌دارد و public/data/tmdb-rows.json را می‌نویسد.

توکن از متغیر محیطی TMDB_TOKEN خوانده می‌شود (در گیتهاب: Secrets).
اگر TMDB خطا بدهد یا نتیجه مشکوک باشد، فایل قبلی دست نمی‌خورد.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_DATA = os.path.join(ROOT, 'public', 'data')
API = 'https://api.themoviedb.org/3'
IMG = 'https://image.tmdb.org/t/p/'
PAGES = 3  # هر صفحه ۲۰ عنوان

# (کلید، نوع، مسیر TMDB، عنوان فارسی، عنوان انگلیسی)
LISTS = [
    ('trending-movie', 'movie', '/trending/movie/week', 'فیلم‌های ترند هفته', 'TRENDING MOVIES'),
    ('trending-tv', 'series', '/trending/tv/week', 'سریال‌های ترند هفته', 'TRENDING SERIES'),
    ('popular-movie', 'movie', '/movie/popular', 'محبوب‌ترین فیلم‌ها', 'POPULAR MOVIES'),
    ('popular-tv', 'series', '/tv/popular', 'محبوب‌ترین سریال‌ها', 'POPULAR SERIES'),
    ('top-movie', 'movie', '/movie/top_rated', 'برترین فیلم‌ها در TMDB', 'TOP RATED MOVIES'),
    ('top-tv', 'series', '/tv/top_rated', 'برترین سریال‌ها در TMDB', 'TOP RATED SERIES'),
    ('now-movie', 'movie', '/movie/now_playing', 'در حال اکران', 'NOW PLAYING'),
    ('air-tv', 'series', '/tv/on_the_air', 'سریال‌های در حال پخش', 'ON THE AIR'),
]
MIN_ROW = 4          # ردیف کمتر از این تعداد نشان داده نمی‌شود
MAX_ROW = 20


def log(*a):
    print('[tmdb]', *a, flush=True)


def norm(t):
    t = (t or '').lower().replace('&', ' and ').replace("'", '').replace('’', '')
    t = re.sub(r'[^a-z0-9\u00c0-\u024f\u0400-\u04ff\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]+', ' ', t).strip()
    t = re.sub(r'^(the|a|an) ', '', t)
    return t


def http_json(path, token, params=''):
    url = API + path + ('?' + params if params else '')
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/json',
                                               'User-Agent': 'flicksy-download-sync/1.0'})
    last = None
    for i in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise SystemExit('TMDB token rejected (HTTP %d) - check the TMDB_TOKEN secret' % e.code)
            last = e
        except (urllib.error.URLError, OSError, ValueError) as e:
            last = e
        time.sleep(2 * (i + 1))
    raise SystemExit('TMDB request failed: %s (%s)' % (path, last))


def build_lookup(index):
    """-> {(kind, normtitle): [(year, id, linkCount, title)]}"""
    d = {}
    for r in index:
        if not r[9]:          # بدون لینک
            continue
        kind = 'movie' if r[1] == 0 else 'series'
        for name in (r[2], r[10]):
            n = norm(name)
            if n:
                d.setdefault((kind, n), []).append((r[4], r[0], r[9], r[2]))
    return d


def match(item, kind, lookup):
    year = None
    date = item.get('release_date') if kind == 'movie' else item.get('first_air_date')
    if date and len(date) >= 4 and date[:4].isdigit():
        year = int(date[:4])
    names = [item.get('title') or item.get('name'), item.get('original_title') or item.get('original_name')]
    best = None
    for name in names:
        for cand in lookup.get((kind, norm(name)), []):
            y = cand[0]
            if year is not None and y is not None and abs(y - year) > 1:
                continue
            exact = 1 if (y == year) else 0
            score = (exact, cand[2])
            if best is None or score > best[0]:
                best = (score, cand)
    return best[1] if best else None


def main():
    token = os.environ.get('TMDB_TOKEN', '').strip()
    if not token:
        raise SystemExit('TMDB_TOKEN is not set')
    with open(os.path.join(PUBLIC_DATA, 'index.json'), encoding='utf-8') as f:
        index = json.load(f)
    lookup = build_lookup(index)
    log('index titles with links:', sum(len(v) for v in lookup.values()))

    rows, seen_total, matched_total = [], 0, 0
    banner_pool = []
    for key, kind, path, fa, en in LISTS:
        ids, items, seen = set(), [], 0
        for page in range(1, PAGES + 1):
            data = http_json(path, token, 'language=en-US&page=%d' % page)
            for it in data.get('results', []):
                seen += 1
                m = match(it, kind, lookup)
                if not m or m[1] in ids:
                    continue
                ids.add(m[1])
                entry = {'id': m[1], 'tmdb': it['id'], 'kind': kind, 'title': m[3]}
                items.append(entry)
                if key.startswith('trending') and it.get('backdrop_path') and it.get('overview'):
                    banner_pool.append({'id': m[1], 'tmdb': it['id'], 'kind': kind, 'title': m[3],
                                        'backdrop': it['backdrop_path'], 'overview': it['overview'],
                                        'popularity': it.get('popularity', 0)})
        seen_total += seen
        matched_total += len(items)
        log('%-15s %3d of %3d matched' % (key, len(items), seen))
        if len(items) >= MIN_ROW:
            rows.append({'key': key, 'kind': kind, 'title': fa, 'kicker': en, 'items': items[:MAX_ROW]})

    if seen_total == 0 or not rows:
        raise SystemExit('no usable rows - keeping the old file')

    banner_pool.sort(key=lambda b: -b['popularity'])
    banner, used = [], set()
    for b in banner_pool:
        if b['id'] in used:
            continue
        used.add(b['id'])
        b.pop('popularity')
        b['backdrop'] = IMG + 'w1280' + b['backdrop']
        banner.append(b)
        if len(banner) == 8:
            break

    out = {'updated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'imgBase': IMG,
           'banner': banner, 'rows': rows}
    dst = os.path.join(PUBLIC_DATA, 'tmdb-rows.json')
    tmp = dst + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, dst)
    log('OK: %d rows, %d banner items, matched %d of %d' % (len(rows), len(banner), matched_total, seen_total))


if __name__ == '__main__':
    main()
