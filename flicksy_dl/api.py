"""Local HTTP API (contract: docs/API-CONTRACT.md, prefix /api/v2) + static web UI. Read-only, localhost only."""
import os

from flask import Flask, jsonify, request, send_from_directory

from . import repo

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, 'web')


def _loopback_host(h):
    h = (h or '').lower()
    name = h.split(']')[0] + ']' if h.startswith('[') else h.rsplit(':', 1)[0] if ':' in h else h
    return name in ('127.0.0.1', 'localhost', '[::1]')


def create_app(db_path, expose_links=True, local_only=True):
    app = Flask(__name__)
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024
    app.config['DB_PATH'] = db_path
    state = {'con': None}

    def con():
        if state['con'] is None:
            state['con'] = repo.connect(db_path)
        return state['con']

    def ok(data):
        return jsonify(success=True, **data)

    def fail(code, message, status):
        return jsonify(success=False, error=code, message=message), status

    @app.before_request
    def guard():
        if local_only and not _loopback_host(request.host):
            return fail('HOST_NOT_ALLOWED', '', 403)

    @app.after_request
    def headers(resp):
        resp.headers.setdefault('X-Content-Type-Options', 'nosniff')
        resp.headers.setdefault('Referrer-Policy', 'no-referrer')
        resp.headers.setdefault('Content-Security-Policy', ("default-src 'self'; img-src 'self' data: https: http:; "
                                                                    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'"))
        return resp

    @app.errorhandler(404)
    def nf(_e):
        return fail('NOT_FOUND', 'پیدا نشد', 404)

    @app.errorhandler(Exception)
    def boom(e):
        from werkzeug.exceptions import HTTPException
        if isinstance(e, HTTPException):
            return fail(e.name.upper().replace(' ', '_'), '', e.code)
        return fail('INTERNAL_ERROR', '', 500)

    def intarg(name, default=None, lo=0, hi=10 ** 9):
        v = request.args.get(name)
        if v in (None, ''):
            return default
        try:
            return max(lo, min(int(v), hi))
        except ValueError:
            raise BadArg(name)

    class BadArg(Exception):
        pass

    @app.errorhandler(BadArg)
    def bad(e):
        return fail('BAD_PARAMETER', 'پارامتر نامعتبر: %s' % e, 400)

    @app.get('/api/v2/health')
    def health():
        return ok(repo.health(con()))

    @app.get('/api/v2/facets')
    def facets():
        return ok(repo.facets(con()))

    @app.get('/api/v2/featured')
    def featured():
        return ok(repo.featured(con(), intarg('limit', 12, 1, 30)))

    @app.get('/api/v2/titles')
    def titles():
        q = (request.args.get('q') or '')[:100]
        kind = request.args.get('kind') or None
        if kind not in (None, 'movie', 'series'):
            raise BadArg('kind')
        return ok(repo.list_titles(con(), q=q, kind=kind, year=intarg('year', None, 1800, 2100), genre=intarg('genre', None, 0),
                                   limit=intarg('limit', 24, 1, repo.MAX_LIMIT), offset=intarg('offset', 0, 0, 10 ** 6)))

    @app.get('/api/v2/titles/<int:mid>')
    def title(mid):
        d = repo.title_detail(con(), mid, expose_links)
        return ok({'title': d}) if d else fail('NOT_FOUND', 'عنوان پیدا نشد', 404)

    @app.get('/')
    def index():
        return send_from_directory(WEB, 'index.html')

    @app.get('/<path:name>')
    def static_files(name):
        return send_from_directory(WEB, name)

    return app
