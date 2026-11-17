"""اسکن هاست‌ها بر اساس فهرست config/sources.txt (با استفاده از dirscan3.py کنار همین فایل).

استفاده:
  python scan_sources.py --mode open                 اسکن هاست‌های «آزاد» (گیتهاب این را اجرا می‌کند)
  python scan_sources.py --mode iran --upload        اسکن هاست‌های «ایران» و فرستادن نتیجه به گیتهاب
  python scan_sources.py --mode iran --list          فقط نشان بده چه چیزی اسکن می‌شود

اسکن نیمه‌کاره هرگز منتشر نمی‌شود و جای اسکن سالم قبلی را نمی‌گیرد.
"""
import argparse
import base64
import glob
import json
import os
import re
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))

OWNER = 'amirhossein-rashidi'
REPO = 'flicksy-download'
BRANCH = 'main'
SOURCES_URL = 'https://raw.githubusercontent.com/%s/%s/%s/config/sources.txt' % (OWNER, REPO, BRANCH)
SCANS_DIR_IN_REPO = 'data-in/scans'
TOKEN_FILE = 'github-token.txt'

# تنظیمات ملایم (هرچه کمتر، فشار روی هاست کمتر)
LIMITS = {
    'open': {'per_host': 2, 'total': 6},
    'iran': {'per_host': 6, 'total': 16},
}
# اگر نتیجهٔ جدید از این نسبت فایل‌های فعلی کمتر باشد، منتشر نمی‌شود
MIN_KEEP_RATIO = 0.80

MODE_WORDS = {'آزاد': 'open', 'ازاد': 'open', 'open': 'open', 'ایران': 'iran', 'iran': 'iran'}


def log(*a):
    print('[scan]', *a, flush=True)


# ------------------------------ فهرست هاست‌ها ------------------------------
def load_text(src):
    if re.match(r'^https?://', src):
        req = urllib.request.Request(src, headers={'User-Agent': 'flicksy-scan/1.0'})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode('utf-8')
    with open(src, encoding='utf-8') as f:
        return f.read()


def site_label(url):
    parts = urlsplit(url).netloc.lower().split('.')
    label = parts[-2] if len(parts) >= 2 else parts[0]
    return re.sub(r'[^a-z0-9-]+', '-', label) or 'site'


def parse_sources(text):
    """-> {(label, mode): [url, ...]}"""
    groups, bad = {}, []
    for raw in text.splitlines():
        line = raw.replace('ي', 'ی').replace('ك', 'ک').strip()
        if not line or line.startswith('#'):
            continue
        parts = line.split(None, 1)
        mode = MODE_WORDS.get(parts[0].lower()) if len(parts) == 2 else None
        url = parts[1].strip() if len(parts) == 2 else ''
        if not mode or not re.match(r'^https?://[^\s]+$', url):
            bad.append(raw)
            continue
        urls = groups.setdefault((site_label(url), mode), [])
        if url not in urls:
            urls.append(url)
    return groups, bad


# ------------------------------ اجرای dirscan3 ------------------------------
def patched_source(path, urls, limits):
    with open(path, encoding='utf-8') as f:
        src = f.read()

    def sub_line(name, value, s):
        pat = re.compile(r'^(%s\s*=\s*)[^\n]*$' % name, re.M)
        if len(pat.findall(s)) != 1:
            raise SystemExit('dirscan3.py: setting %s not found exactly once (file changed?)' % name)
        return pat.sub(lambda m: m.group(1) + repr(value), s)

    pat_urls = re.compile(r'^EXTRA_URLS\s*=\s*\[.*?^\]', re.M | re.S)
    if len(pat_urls.findall(src)) != 1:
        raise SystemExit('dirscan3.py: EXTRA_URLS block not found (file changed?)')
    src = pat_urls.sub(lambda m: 'EXTRA_URLS = ' + repr(urls), src)
    for name, value in (('JSON_FILE', 'no-such-file.json'), ('MODE', 'full'), ('RESUME', 'no'),
                        ('OUT_NAME', 'out'), ('USE_COLOR', False), ('FANCY', False),
                        ('MAX_CONNS_PER_HOST', limits['per_host']), ('GLOBAL_MAX', limits['total'])):
        src = sub_line(name, value, src)
    src, n = re.subn(r'^main\(\)\s*$', '', src, flags=re.M)
    if n != 1:
        raise SystemExit('dirscan3.py: final main() call not found (file changed?)')
    return src


def run_dirscan(urls, limits, max_minutes):
    """-> (finished, [(url, size_or_None)]) ؛ هر بار در یک پوشهٔ موقت جدا اجرا می‌شود."""
    dpath = os.path.join(HERE, 'dirscan3.py')
    if not os.path.isfile(dpath):
        raise SystemExit('dirscan3.py must be next to this script')
    tmp = tempfile.mkdtemp(prefix='flicksy-scan-')
    ns = {'__name__': 'dirscan_run', '__file__': os.path.join(tmp, 'dirscan_run.py')}
    exec(compile(patched_source(dpath, urls, limits), 'dirscan3(patched)', 'exec'), ns)

    def stopper():
        time.sleep(max_minutes * 60)
        log('time limit reached -> stopping this scan (result will NOT be published)')
        ns['STOP'].set()

    threading.Thread(target=stopper, daemon=True).start()
    ns['main']()
    folders = sorted(glob.glob(os.path.join(tmp, 'out', 'dirscan_*')))
    if not folders:
        return False, []
    folder = folders[-1]
    finished = False
    try:
        with open(os.path.join(folder, 'state.json'), encoding='utf-8') as f:
            finished = bool(json.load(f).get('finished'))
    except (OSError, ValueError):
        pass
    rows = []
    tsv = os.path.join(folder, 'files.tsv')
    if os.path.isfile(tsv):
        with open(tsv, encoding='utf-8') as f:
            for line in f:
                u, _, s = line.rstrip('\n').partition('\t')
                if u:
                    rows.append((u, int(s) if s.strip().isdigit() else None))
    return finished, rows


def build_tsv(rows):
    best = {}
    for u, s in rows:
        if u not in best or (best[u] is None and s is not None):
            best[u] = s
    return ''.join('%s\t%s\n' % (u, '' if best[u] is None else best[u]) for u in sorted(best)), len(best)


# ------------------------------ گیتهاب ------------------------------
def read_token():
    t = os.environ.get('GITHUB_TOKEN', '').strip()
    if not t:
        p = os.path.join(HERE, TOKEN_FILE)
        if os.path.isfile(p):
            with open(p, encoding='utf-8') as f:
                t = f.readline().strip()
    return t


def gh(method, path, token, body=None, raw=False):
    url = 'https://api.github.com/repos/%s/%s/contents/%s' % (OWNER, REPO, path)
    if method == 'GET':
        url += '?ref=' + BRANCH
    headers = {'Authorization': 'Bearer ' + token, 'User-Agent': 'flicksy-scan/1.0',
               'Accept': 'application/vnd.github.raw+json' if raw else 'application/vnd.github+json'}
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def existing_in_repo(name, token):
    """-> (sha, text) یا (None, None) اگر فایل هنوز نیست."""
    path = '%s/%s' % (SCANS_DIR_IN_REPO, name)
    try:
        meta = json.loads(gh('GET', path, token))
        text = gh('GET', path, token, raw=True).decode('utf-8')
        return meta['sha'], text
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None, None
        raise


def upload(name, text, count, token):
    sha, old = existing_in_repo(name, token)
    if old is not None:
        if old == text:
            log(name, ': unchanged, nothing to upload')
            return
        old_n = old.count('\n')
        if count < old_n * MIN_KEEP_RATIO:
            log(name, ': SAFETY STOP - new scan has %d files but current has %d. NOT uploaded.' % (count, old_n))
            return False
    body = {'message': 'Scan update: %s (%d files)' % (name, count), 'branch': BRANCH,
            'content': base64.b64encode(text.encode('utf-8')).decode('ascii')}
    if sha:
        body['sha'] = sha
    gh('PUT', '%s/%s' % (SCANS_DIR_IN_REPO, name), token, body)
    log(name, ': uploaded (%d files)' % count)
    return True


# ------------------------------ اصلی ------------------------------
def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument('--mode', required=True, choices=['open', 'iran'])
    ap.add_argument('--sources', default=SOURCES_URL, help='مسیر فایل یا آدرس اینترنتی sources.txt')
    ap.add_argument('--out-dir', default=None, help='نتیجه را به‌جای گیتهاب در این پوشه بنویس')
    ap.add_argument('--upload', action='store_true', help='نتیجه را به گیتهاب بفرست')
    ap.add_argument('--list', action='store_true', help='فقط فهرست را نشان بده')
    ap.add_argument('--max-minutes', type=int, default=300)
    a = ap.parse_args()

    groups, bad = parse_sources(load_text(a.sources))
    for b in bad:
        log('WARNING: unreadable line skipped:', b)
    todo = {k: v for k, v in groups.items() if k[1] == a.mode}
    log('%d group(s) for mode "%s"' % (len(todo), a.mode))
    for (label, mode), urls in sorted(todo.items()):
        log(' scan-%s-%s.tsv  <-  %d address(es)' % (label, mode, len(urls)))
    if a.list or not todo:
        return 0

    token = ''
    if a.upload:
        token = read_token()
        if not token:
            raise SystemExit('No GitHub token: put it in %s next to this script' % TOKEN_FILE)
    if not a.upload and not a.out_dir:
        raise SystemExit('Use --upload or --out-dir')

    failures = 0
    for (label, mode), urls in sorted(todo.items()):
        name = 'scan-%s-%s.tsv' % (label, mode)
        log('=== %s' % name)
        finished, rows = run_dirscan(urls, LIMITS[mode], a.max_minutes)
        text, count = build_tsv(rows)
        if not finished:
            log(name, ': scan did NOT finish completely -> not published, old file kept')
            failures += 1
            continue
        if count == 0:
            log(name, ': scan found no files -> not published, old file kept')
            failures += 1
            continue
        if a.out_dir:
            os.makedirs(a.out_dir, exist_ok=True)
            p = os.path.join(a.out_dir, name)
            old = None
            if os.path.isfile(p):
                with open(p, encoding='utf-8') as f:
                    old = f.read()
            if old == text:
                log(name, ': unchanged')
            elif old is not None and count < old.count('\n') * MIN_KEEP_RATIO:
                log(name, ': SAFETY STOP - new %d files vs current %d. NOT written.' % (count, old.count('\n')))
                failures += 1
            else:
                with open(p + '.tmp', 'w', encoding='utf-8', newline='\n') as f:
                    f.write(text)
                os.replace(p + '.tmp', p)
                log(name, ': written (%d files)' % count)
        if a.upload:
            if upload(name, text, count, token) is False:
                failures += 1
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
