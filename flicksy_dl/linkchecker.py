"""Lightweight link checker. NEVER downloads media.

Usage (from the project folder):
    python -m flicksy_dl.linkchecker --limit 200                 # check 200 not-yet-checked links
    python -m flicksy_dl.linkchecker --media-id 524177           # check the links of one title
    python -m flicksy_dl.linkchecker --host example.com --limit 50
Then re-run  python -m flicksy_dl.importer  to apply the results (the DB itself is opened read-only here).

Rules (all deliberate):
  * Only http/https links the importer marked valid. Only metadata is requested: HEAD, and if HEAD is not
    conclusive a GET with 'Range: bytes=0-0' whose body is NEVER read (connection closed after the headers).
  * Only a clear answer changes a status:  2xx/206 with a non-HTML content type -> working;
    404/410 confirmed by the GET fallback as well -> unavailable.
  * Anything else (timeout, DNS error, 401/403/429/5xx, an HTML page, redirect loops, private addresses) is
    INCONCLUSIVE: the link stays 'unverified'. A failed HEAD alone is never proof that a link is dead.
  * No login, CAPTCHA or paywall is ever bypassed; 401/403 simply stay unverified.
  * Polite: per-host delay (default 1.5 s), few workers, timeouts, at most 3 redirects, resumable
    (links with a definitive result are skipped unless --recheck).
  * Results go to data/overlay/link-status.json (merged atomically, never loses other entries) and a report
    to data/overlay/link-check-report.json.
"""
import argparse
import datetime
import http.client
import ipaddress
import json
import os
import socket
import sqlite3
import ssl
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin, urlsplit

UA = 'FlicksyLinkChecker/1.0 (+metadata-only; contact: site owner)'
MAX_REDIRECTS = 3


def _now():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _is_private(host):
    """True when the host resolves to a loopback/private/link-local address (we never probe those)."""
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False  # unresolvable: the request itself will fail as 'inconclusive'
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            return True
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return True
    return False


class Inconclusive(Exception):
    pass


def _request(method, url, timeout, allow_private):
    """One metadata request following up to MAX_REDIRECTS redirects. Returns (status, content_type).
    The body is never read; the connection is closed right after the headers."""
    for _ in range(MAX_REDIRECTS + 1):
        p = urlsplit(url)
        if p.scheme not in ('http', 'https') or not p.hostname:
            raise Inconclusive('bad scheme')
        if not allow_private and _is_private(p.hostname):
            raise Inconclusive('private address refused')
        cls = http.client.HTTPSConnection if p.scheme == 'https' else http.client.HTTPConnection
        kw = {'timeout': timeout}
        if p.scheme == 'https':
            kw['context'] = ssl.create_default_context()
        conn = cls(p.hostname, p.port, **kw)
        try:
            path = (p.path or '/') + ('?' + p.query if p.query else '')
            headers = {'User-Agent': UA, 'Accept': '*/*', 'Connection': 'close'}
            if method == 'GET':
                headers['Range'] = 'bytes=0-0'
            conn.request(method, path, headers=headers)
            r = conn.getresponse()
            status, loc, ctype = r.status, r.getheader('Location'), (r.getheader('Content-Type') or '').lower()
        except (OSError, http.client.HTTPException, ssl.SSLError) as e:
            raise Inconclusive('%s: %s' % (type(e).__name__, e))
        finally:
            conn.close()  # body (if any) is dropped unread
        if status in (301, 302, 303, 307, 308) and loc:
            url = urljoin(url, loc)
            continue
        return status, ctype
    raise Inconclusive('too many redirects')


def check_url(url, timeout=10, allow_private=False):
    """Returns (status, http_status, note) where status is working | unavailable | unverified."""
    last = None
    try:
        hs, hct = _request('HEAD', url, timeout, allow_private)
        last = hs
        if 200 <= hs < 300 and 'text/html' not in hct:
            return 'working', hs, 'HEAD ok'
    except Inconclusive as e:
        hs, hct = None, ''
        note = str(e)
        if 'private' in note or 'bad scheme' in note:
            return 'unverified', None, note
    # HEAD was not conclusive -> metadata-only ranged GET
    try:
        gs, gct = _request('GET', url, timeout, allow_private)
    except Inconclusive as e:
        return 'unverified', last, 'inconclusive: %s' % e
    if gs in (200, 206) and 'text/html' not in gct:
        return 'working', gs, 'GET range ok'
    if gs in (404, 410):
        return 'unavailable', gs, 'GET %d%s' % (gs, '' if hs is None else ' (HEAD %s)' % hs)
    if gs in (200, 206):
        return 'unverified', gs, 'returned an HTML page (not a file)'
    return 'unverified', gs, 'inconclusive HTTP %d' % gs


class HostGate:
    """Serialises requests per host with a minimum delay between them."""
    def __init__(self, delay):
        self.delay, self._locks, self._last, self._g = delay, {}, {}, threading.Lock()

    def run(self, host, fn):
        with self._g:
            lock = self._locks.setdefault(host, threading.Lock())
        with lock:
            wait = self._last.get(host, 0) + self.delay - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            try:
                return fn()
            finally:
                self._last[host] = time.monotonic()


def _ref(origin, origin_ref):
    return '%s:%s' % ('scan' if origin.startswith('scan:') else origin, origin_ref)


def select_links(db_path, limit=None, media_id=None, host=None, skip_refs=()):
    con = sqlite3.connect('file:%s?mode=ro' % db_path.replace('\\', '/'), uri=True)
    try:
        q = "SELECT id, origin, origin_ref, url_clean, host FROM links WHERE url_valid=1"
        a = []
        if media_id is not None:
            q += ' AND media_id=?'; a.append(media_id)
        if host:
            q += ' AND host=?'; a.append(host)
        q += ' ORDER BY id'
        out = []
        for lid, origin, oref, url, h in con.execute(q, a):
            if oref is None or _ref(origin, oref) in skip_refs:
                continue
            out.append((lid, _ref(origin, oref), url, h))
            if limit and len(out) >= limit:
                break
        return out
    finally:
        con.close()


def _load(path):
    try:
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_atomic(path, data):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path) or '.', suffix='.tmp')
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def run(db_path, overlay_path, limit=None, media_id=None, host=None, delay=1.5, workers=4, timeout=10,
        recheck=False, allow_private=False, log=print):
    overlay = _load(overlay_path)
    skip = set() if recheck else {k for k, v in overlay.items() if isinstance(v, dict) and v.get('status') in ('working', 'unavailable')}
    todo = select_links(db_path, limit, media_id, host, skip)
    log('links to check: %d' % len(todo))
    gate, lock = HostGate(delay), threading.Lock()
    tally = {'working': 0, 'unavailable': 0, 'unverified': 0}

    def one(item):
        lid, ref, url, h = item
        st, code, note = gate.run(h or urlsplit(url).hostname, lambda: check_url(url, timeout, allow_private))
        with lock:
            tally[st] += 1
            old = overlay.get(ref) if isinstance(overlay.get(ref), dict) else None
            # an inconclusive re-check never downgrades an earlier definitive result
            if st == 'unverified' and old and old.get('status') in ('working', 'unavailable'):
                return
            overlay[ref] = {'status': st, 'checked_at': _now(), 'http_status': code, 'note': note}

    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        list(ex.map(one, todo))
    _save_atomic(overlay_path, overlay)
    report = {'checked_at': _now(), 'checked': len(todo), **tally}
    _save_atomic(os.path.join(os.path.dirname(overlay_path) or '.', 'link-check-report.json'), report)
    log('done:', tally, '-> %s (now re-run the importer to apply)' % overlay_path)
    return report


def main():
    ap = argparse.ArgumentParser(description='Metadata-only link checker (never downloads media).')
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument('--data-dir', default=os.path.join(root, 'data'))
    ap.add_argument('--db')
    ap.add_argument('--overlay')
    ap.add_argument('--limit', type=int, default=100, help='max links to check this run (default 100)')
    ap.add_argument('--media-id', type=int)
    ap.add_argument('--host')
    ap.add_argument('--delay', type=float, default=1.5, help='seconds between requests to the same host')
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--timeout', type=float, default=10)
    ap.add_argument('--recheck', action='store_true', help='also re-check links that already have a definitive result')
    a = ap.parse_args()
    db = a.db or os.path.join(a.data_dir, 'flicksy.db')
    ov = a.overlay or os.path.join(a.data_dir, 'overlay', 'link-status.json')
    run(db, ov, a.limit, a.media_id, a.host, a.delay, a.workers, a.timeout, a.recheck)


if __name__ == '__main__':
    main()
