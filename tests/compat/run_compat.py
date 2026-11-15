"""Differential compatibility test: original server.py vs. modified server.py.

Usage:
    python tests/compat/run_compat.py ORIGINAL_SERVER.py MODIFIED_SERVER.py DATA_DIR [--sample N]

Both servers get their OWN COPY of DATA_DIR (so a server that writes to the archive cannot affect the other),
the same requests, and the same stubbed "internet" (no real network connection is ever made).
Results are compared route by route. Known, approved differences are listed in
docs/PHASE1-COMPATIBILITY.md and are reported separately from unexpected differences.
"""
import hashlib
import importlib.util
import json
import os
import re
import shutil
import socket
import sys
import tempfile
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO)

TEST_KEY = 'compat-test-key'


# ---------- the fake internet (shared by both servers) ----------

def fake_size(url):
    return int(hashlib.md5(url.encode()).hexdigest()[:7], 16) + 1000


class Archive:
    """Small helper that builds the fake upstream answers from the real data."""
    def __init__(self, data):
        self.data = data

    def upstream_json(self, url):
        m = re.search(r'/season/by/serie/(\d+)/', url)
        if m:
            return [{'id': 1, 'title': 'فصل اول', 'episodes': [
                {'id': 11, 'title': f'قسمت {i}', 'description': None, 'duration': None,
                 'sources': [{'id': i, 'quality': '720', 'type': 'mkv',
                              'url': f'http://dl.example.test/s/{m.group(1)}/e{i}.mkv'}]}
                for i in (1, 2)]}]
        m = re.search(r'/(movie|serie)/by/filtres/0/created/(\d+)/', url)
        if m:
            kind, page = m.group(1), int(m.group(2))
            if page >= 3:
                return []
            items = list(self.data[kind].values())[page * 5:(page + 1) * 5]
            return items
        return {'error': 'unknown'}


class _Hdrs:
    def __init__(self, d):
        self.d = {k.lower(): v for k, v in d.items()}

    def get(self, k, default=None):
        return self.d.get(k.lower(), default)

    def __getitem__(self, k):
        return self.d[k.lower()]


class _OrigResp:
    def __init__(self, body=b'', headers=None):
        self._b, self.headers = body, _Hdrs(headers or {})

    def read(self):
        return self._b

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def install_stub_original(mod, calls, archive):
    def urlopen(req, timeout=None):
        url = req.full_url if hasattr(req, 'full_url') else req
        # Behave like the real urllib/http.client: surrounding whitespace is stripped by Request already;
        # whitespace/control characters inside the URL, or a non-http(s) text, make the real call fail.
        if re.search(r'[\x00-\x20\x7f]', url) or not url.lower().startswith(('http://', 'https://')):
            raise ValueError('real urllib would refuse this URL')
        calls.append(url)
        if 'Range' in getattr(req, 'headers', {}) or 'range' in {k.lower() for k in getattr(req, 'headers', {})}:
            n = fake_size(url)
            return _OrigResp(b'', {'Content-Range': f'bytes 0-0/{n}'})
        return _OrigResp(json.dumps(archive.upstream_json(url)).encode())
    mod.urllib.request.urlopen = urlopen


def install_stub_modified(mod, calls, archive):
    import urlguard

    def safe_fetch(url, **kw):
        urlguard.check_url_syntax(url, kw.get('allowed_hosts'))    # the REAL syntax rules still apply
        calls.append(url)
        if kw.get('headers', {}).get('Range'):
            n = fake_size(url)
            return urlguard.FetchResult(206, {'content-range': f'bytes 0-0/{n}'}, b'', url)
        return urlguard.FetchResult(200, {}, json.dumps(archive.upstream_json(url)).encode(), url)
    mod.urlguard.safe_fetch = safe_fetch


# ---------- loading a server module ----------

def load(path, name, data_dir, online):
    for k in list(os.environ):
        if k.startswith('FLICKSY_'):
            del os.environ[k]
    os.environ['FLICKSY_DATA_DIR'] = data_dir
    if online:
        os.environ['FLICKSY_MODE'] = 'online'
        os.environ['FLICKSY_API_KEY'] = TEST_KEY
    sys.modules.pop('urlguard', None)
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.DATA_DIR = data_dir                      # both versions use this global
    mod.WEB = os.path.join(REPO, 'apps', 'download', 'web')
    return mod


def no_real_network():
    def boom(*a, **k):
        raise AssertionError('REAL NETWORK ACCESS ATTEMPTED')
    socket.create_connection = boom
    socket.getaddrinfo = boom


# ---------- request list ----------

def build_requests(data, sample):
    movies = list(data['movie'].values())
    series = list(data['serie'].values())
    step_m = max(1, len(movies) // sample)
    step_s = max(1, len(series) // sample)
    pick_m = movies[::step_m][:sample]
    pick_s = series[::step_s][:sample]
    must_m = [data['movie'].get('2204')] if data['movie'].get('2204') else []
    must_s = [data['serie'].get('27965')] if data['serie'].get('27965') else []
    seen = set()
    reqs = []

    def add(group, url):
        if url not in seen:
            seen.add(url)
            reqs.append((group, url))

    L = '/api/v1/providers/sermovie/'
    add('health', '/api/v1/health')
    add('providers', '/api/v1/providers')
    for p in ('/', '/Movies/', '/Series/', '/Movies/1999/', '/Series/2024/', '/Movies/نامشخص/',
              '/Movies/1800/', '/Series/9999/'):
        add('list', f'{L}list?path={p}')
    for p in ('', 'Movies', '/../x', '/Other/', '/Movies/../x', '/a/b/c/d', '/Movies/2020/9/9/9'):
        add('list-bad', f'{L}list?path={p}')
    years_m = sorted({str(i.get('year')) for i in movies if i.get('year')})
    for y in years_m[::max(1, len(years_m) // 12)]:
        add('list-year', f'{L}list?path=/Movies/{y}/')
    years_s = sorted({str(i.get('year')) for i in series if i.get('year')})
    for y in years_s[::max(1, len(years_s) // 8)]:
        add('list-year', f'{L}list?path=/Series/{y}/')
    for it in must_m + pick_m:
        y = it.get('year') or 'نامشخص'
        add('movie', f'{L}movie?path=/Movies/{y}/{it["id"]}/')
    for it in must_s + pick_s:
        y = it.get('year') or 'نامشخص'
        add('series', f'{L}series?path=/Series/{y}/{it["id"]}/')
    for p in ('/Movies/2020/999999999/', '/Movies/2020/', '/Series/2020/999999999/', '/Series/2020/x/', '/Movies/x'):
        add('movie-bad', f'{L}movie?path={p}')
        add('series-bad', f'{L}series?path={p}')
    add('file-info-unknown', f'{L}file-info?path=/Movies/2020/1/dl-0')
    add('file-info-unknown', f'{L}file-info')
    for p in ('/', '/app.js', '/style.css', '/index.html', '/nope.txt', '/api/v1/nope'):
        add('static', p)
    # online-mode requests (the page asks for it)
    add('online-list', f'{L}list?path=/Movies/&mode=online')
    add('online-list', f'{L}list?path=/Movies/p1/&mode=online')
    add('online-list', f'{L}list?path=/Series/p2/&mode=online')
    for it in pick_m[:5]:
        add('online-movie', f'{L}movie?path=/Movies/p1/{it["id"]}/&mode=online')
    first_m = list(data['movie'].values())[:5]
    for it in first_m:
        add('online-movie', f'{L}movie?path=/Movies/p1/{it["id"]}/&mode=online')
    first_s = list(data['serie'].values())[:3]
    for it in first_s:
        add('online-series', f'{L}series?path=/Series/p1/{it["id"]}/&mode=online')
    return reqs


# ---------- comparison ----------

ADDITIVE_KEYS = {'invalidUrl'}

# Approved differences (see docs/PHASE1-COMPATIBILITY.md). Movie 2204 is the one real record whose link has no
# "http://" in front ("00MBhttp://..."): it is no longer offered as a link. In the file-info follow-up the fake
# internet answers any address, whereas the original's urllib would have refused this scheme-less text.
APPROVED = {
    ('movie', '/api/v1/providers/sermovie/movie?path=/Movies/2019/2204/'),
    ('file-info', '/api/v1/providers/sermovie/file-info?path=/Movies/2019/2204/dl-1'),
}
HEALTH_COMMON = ('success', 'service', 'status', 'movies', 'series')


def strip_additive(o):
    if isinstance(o, dict):
        return {k: strip_additive(v) for k, v in o.items() if k not in ADDITIVE_KEYS}
    if isinstance(o, list):
        return [strip_additive(x) for x in o]
    return o


def fetch(client, url):
    r = client.get(url)
    ctype = r.headers.get('Content-Type', '')
    if 'json' in ctype:
        return r.status_code, 'json', r.get_json()
    return r.status_code, 'bytes', hashlib.sha256(r.get_data()).hexdigest()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    sample = 150
    if '--sample' in sys.argv:
        sample = int(sys.argv[sys.argv.index('--sample') + 1])
        args = [a for a in args if a != str(sample)]
    orig_path, mod_path, data_src = args[:3]
    no_real_network()

    archive_file = os.path.join(data_src, 'archive.json')
    h_src = hashlib.sha256(open(archive_file, 'rb').read()).hexdigest()
    data = json.load(open(archive_file, encoding='utf-8'))
    archive = Archive(data)
    reqs = build_requests(data, sample)

    tmp = tempfile.mkdtemp(prefix='compat-')
    try:
        d_orig, d_mod = os.path.join(tmp, 'orig'), os.path.join(tmp, 'mod')
        shutil.copytree(data_src, d_orig)
        shutil.copytree(data_src, d_mod)

        orig = load(orig_path, 'srv_original', d_orig, online=False)
        orig.LIVE_SEASONS = False        # same switch the original offers; separates the "auto-fetch+save" difference
        o_calls = []
        install_stub_original(orig, o_calls, archive)
        mod = load(mod_path, 'srv_modified', d_mod, online=True)
        m_calls = []
        if hasattr(mod, 'urlguard'):
            install_stub_modified(mod, m_calls, archive)
        else:                            # sanity runs: both slots hold an original-style server
            install_stub_original(mod, m_calls, archive)
            mod.LIVE_SEASONS = False

        oc, mc = orig.app.test_client(), mod.app.test_client()
        stats, diffs = {}, []
        file_info_checked = 0
        for group, url in reqs:
            so, ko, bo = fetch(oc, url)
            sm, km, bm = fetch(mc, url)
            if group == 'health' and ko == km == 'json':
                bo = {k: bo.get(k) for k in HEALTH_COMMON}
                bm = {k: bm.get(k) for k in HEALTH_COMMON}
            same = (so == sm) and (strip_additive(bo) == strip_additive(bm))
            s = stats.setdefault(group, [0, 0])
            s[0] += 1
            if same:
                s[1] += 1
            else:
                diffs.append((group, url, so, sm))
            # follow with file-info for every download link of a movie/series answer
            if group in ('movie', 'online-movie', 'series', 'online-series') and ko == 'json' and so == 200:
                body = bo.get('movie') or bo.get('series') or {}
                dls = body.get('downloads') or [d for se in body.get('seasons', []) for ep in se['episodes']
                                                for d in ep['downloads']]
                for d in dls[:2]:
                    if not d.get('downloadUrl'):
                        continue
                    fu = f'/api/v1/providers/sermovie/file-info?path={d["path"]}'
                    fo, fm = fetch(oc, fu), fetch(mc, fu)
                    s2 = stats.setdefault('file-info', [0, 0])
                    s2[0] += 1
                    file_info_checked += 1
                    if fo == fm:
                        s2[1] += 1
                    else:
                        diffs.append(('file-info', fu, fo[0], fm[0]))

        h_orig = hashlib.sha256(open(os.path.join(d_orig, 'archive.json'), 'rb').read()).hexdigest()
        h_mod = hashlib.sha256(open(os.path.join(d_mod, 'archive.json'), 'rb').read()).hexdigest()
        print(f'requests compared: {len(reqs)} (+ {file_info_checked} file-info follow-ups)')
        print(f'{"group":<20}{"total":>7}{"identical":>11}')
        for g, (t, ok_) in stats.items():
            print(f'{g:<20}{t:>7}{ok_:>11}{"" if t == ok_ else "   <-- DIFFERENT"}')
        unexpected = [d for d in diffs if (d[0], d[1]) not in APPROVED]
        approved = [d for d in diffs if (d[0], d[1]) in APPROVED]
        print('approved differences:', len(approved))
        for d in approved:
            print('   approved:', d)
        print('UNEXPECTED differences:', len(unexpected))
        for d in unexpected[:25]:
            print('   ', d)
        diffs = unexpected
        print('real source archive unchanged:', h_src == hashlib.sha256(open(archive_file, "rb").read()).hexdigest())
        print('original server left its archive copy unchanged:', h_orig == h_src)
        print('modified server left its archive copy unchanged:', h_mod == h_src)
        print('stub upstream calls  original:', len(o_calls), ' modified:', len(m_calls))
        json.dump({'diffs': diffs, 'stats': stats}, open(os.path.join(tempfile.gettempdir(), 'compat-last.json'), 'w'))
        sys.exit(1 if diffs or h_mod != h_src else 0)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
