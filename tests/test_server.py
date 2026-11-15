"""Tests for the (incrementally modified) server.py. No real network is ever used."""
import hashlib
import json
import os
import re

import pytest

import urlguard
from conftest import ROOT, load_server

SECRET = 'TESTKEY-abc123-NOT-REAL'
L = '/api/v1/providers/sermovie/'


def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


def get(srv, url, **kw):
    return srv.app.test_client().get(url, **kw)


# ---------- configuration / binding ----------

def test_defaults_are_local_and_offline(offline_server):
    srv = offline_server
    assert srv.HOST == '127.0.0.1'
    assert srv.MODE == 'offline'
    assert urlguard.network_enabled() is False
    assert srv.LIVE_SEASONS is False


def test_public_bind_is_refused_without_explicit_permission(monkeypatch, data_dir):
    srv = load_server(monkeypatch, data_dir, FLICKSY_HOST='0.0.0.0')
    with pytest.raises(SystemExit):
        srv.check_bind('0.0.0.0')
    srv.check_bind('127.0.0.1')
    srv.check_bind('localhost')
    srv2 = load_server(monkeypatch, data_dir, FLICKSY_HOST='0.0.0.0', FLICKSY_ALLOW_PUBLIC_BIND='1')
    srv2.check_bind('0.0.0.0')          # allowed only with the explicit switch


def test_online_mode_without_key_stays_offline(monkeypatch, data_dir):
    load_server(monkeypatch, data_dir, FLICKSY_MODE='online')
    assert urlguard.network_enabled() is False


def test_key_alone_does_not_enable_network(monkeypatch, data_dir):
    load_server(monkeypatch, data_dir, FLICKSY_API_KEY=SECRET)
    assert urlguard.network_enabled() is False


def test_no_hardcoded_secret_in_source():
    pat = re.compile(r"""(?i)\b(key|token|secret|password|api_key)\w*\s*=\s*['"][A-Za-z0-9_\-]{16,}['"]""")
    for name in os.listdir(ROOT):
        if name.endswith(('.py', '.js', '.html', '.toml', '.json')) or name == '.env.example':
            text = open(os.path.join(ROOT, name), encoding='utf-8', errors='replace').read()
            assert not pat.search(text), f'possible hard-coded secret in {name}'
    assert 'KEY = ' in open(os.path.join(ROOT, 'server.py'), encoding='utf-8').read()


def test_env_example_has_placeholders_only():
    text = open(os.path.join(ROOT, '.env.example'), encoding='utf-8').read()
    assert re.search(r'^FLICKSY_API_KEY=\s*$', text, re.M)
    assert not re.search(r'[A-F0-9]{24,}', text)


def test_dotenv_file_is_read_without_overriding_real_environment(tmp_path, monkeypatch, data_dir):
    srv = load_server(monkeypatch, data_dir)
    f = tmp_path / '.env'
    f.write_text('# c\nFLICKSY_TEST_A=from_file\nFLICKSY_TEST_B="quoted"\n', encoding='utf-8')
    monkeypatch.setenv('FLICKSY_TEST_B', 'from_env')
    monkeypatch.delenv('FLICKSY_TEST_A', raising=False)
    srv.load_dotenv(str(f))
    assert os.environ['FLICKSY_TEST_A'] == 'from_file'
    assert os.environ['FLICKSY_TEST_B'] == 'from_env'
    monkeypatch.delenv('FLICKSY_TEST_A', raising=False)


# ---------- offline behaviour: zero outside connections ----------

def test_offline_everything_works_without_any_connection(offline_server, no_network, data_dir):
    srv = offline_server
    before = sha(data_dir / 'archive.json')
    h = get(srv, '/api/v1/health').get_json()
    assert h['mode'] == 'offline' and h['movies'] == 1 and h['series'] == 2
    r = get(srv, L + 'list?path=/Movies/')
    assert r.status_code == 200 and r.get_json()['directory']['entries']
    r = get(srv, L + 'list?path=/Movies/2020/')
    assert r.get_json()['directory']['count'] == 1
    m = get(srv, L + 'movie?path=/Movies/2020/1/').get_json()['movie']
    assert m['downloadCount'] == 3
    s = get(srv, L + 'series?path=/Series/2025/27965/').get_json()['series']
    assert s['seasonCount'] == 1 and s['episodeCount'] == 1
    assert sha(data_dir / 'archive.json') == before


def test_offline_server_ignores_online_request_and_says_so(offline_server, no_network):
    srv = offline_server
    m = get(srv, L + 'movie?path=/Movies/p1/1/&mode=online').get_json()['movie']
    assert m['title'] == 'Test Movie' and 'آفلاین' in m['warnings'][0]
    s = get(srv, L + 'series?path=/Series/p1/27965/&mode=online').get_json()['series']
    assert s['seasonCount'] == 1 and 'آفلاین' in s['warnings'][0]
    r = get(srv, L + 'list?path=/Movies/p1/&mode=online')
    assert r.status_code == 200 and r.get_json()['directory']['entries'] == []   # offline listing, no live pages


def test_series_without_stored_seasons_is_not_fetched_and_archive_not_modified(
        offline_server, no_network, data_dir):
    """Old default: fetched seasons from the internet and wrote them into archive.json."""
    srv = offline_server
    before = sha(data_dir / 'archive.json')
    r = get(srv, L + 'series?path=/Series/2024/28000/')
    s = r.get_json()['series']
    assert r.status_code == 200 and s['seasons'] == [] and s['warnings'] == []
    assert sha(data_dir / 'archive.json') == before
    assert not list(data_dir.glob('*.tmp'))
    assert not hasattr(srv, 'save_seasons')                # the function that wrote into the archive is gone


def test_file_info_offline_makes_no_request_and_uses_the_same_error_code(offline_server, no_network):
    srv = offline_server
    m = get(srv, L + 'movie?path=/Movies/2020/1/').get_json()['movie']
    r = get(srv, L + 'file-info', query_string={'path': m['downloads'][0]['path']})
    body = r.get_json()
    assert r.status_code == 502 and body['error'] == 'SIZE_UNAVAILABLE' and 'آفلاین' in body['message']


def test_file_info_unknown_path(offline_server):
    assert get(offline_server, L + 'file-info?path=/Movies/2020/1/dl-9').status_code == 404


# ---------- data hygiene ----------

def test_bad_download_urls_are_not_linked_but_records_remain(offline_server):
    m = get(offline_server, L + 'movie?path=/Movies/2020/1/').get_json()['movie']
    urls = [d['downloadUrl'] for d in m['downloads']]
    assert urls[0].startswith('http://example.test/')
    assert urls[1] == '' and urls[2] == ''                 # scheme-less text and javascript: are not links
    assert [d['invalidUrl'] for d in m['downloads']] == [False, True, True]
    assert m['downloadCount'] == 3                         # nothing silently dropped


def test_links_with_spaces_or_trailing_tab_stay_links(tmp_path, monkeypatch):
    """Real archive links contain spaces / a trailing tab; they were links before and must stay links."""
    import conftest
    arc = json.loads(json.dumps(conftest.SMALL_ARCHIVE))
    arc['movie']['1']['sources'] = [
        {'id': 1, 'quality': '720', 'type': 'mkv', 'url': 'http://example.test/a b/Test.mkv\t'},
        {'id': 2, 'quality': '480', 'type': 'mkv', 'url': 'https://example.test/پ.mkv'}]
    d = tmp_path / 'data'
    d.mkdir()
    (d / 'archive.json').write_text(json.dumps(arc, ensure_ascii=False), encoding='utf-8')
    srv = load_server(monkeypatch, d)
    m = get(srv, L + 'movie?path=/Movies/2020/1/').get_json()['movie']
    assert [x['downloadUrl'] for x in m['downloads']] == ['http://example.test/a b/Test.mkv\t',
                                                          'https://example.test/پ.mkv']
    assert not any(x['invalidUrl'] for x in m['downloads'])


def test_unsafe_imdb_tmdb_links_from_data_are_replaced_by_search_links(tmp_path, monkeypatch):
    import conftest
    arc = json.loads(json.dumps(conftest.SMALL_ARCHIVE))
    arc['movie']['1']['imdb_link'] = 'javascript:alert(1)//imdb.com'
    d = tmp_path / 'data'
    d.mkdir()
    (d / 'archive.json').write_text(json.dumps(arc, ensure_ascii=False), encoding='utf-8')
    srv = load_server(monkeypatch, d)
    ids = get(srv, L + 'movie?path=/Movies/2020/1/').get_json()['movie']['ids']
    imdb = next(i for i in ids if i['label'] == 'IMDb')
    assert imdb['url'].startswith('https://www.imdb.com/find/') and imdb['search'] is True


def test_unknown_archive_fields_are_preserved(offline_server):
    m = get(offline_server, L + 'movie?path=/Movies/2020/1/').get_json()['movie']
    assert m['extra']['unknown_field'] == 'kept'
    assert m['raw']['unknown_field'] == 'kept'


def test_season_data_for_27965_preserved(offline_server):
    s = get(offline_server, L + 'series?path=/Series/2025/27965/').get_json()['series']
    ep = s['seasons'][0]['episodes'][0]
    assert ep['title'] == 'E1' and ep['downloads'][0]['downloadUrl'] == 'http://example.test/e1.mp4'


# ---------- request safety ----------

def test_foreign_host_header_rejected(offline_server):
    assert get(offline_server, '/api/v1/health', base_url='http://evil.example').status_code == 403
    assert get(offline_server, '/api/v1/health', base_url='http://localhost:8080').status_code == 200
    assert get(offline_server, '/api/v1/health', base_url='http://127.0.0.1:8080').status_code == 200


def test_post_is_still_refused_by_flask(offline_server):
    assert offline_server.app.test_client().post('/api/v1/health').status_code == 405


def test_unknown_pages_keep_their_original_404(offline_server):
    r = get(offline_server, '/nope.txt')
    assert r.status_code == 404 and 'json' not in r.headers.get('Content-Type', '')


@pytest.mark.parametrize('path', ['../etc/passwd', '/Movies/../x', 'Movies', '/Other/', '/' + 'a' * 600, ''])
def test_bad_paths_rejected(offline_server, path):
    assert get(offline_server, L + 'list', query_string={'path': path}).status_code == 400


def test_unexpected_errors_do_not_leak_internals(offline_server, monkeypatch):
    def boom():
        raise RuntimeError('/home/secret/path.py line 9')
    monkeypatch.setattr(offline_server, 'get_db', boom)
    r = get(offline_server, '/api/v1/health')
    text = r.get_data(as_text=True)
    assert r.status_code == 500 and 'secret' not in text and 'Traceback' not in text


def test_health_keeps_its_fields_and_hides_path_and_key(monkeypatch, data_dir):
    srv = load_server(monkeypatch, data_dir, FLICKSY_MODE='online', FLICKSY_API_KEY=SECRET)
    text = get(srv, '/api/v1/health').get_data(as_text=True)
    h = json.loads(text)
    assert SECRET not in text and str(data_dir) not in text
    assert {'success', 'service', 'status', 'movies', 'series', 'dataFile'} <= set(h)
    assert h['dataFile'] == 'archive.json' and h['mode'] == 'online'


def test_security_headers(offline_server):
    h = get(offline_server, '/api/v1/health').headers
    assert h['X-Content-Type-Options'] == 'nosniff' and h['Referrer-Policy'] == 'no-referrer'


def test_caches_are_bounded(offline_server):
    srv = offline_server
    for c in (srv.DL_URLS, srv.SIZE_CACHE, srv.LIVE_PAGE_CACHE, srv.LIVE_ITEMS):
        assert c.max_items < 100_000 and c.ttl
    # must still hold a full "item not found" scan (both kinds), otherwise every request would refetch everything
    assert srv.LIVE_PAGE_CACHE.max_items >= 2 * srv.LIVE_SCAN_MAX


# ---------- online mode (network stubbed: nothing real is contacted) ----------

@pytest.fixture()
def online_server(monkeypatch, data_dir):
    srv = load_server(monkeypatch, data_dir, FLICKSY_MODE='online', FLICKSY_API_KEY=SECRET)
    calls = []

    def fake_fetch(url, **kw):
        calls.append((url, kw))
        if '/season/by/serie/' in url:
            body = [{'id': 1, 'title': 'Season 1', 'episodes': [{'id': 1, 'title': 'Live E1', 'sources': []}]}]
        else:
            body = [{'id': 1, 'title': 'Live Movie', 'year': 2021, 'genres': [], 'country': []}]
        return urlguard.FetchResult(200, {}, json.dumps(body).encode(), url)

    monkeypatch.setattr(srv.urlguard, 'safe_fetch', fake_fetch)
    return srv, calls


def test_online_needs_page_to_ask_for_it(online_server):
    srv, calls = online_server
    assert urlguard.network_enabled() is True
    get(srv, L + 'series?path=/Series/2024/28000/')            # page did not ask for online
    assert calls == []


def test_online_live_seasons_are_fresh_each_time_and_archive_untouched(online_server, data_dir):
    srv, calls = online_server
    before = sha(data_dir / 'archive.json')
    url = L + 'series?path=/Series/2024/28000/&mode=online'
    s1 = get(srv, url).get_json()['series']
    pages1 = sum('/filtres/' in c[0] for c in calls)
    seasons1 = sum('/season/by/serie/' in c[0] for c in calls)
    s2 = get(srv, url).get_json()['series']
    assert s1['seasons'][0]['episodes'][0]['title'] == 'Live E1' and s2 == s1
    assert sum('/filtres/' in c[0] for c in calls) == pages1           # list pages / items come from the bounded cache
    assert sum('/season/by/serie/' in c[0] for c in calls) == seasons1 + 1   # seasons stay "always fresh", as before
    assert sha(data_dir / 'archive.json') == before
    assert all(kw.get('allowed_hosts') == srv.LIVE_HOSTS for _, kw in calls)


def test_auto_live_seasons_only_when_explicitly_enabled_and_never_saved(monkeypatch, data_dir):
    srv = load_server(monkeypatch, data_dir, FLICKSY_MODE='online', FLICKSY_API_KEY=SECRET,
                      FLICKSY_LIVE_SEASONS='1')
    calls = []

    def fake_fetch(url, **kw):
        calls.append(url)
        body = [{'id': 1, 'title': 'Season 1', 'episodes': [{'id': 1, 'title': 'Auto E1', 'sources': []}]}]
        return urlguard.FetchResult(200, {}, json.dumps(body).encode(), url)
    monkeypatch.setattr(srv.urlguard, 'safe_fetch', fake_fetch)
    before = sha(data_dir / 'archive.json')
    s = get(srv, L + 'series?path=/Series/2024/28000/').get_json()['series']
    assert s['seasons'][0]['episodes'][0]['title'] == 'Auto E1' and len(calls) == 1
    assert sha(data_dir / 'archive.json') == before
    assert not list(data_dir.glob('*.tmp'))


def test_online_failure_falls_back_and_never_leaks_key(online_server):
    srv, _ = online_server

    def failing(url, **kw):
        raise urlguard.FetchError('TIMEOUT')
    srv.urlguard.safe_fetch = failing
    r = get(srv, L + 'series?path=/Series/2025/27965/&mode=online')
    assert r.status_code == 200 and SECRET not in r.get_data(as_text=True)
    s = r.get_json()['series']
    assert s['seasonCount'] == 1                           # stored data still served
    assert any('TIMEOUT' in w for w in s['warnings'])
    r = get(srv, L + 'list?path=/Movies/p1/&mode=online')
    assert r.status_code == 502 and SECRET not in r.get_data(as_text=True)


def test_temporary_failure_does_not_erase_stored_data(online_server, data_dir):
    srv, _ = online_server
    srv.urlguard.safe_fetch = lambda url, **kw: (_ for _ in ()).throw(urlguard.FetchError('CONNECT_FAILED'))
    before = sha(data_dir / 'archive.json')
    for _ in range(3):
        get(srv, L + 'series?path=/Series/2025/27965/&mode=online')
    assert sha(data_dir / 'archive.json') == before
    assert get(srv, L + 'series?path=/Series/2025/27965/').get_json()['series']['seasonCount'] == 1


def test_file_info_online_uses_guarded_fetch_and_caches(online_server):
    srv, calls = online_server
    m = get(srv, L + 'movie?path=/Movies/2020/1/').get_json()['movie']
    path = m['downloads'][0]['path']

    def head(url, **kw):
        calls.append((url, kw))
        return urlguard.FetchResult(206, {'content-range': 'bytes 0-0/987654'}, b'', url)
    srv.urlguard.safe_fetch = head
    r = get(srv, L + 'file-info', query_string={'path': path}).get_json()
    assert r['file']['sizeBytes'] == 987654
    n = len(calls)
    get(srv, L + 'file-info', query_string={'path': path})
    assert len(calls) == n                                  # cached
    assert calls[-1][1]['read_body'] is False               # never downloads the file body


def test_file_info_strips_surrounding_whitespace_like_urllib_did(tmp_path, monkeypatch):
    import conftest
    arc = json.loads(json.dumps(conftest.SMALL_ARCHIVE))
    arc['movie']['1']['sources'] = [{'id': 1, 'quality': '720', 'type': 'mkv', 'url': 'http://example.test/x.mkv\t'}]
    d = tmp_path / 'data'
    d.mkdir()
    (d / 'archive.json').write_text(json.dumps(arc), encoding='utf-8')
    srv = load_server(monkeypatch, d, FLICKSY_MODE='online', FLICKSY_API_KEY=SECRET)
    seen = []

    def head(url, **kw):
        seen.append(url)
        urlguard.check_url_syntax(url)                      # the real syntax rules must accept it
        return urlguard.FetchResult(206, {'content-range': 'bytes 0-0/55'}, b'', url)
    monkeypatch.setattr(srv.urlguard, 'safe_fetch', head)
    path = get(srv, L + 'movie?path=/Movies/2020/1/').get_json()['movie']['downloads'][0]['path']
    r = get(srv, L + 'file-info', query_string={'path': path})
    assert r.status_code == 200 and seen == ['http://example.test/x.mkv']


def test_file_info_failure_is_remembered_only_briefly(online_server):
    srv, _ = online_server
    path = get(srv, L + 'movie?path=/Movies/2020/1/').get_json()['movie']['downloads'][0]['path']
    srv.urlguard.safe_fetch = lambda url, **kw: (_ for _ in ()).throw(urlguard.FetchError('TIMEOUT'))
    r = get(srv, L + 'file-info', query_string={'path': path})
    assert r.status_code == 502 and r.get_json()['error'] == 'SIZE_UNAVAILABLE'
    assert srv.SIZE_CACHE.get(path) is None                 # stored as "unknown" with a short life, not forever
