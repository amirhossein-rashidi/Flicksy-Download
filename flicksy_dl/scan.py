"""Scan-link (data/scan-*.tsv) parsing. Same matching idea as server.py (title + year); kept here so the new
package does not import the Flask server. Results are only LOCAL data; nothing is published."""
import os
import re
from urllib.parse import unquote, urlsplit

VIDEO_EXTS = {'mkv', 'mp4', 'avi', 'mov', 'm4v', 'ts'}
YEAR_RE = re.compile(r'(?<!\d)((?:19|20)\d{2})(?!\d)')
SE_RE = re.compile(r'[Ss](\d{1,2})[ ._-]?[Ee](\d{1,3})')


def norm_title(text):
    t = unquote(text or '').lower().replace('&', ' and ').replace("'", '')
    return re.sub(r'[^a-z0-9]+', ' ', t).strip()


def strip_year(t):
    return re.sub(r'\s(?:19|20)\d{2}$', '', t)


def parse_scan(url, size):
    path = unquote(urlsplit(url).path)
    name = path.rsplit('/', 1)[-1]
    if '.' not in name:
        return None
    base, ext = name.rsplit('.', 1)
    if ext.lower() not in VIDEO_EXTS:
        return None
    low = base.replace('.', ' ').replace('_', ' ')
    se = SE_RE.search(low)
    title, year, season, episode = '', None, None, None
    if se:
        season, episode = int(se.group(1)), int(se.group(2))
        title = low[:se.start()]
        if not title.strip():
            for seg in reversed(path.split('/')[:-1]):
                if seg and not re.match(r'(?i)^(s\d{1,2}|season.*|\d{3,4}p.*)$', seg):
                    title = seg
                    break
    else:
        for m in YEAR_RE.finditer(low):
            if low[:m.start()].strip():
                title, year = low[:m.start()], int(m.group(1))
                break
    title = strip_year(norm_title(title))
    if not title or (not se and not year):
        return None
    return {'url': url, 'size': size, 'title': title, 'year': year, 'season': season, 'episode': episode}


def read_scan_files(data_dir):
    """-> (movies{(title,year):[e]}, series{title:[e]}, stats). Duplicate URLs are skipped; lines are counted."""
    movies, series = {}, {}
    st = {'files': 0, 'lines': 0, 'duplicate_urls': 0, 'unparsed': 0, 'kept': 0}
    seen = set()
    names = sorted(n for n in os.listdir(data_dir) if n.lower().startswith('scan') and n.lower().endswith('.tsv')) if os.path.isdir(data_dir) else []
    for n in names:
        st['files'] += 1
        with open(os.path.join(data_dir, n), encoding='utf-8', errors='replace') as fh:
            for line in fh:
                url, _, sz = line.rstrip('\n').partition('\t')
                if not url:
                    continue
                st['lines'] += 1
                if url in seen:
                    st['duplicate_urls'] += 1
                    continue
                seen.add(url)
                e = parse_scan(url, int(sz) if sz.strip().isdigit() else None)
                if not e:
                    st['unparsed'] += 1
                    continue
                e['file'] = n
                st['kept'] += 1
                if e['season'] is not None:
                    series.setdefault(e['title'], []).append(e)
                else:
                    movies.setdefault((e['title'], e['year']), []).append(e)
    return movies, series, st
