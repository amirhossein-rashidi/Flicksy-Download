"""Self-contained copy of the light 'may this text be shown as a link?' check (same rule as urlguard.has_http_scheme),
so the flicksy_dl package runs on its own without the other Phase-1 files."""
from urllib.parse import urlsplit


def has_http_scheme(url):
    if not isinstance(url, str):
        return False
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return False
    return parts.scheme.lower() in ('http', 'https') and bool(parts.netloc)
