import pytest

import urlguard
from urlguard import (FetchError, OfflineError, UrlRejected, check_url_syntax, ip_is_public,
                      resolve_public, safe_fetch)


@pytest.fixture(autouse=True)
def network_on():
    urlguard.set_network_enabled(True)
    yield
    urlguard.set_network_enabled(False)


def fake_resolver(mapping):
    def resolver(host, port, type=0):
        if host not in mapping:
            raise OSError('no such host')
        return [(2, 1, 6, '', (ip, port)) for ip in mapping[host]]
    return resolver


class FakeResp:
    def __init__(self, status=200, headers=None, body=b''):
        self.status = status
        self.headers = {k.lower(): v for k, v in (headers or {}).items()}
        self._body = body
        self.closed = False

    def read(self, n):
        chunk, self._body = self._body[:n], self._body[n:]
        return chunk

    def close(self):
        self.closed = True


def make_opener(script, calls):
    """script: dict url-host -> FakeResp or list of FakeResp (consumed in order)."""
    def opener(scheme, host, ip, port, method, target, headers, timeout):
        calls.append((scheme, host, ip, port, method, target))
        r = script[host]
        if isinstance(r, list):
            r = r.pop(0)
        return r
    return opener


# ---------- light check used only when a link is SHOWN ----------

@pytest.mark.parametrize('text,expected', [
    ('http://a.test/x.mkv\t', True), (' http://a.test/x ', True), ('http://a.test/a b.mkv', True),
    ('https://a.test/پ.mkv', True), ('javascript:alert(1)', False), (' javascript:alert(1)', False),
    ('java\tscript:alert(1)', False), ('JaVaScRiPt:alert(1)', False), ('data:text/html,x', False),
    ('file:///etc/passwd', False), ('00MBhttp://a.test/x', False), ('//a.test/x', False),
    ('http://', False), ('', False), (None, False), (5, False),
])
def test_has_http_scheme(text, expected):
    assert urlguard.has_http_scheme(text) is expected


# ---------- syntax ----------

@pytest.mark.parametrize('url', [
    'ftp://example.com/a', 'file:///etc/passwd', 'gopher://example.com', 'javascript:alert(1)',
    'data:text/plain,hi', '//example.com/a', 'example.com/a', '', None, 123,
])
def test_bad_scheme_or_shape_rejected(url):
    with pytest.raises(UrlRejected):
        check_url_syntax(url)


@pytest.mark.parametrize('url', [
    'http://user:pw@example.com/', 'http://example.com@evil.com/', 'https://:x@example.com/',
])
def test_credentials_rejected(url):
    with pytest.raises(UrlRejected) as e:
        check_url_syntax(url)
    assert e.value.code == 'CREDENTIALS_NOT_ALLOWED'


@pytest.mark.parametrize('url', [
    'http://example.com:22/', 'http://example.com:8080/', 'https://example.com:9999/',
])
def test_odd_ports_rejected(url):
    with pytest.raises(UrlRejected) as e:
        check_url_syntax(url)
    assert e.value.code == 'PORT_NOT_ALLOWED'


@pytest.mark.parametrize('url', [
    'http://example.com/a b', 'http://example.com/\r\nX: y', 'http://exa\tmple.com/',
    'http://example.com\\@evil.com/', 'http://' + 'a' * 3000 + '.com/',
])
def test_control_chars_and_long_urls_rejected(url):
    with pytest.raises(UrlRejected):
        check_url_syntax(url)


def test_good_urls_accepted_and_normalised():
    t = check_url_syntax('HTTP://Example.COM./Path/File.mkv?a=1')
    assert (t.scheme, t.host, t.port) == ('http', 'example.com', 80)
    assert t.target == '/Path/File.mkv?a=1'
    assert check_url_syntax('https://example.com').port == 443


def test_allow_list():
    check_url_syntax('https://api.example.com/x', allowed_hosts={'api.example.com'})
    with pytest.raises(UrlRejected) as e:
        check_url_syntax('https://evil.com/x', allowed_hosts={'api.example.com'})
    assert e.value.code == 'HOST_NOT_ALLOWED'


# ---------- addresses ----------

@pytest.mark.parametrize('ip', [
    '127.0.0.1', '127.1.2.3', '0.0.0.0', '10.0.0.5', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '255.255.255.255',
    '192.0.2.1', '198.18.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.169.254',
    '64:ff9b::7f00:1', '2001::1', '2002:7f00:1::1', '2002:0a00:0001::1', 'not-an-ip', '',
])
def test_non_public_addresses_rejected(ip):
    assert ip_is_public(ip) is False


@pytest.mark.parametrize('ip', ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'])
def test_public_addresses_accepted(ip):
    assert ip_is_public(ip) is True


def test_resolve_rejects_if_any_address_is_private():
    r = fake_resolver({'mixed.test': ['8.8.8.8', '10.0.0.1']})
    with pytest.raises(UrlRejected) as e:
        resolve_public('mixed.test', 80, r)
    assert e.value.code == 'ADDRESS_NOT_ALLOWED'


def test_resolve_failure_is_fetch_error():
    with pytest.raises(FetchError) as e:
        resolve_public('nope.test', 80, fake_resolver({}))
    assert e.value.code == 'DNS_FAILED'


@pytest.mark.parametrize('url', [
    'http://127.0.0.1/', 'http://localhost/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/',
    'http://2130706433/', 'http://0x7f000001/', 'http://017700000001/', 'http://127.1/',
    'http://10.1.2.3/', 'http://[::ffff:127.0.0.1]/', 'http://0/',
])
def test_literal_local_targets_never_connect(url):
    calls = []
    with pytest.raises((UrlRejected, FetchError)):
        # real resolver on purpose: literals must be rejected without any real connection
        safe_fetch(url, opener=make_opener({}, calls))
    assert calls == []


# ---------- offline switch ----------

def test_offline_switch_blocks_everything():
    urlguard.set_network_enabled(False)
    calls = []
    with pytest.raises(OfflineError):
        safe_fetch('https://example.com/', resolver=fake_resolver({'example.com': ['8.8.8.8']}),
                   opener=make_opener({}, calls))
    assert calls == []


# ---------- fetching and redirects ----------

def test_simple_fetch_pins_checked_address():
    calls = []
    script = {'example.com': FakeResp(200, {'x': 'y'}, b'hello')}
    r = safe_fetch('http://example.com/a?b=1', resolver=fake_resolver({'example.com': ['8.8.8.8']}),
                   opener=make_opener(script, calls))
    assert r.status == 200 and r.body == b'hello'
    assert calls == [('http', 'example.com', '8.8.8.8', 80, 'GET', '/a?b=1')]


def test_redirect_to_private_address_is_refused():
    calls = []
    script = {'a.test': FakeResp(302, {'Location': 'http://evil.test/x'})}
    res = fake_resolver({'a.test': ['8.8.8.8'], 'evil.test': ['192.168.0.10']})
    with pytest.raises(UrlRejected) as e:
        safe_fetch('http://a.test/', resolver=res, opener=make_opener(script, calls))
    assert e.value.code == 'ADDRESS_NOT_ALLOWED'
    assert [c[1] for c in calls] == ['a.test']      # never connected to evil.test


@pytest.mark.parametrize('loc', [
    'http://127.0.0.1/', 'http://localhost:80/', 'file:///etc/passwd', 'ftp://a.test/', 'gopher://a.test/',
    'http://a.test:22/', 'http://u:p@a.test/',
])
def test_redirect_to_unsafe_target_is_refused(loc):
    script = {'a.test': FakeResp(301, {'Location': loc})}
    calls = []
    with pytest.raises((UrlRejected, FetchError)):
        safe_fetch('http://a.test/', resolver=fake_resolver({'a.test': ['8.8.8.8']}),
                   opener=make_opener(script, calls))
    assert len(calls) == 1


def test_redirect_chain_followed_and_each_hop_checked():
    script = {'a.test': FakeResp(302, {'Location': '/next'}),
              'b.test': FakeResp(301, {'Location': 'http://c.test/final'}),
              'c.test': FakeResp(200, {}, b'ok')}
    script['a.test'] = FakeResp(302, {'Location': 'http://b.test/hop'})
    res = fake_resolver({'a.test': ['8.8.8.8'], 'b.test': ['1.1.1.1'], 'c.test': ['9.9.9.9']})
    r = safe_fetch('http://a.test/', resolver=res, opener=make_opener(script, []))
    assert r.body == b'ok' and r.url == 'http://c.test/final'


def test_redirect_loop_is_cut_off():
    script = {'a.test': [FakeResp(302, {'Location': 'http://a.test/'}) for _ in range(20)]}
    with pytest.raises(FetchError) as e:
        safe_fetch('http://a.test/', max_redirects=3,
                   resolver=fake_resolver({'a.test': ['8.8.8.8']}), opener=make_opener(script, []))
    assert e.value.code == 'TOO_MANY_REDIRECTS'


def test_https_to_http_downgrade_refused():
    script = {'a.test': FakeResp(302, {'Location': 'http://a.test/x'})}
    with pytest.raises(UrlRejected) as e:
        safe_fetch('https://a.test/', resolver=fake_resolver({'a.test': ['8.8.8.8']}),
                   opener=make_opener(script, []))
    assert e.value.code == 'REDIRECT_DOWNGRADE'


def test_redirect_without_location_is_error():
    script = {'a.test': FakeResp(302, {})}
    with pytest.raises(FetchError) as e:
        safe_fetch('http://a.test/', resolver=fake_resolver({'a.test': ['8.8.8.8']}),
                   opener=make_opener(script, []))
    assert e.value.code == 'BAD_REDIRECT'


def test_response_size_limit():
    script = {'a.test': FakeResp(200, {}, b'x' * 5000)}
    with pytest.raises(FetchError) as e:
        safe_fetch('http://a.test/', max_bytes=1000, resolver=fake_resolver({'a.test': ['8.8.8.8']}),
                   opener=make_opener(script, []))
    assert e.value.code == 'RESPONSE_TOO_LARGE'


def test_connect_failure_does_not_leak_url():
    def opener(*a, **k):
        raise OSError('connection refused http://a.test/secret-key-123')
    with pytest.raises(FetchError) as e:
        safe_fetch('http://a.test/secret-key-123', resolver=fake_resolver({'a.test': ['8.8.8.8']}),
                   opener=opener)
    assert 'secret-key-123' not in str(e.value) and e.value.code == 'CONNECT_FAILED'


def test_header_injection_rejected():
    with pytest.raises(UrlRejected):
        safe_fetch('http://a.test/', headers={'X': 'a\r\nHost: evil'},
                   resolver=fake_resolver({'a.test': ['8.8.8.8']}), opener=make_opener({}, []))


def test_read_body_false_skips_body_and_closes():
    resp = FakeResp(206, {'content-range': 'bytes 0-0/12345'}, b'z' * 10)
    r = safe_fetch('http://a.test/', read_body=False, resolver=fake_resolver({'a.test': ['8.8.8.8']}),
                   opener=make_opener({'a.test': resp}, []))
    assert r.body == b'' and r.headers['content-range'].endswith('/12345') and resp.closed
