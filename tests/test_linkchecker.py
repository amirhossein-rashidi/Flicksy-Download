"""Link checker tests against a local throw-away HTTP server (no internet, nothing downloaded)."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from flicksy_dl import importer, linkchecker
from tests.test_mvp import mini_archive

SEEN = []


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _go(self, method):
        SEEN.append((method, self.path, self.headers.get('Range')))
        p = self.path
        if p == '/ok':
            return self._send(200, 'video/x-matroska')
        if p == '/nohead':
            return self._send(405 if method == 'HEAD' else 206, 'video/mp4')
        if p == '/gone':
            return self._send(404, 'text/plain')
        if p == '/headonly404':
            return self._send(404 if method == 'HEAD' else 206, 'video/mp4')
        if p == '/forbidden':
            return self._send(403, 'text/plain')
        if p == '/html':
            return self._send(200, 'text/html')
        if p == '/redir':
            self.send_response(302); self.send_header('Location', '/ok'); self.end_headers(); return
        if p == '/loop':
            self.send_response(302); self.send_header('Location', '/loop'); self.end_headers(); return
        return self._send(500, 'text/plain')

    def _send(self, code, ctype):
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', '5'); self.end_headers()

    def do_HEAD(self):
        self._go('HEAD')

    def do_GET(self):
        self._go('GET')


@pytest.fixture(scope='module')
def base():
    s = ThreadingHTTPServer(('127.0.0.1', 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    yield 'http://127.0.0.1:%d' % s.server_address[1]
    s.shutdown()


def chk(base, path):
    return linkchecker.check_url(base + path, timeout=3, allow_private=True)[:2]


def test_classification(base):
    assert chk(base, '/ok') == ('working', 200)
    assert chk(base, '/nohead') == ('working', 206)
    assert chk(base, '/redir') == ('working', 200)
    assert chk(base, '/gone') == ('unavailable', 404)
    assert chk(base, '/headonly404') == ('working', 206)      # failed HEAD is not proof of death
    assert chk(base, '/forbidden')[0] == 'unverified'          # never bypass auth
    assert chk(base, '/html')[0] == 'unverified'               # landing page != file
    assert chk(base, '/loop')[0] == 'unverified'
    assert chk(base, '/boom')[0] == 'unverified'


def test_get_uses_range_only(base):
    SEEN.clear()
    chk(base, '/nohead')
    assert [m for m, _, r in SEEN if m == 'GET' and r == 'bytes=0-0']


def test_private_and_bad_scheme_refused_by_default():
    assert linkchecker.check_url('http://127.0.0.1:9/x')[0] == 'unverified'
    assert linkchecker.check_url('ftp://example.com/x')[0] == 'unverified'
    assert linkchecker.check_url('http://[::1]:9/x')[0] == 'unverified'


def test_unreachable_is_inconclusive():
    assert linkchecker.check_url('http://127.0.0.1:1/x', timeout=1, allow_private=True)[0] == 'unverified'


def test_run_end_to_end_overlay_and_import(base, tmp_path):
    a = mini_archive()
    s = a['movie']['10']['sources']
    s[0]['url'] = base + '/ok'; s[1]['url'] = base + '/gone'; s[2]['url'] = base + '/forbidden'
    d = tmp_path / 'data'; (d / 'overlay').mkdir(parents=True)
    a['seasons']['20'][0]['episodes'][0]['sources'][0]['url'] = base + '/forbidden'
    arch = d / 'archive.json'; arch.write_text(json.dumps(a, ensure_ascii=False), encoding='utf-8')
    db = d / 'flicksy.db'
    importer.build(str(arch), str(db), str(d), log=lambda *x: None)
    ov = d / 'overlay' / 'link-status.json'
    rep = linkchecker.run(str(db), str(ov), allow_private=True, delay=0, workers=2, timeout=3, log=lambda *x: None)
    data = json.loads(ov.read_text(encoding='utf-8'))
    assert data['archive:100']['status'] == 'working'
    assert data['archive:102']['status'] == 'unverified'
    assert data['archive:101']['status'] == 'unavailable'
    # second run: definitive results skipped, the two forbidden links are retried
    rep2 = linkchecker.run(str(db), str(ov), allow_private=True, delay=0, timeout=3, log=lambda *x: None)
    assert rep2['checked'] == 2
    # apply via importer
    importer.build(str(arch), str(db), str(d), log=lambda *x: None)
    import sqlite3
    con = sqlite3.connect(str(db))
    assert con.execute("SELECT status FROM links WHERE origin_ref='100'").fetchone()[0] == 'working'
    assert con.execute("SELECT status FROM links WHERE origin_ref='102'").fetchone()[0] == 'unverified'


def test_inconclusive_never_downgrades(base, tmp_path):
    a = mini_archive(); a['movie']['10']['sources'][0]['url'] = base + '/forbidden'
    d = tmp_path / 'data'; (d / 'overlay').mkdir(parents=True)
    arch = d / 'archive.json'; arch.write_text(json.dumps(a, ensure_ascii=False), encoding='utf-8')
    importer.build(str(arch), str(d / 'flicksy.db'), str(d), log=lambda *x: None)
    ov = d / 'overlay' / 'link-status.json'
    ov.write_text(json.dumps({'archive:100': {'status': 'working', 'http_status': 200}}), encoding='utf-8')
    linkchecker.run(str(d / 'flicksy.db'), str(ov), recheck=True, allow_private=True, delay=0, timeout=3, log=lambda *x: None)
    assert json.loads(ov.read_text(encoding='utf-8'))['archive:100']['status'] == 'working'
