"""Best-effort parsing of a file URL / quality text into release attributes. Missing = None (never guessed)."""
import re
from urllib.parse import unquote, urlsplit

RES_RE = re.compile(r'(?<!\d)(2160|1440|1080|720|576|540|480|360)\s*[pP]?(?!\d)')
SRC_RE = re.compile(r'(web[-. ]?dl|webrip|blu[-. ]?ray|brrip|bdrip|hdrip|hdtv|dvdrip|hdcam|cam)', re.I)
CODEC_RE = re.compile(r'(x\.?26[45]|h\.?26[45]|hevc|av1)', re.I)
AUDIO_RE = re.compile(r'(?<![A-Za-z0-9])(DDP?5\.1|DD5\.1|5\.1|6CH|2CH|AAC|AC3|DTS|Atmos)(?![A-Za-z0-9])', re.I)
GROUP_RE = re.compile(r'(?:x\.?26[45]|h\.?26[45]|hevc)[-.]([A-Za-z0-9]{2,12})(?=[.\-_ ]|$)', re.I)
KNOWN_GROUPS = ('Film2Media', 'Film2Movie', 'Pahe', 'YTS', 'RARBG', 'BMB')


def _canon_codec(c):
    c = c.lower().replace('.', '')
    return {'h264': 'x264', 'h265': 'x265'}.get(c, c)


def parse_release(url, quality_text=None, container=None):
    name = None
    try:
        path = unquote(urlsplit((url or '').strip()).path)
        name = path.rsplit('/', 1)[-1] or None
    except ValueError:
        pass
    hay = ' '.join(x for x in (name or '', quality_text or '') if x)
    res = RES_RE.search(hay)
    src = SRC_RE.search(name or '')
    codec = CODEC_RE.search(name or '')
    audio = AUDIO_RE.search(name or '')
    grp = GROUP_RE.search(name or '')
    group = grp.group(1) if grp else next((g for g in KNOWN_GROUPS if g.lower() in (name or '').lower()), None)
    low = hay.lower()
    if 'hardsub' in low or 'hard sub' in low or 'چسبیده' in hay:
        sub = 'hardsub-fa'
    elif 'softsub' in low or 'farsi.sub' in low or 'farsi sub' in low or 'زیرنویس' in hay:
        sub = 'softsub-fa'
    elif 'dub' in low or 'دوبله' in hay:
        sub = 'dubbed-fa'
    else:
        sub = None
    if (quality_text or '').strip() in ('تیزر',) or 'tizer' in (url or '').lower() or 'trailer' in low:
        kind_hint = 'trailer'
    else:
        kind_hint = None
    return {'release_name': name, 'resolution': int(res.group(1)) if res else None,
            'source_tag': re.sub(r'[-. ]', '-', src.group(1)).upper() if src else None,
            'codec': _canon_codec(codec.group(1)) if codec else None,
            'audio': audio.group(1).upper() if audio else None, 'subtitle': sub,
            'release_group': group, 'hint': kind_hint}
