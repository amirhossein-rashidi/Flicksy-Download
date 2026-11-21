"""خواندن صفحه‌های «آرشیو تک‌صفحه‌ای» (یک صفحه که نام فیلم، کیفیت‌ها و لینک‌ها را یک‌جا دارد).

فهرست آدرس صفحه‌ها در config/archive-pages.txt است. هر خط:  ایران https://...  (یا آزاد)

استفاده:
  python scan_pages.py --mode iran --list            فقط نشان بده چه چیزی خوانده می‌شود
  python scan_pages.py --mode iran --out-dir خروجی    نتیجه را در پوشه بنویس (برای آزمایش)
  python scan_pages.py --mode iran --upload          نتیجه را به گیتهاب بفرست

خروجی هم‌شکل فایل‌های اسکن است: هر خط «آدرس فایل ‹tab› حجم به بایت». نام فایل: scan-page-<سایت>-<حالت>.tsv
نتیجهٔ ناقص یا خالی هرگز منتشر نمی‌شود و جای فایل سالم قبلی را نمی‌گیرد.
فایل رسانه‌ای دانلود نمی‌شود؛ فقط خودِ صفحهٔ فهرست خوانده می‌شود.
"""
import argparse
import os
import re
import sys
import time
import urllib.request
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scan_sources as ss  # noqa: E402

PAGES_URL = 'https://raw.githubusercontent.com/%s/%s/%s/config/archive-pages.txt' % (ss.OWNER, ss.REPO, ss.BRANCH)
MEDIA_EXTS = ('.mkv', '.mp4', '.avi', '.mov', '.m4v', '.webm', '.ts', '.wmv', '.flv')
UNITS = {'B': 1, 'KB': 1024, 'MB': 1024 ** 2, 'GB': 1024 ** 3, 'TB': 1024 ** 4}
SIZE_RE = re.compile(r'([0-9][0-9,]*(?:\.[0-9]+)?)\s*(TB|GB|MB|KB|B)\b', re.I)
log = ss.log


def to_bytes(text):
    m = SIZE_RE.search(text or '')
    if not m:
        return None
    try:
        return int(round(float(m.group(1).replace(',', '')) * UNITS[m.group(2).upper()]))
    except ValueError:
        return None


class PageParser(HTMLParser):
    """هر لینک فایل را با حجمی که بلافاصله بعد از آن نوشته شده نگه می‌دارد."""

    def __init__(self, base):
        super().__init__(convert_charrefs=True)
        self.base = base
        self.items = []          # [url, size_text_inside_link, text_after_link]
        self._open = None        # لینک باز فعلی
        self._last = None        # آخرین لینک بسته‌شده (متن بعدش حجم است)
        self.links_total = 0

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            href = dict(attrs).get('href')
            self._open = None
            if href:
                self.links_total += 1
                url = urljoin(self.base, href.strip())
                path = urlsplit(url).path.lower()
                if url.lower().startswith(('http://', 'https://')) and path.endswith(MEDIA_EXTS):
                    self._open = [url, '', '']
        elif tag in ('br', 'p', 'div', 'h1', 'h2', 'h3', 'h4', 'hr', 'li', 'tr'):
            self._last = None    # حجم فقط از همان خط خود لینک خوانده می‌شود

    def handle_data(self, data):
        if self._open is not None:
            self._open[1] += data
        elif self._last is not None and len(self._last[2]) < 60:
            self._last[2] += data

    def handle_endtag(self, tag):
        if tag == 'a' and self._open is not None:
            self.items.append(self._open)
            self._last = self._open
            self._open = None


def fetch(url):
    if not re.match(r'^https?://', url):
        with open(url, encoding='utf-8', errors='replace') as f:
            return f.read()
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'flicksy-scan/1.0'})
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = r.read()
            return raw.decode('utf-8', errors='replace')
        except Exception as e:  # noqa: BLE001
            last = e
            log('fetch problem (%d/3): %s' % (attempt + 1, e))
            time.sleep(3 * (attempt + 1))
    raise SystemExit('could not read page: %s (%s)' % (url, last))


def read_page(url):
    html = fetch(url)
    p = PageParser(url)
    p.feed(html)
    rows = []
    for u, inside, after in p.items:
        size = to_bytes(after) or to_bytes(inside)
        rows.append((u, size))
    log('  %s : %d link(s) in page, %d media file(s)' % (url, p.links_total, len(rows)))
    return rows


def parse_pages(text):
    groups, bad = {}, []
    for raw in text.splitlines():
        line = raw.replace('ي', 'ی').replace('ك', 'ک').strip()
        if not line or line.startswith('#'):
            continue
        parts = line.split(None, 1)
        mode = ss.MODE_WORDS.get(parts[0].lower()) if len(parts) == 2 else None
        url = parts[1].strip() if len(parts) == 2 else ''
        if not mode or not re.match(r'^https?://[^\s]+$', url):
            bad.append(raw)
            continue
        urls = groups.setdefault((ss.site_label(url), mode), [])
        if url not in urls:
            urls.append(url)
    return groups, bad


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:  # noqa: BLE001
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument('--mode', required=True, choices=['open', 'iran'])
    ap.add_argument('--pages', default=PAGES_URL, help='مسیر فایل یا آدرس اینترنتی archive-pages.txt')
    ap.add_argument('--out-dir', default=None)
    ap.add_argument('--upload', action='store_true')
    ap.add_argument('--list', action='store_true')
    a = ap.parse_args()

    groups, bad = parse_pages(ss.load_text(a.pages))
    for b in bad:
        log('WARNING: unreadable line skipped:', b)
    todo = {k: v for k, v in groups.items() if k[1] == a.mode}
    log('%d group(s) for mode "%s"' % (len(todo), a.mode))
    for (label, mode), urls in sorted(todo.items()):
        log(' scan-page-%s-%s.tsv  <-  %d page(s)' % (label, mode, len(urls)))
    if a.list or not todo:
        return 0

    token = ''
    if a.upload:
        token = ss.read_token()
        if not token:
            raise SystemExit('No GitHub token: put it in %s next to this script' % ss.TOKEN_FILE)
    if not a.upload and not a.out_dir:
        raise SystemExit('Use --upload or --out-dir')

    failures = 0
    for (label, mode), urls in sorted(todo.items()):
        name = 'scan-page-%s-%s.tsv' % (label, mode)
        log('=== %s' % name)
        rows = []
        for u in urls:
            rows.extend(read_page(u))
        text, count = ss.build_tsv(rows)
        if count == 0:
            log(name, ': no media links found in the page(s) -> not published, old file kept')
            failures += 1
            continue
        if a.out_dir:
            os.makedirs(a.out_dir, exist_ok=True)
            p = os.path.join(a.out_dir, name)
            with open(p + '.tmp', 'w', encoding='utf-8', newline='\n') as f:
                f.write(text)
            os.replace(p + '.tmp', p)
            log(name, ': written (%d files)' % count)
        if a.upload:
            if ss.upload(name, text, count, token) is False:
                failures += 1
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
