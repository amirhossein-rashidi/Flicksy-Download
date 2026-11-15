"""
Flicksy Local — اجرای Flicksy روی گوشی (Pydroid) با داده‌ی JSON محلی.

اجرا:
    pip install flask
    python server.py
بعد در مرورگر: http://127.0.0.1:8080

فایل archive.json (خروجی scrape_report.py) را در پوشه‌ی data بگذار.
"""
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from flask import Flask, Response, abort, jsonify, request, send_from_directory

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, 'apps', 'download', 'web')
DATA_DIR = os.path.join(ROOT, 'data')
PORT = 8080

# گرفتن فصل‌ها به‌صورت زنده، وقتی در JSON نیستند
LIVE_SEASONS = True
KEY = '4F5A9C3D9A86FA54EACEDDD635185'
BASE = 'https://server-hi-speed-iran.info/api'
HELPERS = ['https://hostinnegar.com', 'https://windowsdiba.info']
LIVE_FILTER = 'created'     # فیلتر لیست آنلاین: created / year / imdb
LIVE_PAGES_SHOWN = 30       # در حالت آنلاین چند صفحه‌ی اول به‌عنوان دکمه نشان داده شود
LIVE_SCAN_MAX = 400         # سقف صفحه‌هایی که برای پیدا کردن یک عنوان اسکن می‌شود
LIVE_TTL = 300              # ثانیه؛ مدت نگه داشتن جواب صفحه‌های آنلاین در حافظه

app = Flask(__name__)

_cache = {'file': None, 'mtime': None, 'db': {'movie': {}, 'serie': {}, 'seasons': {}}}
DL_URLS = {}   # مسیر مجازی فایل -> لینک واقعی (برای گرفتن حجم)
SIZE_CACHE = {}


# ---------- لینک‌های اسکن‌شده (فایل‌های data/scan-*.tsv) ----------
# هر خط فایل: لینک <TAB> حجم. فایل files.tsv خروجی dirscan3.py را به scan-اسم.tsv تغییر نام بده.
SCAN = {'sig': None, 'movies': {}, 'series': {}, 'count': 0}
VIDEO_EXTS = {'mkv', 'mp4', 'avi', 'mov', 'm4v', 'ts'}
YEAR_RE = re.compile(r'(?<!\d)((?:19|20)\d{2})(?!\d)')
SE_RE = re.compile(r'[Ss](\d{1,2})[ ._-]?[Ee](\d{1,3})')
RES_RE = re.compile(r'(?<!\d)(2160|1440|1080|720|576|480|360)[pP]')
SRC_RE = re.compile(r'(web[- ]?dl|webrip|bluray|blu[- ]?ray|brrip|bdrip|hdrip|hdtv|dvdrip|hdcam|cam)', re.I)


def norm_title(text):
    from urllib.parse import unquote
    t = unquote(text or '').lower().replace('&', ' and ').replace("'", '')
    return re.sub(r'[^a-z0-9]+', ' ', t).strip()


def strip_year(t):
    return re.sub(r'\s(?:19|20)\d{2}$', '', t)


def parse_scan(url, size):
    from urllib.parse import unquote, urlsplit
    path = unquote(urlsplit(url).path)
    name = path.rsplit('/', 1)[-1]
    if '.' not in name:
        return None
    base, ext = name.rsplit('.', 1)
    if ext.lower() not in VIDEO_EXTS:
        return None
    low = base.replace('.', ' ').replace('_', ' ')
    tl = low.lower()
    se = SE_RE.search(low)
    title, year, season, episode = '', None, None, None
    if se:
        season, episode = int(se.group(1)), int(se.group(2))
        title = low[:se.start()]
        if not title.strip():
            for seg in reversed(path.split('/')[:-1]):
                if seg and not re.match(r'(?i)^(s\d{1,2}|season.*|\d{3,4}p.*)$', seg):
                    title = seg
                    break
    else:
        for m in YEAR_RE.finditer(low):
            if low[:m.start()].strip():
                title, year = low[:m.start()], int(m.group(1))
                break
    title = strip_year(norm_title(title))
    if not title:
        return None
    if not se and not year:
        return None
    res = RES_RE.search(low)
    src = SRC_RE.search(low)
    parts = [(res.group(1) + 'p') if res else '', src.group(1).upper() if src else '']
    if 'hardsub' in tl or 'hard sub' in tl:
        label = 'هاردساب فارسی'
    elif 'dub' in tl:
        label = 'دوبله فارسی'
    elif 'softsub' in tl or 'farsi sub' in tl or ' sub' in tl:
        label = 'زیرنویس فارسی'
    else:
        label = 'سرور اسکن'
    return {'url': url, 'size': size, 'title': title, 'year': year, 'season': season,
            'episode': episode, 'res': parts[0], 'quality': ' '.join(x for x in parts if x),
            'label': label, 'source': parts[1] or None}


def load_scan():
    files = []
    if os.path.isdir(DATA_DIR):
        files = sorted(os.path.join(DATA_DIR, n) for n in os.listdir(DATA_DIR)
                       if n.lower().startswith('scan') and n.lower().endswith('.tsv'))
    sig = tuple((f, os.path.getmtime(f)) for f in files)
    if sig == SCAN['sig']:
        return SCAN
    movies, series, count, seen = {}, {}, 0, set()
    for f in files:
        with open(f, encoding='utf-8', errors='replace') as fh:
            for line in fh:
                url, _, sz = line.rstrip('\n').partition('\t')
                if not url or url in seen:
                    continue
                seen.add(url)
                e = parse_scan(url, int(sz) if sz.strip().isdigit() else None)
                if not e:
                    continue
                count += 1
                if e['season'] is not None:
                    series.setdefault(e['title'], []).append(e)
                else:
                    movies.setdefault((e['title'], e['year']), []).append(e)
    SCAN.update(sig=sig, movies=movies, series=series, count=count)
    print('لینک‌های اسکن خوانده شد:', count, 'فایل ویدیویی از', len(files), 'فایل')
    return SCAN


def scan_movie_entries(item):
    sc = load_scan()
    t = strip_year(norm_title(item.get('title')))
    try:
        y = int(item.get('year') or 0)
    except (TypeError, ValueError):
        y = 0
    if not t or not y:
        return []
    found = sc['movies'].get((t, y), [])
    if not found:
        found = sc['movies'].get((t, y - 1), []) + sc['movies'].get((t, y + 1), [])
    return sorted(found, key=lambda e: -(int(e['res'][:-1]) if e['res'] else 0))


def scan_series_map(item):
    t = strip_year(norm_title(item.get('title')))
    out = {}
    for e in load_scan()['series'].get(t, []):
        out.setdefault((e['season'], e['episode']), []).append(e)
    for lst in out.values():
        lst.sort(key=lambda e: -(int(e['res'][:-1]) if e['res'] else 0))
    return out


def scan_download(vpath, e, idx):
    d = make_download(vpath, {'quality': e['quality'], 'type': e['label'], 'url': e['url']}, idx)
    d['sizeBytes'] = e['size']
    d['metadata']['size'] = e['size']
    d['metadata']['source'] = e['source']
    d['qualityFolder'] = e['res'] or 'نامشخص'
    return d


# ---------- خواندن JSON ----------

def find_json():
    """اول data/archive.json، بعد هر json دیگر داخل data که کلید movie یا serie داشته باشد."""
    main = os.path.join(DATA_DIR, 'archive.json')
    if os.path.exists(main):
        return main
    if os.path.isdir(DATA_DIR):
        for name in sorted(os.listdir(DATA_DIR)):
            if name.lower().endswith('.json'):
                return os.path.join(DATA_DIR, name)
    return None


def get_db():
    path = find_json()
    if not path:
        return _cache['db']
    mtime = os.path.getmtime(path)
    if _cache['file'] != path or _cache['mtime'] != mtime:
        with open(path, encoding='utf-8') as f:
            raw = json.load(f)
        _cache.update(file=path, mtime=mtime, db={
            'movie': raw.get('movie') or {},
            'serie': raw.get('serie') or {},
            'seasons': raw.get('seasons') or {},
        })
        DL_URLS.clear()
        print('خوانده شد:', path, '| فیلم:', len(_cache['db']['movie']),
              '| سریال:', len(_cache['db']['serie']))
    return _cache['db']


# ---------- گرفتن زنده‌ی فصل‌ها ----------

def fetch_json_live(url):
    """اول سرور اصلی، اگر نشد سرورهای کمکی. خروجی JSON."""
    urls = [url] + [re.sub(r'^https?://[^/]+', h, url) for h in HELPERS]
    last = None
    for u in urls:
        try:
            req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read().decode('utf-8', errors='replace'))
        except Exception as e:
            last = e
    raise RuntimeError(str(last))


def fetch_seasons_live(sid):
    data = fetch_json_live(f'{BASE}/season/by/serie/{sid}/{KEY}/')
    if not isinstance(data, list):
        raise RuntimeError('جواب لیست نبود')
    return data


LIVE_PAGE_CACHE = {}    # (kind, page) -> (زمان, لیست آیتم‌ها)
LIVE_ITEMS = {}         # (kind, id) -> آیتم


def live_page(kind, page):
    """یک صفحه از لیست آنلاین. همه‌ی آیتم‌هایش در LIVE_ITEMS هم ثبت می‌شود."""
    key = (kind, page)
    hit = LIVE_PAGE_CACHE.get(key)
    if hit and time.time() - hit[0] < LIVE_TTL:
        return hit[1]
    data = fetch_json_live(f'{BASE}/{kind}/by/filtres/0/{LIVE_FILTER}/{page}/{KEY}')
    if not isinstance(data, list):
        raise RuntimeError('جواب لیست نبود')
    LIVE_PAGE_CACHE[key] = (time.time(), data)
    for it in data:
        LIVE_ITEMS[(kind, str(it.get('id')))] = it
    return data


def find_live_item(kind, iid, hint=None):
    """
    مشخصات یک فیلم/سریال را درجا از سرور می‌گیرد.
    اگر مسیر شماره‌ی صفحه (مثل p3) داشته باشد فقط همان یک صفحه گرفته می‌شود؛
    وگرنه صفحه‌ها به‌صورت دسته‌ای اسکن می‌شوند تا آیتم پیدا شود.
    """
    m = re.fullmatch(r'p(\d+)', hint or '')
    if m:
        for it in live_page(kind, int(m.group(1)) - 1):
            if str(it.get('id')) == iid:
                return it
    else:
        hit = LIVE_ITEMS.get((kind, iid))
        if hit:
            return hit
    page, batch = 0, 8
    with ThreadPoolExecutor(batch) as pool:
        while page < LIVE_SCAN_MAX:
            pages = list(range(page, page + batch))
            results = list(pool.map(lambda p: live_page(kind, p), pages))
            for data in results:
                for it in data:
                    if str(it.get('id')) == iid:
                        return it
            if any(not d for d in results):
                break
            page += batch
    return None


def is_online():
    return request.args.get('mode') == 'online'


def save_seasons(sid, data):
    """فصل‌های گرفته‌شده را داخل خود فایل JSON هم ذخیره می‌کند تا دفعه‌ی بعد نخواهد"""
    path = _cache['file']
    if not path:
        return
    try:
        with open(path, encoding='utf-8') as f:
            raw = json.load(f)
        raw.setdefault('seasons', {})[sid] = data
        tmp = path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(raw, f, ensure_ascii=False)
        os.replace(tmp, path)
        _cache['mtime'] = os.path.getmtime(path)   # دوباره‌خوانی بی‌خود نشود
    except Exception as e:
        print('ذخیره‌ی فصل‌ها در JSON نشد:', e)


# ---------- کمک‌ها ----------

def ok(**kw):
    return jsonify(success=True, **kw)


def fail(code, status=400, message=''):
    return jsonify(success=False, error=code, message=message), status


def year_of(item):
    y = item.get('year')
    return str(y) if y else 'نامشخص'


def kind_of(seg):
    return {'Movies': 'movie', 'Series': 'serie'}.get(seg)


def digits(text):
    m = re.search(r'(\d{3,4})', text or '')
    return m.group(1) if m else None


def make_download(vpath, src, idx):
    quality = str(src.get('quality') or '').strip()
    url = src.get('url') or ''
    res = digits(quality)
    ext = (re.search(r'\.([a-z0-9]{2,4})(?:$|\?)', url, re.I) or [None, None])[1]
    DL_URLS[vpath] = url
    return {
        'id': vpath.strip('/').replace('/', '-'),
        'name': f'{quality or "لینک"} {src.get("type") or ""}'.strip() + f' #{idx + 1}',
        'path': vpath,
        'qualityFolder': quality or 'نامشخص',
        'metadata': {
            'extension': ext.lower() if ext else None,
            'mediaType': 'video',
            'resolution': f'{res}p' if res else (quality or None),
            'codec': None, 'bitDepth': None, 'source': None,
            'audioChannels': None, 'season': None, 'episode': None,
            'softSub': False, 'size': None,
        },
        'sizeBytes': None,
        'downloadUrl': url,
    }


ITEM_KNOWN = {'id', 'title', 'description', 'year', 'imdb', 'rating', 'duration', 'image',
              'cover', 'genres', 'country', 'type', 'sources', 'episodes'}


def extras(obj, known=ITEM_KNOWN):
    """هر فیلدی که جای مشخصی ندارد، همین‌طور برای نمایش می‌فرستیم"""
    return {k: v for k, v in obj.items() if k not in known}


TT_RE = re.compile(r'tt\d{6,10}')


def identifiers(item, kind):
    """شناسه‌ها و لینک‌های IMDb / TMDB. اول از فیلدهای خود داده، اگر نبود لینک جست‌وجو."""
    out = [{'label': 'شناسه‌ی آرشیو (id)', 'value': str(item.get('id')), 'url': None}]
    imdb_id = tmdb_id = imdb_url = tmdb_url = None
    for k, v in item.items():
        if k in ('sources', 'episodes') or v in (None, '', 0):
            continue
        kl = k.lower()
        vals = [v] if isinstance(v, (str, int)) and not isinstance(v, bool) else []
        for x in vals:
            xs = str(x).strip()
            m = TT_RE.search(xs)
            if 'imdb.com' in xs and not imdb_url:
                imdb_url = xs
            if m and not imdb_id:
                imdb_id = m.group(0)
            if 'themoviedb.org' in xs and not tmdb_url:
                tmdb_url = xs
            if 'tmdb' in kl and not tmdb_id and re.fullmatch(r'\d+', xs):
                tmdb_id = xs
    if imdb_id and not imdb_url:
        imdb_url = f'https://www.imdb.com/title/{imdb_id}/'
    if tmdb_id and not tmdb_url:
        tmdb_url = f'https://www.themoviedb.org/{"tv" if kind == "serie" else "movie"}/{tmdb_id}'
    title = item.get('title') or ''
    from urllib.parse import quote
    out.append({'label': 'IMDb', 'value': imdb_id,
                'url': imdb_url or f'https://www.imdb.com/find/?q={quote(title)}',
                'search': not imdb_url})
    out.append({'label': 'TMDB', 'value': tmdb_id,
                'url': tmdb_url or f'https://www.themoviedb.org/search?query={quote(title)}',
                'search': not tmdb_url})
    return out


def meta(item, kind='movie'):
    """همه‌ی فیلدهای فیلم/سریال برای نمایش"""
    return {
        'ids': identifiers(item, kind),
        'description': item.get('description'), 'imdb': item.get('imdb'),
        'rating': item.get('rating'), 'duration': item.get('duration'),
        'image': item.get('image'), 'cover': item.get('cover'),
        'itemType': item.get('type'), 'year': item.get('year') or None,
        'genres': [g.get('title') for g in item.get('genres') or []],
        'countries': [{'title': c.get('title'), 'image': c.get('image')}
                      for c in item.get('country') or []],
        'extra': extras(item),
        'raw': {k: v for k, v in item.items() if k not in ('sources', 'episodes')},
    }


def archive_year(seg, item):
    # در حالت آنلاین سگمنت دوم مسیر «p3» است نه سال
    return year_of(item) if re.fullmatch(r'p\d+', seg or '') else seg


def split_path(path):
    if not isinstance(path, str) or not path.startswith('/') or '..' in path:
        raise ValueError('INVALID_PATH')
    segs = [s for s in path.split('/') if s]
    if segs and kind_of(segs[0]) is None:
        raise ValueError('PATH_NOT_ALLOWED')
    return segs


# ---------- API ----------

@app.route('/api/v1/health')
def health():
    db = get_db()
    return ok(service='flicksy-local', status='healthy',
              movies=len(db['movie']), series=len(db['serie']),
              dataFile=_cache['file'])


@app.route('/api/v1/providers')
def providers():
    return ok(providers=[{'id': 'sermovie', 'name': 'Local JSON', 'enabled': True}])


@app.route('/api/v1/providers/sermovie/list')
def list_dir():
    try:
        segs = split_path(request.args.get('path', ''))
    except ValueError as e:
        return fail(str(e))
    db = get_db()
    online = is_online()

    if online and len(segs) >= 1:
        kind = kind_of(segs[0])
        if len(segs) == 1:      # در حالت آنلاین به‌جای سال، صفحه‌های لیست زنده
            entries = [{'name': f'p{n + 1}', 'label': f'صفحه {n + 1}',
                        'path': f'/{segs[0]}/p{n + 1}/', 'isDirectory': True}
                       for n in range(LIVE_PAGES_SHOWN)]
        elif len(segs) == 2:
            m = re.fullmatch(r'p(\d+)', segs[1])
            if not m:
                return ok(provider='sermovie', directory={'path': request.args.get('path'),
                                                          'count': 0, 'entries': []})
            try:
                data = live_page(kind, int(m.group(1)) - 1)
            except Exception as e:
                return fail('LIVE_FAILED', 502, f'گرفتن صفحه از سرور ممکن نشد: {e}')
            entries = [{'name': i.get('title') or str(i.get('id')),
                        'path': f'/{segs[0]}/{segs[1]}/{i.get("id")}/',
                        'isDirectory': True,
                        'image': i.get('image') or i.get('cover'),
                        'imdb': i.get('imdb'), 'rating': i.get('rating'),
                        'duration': i.get('duration'),
                        'year': i.get('year') or None,
                        'genres': [g.get('title') for g in i.get('genres') or []]}
                       for i in data]
        else:
            entries = []
        return ok(provider='sermovie', mode='online',
                  directory={'path': request.args.get('path'), 'count': len(entries), 'entries': entries})

    if not segs:
        entries = [{'name': 'Movies', 'path': '/Movies/', 'isDirectory': True},
                   {'name': 'Series', 'path': '/Series/', 'isDirectory': True}]
    else:
        kind = kind_of(segs[0])
        items = db[kind]
        if len(segs) == 1:      # لیست سال‌ها
            years = sorted({year_of(i) for i in items.values()},
                           key=lambda y: (y == 'نامشخص', -int(y) if y.isdigit() else 0))
            entries = [{'name': y, 'path': f'/{segs[0]}/{y}/', 'isDirectory': True} for y in years]
        elif len(segs) == 2:    # عنوان‌های یک سال
            entries = [{'name': i.get('title') or str(i.get('id')),
                        'path': f'/{segs[0]}/{segs[1]}/{i.get("id")}/',
                        'isDirectory': True,
                        'image': i.get('image') or i.get('cover'),
                        'imdb': i.get('imdb'), 'rating': i.get('rating'),
                        'duration': i.get('duration'),
                        'genres': [g.get('title') for g in i.get('genres') or []]}
                       for i in items.values() if year_of(i) == segs[1]]
            entries.sort(key=lambda e: e['name'])
        else:
            entries = []
    return ok(provider='sermovie',
              directory={'path': request.args.get('path'), 'count': len(entries), 'entries': entries})


@app.route('/api/v1/providers/sermovie/movie')
def movie():
    try:
        segs = split_path(request.args.get('path', ''))
    except ValueError as e:
        return fail(str(e))
    if len(segs) != 3 or segs[0] != 'Movies':
        return fail('INVALID_MOVIE_PATH')
    warnings = []
    item = None
    if is_online():
        try:
            item = find_live_item('movie', segs[2], segs[1])
        except Exception as e:
            warnings.append(f'گرفتن زنده از سرور نشد، از JSON خوانده شد: {e}')
    if item is None:
        item = get_db()['movie'].get(segs[2])
    if not item:
        return fail('NOT_FOUND', 404, 'این فیلم نه روی سرور پیدا شد و نه در JSON')
    base = f'/Movies/{segs[1]}/{segs[2]}'
    downloads = [make_download(f'{base}/dl-{n}', s, n) for n, s in enumerate(item.get('sources') or [])]
    for e in scan_movie_entries(item):
        downloads.append(scan_download(f'{base}/dl-{len(downloads)}', e, len(downloads)))
    return ok(provider='sermovie', movie={
        'id': f'local-movie-{segs[2]}', 'type': 'movie', 'provider': 'sermovie',
        'title': item.get('title'), 'archiveYear': archive_year(segs[1], item),
        'releaseYear': item.get('year') or None, 'path': base + '/',
        'downloadCount': len(downloads), 'subtitleCount': 0,
        'downloads': downloads, 'subtitles': [], 'warnings': warnings,
        **meta(item, 'movie'),
    })


@app.route('/api/v1/providers/sermovie/series')
def series():
    try:
        segs = split_path(request.args.get('path', ''))
    except ValueError as e:
        return fail(str(e))
    if len(segs) != 3 or segs[0] != 'Series':
        return fail('INVALID_SERIES_PATH')
    db = get_db()
    online = is_online()
    warnings = []
    item = None
    if online:
        try:
            item = find_live_item('serie', segs[2], segs[1])
        except Exception as e:
            warnings.append(f'گرفتن زنده از سرور نشد، از JSON خوانده شد: {e}')
    if item is None:
        item = db['serie'].get(segs[2])
    if not item:
        return fail('NOT_FOUND', 404, 'این سریال نه روی سرور پیدا شد و نه در JSON')
    base = f'/Series/{segs[1]}/{segs[2]}'
    raw = None
    if online:      # حالت آنلاین: فصل‌ها همیشه تازه از سرور (بدون دست زدن به JSON)
        try:
            raw = fetch_seasons_live(segs[2])
        except Exception as e:
            warnings.append(f'فصل‌ها از سرور گرفته نشد، از JSON خوانده شد: {e}')
    if raw is None:
        raw = db['seasons'].get(segs[2])
    if raw is None and LIVE_SEASONS and not online:
        try:
            raw = fetch_seasons_live(segs[2])
            db['seasons'][segs[2]] = raw
            save_seasons(segs[2], raw)
            print('فصل‌های سریال', segs[2], 'از سرور گرفته و ذخیره شد')
        except Exception as e:
            warnings.append(f'فصل‌ها در JSON نبود و از سرور هم گرفته نشد: {e}')
    if raw is None:
        raw = []
    by_se = scan_series_map(item)
    seasons, total_eps, total_dl = [], 0, 0
    for si, s in enumerate(raw if isinstance(raw, list) else []):
        m = re.search(r'(\d{1,2})', s.get('title') or '')
        snum = int(m.group(1)) if m else si + 1
        eps = []
        for ei, e in enumerate(s.get('episodes') or []):
            dls = [make_download(f'{base}/s{snum}e{ei + 1}-{n}', src, n)
                   for n, src in enumerate(e.get('sources') or [])]
            for x in by_se.pop((snum, ei + 1), []):
                dls.append(scan_download(f'{base}/s{snum}e{ei + 1}-{len(dls)}', x, len(dls)))
            eps.append({'id': f'local-{segs[2]}-s{snum}e{ei + 1}', 'type': 'episode',
                        'seasonNumber': snum, 'episodeNumber': ei + 1,
                        'title': e.get('title') or f'Episode {ei + 1:02d}',
                        'description': e.get('description'), 'duration': e.get('duration'),
                        'image': e.get('image'),
                        'extra': extras(e, {'id', 'title', 'description', 'duration', 'image', 'sources'}),
                        'downloadCount': len(dls), 'downloads': dls, 'subtitles': []})
            total_dl += len(dls)
        total_eps += len(eps)
        seasons.append({'id': f'local-{segs[2]}-s{snum}', 'seasonNumber': snum,
                        'title': s.get('title') or f'Season {snum}', 'path': f'{base}/s{snum}/',
                        'episodeCount': len(eps),
                        'downloadCount': sum(x['downloadCount'] for x in eps),
                        'subtitleCount': 0, 'subtitles': [], 'episodes': eps,
                        'extra': extras(s, {'id', 'title', 'episodes'})})
    by_season = {}
    for (sn, en), lst in by_se.items():
        by_season.setdefault(sn, {})[en] = lst
    for sn in sorted(by_season):
        season = next((x for x in seasons if x['seasonNumber'] == sn), None)
        if season is None:
            season = {'id': f'local-{segs[2]}-s{sn}', 'seasonNumber': sn, 'title': f'Season {sn}',
                      'path': f'{base}/s{sn}/', 'episodeCount': 0, 'downloadCount': 0,
                      'subtitleCount': 0, 'subtitles': [], 'episodes': [], 'extra': {}}
            seasons.append(season)
        for en in sorted(by_season[sn]):
            dls = [scan_download(f'{base}/s{sn}e{en}-{n}', x, n) for n, x in enumerate(by_season[sn][en])]
            season['episodes'].append({'id': f'local-{segs[2]}-s{sn}e{en}', 'type': 'episode',
                                       'seasonNumber': sn, 'episodeNumber': en,
                                       'title': f'Episode {en:02d}', 'description': None,
                                       'duration': None, 'image': None, 'extra': {},
                                       'downloadCount': len(dls), 'downloads': dls, 'subtitles': []})
            season['episodeCount'] += 1
            season['downloadCount'] += len(dls)
            total_eps += 1
            total_dl += len(dls)
        season['episodes'].sort(key=lambda x: x['episodeNumber'])
    seasons.sort(key=lambda x: x['seasonNumber'])
    return ok(provider='sermovie', series={
        'id': f'local-series-{segs[2]}', 'type': 'series', 'provider': 'sermovie',
        'title': item.get('title'), 'archiveYear': archive_year(segs[1], item),
        'releaseYear': item.get('year') or None,
        'path': base + '/', 'seasonCount': len(seasons), 'episodeCount': total_eps,
        'downloadCount': total_dl, 'subtitleCount': 0, 'seasons': seasons, 'warnings': warnings,
        **meta(item, 'serie'),
    })


@app.route('/api/v1/providers/sermovie/file-info')
def file_info():
    path = request.args.get('path', '')
    url = DL_URLS.get(path)
    if not url:
        return fail('NOT_FOUND', 404)
    if path not in SIZE_CACHE:
        size = None
        try:
            req = urllib.request.Request(url, headers={'Range': 'bytes=0-0', 'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as r:
                cr = r.headers.get('Content-Range', '')
                m = re.search(r'/(\d+)$', cr)
                if m:
                    size = int(m.group(1))
                elif r.headers.get('Content-Length', '').isdigit():
                    size = int(r.headers['Content-Length'])
        except Exception:
            size = None
        SIZE_CACHE[path] = size
    size = SIZE_CACHE[path]
    if not size:
        return fail('SIZE_UNAVAILABLE', 502)
    return ok(provider='sermovie', file={'path': path, 'sizeBytes': size, 'downloadUrl': url})


# ---------- فایل‌های صفحه ----------

@app.route('/')
def index():
    return send_from_directory(WEB, 'index.html')


@app.route('/app.js')
def appjs():
    # آدرس API را به همین سرور محلی تغییر می‌دهیم (فایل اصلی دست‌نخورده می‌ماند)
    with open(os.path.join(WEB, 'app.js'), encoding='utf-8') as f:
        js = f.read()
    js = re.sub(r'const API_BASE = "[^"]*";', 'const API_BASE = "";', js, count=1)
    return Response(js, mimetype='application/javascript')


@app.route('/<path:name>')
def static_files(name):
    if name.startswith('api/'):
        abort(404)
    return send_from_directory(WEB, name)


if __name__ == '__main__':
    if '--data' in sys.argv:
        DATA_DIR = sys.argv[sys.argv.index('--data') + 1]
    if '--port' in sys.argv:
        PORT = int(sys.argv[sys.argv.index('--port') + 1])
    db = get_db()
    if not find_json():
        print('هشدار: فایل JSON در', DATA_DIR, 'پیدا نشد.')
    print(f'باز کن: http://127.0.0.1:{PORT}')
    app.run(host='0.0.0.0', port=PORT)
