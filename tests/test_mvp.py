"""Phase B tests: importer, repo/API. Synthetic archive (always runs) + the real archive (skipped if absent)."""
import hashlib
import json
import os
import shutil
import sqlite3

import pytest

from flicksy_dl import importer, repo
from flicksy_dl.api import create_app
from flicksy_dl.textnorm import fts_query, norm, parse_description

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST = {'Host': '127.0.0.1:8090'}


def mini_archive():
    desc = 'نام اصلی: Alpha\r\n\r\nنام پارسی:   آلفا\r\n\r\nکارگردان :  Jane Roe\r\n\r\nخلاصه داستان : \r\n\r\nداستان کوتاه'
    return {
        'movie': {
            '10': {'id': 10, 'type': 'movie', 'title': 'Alpha', 'description': desc, 'year': 2020, 'imdb': 7.0, 'rating': 0, 'unknown_future_field': {'a': [1, 2]},
                   'genres': [{'id': 1, 'title': 'درام'}], 'country': [{'id': 5, 'title': 'ایران', 'image': None}],
                   'sources': [{'id': 100, 'quality': '1080', 'type': 'mkv', 'url': 'http://h1.test/Alpha.2020.1080p.WEB-DL.x265-GRP.mkv'},
                               {'id': 101, 'quality': '480', 'type': 'mkv', 'url': '00MBhttp://bad.test/x.mkv'},
                               {'id': 102, 'quality': '720', 'type': 'mkv', 'url': 'http://h2.test/Alpha 720.mkv\t'}]},
            '11': {'id': 11, 'type': 'movie', 'title': 'Alpha', 'description': '', 'year': 2020, 'genres': [], 'country': [], 'sources': []},
            '12': {'id': 12, 'type': 'movie', 'title': 'Beta', 'description': None, 'year': 0, 'genres': [{'id': 2, 'title': 'اکشن'}], 'country': []},
        },
        'serie': {
            '20': {'id': 20, 'type': 'serie', 'title': 'Gamma Show', 'description': 'نام پارسی سریال : گاما', 'year': 2024, 'genres': [{'id': 1, 'title': 'درام'}], 'country': []},
            '21': {'id': 21, 'type': 'serie', 'title': 'No Seasons', 'description': '', 'year': 2023, 'genres': [], 'country': []},
        },
        'next_page': {'movie': 3, 'serie': 2}, 'done': True,
        'seasons': {'20': [{'id': 900, 'title': 'فصل اول', 'episodes': [
            {'id': 9001, 'title': 'قسمت 1', 'description': None, 'duration': None, 'sources': [{'id': 1, 'quality': '720', 'type': 'mkv', 'url': 'http://h3.test/Gamma.S01E01.720p.mkv'}]},
            {'id': 9002, 'title': 'قسمت 2', 'description': None, 'duration': None, 'sources': []}]}]},
    }


@pytest.fixture()
def env(tmp_path):
    d = tmp_path / 'data'
    (d / 'overlay').mkdir(parents=True)
    arch = d / 'archive.json'
    arch.write_text(json.dumps(mini_archive(), ensure_ascii=False), encoding='utf-8')
    return d, arch


def run(d, arch):
    return importer.build(str(arch), str(d / 'flicksy.db'), str(d), log=lambda *a: None)


def sha(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


# ---------- text helpers ----------
def test_norm_unifies_arabic_persian():
    assert norm('كتاب ي ۲۰۲۵') == norm('کتاب ی 2025') == 'کتاب ی 2025'
    assert fts_query('') is None and fts_query('a"b') == '"a"* "b"*'


def test_parse_description_lines():
    d = parse_description(mini_archive()['movie']['10']['description'])
    assert d['title_fa'] == 'آلفا' and d['director'] == 'Jane Roe' and d['synopsis'] == 'داستان کوتاه'
    assert parse_description(None) == {} and parse_description('random text') == {}


# ---------- importer ----------
def test_counts_and_separation(env):
    d, arch = env
    s = run(d, arch)
    assert (s['movies'], s['series']) == (3, 2)
    con = sqlite3.connect(d / 'flicksy.db')
    assert con.execute("select count(*) from media where kind='movie' and id in (20,21)").fetchone()[0] == 0
    assert con.execute("select count(*) from media where kind='series' and id in (10,11,12)").fetchone()[0] == 0


def test_every_record_preserved_with_unknown_fields(env):
    d, arch = env
    run(d, arch)
    con = sqlite3.connect(d / 'flicksy.db')
    orig = mini_archive()
    for src in (orig['movie'], orig['serie']):
        for k, it in src.items():
            assert json.loads(con.execute('select json from media_raw where media_id=?', (int(k),)).fetchone()[0]) == it
    assert 'unknown_future_field' in con.execute('select json from media_raw where media_id=10').fetchone()[0]


def test_archive_never_modified(env):
    d, arch = env
    before = sha(arch)
    run(d, arch)
    assert sha(arch) == before


def test_duplicates_flagged_not_merged(env):
    d, arch = env
    run(d, arch)
    con = sqlite3.connect(d / 'flicksy.db')
    assert con.execute('select count(*) from media where id in (10,11)').fetchone()[0] == 2
    assert con.execute('select count(distinct dup_key) from media where id in (10,11)').fetchone()[0] == 1
    c = repo.connect(str(d / 'flicksy.db'))
    assert [x['id'] for x in repo.title_detail(c, 10)['possibleDuplicates']] == [11]


def test_links_parsed_and_invalid_hidden(env):
    d, arch = env
    run(d, arch)
    c = repo.connect(str(d / 'flicksy.db'))
    t = repo.title_detail(c, 10)
    assert t['hiddenInvalidLinks'] == 1 and len(t['releases']) == 2
    top = t['releases'][0]
    assert (top['resolution'], top['sourceTag'], top['codec'], top['releaseGroup'], top['status']) == (1080, 'WEB-DL', 'x265', 'GRP', 'unverified')
    assert [r['url'] for r in t['releases']][1] == 'http://h2.test/Alpha 720.mkv'      # trailing tab trimmed only in url_clean
    raw = sqlite3.connect(d / 'flicksy.db').execute('select url from links where origin_ref=?', ('102',)).fetchone()[0]
    assert raw.endswith('\t')                                                          # original text kept


def test_seasons_episodes_from_archive(env):
    d, arch = env
    s = run(d, arch)
    assert (s['seasons'], s['episodes']) == (1, 2)
    c = repo.connect(str(d / 'flicksy.db'))
    se = repo.title_detail(c, 20)['seasons']
    assert se[0]['number'] == 1 and [e['number'] for e in se[0]['episodes']] == [1, 2] and len(se[0]['episodes'][0]['links']) == 1
    assert repo.title_detail(c, 21)['seasons'] == []


def test_overlay_adds_but_never_replaces(env):
    d, arch = env
    ov = {'20': [{'id': 900, 'title': 'CONFLICT', 'episodes': []}, {'id': 901, 'title': 'فصل دوم', 'episodes': [{'id': 9100, 'title': 'قسمت 1', 'sources': []}]}],
          '21': [{'id': 950, 'title': 'فصل اول', 'episodes': []}], '9999': [{'id': 1, 'title': 'orphan', 'episodes': []}]}
    (d / 'overlay' / 'seasons.json').write_text(json.dumps(ov, ensure_ascii=False), encoding='utf-8')
    s = run(d, arch)
    con = sqlite3.connect(d / 'flicksy.db')
    assert con.execute('select title,origin from seasons where id=900').fetchone() == ('فصل اول', 'archive')
    assert con.execute('select origin from seasons where id=901').fetchone()[0] == 'overlay:seasons.json'
    assert s['seasons'] == 3 and len(s['notes']['overlay_conflicts']) == 1 and len(s['notes']['overlay_orphans']) == 1


def test_link_status_overlay(env):
    d, arch = env
    (d / 'overlay' / 'link-status.json').write_text(json.dumps({'archive:100': {'status': 'working', 'checked_at': '2026-11-01T00:00:00', 'http_status': 206},
                                                                 'archive:102': {'status': 'unavailable', 'checked_at': '2026-11-01T00:00:00', 'http_status': 404}}))
    run(d, arch)
    t = repo.title_detail(repo.connect(str(d / 'flicksy.db')), 10)
    assert {r['status'] for r in t['releases']} == {'working', 'unavailable'}


def test_scan_links_matched_and_ambiguity_flagged(env):
    d, arch = env
    (d / 'scan-x.tsv').write_text('http://s.test/Alpha.2020.1080p.WEB-DL.mkv\t1000\nhttp://s.test/Gamma.Show.S01E01.1080p.mkv\t2000\nhttp://s.test/Zzz.2020.mkv\t5\n')
    s = run(d, arch)
    assert s['scan_unmatched'] == 1 and s['scan_ambiguous'] == 1
    c = repo.connect(str(d / 'flicksy.db'))
    assert any(r['origin'] == 'scan' and r['ambiguousMatch'] for r in repo.title_detail(c, 10)['releases'])   # Alpha exists twice (ids 10, 11)
    eps = repo.title_detail(c, 20)['seasons'][0]['episodes']
    assert any(l['origin'] == 'scan' for l in eps[0]['links'])


def test_failed_import_keeps_previous_db(env):
    d, arch = env
    run(d, arch)
    before = sha(d / 'flicksy.db')
    bad = mini_archive()
    bad['serie']['10'] = {'id': 10, 'type': 'serie', 'title': 'clash'}            # same id as a movie
    arch.write_text(json.dumps(bad), encoding='utf-8')
    with pytest.raises(importer.ImportErrorFatal):
        run(d, arch)
    assert sha(d / 'flicksy.db') == before


# ---------- API ----------
@pytest.fixture()
def client(env):
    d, arch = env
    run(d, arch)
    return create_app(str(d / 'flicksy.db')).test_client()


def get(c, url):
    r = c.get(url, headers=HOST)
    return r.status_code, r.get_json()


def test_api_list_search_filters(client):
    assert get(client, '/api/v2/titles')[1]['items'][0]['year'] == 2024                   # newest first
    assert [i['id'] for i in get(client, '/api/v2/titles?q=gam')[1]['items']] == [20]       # prefix search
    assert [i['id'] for i in get(client, '/api/v2/titles?q=آلفا')[1]['items']] == [10]      # Persian title
    assert {i['id'] for i in get(client, '/api/v2/titles?kind=movie')[1]['items']} == {10, 11, 12}
    assert {i['id'] for i in get(client, '/api/v2/titles?genre=1')[1]['items']} == {10, 20}
    assert {i['id'] for i in get(client, '/api/v2/titles?q=alpha&kind=movie&year=2020&genre=1')[1]['items']} == {10}
    s, j = get(client, '/api/v2/titles?limit=2')
    assert len(j['items']) == 2 and j['hasMore'] is True
    assert get(client, '/api/v2/titles?limit=2&offset=4')[1]['hasMore'] is False


def test_api_facets_counts(client):
    f = get(client, '/api/v2/facets')[1]
    assert f['totals'] == {'movie': 3, 'series': 2}
    assert {(g['title'], g['count']) for g in f['genresByKind']['movie']} == {('درام', 1), ('اکشن', 1)}
    assert [(g['title'], g['count']) for g in f['genresByKind']['series']] == [('درام', 1)]


def test_api_featured_only_with_poster(env):
    d, arch = env
    a = mini_archive()
    a['movie']['10']['image'] = 'http://img.test/a.jpg'
    a['movie']['10']['imdb'] = 7.5
    arch.write_text(json.dumps(a, ensure_ascii=False), encoding='utf-8')
    run(d, arch)
    c = create_app(str(d / 'flicksy.db')).test_client()
    assert [i['id'] for i in get(c, '/api/v2/featured')[1]['items']] == [10]


def test_api_featured_skips_announcement_records(env):
    d, arch = env
    a = mini_archive()
    a['movie']['10']['image'] = 'http://img.test/a.jpg'
    a['movie']['10']['imdb'] = 7.5
    a['movie']['10']['genres'] = [{'id': i, 'title': 'g%d' % i} for i in range(1, 40)]
    arch.write_text(json.dumps(a, ensure_ascii=False), encoding='utf-8')
    run(d, arch)
    c = create_app(str(d / 'flicksy.db')).test_client()
    assert get(c, '/api/v2/featured')[1]['items'] == []


def test_api_errors_and_guards(client):
    assert get(client, '/api/v2/titles/999')[0] == 404
    assert get(client, '/api/v2/titles?year=abc')[0] == 400
    assert get(client, '/api/v2/titles?kind=x')[0] == 400
    assert get(client, '/api/v2/titles?q=%22%20OR%201%3D1%20--')[0] == 200                 # hostile text is just text
    assert client.get('/api/v2/health', headers={'Host': 'evil.test'}).status_code == 403
    assert client.post('/api/v2/titles').status_code == 405


def test_api_can_hide_links(env):
    d, arch = env
    run(d, arch)
    c = create_app(str(d / 'flicksy.db'), expose_links=False).test_client()
    assert all(r['url'] is None for r in get(c, '/api/v2/titles/10')[1]['title']['releases'])


# ---------- real archive ----------
REAL = os.path.join(ROOT, 'data', 'archive.json')
real = pytest.mark.skipif(not os.path.exists(REAL), reason='real archive not present')


@real
def test_real_import_full(tmp_path):
    d = tmp_path / 'data'
    shutil.copytree(os.path.join(ROOT, 'data'), d, ignore=shutil.ignore_patterns('flicksy.db*', 'archive.json'))
    arch = d / 'archive.json'
    os.symlink(REAL, arch)
    before = sha(REAL)
    s = importer.build(str(arch), str(d / 'flicksy.db'), str(d), log=lambda *a: None)
    assert sha(REAL) == before
    assert (s['movies'], s['series'], s['seasons'], s['episodes']) == (20524, 9544, 2, 20)
    assert s['links_archive'] == 54134 + 58 and s['links_invalid_scheme'] == 1
    c = repo.connect(str(d / 'flicksy.db'))
    mob = repo.title_detail(c, 27965)
    assert [(x['number'], len(x['episodes'])) for x in mob['seasons']] == [(1, 11), (2, 9)]
    assert get_titles(c, 'mobland') == [27965] and get_titles(c, 'سرزمین اوباش') == [27965]
    assert repo.title_detail(c, 2204)['hiddenInvalidLinks'] == 1


def get_titles(c, q):
    return [i['id'] for i in repo.list_titles(c, q=q)['items']]
