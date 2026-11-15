"""python -m flicksy_dl  -> local app at http://127.0.0.1:8090 (needs data/flicksy.db; build it with the importer)."""
import argparse
import os
import sys

from .api import create_app

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', default=os.path.join(os.environ.get('FLICKSY_DATA_DIR') or os.path.join(ROOT, 'data'), 'flicksy.db'))
    ap.add_argument('--port', type=int, default=int(os.environ.get('FLICKSY_MVP_PORT') or 8090))
    a = ap.parse_args()
    if not os.path.isfile(a.db):
        print('Database not found: %s\nBuild it first:  python -m flicksy_dl.importer' % a.db)
        return 2
    expose = os.environ.get('FLICKSY_EXPOSE_LINKS', '1') != '0'
    print('Open: http://127.0.0.1:%d/   (local only; links shown: %s)' % (a.port, 'yes' if expose else 'no'))
    create_app(a.db, expose_links=expose).run(host='127.0.0.1', port=a.port, debug=False)
    return 0


if __name__ == '__main__':
    sys.exit(main())
