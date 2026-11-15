"""Static generator tests: link gate (nothing leaks by default), shard layout, JS/Python text normalisation parity."""
import json
import os
import shutil
import subprocess

import pytest

from flicksy_dl import importer, staticgen
from flicksy_dl.textnorm import norm
from tests.test_mvp import mini_archive


@pytest.fixture()
def db(tmp_path):
    d = tmp_path / 'data'; d.mkdir()
    a = mini_archive()
    a['movie']['10']['image'] = 'http://img.test/a.jpg'
    arch = d / 'archive.json'; arch.write_text(json.dumps(a, ensure_ascii=False), encoding='utf-8')
    importer.build(str(arch), str(d / 'flicksy.db'), str(d), log=lambda *x: None)
    return str(d / 'flicksy.db')


def all_text(out):
    t = ''
    for root, _, files in os.walk(out):
        for f in files:
            if f.endswith('.json'):
                t += open(os.path.join(root, f), encoding='utf-8').read()
    return t


def test_default_publishes_no_link_urls(db, tmp_path):
    out = str(tmp_path / 'pub')
    rep = staticgen.generate(db, out, publish_links=False, log=lambda *x: None)
    txt = all_text(out)
    for host in ('h1.test', 'h2.test', 'h3.test', 'bad.test'):
        assert host not in txt.replace('"host":"%s"' % host, '')  # host NAMES may appear as metadata, URLs never
    assert 'http://h1.test' not in txt and 'http://h2.test' not in txt and 'http://h3.test' not in txt
    assert rep['linksPublished'] == 0 and rep['linksWithheld'] >= 3
    assert os.path.exists(os.path.join(out, 'index.html')) and os.path.exists(os.path.join(out, 'api-client.js'))
    assert 'staticgen' in open(os.path.join(out, 'api-client.js'), encoding='utf-8').read()


def test_publish_requires_allowed_host(db, tmp_path):
    out = str(tmp_path / 'pub')
    # flag on but empty allow-list -> still nothing
    staticgen.generate(db, out, publish_links=True, allowed_hosts=[], log=lambda *x: None)
    assert 'http://h1.test' not in all_text(out)
    # allow only h1.test (and subdomains of it)
    rep = staticgen.generate(db, out, publish_links=True, allowed_hosts=['h1.test'], log=lambda *x: None)
    txt = all_text(out)
    assert 'http://h1.test/' in txt and 'http://h2.test' not in txt and 'http://h3.test' not in txt
    assert rep['linksPublished'] == 1


def test_host_matching():
    assert staticgen.host_allowed('cdn.h1.test', ['h1.test'])
    assert staticgen.host_allowed('H1.test', ['h1.test'])
    assert not staticgen.host_allowed('evilh1.test', ['h1.test'])
    assert not staticgen.host_allowed(None, ['h1.test'])


def test_layout_and_index(db, tmp_path):
    out = str(tmp_path / 'pub')
    staticgen.generate(db, out, log=lambda *x: None)
    idx = json.load(open(os.path.join(out, 'data', 'index.json'), encoding='utf-8'))
    assert {r[0] for r in idx} == {10, 11, 12, 20, 21}
    assert idx[0][4] is not None  # newest first
    shard = json.load(open(os.path.join(out, 'data', 't', '0.json'), encoding='utf-8'))
    assert '10' in shard and 'description' not in shard['10'] and shard['10']['title'] == 'Alpha'
    meta = json.load(open(os.path.join(out, 'data', 'meta.json'), encoding='utf-8'))
    assert 'archiveSha256' not in meta['health'] and 'facets' in meta


@pytest.mark.skipif(not shutil.which('node'), reason='node not installed')
def test_js_norm_matches_python(tmp_path):
    src = open(os.path.join(os.path.dirname(staticgen.__file__), 'web', 'api-client-static.js'), encoding='utf-8').read()
    samples = ['Mob Land', "Don't Look", 'كتاب ياسمن ۱۲۳', 'می‌خواهم  Ṭest!!', 'Tom & Jerry', 'سریال_۲ ٣٤', 'ﻓﻴﻠﻢ']
    js = "global.window={};global.fetch=()=>{};" + src + ";" + \
         "const n=%s;" % 'null' + "console.log(JSON.stringify(%s.map(window.__norm)))" % json.dumps(samples, ensure_ascii=False)
    # expose norm for the test without changing production code: evaluate the file and call the internal via a tiny shim
    shim = src.replace('window.Api = {', 'window.__norm = norm; window.Api = {')
    code = "global.window={};global.fetch=()=>{};" + shim + ";console.log(JSON.stringify(%s.map(window.__norm)))" % json.dumps(samples, ensure_ascii=False)
    f = tmp_path / 't.js'; f.write_text(code, encoding='utf-8')
    out = subprocess.run(['node', str(f)], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    assert json.loads(out.stdout) == [norm(s) for s in samples]
