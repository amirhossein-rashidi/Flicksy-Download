"""Shared test setup. Tests never use the network and never touch the real archive."""
import importlib
import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

SMALL_ARCHIVE = {
    'movie': {
        '1': {'id': 1, 'type': 'movie', 'title': 'Test Movie', 'description': 'd', 'year': 2020,
              'imdb': '7.0', 'rating': '7', 'duration': '100', 'image': None, 'cover': None,
              'genres': [{'title': 'Drama'}], 'country': [{'title': 'X', 'image': None}],
              'sources': [{'id': 1, 'quality': '720', 'type': 'mkv',
                           'url': 'http://example.test/a/Test.Movie.2020.720p.mkv'},
                          {'id': 2, 'quality': '480', 'type': 'mkv', 'url': '00MBhttp://bad/x'},
                          {'id': 3, 'quality': '1080', 'type': 'mkv', 'url': 'javascript:alert(1)'}],
              'unknown_field': 'kept'},
    },
    'serie': {
        '27965': {'id': 27965, 'type': 'serie', 'title': 'Test Serie', 'description': 'd', 'year': 2025,
                  'imdb': '8', 'rating': '8', 'duration': '50', 'image': None, 'cover': None,
                  'genres': [], 'country': []},
        '28000': {'id': 28000, 'type': 'serie', 'title': 'Other Serie', 'description': 'd', 'year': 2024,
                  'imdb': '8', 'rating': '8', 'duration': '50', 'image': None, 'cover': None,
                  'genres': [], 'country': []},
    },
    'next_page': {'movie': 2, 'serie': 2},
    'done': {'movie': True, 'serie': True},
    'seasons': {
        '27965': [{'id': 1, 'title': 'فصل اول', 'episodes': [
            {'id': 10, 'title': 'E1', 'description': None, 'duration': None,
             'sources': [{'id': 5, 'quality': None, 'type': 'mp4',
                          'url': 'http://example.test/e1.mp4'}]}]}],
    },
}


@pytest.fixture()
def data_dir(tmp_path):
    d = tmp_path / 'data'
    d.mkdir()
    (d / 'archive.json').write_text(json.dumps(SMALL_ARCHIVE, ensure_ascii=False), encoding='utf-8')
    return d


def load_server(monkeypatch, data_dir, **env):
    """Import a fresh copy of server.py with the given environment."""
    for k in ('FLICKSY_MODE', 'FLICKSY_HOST', 'FLICKSY_PORT', 'FLICKSY_API_KEY',
              'FLICKSY_ALLOW_PUBLIC_BIND', 'FLICKSY_LIVE_BASE', 'FLICKSY_LIVE_HELPERS'):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv('FLICKSY_DATA_DIR', str(data_dir))
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    sys.modules.pop('server', None)
    import urlguard
    urlguard.set_network_enabled(False)      # server.py switches it on only for online mode + key
    srv = importlib.import_module('server')
    return srv


@pytest.fixture()
def offline_server(monkeypatch, data_dir):
    srv = load_server(monkeypatch, data_dir)
    return srv


@pytest.fixture()
def no_network(monkeypatch):
    """Make ANY attempt to open a socket fail the test."""
    import socket

    def boom(*a, **k):
        raise AssertionError('an outside network connection was attempted')

    monkeypatch.setattr(socket, 'create_connection', boom)
    monkeypatch.setattr(socket, 'getaddrinfo', boom)
    monkeypatch.setattr(socket.socket, 'connect', boom)
