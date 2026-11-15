"""Text normalisation shared by the importer (index time) and the search API (query time)."""
import re

_DIAC = re.compile('[ً-ٰٟـ]')
_NON_WORD = re.compile(r'[\W_]+', re.UNICODE)
_TRANS = str.maketrans({'ي': 'ی', 'ك': 'ک', 'ۀ': 'ه', 'ة': 'ه', 'أ': 'ا', 'إ': 'ا', 'ٱ': 'ا', '‌': ' ', '‏': ' ', '‎': ' ',
                        '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
                        '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
                        '&': ' and '})


def norm(text):
    """lower-case, unify Arabic/Persian letters and digits, drop diacritics/ZWNJ/punctuation."""
    if not text:
        return ''
    t = _DIAC.sub('', str(text)).translate(_TRANS).lower().replace("'", '')
    return _NON_WORD.sub(' ', t).strip()


def fts_query(q, max_terms=6):
    """Turn user text into a safe FTS5 prefix query: every term quoted, last-letters prefix, AND-ed."""
    terms = norm(q).split()[:max_terms]
    if not terms:
        return None
    return ' '.join('"%s"*' % t.replace('"', '') for t in terms)


_KEYS = [('نام پارسی', 'title_fa'), ('سایر عناوین', 'other_titles'), ('کارگردان', 'director'), ('ستارگان', 'stars')]


def parse_description(desc):
    """Pull a few known lines out of the semi-structured Persian description. Never raises; unknown text stays
    in the original description (stored untouched)."""
    out = {}
    if not desc:
        return out
    lines = str(desc).replace('\r\n', '\n').replace('\r', '\n').split('\n')
    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith('خلاصه داستان'):
            rest = s.split(':', 1)[1].strip() if ':' in s else ''
            tail = [x.strip() for x in lines[i + 1:] if x.strip()]
            out.setdefault('synopsis', ' '.join(([rest] if rest else []) + tail).strip())
            break
        for prefix, field in _KEYS:
            if s.startswith(prefix) and field not in out:
                m = re.match(r'^[^:：]*[:：]\s*(.*)$', s)
                if m and m.group(1).strip():
                    out[field] = re.sub(r'\s+', ' ', m.group(1)).strip()
    return out
