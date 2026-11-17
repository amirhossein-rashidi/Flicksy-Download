# -*- coding: utf-8 -*-
"""
DIRSCAN v3  -  adaptive open-directory crawler  (Pydroid 3 / Termux, stdlib only)

Nothing here is a hand-set limit. The engine LEARNS and ADAPTS:

 * listing format   : learns each site's navigation / sort / pagination
                      parameters from the page structure itself
 * dir vs file      : structural rules first, a live HEAD check only when a
                      link is genuinely ambiguous (no guessing by name)
 * loops & traps    : fingerprints every listing (symlink loops, aliases),
                      detects repeating path cycles and barren runaway trees
 * speed            : per-host AIMD congestion control (like TCP): ramps the
                      parallelism up while the server is happy, halves it on
                      429/5xx/timeouts/latency spikes, honours Retry-After
 * transport        : persistent keep-alive connections, gzip, auto SSL fallback
 * sizes            : parses sizes from listings -> total bytes, per extension
 * safety           : state is checkpointed; Stop/Ctrl+C -> run again to RESUME

Edit only the SETTINGS block. Put results.json next to the script.
"""
import hashlib
import heapq
import http.client
import json
import os
import re
import shutil
import ssl
import threading
import time
import zlib
from collections import Counter, deque
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from datetime import datetime
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, parse_qsl, unquote, quote

# ============================== SETTINGS ==============================
JSON_FILE          = "results.json"
EXTRA_URLS         = [          # start URLs added on top of results.json
    # "https://dl5.sermoviedown.pw/Ss/",
]
MODE               = "full"     # "probe" = only detect hosts, "full" = crawl everything
INCLUDE_NON_INDEX  = False      # also crawl hosts that do not look like listings
ONLY_EXTS          = []         # e.g. [".mkv", ".mp4"] -> export only these (stats count all)
RESUME             = "ask"      # "ask" | "yes" | "no"
OUT_NAME           = "out"      # output folder, created next to this script
PROBE_TIMEOUT      = 8          # seconds per request in phase 1 (dead hosts no longer stall)
FETCH_MISSING_SIZES = True     # after the crawl, ask the server (HEAD) for sizes the listing did not show
DISCOVER_PAGES     = 250        # max pages fetched per host while discovering its folders
DISCOVER_SECONDS   = 75         # max seconds of discovery per host
USE_COLOR          = True
FANCY              = True       # unicode icons/bars; False = plain ASCII
# advanced (None = automatic, you normally never touch these)
MAX_CONNS_PER_HOST = None       # ceiling for the adaptive controller (auto 24)
GLOBAL_MAX         = None       # total threads (auto 64)
TIMEOUT            = 25
# ======================================================================

PER_HOST_CAP = MAX_CONNS_PER_HOST or 24
POOL_SIZE = GLOBAL_MAX or 64
BASE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Android; Mobile) dirscan/3.0",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
}
STOP = threading.Event()
LOCK = threading.Lock()
STATS = {"req": 0, "err": 0, "t0": time.time(), "bytes": 0}
INSECURE = set()                      # hosts where we had to skip cert checks

# ------------------------------- UI helpers -------------------------------
COLOR = USE_COLOR
CODES = {"red": 31, "green": 32, "yellow": 33, "blue": 34, "magenta": 35,
         "cyan": 36, "gray": 90, "bold": 1}
ICON = ({"ok": "✔", "bad": "✖", "dot": "•", "arrow": "▸", "full": "█", "empty": "░", "mid": "·"}
        if FANCY else {"ok": "+", "bad": "x", "dot": "-", "arrow": ">", "full": "#", "empty": ".", "mid": "|"})


def c(text, name):
    return "\033[%dm%s\033[0m" % (CODES[name], text) if COLOR else str(text)


def width():
    return max(44, min(shutil.get_terminal_size((64, 20)).columns, 110))


def clip(s, n):
    if len(s) <= n:
        return s
    return ("…" + s[-(n - 1):]) if FANCY else s[-n:]


def head(s, n):
    return s if len(s) <= n else s[:n - 1] + ("…" if FANCY else "")


def bar(frac, w=14):
    n = max(0, min(w, int(round(frac * w))))
    return ICON["full"] * n + ICON["empty"] * (w - n)


def tfmt(sec):
    sec = int(sec)
    return "%02d:%02d" % (sec // 60, sec % 60) if sec < 3600 else "%d:%02d:%02d" % (sec // 3600, sec % 3600 // 60, sec % 60)


def human(n):
    n = float(n)
    for u in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or u == "TB":
            return "%d B" % n if u == "B" else "%.1f %s" % (n, u)
        n /= 1024.0


def rule(title="", ch="─"):
    ch = ch if FANCY else "-"
    t = (" %s " % title) if title else ""
    return c(ch * 2 + t + ch * max(2, width() - len(t) - 2), "gray")


def banner():
    t = "DIRSCAN 3   adaptive crawler".center(32)
    if FANCY:
        print(c("╔" + "═" * 32 + "╗", "cyan"))
        print(c("║", "cyan") + c(t, "bold") + c("║", "cyan"))
        print(c("╚" + "═" * 32 + "╝", "cyan"))
    else:
        print("=" * 34 + "\n" + t + "\n" + "=" * 34)


def where(url):
    p = urlsplit(url)
    return unquote(p.path + ("?" + p.query if p.query else "")) or "/"


# ------------------------------ HTTP (keep-alive) ------------------------------
class Resp:
    __slots__ = ("status", "url", "headers", "body", "error")

    def __init__(self, status, url, headers, body, error=None):
        self.status, self.url, self.headers, self.body, self.error = status, url, headers, body, error

    def text(self):
        ct = self.headers.get("content-type", "")
        m = re.search(r"charset=([\w-]+)", ct, re.I)
        for enc in ((m.group(1),) if m else ()) + ("utf-8", "latin-1"):
            try:
                return self.body.decode(enc)
            except (LookupError, UnicodeDecodeError):
                continue
        return self.body.decode("utf-8", errors="replace")


class Http:
    LIMIT = 40_000_000

    def __init__(self):
        self.tl = threading.local()

    def _pool(self):
        if not hasattr(self.tl, "pool"):
            self.tl.pool = {}
        return self.tl.pool

    def _conn(self, scheme, netloc, fresh=False, timeout=None):
        pool = self._pool()
        key = (scheme, netloc)
        if fresh and key in pool:
            try:
                pool.pop(key).close()
            except Exception:
                pass
        if key not in pool:
            if scheme == "https":
                ctx = ssl._create_unverified_context() if netloc in INSECURE else ssl.create_default_context()
                pool[key] = http.client.HTTPSConnection(netloc, timeout=timeout or TIMEOUT, context=ctx)
            else:
                pool[key] = http.client.HTTPConnection(netloc, timeout=timeout or TIMEOUT)
        return pool[key]

    def _drop(self, scheme, netloc):
        try:
            self._pool().pop((scheme, netloc)).close()
        except Exception:
            pass

    def request(self, url, method="GET", redirects=6, timeout=None, attempts=3, headers=None):
        hops, err = 0, None
        while True:
            sp = urlsplit(url)
            if sp.scheme not in ("http", "https") or not sp.netloc:
                return Resp(None, url, {}, b"", "bad url")
            target = quote(sp.path or "/", safe="/%:@&=+$,;~!*'()[]")
            if sp.query:
                target += "?" + quote(sp.query, safe="=&%:@/+$,;~!*'()[]?")
            r = None
            for attempt in range(attempts):
                conn = self._conn(sp.scheme, sp.netloc, fresh=attempt > 0, timeout=timeout)
                try:
                    with LOCK:
                        STATS["req"] += 1
                    conn.request(method, target, headers=BASE_HEADERS if not headers else dict(BASE_HEADERS, **headers))
                    r = conn.getresponse()
                    body = r.read(self.LIMIT) if method != "HEAD" else b""
                    if len(body) >= self.LIMIT or r.will_close:
                        self._drop(sp.scheme, sp.netloc)
                    break
                except ssl.SSLCertVerificationError as e:
                    INSECURE.add(sp.netloc)         # auto-fallback, noted in report
                    self._drop(sp.scheme, sp.netloc)
                    err = "ssl: " + str(e)[:40]
                except (http.client.HTTPException, OSError) as e:
                    self._drop(sp.scheme, sp.netloc)
                    err = str(e)[:60] or e.__class__.__name__
                    r = None
            if r is None:
                return Resp(None, url, {}, b"", err)
            hd = {k.lower(): v for k, v in r.getheaders()}
            with LOCK:
                STATS["bytes"] += len(body)
            if r.status in (301, 302, 303, 307, 308) and "location" in hd and hops < redirects:
                url, hops = urljoin(url, hd["location"]), hops + 1
                continue
            enc = hd.get("content-encoding", "").lower()
            try:
                if enc == "gzip":
                    body = zlib.decompress(body, 16 + zlib.MAX_WBITS)
                elif enc == "deflate":
                    try:
                        body = zlib.decompress(body)
                    except zlib.error:
                        body = zlib.decompress(body, -15)
            except Exception:
                pass
            return Resp(r.status, url, hd, body)


HTTP = Http()


# ------------------------------ adaptive concurrency ------------------------------
class Gov:
    """AIMD congestion control, one per host (runs in the dispatcher thread)."""

    def __init__(self):
        self.limit, self.peak = 4.0, 4.0
        self.inflight, self.cool = 0, 0.0
        self.lat, self.lat_n, self.lat_sum = None, 0, 0.0
        self.throttles, self.ok = 0, 0

    def allowed(self, now):
        return self.inflight < int(self.limit) and now >= self.cool

    def done(self, status, latency, retry_after=None):
        self.inflight -= 1
        spike = self.lat is not None and latency > max(3.0, 5 * self.lat)
        if status is None or status in (429, 502, 503, 504) or spike:
            self.limit = max(1.0, self.limit * 0.5)
            self.cool = time.time() + (retry_after if retry_after else 1.0)
            self.throttles += 1
        else:
            self.ok += 1
            self.lat = latency if self.lat is None else 0.9 * self.lat + 0.1 * latency
            self.lat_n += 1
            self.lat_sum += latency
            self.limit = min(PER_HOST_CAP, self.limit + 1.0 / max(1.0, self.limit))
            self.peak = max(self.peak, self.limit)


GOVS = {}


def gov_for(netloc):
    if netloc not in GOVS:
        GOVS[netloc] = Gov()
    return GOVS[netloc]


# ------------------------------ HTML parsing ------------------------------
class AnchorParser(HTMLParser):
    """Collects anchors plus the text that trails each one on the same row
    (that is where listings put dates and sizes)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.anchors, self.title, self.h1, self.text_head = [], "", "", ""
        self.has_pre = self.has_table = False
        self.scripts = 0
        self._cur, self._in_a, self._tail, self._t, self._h1, self._tr = None, False, False, False, False, False

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self._tail = False
            d = dict(attrs)
            self._cur = {"href": (d.get("href") or "").strip(), "text": "", "tail": ""}
            self.anchors.append(self._cur)
            self._in_a = True
        elif tag == "title":
            self._t = True
        elif tag == "h1":
            self._h1 = True
        elif tag == "pre":
            self.has_pre = True
        elif tag == "table":
            self.has_table = True
        elif tag == "script":
            self.scripts += 1
        elif tag == "tr":
            self._tr, self._tail = True, False
        elif tag in ("br", "li", "p", "div", "hr"):
            self._tail = False
        elif tag in ("td", "th") and self._tail and self._cur is not None:
            self._cur["tail"] += " | "

    def handle_endtag(self, tag):
        if tag == "a":
            self._in_a, self._tail = False, True
        elif tag == "title":
            self._t = False
        elif tag == "h1":
            self._h1 = False
        elif tag == "tr":
            self._tr, self._tail = False, False
        elif tag in ("li", "p", "div"):
            self._tail = False

    def handle_data(self, data):
        if self._t:
            self.title += data
        if self._h1:
            self.h1 += data
        if len(self.text_head) < 3000:
            self.text_head += data
        if self._in_a and self._cur is not None:
            self._cur["text"] += data
        elif self._tail and self._cur is not None:
            if "\n" in data and not self._tr:
                self._cur["tail"] += data.partition("\n")[0]
                self._tail = False
            else:
                self._cur["tail"] += data


DATE_RES = [re.compile(p, re.I) for p in (
    r"\d{4}-\d{2}-\d{2}", r"\d{1,2}[-/ ][A-Za-z]{3}[-/ ]\d{2,4}", r"\d{1,2}/\d{1,2}/\d{2,4}",
    r"[A-Za-z]{3,9} \d{1,2},? \d{4}", r"\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?")]
SIZE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*([KMGTP]?)(?:i?B(?:ytes?)?)?\s*$", re.I)
UNIT = {"": 1, "K": 1 << 10, "M": 1 << 20, "G": 1 << 30, "T": 1 << 40, "P": 1 << 50}
HEADER_WORDS = {"name", "last modified", "modified", "size", "description", "date", "type", "mtime",
                "filename", "file name", "last_modified", "created", "kind", "owner", "perms"}
NEXT_WORDS = {"next", "prev", "previous", "older", "newer", "»", "«", "›", "‹", ">", "<", ">>", "<<", "more"}
PAGE_NAMES = {"page", "p", "pg", "paged", "pagenum", "offset", "start", "skip", "from", "cursor", "after"}
DYNAMIC_EXTS = {".php", ".asp", ".aspx", ".jsp", ".cgi", ".html", ".htm", ".shtml", ".do", ".action", ".pl"}
SIGS = ("index of", "directory listing", "parent directory", "to parent directory")


def parse_meta(tail):
    """-> (has_meta, size_or_None) from the text trailing an entry."""
    t = tail.replace("(", " ").replace(")", " ").replace("[", " ").replace("]", " ")
    has = False
    for r in DATE_RES:
        t2 = r.sub(" ", t)
        has = has or t2 != t
        t = t2
    t = t.replace("|", " ").strip()
    if not t:
        return has, None
    if t == "-":
        return True, None
    m = SIZE_RE.search(t)
    if m and (m.group(2) or "." in m.group(1) or re.search(r"[bB]", t) or m.group(1).isdigit()):
        try:
            return True, int(float(m.group(1)) * UNIT[m.group(2).upper()])
        except (ValueError, KeyError):
            pass
    return has, None


def last_seg(v):
    return unquote(v).rstrip("/").split("/")[-1]


def norm_text(s):
    return " ".join(s.split()).strip().rstrip("/").lower()


def text_matches(text, base):
    t, b = norm_text(text), base.lower()
    if not t:
        return False
    if t == b:
        return True
    if t.endswith("..>") or t.endswith("…"):
        return b.startswith(t.rstrip(".>…"))
    return False


# ------------------------------ targets & learning ------------------------------
class Target:
    def __init__(self, start):
        sp = urlsplit(start)
        self.start, self.netloc = start, sp.netloc.lower()
        self.base = sp.path if sp.path.endswith("/") else sp.path.rsplit("/", 1)[0] + "/"
        self.start_q = dict(parse_qsl(sp.query, keep_blank_values=True))
        self.prof = {"nav": set(), "page": set(), "noise": set(), "engine": "?", "style": "?"}
        self.gov = gov_for(self.netloc)
        self.seen = {start}
        self.queue, self.delayed, self.seq = deque(), [], 0
        self.nodes, self.fp, self.hc = {}, {}, {}
        self.pfiles = {}
        self.exts = Counter()
        self.st = {"scanned": 0, "files": 0, "size": 0, "err": 0, "dups": 0, "traps": 0, "barren": 0,
                   "guard": False, "retries": 0, "heads": 0, "pages": 0}
        self.partial = False

    def in_scope(self, url):
        sp = urlsplit(url)
        if sp.netloc.lower() != self.netloc or not sp.path.startswith(self.base):
            return False
        if self.start_q and self.prof["nav"]:
            q = dict(parse_qsl(sp.query, keep_blank_values=True))
            for p in self.prof["nav"]:
                if p in self.start_q and p in q and not q[p].startswith(self.start_q[p]):
                    return False
        return True

    def open_work(self):
        return len(self.queue) + len(self.delayed)


def path_cycle(path):
    segs = [s for s in path.split("/") if s]
    for k in range(1, min(6, len(segs) // 3) + 1):
        if segs[-k:] == segs[-2 * k:-k] == segs[-3 * k:-2 * k]:
            return True
    return False


def learn(tg, cu, cq, items):
    """Decide, from page structure alone, what each query parameter means."""
    groups = {}
    for absu, sp, a in items:
        for p, v in parse_qsl(sp.query, keep_blank_values=True):
            if p in tg.prof["nav"] or p in tg.prof["page"] or p in tg.prof["noise"]:
                continue
            groups.setdefault(p, []).append((v, a))
    for p, lst in groups.items():
        n = len(lst)
        texts = [norm_text(a["text"]) for _, a in lst]
        header_frac = sum(1 for t in texts if t in HEADER_WORDS) / float(n)
        match_frac = sum(1 for (v, a) in lst if text_matches(a["text"], last_seg(v))) / float(n)
        cur_v = cq.get(p, "")
        extends = any(v != cur_v and v.rstrip("/").startswith(cur_v.rstrip("/")) for v, _ in lst)
        ints = all(v.isdigit() for v, _ in lst)
        if header_frac >= 0.5:
            tg.prof["noise"].add(p)
        elif (p.lower() in PAGE_NAMES and ints) or (ints and any(t in NEXT_WORDS for t in texts)):
            tg.prof["page"].add(p)
        elif match_frac >= 0.5 or (cur_v and extends):
            tg.prof["nav"].add(p)
        else:
            tg.prof["noise"].add(p)


def verify_kind(tg, u):
    """Live check for a genuinely ambiguous link (no slash, no plain extension)."""
    if u in tg.hc:
        return tg.hc[u]
    r = HTTP.request(u, "HEAD")
    tg.st["heads"] += 1
    kind = "file"
    if r.status == 200 and r.url != u and urlsplit(r.url).path.endswith("/") and not urlsplit(u).path.endswith("/"):
        kind = ("dir", r.url)
    tg.hc[u] = kind
    return kind


def analyze(tg, cur, html):
    cu = urlsplit(cur)
    cq = dict(parse_qsl(cu.query, keep_blank_values=True))
    P = AnchorParser()
    try:
        P.feed(html)
    except Exception:
        pass
    host = cu.netloc.lower()
    items = []
    for a in P.anchors:
        h = a["href"]
        if not h or h[0] == "#" or h.lower().startswith(("javascript:", "mailto:", "tel:", "data:")):
            continue
        absu = urljoin(cur, h).split("#")[0]
        sp = urlsplit(absu)
        if sp.scheme not in ("http", "https") or sp.netloc.lower() != host or absu == cur:
            continue
        items.append((absu, sp, a))
    learn(tg, cu, cq, items)
    nav, pg = tg.prof["nav"], tg.prof["page"]
    cur_dir = cu.path if cu.path.endswith("/") else cu.path.rsplit("/", 1)[0] + "/"
    subdirs, files, pages = set(), {}, set()
    metas, entries, heads_left = 0, 0, 40

    for absu, sp, a in items:
        txt = norm_text(a["text"])
        if "parent directory" in txt or txt in ("..", "up", "[to parent directory]", "../"):
            continue
        qd = dict(parse_qsl(sp.query, keep_blank_values=True))
        has_meta, size = parse_meta(a["tail"])
        navp = [p for p in qd if p in nav]
        if navp:                                              # navigation link (?dir=...)
            p = navp[0]
            rest_a = {k: v for k, v in qd.items() if k != p}
            rest_c = {k: v for k, v in cq.items() if k != p}
            v, cv = qd[p], cq.get(p, "")
            if rest_a != rest_c:
                continue
            if v and v.rstrip("/") != cv.rstrip("/") and v.rstrip("/").startswith(cv.rstrip("/")) and \
                    (not cv or v.rstrip("/")[len(cv.rstrip("/")):].startswith("/") or cv == ""):
                subdirs.add(absu)
                entries += 1
                metas += has_meta
            continue
        if sp.path == cu.path and sp.query != cu.query:      # same page, other query
            rest_a = {k: v for k, v in qd.items() if k not in pg}
            rest_c = {k: v for k, v in cq.items() if k not in pg}
            if any(p in pg for p in qd) and rest_a == rest_c:
                pages.add(absu)
            continue
        path = sp.path
        if path.endswith("/") and not sp.query:              # directory
            if path.startswith(cur_dir) and len(path) > len(cur_dir):
                subdirs.add(absu)
                entries += 1
                metas += has_meta
            continue
        base = last_seg(path or "/")
        direct = path.startswith(cur_dir) and "/" not in path[len(cur_dir):].strip("/")
        entry_like = text_matches(a["text"], base) or has_meta or (sp.query and text_matches(a["text"], last_seg(sp.query.split("=")[-1])))
        if not (direct or entry_like):
            continue                                         # nav / footer noise
        ext = os.path.splitext(path)[1].lower()
        if ext and ext not in DYNAMIC_EXTS and len(ext) <= 7:
            kind = "file"
        elif heads_left > 0 and not sp.query:                # truly ambiguous -> ask the server
            heads_left -= 1
            kind = verify_kind(tg, absu)
        else:
            kind = "file"
        if isinstance(kind, tuple):
            subdirs.add(kind[1])
        else:
            files[absu] = size
        entries += 1
        metas += has_meta

    low = (P.title + " " + P.h1 + " " + P.text_head[:600]).lower()
    sig = any(k in low for k in SIGS)
    names = sorted([unquote(last_seg(u)) for u in subdirs] + ["f:" + unquote(last_seg(u)) for u in files])
    fp = hashlib.md5("\n".join(names).encode("utf-8", "replace")).hexdigest() if len(names) >= 3 else ""
    style = ("index-of" if "index of" in low else "http.server" if "directory listing" in low else
             "iis" if "to parent directory" in low else "query-nav" if nav else "generic")
    score = 3 * sig + 3 * bool(nav) + (entries >= 3) + 2 * (entries and metas / float(entries) >= 0.5) + \
        (P.has_pre or P.has_table)
    return {"subdirs": sorted(subdirs), "files": list(files.items()), "pages": sorted(pages), "fp": fp,
            "score": score, "style": style, "js": (entries == 0 and (P.scripts > 0 or "h5ai" in html[:5000].lower())),
            "title": P.title.strip()[:50], "entries": entries}


# ------------------------------ probe ------------------------------
SEEDS = {}           # host -> set(urls found inside results.json)
URL_RE = re.compile(r'https?://[^\s"\'<>\\]+')


def _strings(o):
    if isinstance(o, str):
        yield o
    elif isinstance(o, dict):
        for v in o.values():
            yield from _strings(v)
    elif isinstance(o, (list, tuple)):
        for v in o:
            yield from _strings(v)


def load_hosts(path):
    """Reads hosts AND every URL / path found anywhere inside the json (any schema)."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    hosts, notes = set(), []
    SEEDS.clear()
    pairs = data.items() if isinstance(data, dict) else [("", data)]
    for domain, items in pairs:
        dom = str(domain).lower()
        flat = []
        for it in (items if isinstance(items, list) else [items]):
            if isinstance(it, str):                      # "a, b c;d" -> separate entries
                flat.extend(x for x in re.split(r"[\s,;]+", it.strip()) if x)
            else:
                flat.append(it)
        for it in flat:
            h = (it.get("host") if isinstance(it, dict) else it if isinstance(it, str) else "") or ""
            h, mine = str(h).strip().lower(), set()
            if "://" in h:
                mine.add(h)
                h = urlsplit(h).netloc
            elif "/" in h:
                mine.add("https://" + h)
                h = h.split("/", 1)[0]
            if h.endswith("."):
                fixed = h + dom
                notes.append("fixed %r -> %r" % (h, fixed))
                h = fixed
            others = {}
            for s in _strings(it):
                for u in URL_RE.findall(s):
                    u = u.rstrip(".,;)")
                    nl = urlsplit(u).netloc.lower()
                    if not nl:
                        continue
                    if (h and nl == h) or (not h and dom and nl.endswith(dom)):
                        h = h or nl
                        mine.add(u)
                    elif (dom and nl.endswith(dom)) or (not dom and not (isinstance(it, dict) and h)):
                        others.setdefault(nl, set()).add(u)
                if h and s.startswith("/") and len(s) > 1 and " " not in s:
                    mine.add("https://" + h + s)
            if not h and not others:
                notes.append("skipped entry without host (ips=%s)" % (it.get("ips") if isinstance(it, dict) else "?"))
                continue
            if h:
                hosts.add(h)
                SEEDS.setdefault(h, set()).update(mine)
            for nl, us in others.items():
                hosts.add(nl)
                SEEDS.setdefault(nl, set()).update(us)
    seeded = sum(len(v) for v in SEEDS.values())
    if seeded:
        notes.append("found %d url(s)/path(s) inside the json -> used as discovery seeds" % seeded)
    return sorted(hosts), notes


# ------------------------------ automatic discovery ------------------------------
HREF_RE = re.compile(r'''(?:href|src|action|data-[\w-]+)\s*=\s*["']([^"'#\s][^"']*)["']''', re.I)
PATHY_RE = re.compile(r'''["'`(]((?:https?:)?//[^"'`\s<>)\\]+|/[A-Za-z0-9_\-.%~@+,;:/]{2,})''')
SCRIPT_RE = re.compile(r'<script[^>]+src=["\']([^"\']+)["\']', re.I)
ACTIVE = {}          # host -> (start_time, stage)   (for live progress in phase 1)


def ancestors(path):
    parts = [x for x in path.split("/") if x]
    if not path.endswith("/"):
        parts = parts[:-1]
    for i in range(1, len(parts) + 1):
        yield "/" + "/".join(parts[:i]) + "/"


def discover(host, label_cb=None):
    """Find every open-directory entry point of a host from evidence only:
    json seeds, links, scripts, robots.txt, sitemaps and the parent folders of every
    URL seen. Nothing is guessed from word lists."""
    t0 = time.time()
    host_l = host.lower()
    base, last, root, root_pg = None, None, None, None
    for scheme in ("https", "http"):
        ACTIVE[host] = (t0, scheme)
        r = HTTP.request("%s://%s/" % (scheme, host), timeout=PROBE_TIMEOUT, attempts=2)
        if r.status is not None:
            base = "%s://%s" % (scheme, host)
            if r.status == 200 and r.body:
                root = r
            last = r.status
            break
        last = r.error or "no response"
    if not base:
        for u in SEEDS.get(host, ()):               # root silent: maybe only seeds answer
            for scheme in ("https", "http"):
                sp = urlsplit(u)
                r = HTTP.request("%s://%s%s" % (scheme, host, sp.path or "/"), timeout=PROBE_TIMEOUT, attempts=1)
                if r.status is not None:
                    base = "%s://%s" % (scheme, host)
                    break
            if base:
                break
    if not base:
        return {"host": host, "status": last or "no response", "root": None, "found": [], "root_tg": None}

    seen, frontier, forced, found, found_urls = set(), [], set(), [], set()

    def norm(u):
        u = u.split("#")[0]
        sp = urlsplit(u)
        return "%s://%s%s%s" % (urlsplit(base).scheme, sp.netloc.lower(), sp.path or "/", ("?" + sp.query) if sp.query else "")

    def push(u, prio, force=False):
        u = norm(u)
        if urlsplit(u).netloc.lower() != host_l or u in seen:
            return
        seen.add(u)
        if force:
            forced.add(u)
        frontier.append((u, prio, urlsplit(u).path.count("/")))

    def evidence(u, dirs_only=False):
        sp = urlsplit(u)
        if sp.netloc.lower() != host_l:
            return
        path = sp.path or "/"
        for d in ancestors(path):
            push("%s://%s%s" % (sp.scheme, sp.netloc, d), 1)
        ext = os.path.splitext(path)[1].lower()
        if path.endswith("/"):
            push(u, 1)
        elif not ext:
            push(u.split("?")[0] + "/", 1)           # extension-less path: folder form
            if not dirs_only:
                push(u, 2)
        elif ext in DYNAMIC_EXTS and not dirs_only:
            push(u, 2)

    def harvest(page_url, text, dirs_only=False):
        for m in HREF_RE.finditer(text):
            evidence(urljoin(page_url, m.group(1)), dirs_only)
        for m in PATHY_RE.finditer(text):
            v = m.group(1)
            evidence(urljoin(page_url, "https:" + v if v.startswith("//") else v), dirs_only)

    for u in SEEDS.get(host, ()):
        sp = urlsplit(u)
        if sp.netloc.lower() == host_l:
            push(u, 0, force=True)
            evidence(u)
    if root:
        root_pg_tg = Target(root.url)
        root_pg = analyze(root_pg_tg, root.url, root.text())
        harvest(root.url, root.text())
        for src in SCRIPT_RE.findall(root.text())[:6]:               # same-host scripts hide paths too
            ju = urljoin(root.url, src)
            if urlsplit(ju).netloc.lower() == host_l:
                jr = HTTP.request(ju, timeout=PROBE_TIMEOUT, attempts=1)
                if jr.status == 200:
                    harvest(ju, jr.text(), dirs_only=True)
    ACTIVE[host] = (t0, "robots/sitemap")
    rb = HTTP.request(base + "/robots.txt", timeout=PROBE_TIMEOUT, attempts=1)
    sitemaps = []
    if rb.status == 200:
        for line in rb.text().splitlines():
            m = re.match(r"\s*(allow|disallow)\s*:\s*(/\S*)", line, re.I)
            if m:
                evidence(base + re.split(r"[*$]", m.group(2))[0], dirs_only=True)
            m = re.match(r"\s*sitemap\s*:\s*(\S+)", line, re.I)
            if m:
                sitemaps.append(m.group(1))
    for sm in (sitemaps or [base + "/sitemap.xml"])[:3]:
        sr = HTTP.request(sm, timeout=PROBE_TIMEOUT, attempts=1)
        if sr.status == 200:
            for loc in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", sr.text())[:3000]:
                evidence(loc, dirs_only=True)

    def covered(u):
        p = urlsplit(u).path
        return any(p.startswith(fp) and len(p) >= len(fp) for fp in found_urls)

    def fetch(u):
        r = HTTP.request(u, timeout=PROBE_TIMEOUT, attempts=2)
        if r.status != 200 or not r.body:
            return u, r, None, None
        ct = r.headers.get("content-type", "").lower()
        if ct and "html" not in ct and "text" not in ct:
            return u, r, None, None
        tg = Target(r.url)
        return u, r, tg, analyze(tg, r.url, r.text())

    pages = 0
    ex = ThreadPoolExecutor(8)
    try:
        while frontier and pages < DISCOVER_PAGES and time.time() - t0 < DISCOVER_SECONDS and not STOP.is_set():
            frontier.sort(key=lambda x: (x[1], x[2]))
            batch = [b for b in frontier[:16] if b[0] in forced or not covered(b[0])]
            del frontier[:16]
            ACTIVE[host] = (t0, "discover %dp/%d dirs" % (pages, len(found)))
            for u, r, tg, pg in ex.map(lambda b: fetch(b[0]), batch):
                pages += 1
                if not pg:
                    continue
                if pg["entries"] > 0 and (pg["score"] >= 3 or u in forced):
                    key = urlsplit(r.url).path
                    if not any(key.startswith(fp) for fp in found_urls):
                        tg.prof["engine"] = r.headers.get("server", "?")[:24]
                        tg.prof["style"] = pg["style"]
                        found.append((tg, pg))
                        found_urls.add(key if key.endswith("/") else key.rsplit("/", 1)[0] + "/")
                elif u != norm(root.url if root else base + "/"):
                    harvest(r.url, r.text())
    finally:
        ex.shutdown(wait=False)
    root_tg = None
    if root:
        root_tg = Target(root.url)
        root_tg.prof["engine"] = root.headers.get("server", "?")[:24]
        root_tg.prof["style"] = root_pg["style"]
        if root_pg["entries"] > 0 and root_pg["score"] >= 3 and urlsplit(root.url).path not in found_urls:
            found.insert(0, (root_tg, root_pg))
    return {"host": host, "status": 200 if (root or found) else last, "root": root, "root_pg": root_pg,
            "found": found, "root_tg": root_tg, "pages": pages, "url": root.url if root else base + "/"}


def dead_probe(host, why):
    return {"host": host, "url": None, "status": why, "title": "", "score": 0, "entries": 0,
            "index_like": False, "js": False, "style": "-", "engine": "-", "target": None,
            "targets": [], "found": []}


def probe(host):
    try:
        if STOP.is_set():
            return dead_probe(host, "stopped")
        d = discover(host)
        if d["status"] != 200:
            return dead_probe(host, d["status"])
        found, rp = d["found"], d.get("root_pg")
        targets = [tg for tg, _ in found]
        if not targets and INCLUDE_NON_INDEX and d["root_tg"]:
            targets = [d["root_tg"]]
        pg = rp or (found[0][1] if found else {"title": "", "score": 0, "entries": 0, "style": "-", "js": False})
        tg0 = found[0][0] if found else d["root_tg"]
        return {"host": host, "url": d["url"], "status": 200, "title": pg["title"],
                "score": max([pg["score"]] + [p["score"] for _, p in found]),
                "entries": pg["entries"], "index_like": bool(found), "js": pg["js"],
                "style": found[0][1]["style"] if found else pg["style"],
                "engine": tg0.prof["engine"] if tg0 else "?", "target": targets[0] if targets else None,
                "targets": targets, "found": [{"url": t.start, "entries": p["entries"]} for t, p in found]}
    finally:
        ACTIVE.pop(host, None)


def print_probe(r, i=0, n=0):
    if r["index_like"]:
        tag, ic = c("INDEX", "green"), c(ICON["ok"], "green")
    elif r["status"] == 200:
        tag, ic = c("site ", "yellow"), c(ICON["dot"], "yellow")
    else:
        tag, ic = c("dead ", "red"), c(ICON["bad"], "red")
    if r["status"] == 200:
        extra = "%s | %s | %d listing dir(s)%s" % (r["style"], head(r["engine"], 12), len(r["found"]),
                                                  " | JS-rendered (unsupported)" if r["js"] else "")
    else:
        extra = "no response (%s)" % str(r["status"])[:30]
    cnt = c("[%d/%d]" % (i, n), "gray") + " " if n else ""
    print(" %s%s %s %-26s %s" % (cnt, ic, tag, clip(r["host"], 26), c(extra, "gray")))
    for f in r["found"][:6]:
        print("      %s %s %s" % (c(ICON["arrow"], "magenta"), clip(where(f["url"]), width() - 22),
                                 c("(%d entries)" % f["entries"], "gray")))
    if len(r["found"]) > 6:
        print(c("      ... +%d more" % (len(r["found"]) - 6), "gray"))


def probe_all(hosts):
    """Probe in parallel, print each result the moment it finishes, and show a
    heartbeat naming the hosts we are still waiting for."""
    results, total = [], len(hosts)
    if not total:
        return results
    print(c("  probing %d hosts in parallel (timeout %ds each)..." % (total, PROBE_TIMEOUT), "gray"))
    ex = ThreadPoolExecutor(min(16, total))
    pending = {ex.submit(probe, h): h for h in hosts}
    t0 = last = time.time()
    try:
        while pending:
            done, _ = wait(list(pending), timeout=1.0, return_when=FIRST_COMPLETED)
            for f in done:
                h = pending.pop(f)
                try:
                    r = f.result()
                except Exception as e:
                    r = dead_probe(h, str(e)[:30])
                results.append(r)
                print_probe(r, len(results), total)
            if pending and time.time() - last >= 3:
                last = time.time()
                waits = []
                for h in list(ACTIVE)[:3]:
                    st, stage = ACTIVE[h]
                    waits.append("%s (%s %ds)" % (head(h, 24), stage, time.time() - st))
                more = len(ACTIVE) - len(waits)
                print(c("  %s %d/%d done | waiting: %s%s | %s" % (
                    ICON["mid"], len(results), total, ", ".join(waits) or "...",
                    " +%d more" % more if more > 0 else "", tfmt(time.time() - t0)), "gray"))
    except KeyboardInterrupt:
        STOP.set()
        print(c("\n interrupted during probe", "red"))
        for f in pending:
            f.cancel()
    finally:
        ex.shutdown(wait=False)
    results.sort(key=lambda r: r["host"])
    return results


# ------------------------------ crawl engine ------------------------------
FILES_OUT = {"fh": None, "lock": threading.Lock()}


def write_files(tg, files):
    lines = []
    for u, s in files:
        if ONLY_EXTS and os.path.splitext(urlsplit(u).path)[1].lower() not in ONLY_EXTS:
            continue
        lines.append("%s\t%s\n" % (u, "" if s is None else s))
    if lines and FILES_OUT["fh"]:
        with FILES_OUT["lock"]:
            FILES_OUT["fh"].write("".join(lines))


def scan(tg, url):
    t0 = time.time()
    r = HTTP.request(url)
    lat = time.time() - t0
    ra = None
    if r.headers.get("retry-after", "").isdigit():
        ra = min(60, int(r.headers["retry-after"]))
    out = {"status": r.status, "lat": lat, "retry": ra, "err": r.error, "final": r.url}
    if r.status == 200:
        ct = r.headers.get("content-type", "").lower()
        if "html" in ct or "text" in ct or not ct:
            out["page"] = analyze(tg, r.url, r.text())
        else:
            out["notdir"] = True
    return out


def add_node(tg, key, depth):
    return tg.nodes.setdefault(key, {"depth": depth, "subdirs": 0, "files": 0, "size": 0,
                                     "exts": {}, "sample": []})


class Feed:
    def __init__(self):
        self.n, self.every, self.rate_t, self.rate_n = 0, 1, time.time(), 0

    def line(self, tg, depth, node, url, notable=""):
        self.n += 1
        if self.n % self.every and not notable:
            return
        host = c("%-8s" % head(tg.netloc.split(".")[0], 8), "magenta")
        sz = c(" %8s" % human(node["size"]) if node.get("size") else " " * 9, "gray")
        print("  %s %s %s %s%s %s%s" % (host, c("d%-2d" % depth, "cyan"),
                                       c("%4dD" % node["subdirs"], "blue"), c("%5dF" % node["files"], "green"), sz,
                                       c(clip(where(url), max(12, width() - 40)), "gray"), notable))

    def adapt(self, scanned):
        now = time.time()
        if now - self.rate_t >= 2:
            rate = (scanned - self.rate_n) / (now - self.rate_t)
            self.every = max(1, int(rate / 6))
            self.rate_t, self.rate_n = now, scanned


def handle(tg, task, res, feed, targets):
    url, depth, attempt, base = task
    st = tg.st
    tg.gov.done(res["status"], res["lat"], res["retry"])
    status = res["status"]
    if status is None or status in (429, 502, 503, 504):
        if attempt < 4 and not STOP.is_set():
            st["retries"] += 1
            tg.seq += 1
            heapq.heappush(tg.delayed, (time.time() + 1.5 * (attempt + 1) + (res["retry"] or 0), tg.seq,
                                        (url, depth, attempt + 1, base)))
            return
    key = base or url
    if status != 200 or "page" not in res:
        if base is None:
            node = add_node(tg, key, depth)
            node["error"] = status if status else (res["err"] or "net")
            st["err"] += 1
            st["scanned"] += 1
            feed.line(tg, depth, node, url, c(" ERROR %s" % node["error"], "red"))
        return
    page = res["page"]
    node = add_node(tg, key, depth)
    paged = bool(page["pages"]) or base is not None
    if paged:
        seen_f = tg.pfiles.setdefault(key, set())
        new_files = [(u, s) for u, s in page["files"] if u not in seen_f]
        seen_f.update(u for u, _ in new_files)
        st["pages"] += 1
    else:
        new_files = page["files"]
    new_subs = [s for s in page["subdirs"] if s not in tg.seen]
    if base is None:
        st["scanned"] += 1
    write_files(tg, new_files)
    node["files"] += len(new_files)
    node["subdirs"] += len(page["subdirs"]) if base is None else len(new_subs)
    for u, s in new_files:
        e = os.path.splitext(unquote(urlsplit(u).path))[1].lower() or "(none)"
        node["exts"][e] = node["exts"].get(e, 0) + 1
        tg.exts[e] += 1
        if s:
            node["size"] += s
            st["size"] += s
        if len(node["sample"]) < 3:
            node["sample"].append(unquote(last_seg(urlsplit(u).path or u)))
    st["files"] += len(new_files)
    tg.prof["style"] = page["style"]
    notable = ""
    expand = True
    if page["fp"] and page["subdirs"]:
        other = tg.fp.get(page["fp"])
        if other and other != key and (key.startswith(other) or other.startswith(key)):
            st["dups"] += 1
            node["dup"] = other
            expand, notable = False, c(" =dup", "yellow")
        else:
            tg.fp[page["fp"]] = key
    if new_files or page["subdirs"] == []:
        st["barren"] = 0
    else:
        st["barren"] += 1
        if st["barren"] > 1500:
            st["guard"], expand = True, False
            notable = c(" =runaway", "red")
    if expand:
        for s in new_subs:
            if len(s) > 1500 or path_cycle(urlsplit(s).path) or not tg.in_scope(s):
                if path_cycle(urlsplit(s).path):
                    st["traps"] += 1
                continue
            tg.seen.add(s)
            tg.queue.append((s, depth + 1, 0, None))
        if new_files or new_subs or base is None:
            for pu in page["pages"]:
                if pu not in tg.seen and tg.in_scope(pu):
                    tg.seen.add(pu)
                    tg.queue.append((pu, depth, 0, key))
    if base is None:
        if len(new_files) >= 300:
            notable += c(" big", "cyan")
        feed.line(tg, depth, node, url, notable)


def save_state(folder, targets, finished):
    data = {"finished": finished, "saved": time.time(), "stats": dict(STATS), "targets": []}
    for tg in targets:
        pend = list(tg.queue) + [t for _, _, t in tg.delayed]
        data["targets"].append({
            "start": tg.start, "seen": sorted(tg.seen), "pending": pend, "nodes": tg.nodes, "fp": tg.fp,
            "pfiles": {k: sorted(v) for k, v in tg.pfiles.items()}, "exts": dict(tg.exts), "st": tg.st,
            "prof": {k: (sorted(v) if isinstance(v, set) else v) for k, v in tg.prof.items()},
            "gov": {"limit": tg.gov.limit, "peak": tg.gov.peak, "throttles": tg.gov.throttles,
                    "lat_n": tg.gov.lat_n, "lat_sum": tg.gov.lat_sum}, "partial": tg.partial})
    tmp = os.path.join(folder, "state.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, os.path.join(folder, "state.json"))


def load_state(folder):
    with open(os.path.join(folder, "state.json"), encoding="utf-8") as f:
        data = json.load(f)
    targets = []
    for d in data["targets"]:
        tg = Target(d["start"])
        tg.seen = set(d["seen"])
        tg.nodes, tg.fp = d["nodes"], d["fp"]
        tg.pfiles = {k: set(v) for k, v in d["pfiles"].items()}
        tg.exts, tg.st, tg.partial = Counter(d["exts"]), d["st"], False
        tg.prof = {k: (set(v) if k in ("nav", "page", "noise") else v) for k, v in d["prof"].items()}
        g = d["gov"]
        tg.gov.limit, tg.gov.peak, tg.gov.throttles = max(2.0, g["limit"]), g["peak"], g["throttles"]
        tg.gov.lat_n, tg.gov.lat_sum = g["lat_n"], g["lat_sum"]
        for t in d["pending"]:
            tg.queue.append(tuple(t))
        targets.append(tg)
    return targets


def run(targets, folder):
    pool = ThreadPoolExecutor(POOL_SIZE)
    futs, feed = {}, Feed()
    t0 = last_ck = time.time()
    last_ui = t0 - 2          # first status line shows immediately
    try:
        while True:
            now = time.time()
            for tg in targets:
                while tg.delayed and tg.delayed[0][0] <= now:
                    tg.queue.append(heapq.heappop(tg.delayed)[2])
            progress = True
            while progress and len(futs) < POOL_SIZE and not STOP.is_set():
                progress = False
                for tg in targets:
                    if tg.queue and tg.gov.allowed(now):
                        task = tg.queue.popleft()
                        tg.gov.inflight += 1
                        futs[pool.submit(scan, tg, task[0])] = (tg, task)
                        progress = True
                        if len(futs) >= POOL_SIZE:
                            break
            if not futs:
                if not any(tg.open_work() for tg in targets):
                    break
                time.sleep(0.1)
            else:
                done, _ = wait(list(futs), timeout=0.25, return_when=FIRST_COMPLETED)
                for f in done:
                    tg, task = futs.pop(f)
                    try:
                        res = f.result()
                    except Exception as e:                      # never let one page kill the run
                        res = {"status": None, "lat": 0, "retry": None, "err": str(e)[:40], "final": task[0]}
                    handle(tg, task, res, feed, targets)
            now = time.time()
            scanned = sum(t.st["scanned"] for t in targets)
            if now - last_ui >= 2:
                feed.adapt(scanned)
                status_line(targets, futs, t0)
                last_ui = now
            if now - last_ck >= 30:
                save_state(folder, targets, False)
                last_ck = now
    except KeyboardInterrupt:
        STOP.set()
        print("\n" + c(" interrupted - state saved, run again to RESUME", "red"))
    finally:
        for f, (tg, task) in list(futs.items()):
            f.cancel()
            tg.queue.appendleft(task)
        pool.shutdown(wait=False)
        for tg in targets:
            tg.partial = tg.open_work() > 0
        if FILES_OUT["fh"]:
            FILES_OUT["fh"].flush()
    return t0


def status_line(targets, futs, t0):
    sc = sum(t.st["scanned"] for t in targets)
    qd = sum(t.open_work() for t in targets) + len(futs)
    fl = sum(t.st["files"] for t in targets)
    sz = sum(t.st["size"] for t in targets)
    er = sum(t.st["err"] for t in targets)
    el = max(1, time.time() - t0)
    thr = sum(t.gov.throttles for t in targets)
    sep = " " + ICON["mid"] + " "
    print("  %s %s %s scanned%squeued %s%s%d busy%s%.0f dir/s%s%s files%s%serr=%d slow=%d%s%s" % (
        c(ICON["arrow"], "magenta"), c(bar(sc / float(max(1, sc + qd))), "magenta"),
        format(sc, ","), sep, format(qd, ","), sep, len(futs), sep, sc / el, sep,
        format(fl, ","), sep, (human(sz) + " ") if sz else "", er, thr, sep, c(tfmt(el), "gray")))
    if futs:
        cur = []
        for tg, task in list(futs.values())[:2]:
            cur.append("%s%s" % (head(tg.netloc.split(".")[0], 8), clip(where(task[0]), max(10, width() // 2 - 14))))
        print(c("     now: " + "  ".join(cur), "gray"))


# ------------------------------ phase 3: missing file sizes ------------------------------
def head_size(u, sem):
    """Size straight from the server (HEAD -> Content-Length). Never downloads the file."""
    with sem:
        for a in range(3):
            if STOP.is_set():
                return None
            r = HTTP.request(u, "HEAD", headers={"Accept-Encoding": "identity"})
            if r.status == 200:
                cl = r.headers.get("content-length", "")
                return int(cl) if cl.isdigit() else None
            if r.status in (429, 502, 503, 504) or r.status is None:
                time.sleep(1.5 * (a + 1))
                continue
            return None
    return None


def fill_sizes(folder, targets):
    tsv = os.path.join(folder, "files.tsv")
    if not os.path.exists(tsv):
        return
    rows = []
    with open(tsv, encoding="utf-8") as f:
        for line in f:
            u, _, s = line.rstrip("\n").partition("\t")
            if u:
                rows.append([u, int(s) if s.strip().isdigit() else None])
    missing = [i for i, r in enumerate(rows) if r[1] is None]
    if FETCH_MISSING_SIZES and missing and not STOP.is_set():
        print("\n" + rule("PHASE 3  FILE SIZES  (%s files without size, HEAD only)" % format(len(missing), ",")))
        sems, t0, last, got, fail = {}, time.time(), 0, 0, 0
        ex = ThreadPoolExecutor(POOL_SIZE)
        futs = {}
        for i in missing:
            nl = urlsplit(rows[i][0]).netloc.lower()
            sem = sems.setdefault(nl, threading.Semaphore(min(8, PER_HOST_CAP)))
            futs[ex.submit(head_size, rows[i][0], sem)] = i
        pending = set(futs)
        try:
            while pending:
                done, pending = wait(pending, timeout=1.0, return_when=FIRST_COMPLETED)
                for fu in done:
                    try:
                        s = fu.result()
                    except Exception:
                        s = None
                    if s is None:
                        fail += 1
                    else:
                        rows[futs[fu]][1] = s
                        got += 1
                if time.time() - last >= 2:
                    last = time.time()
                    n = got + fail
                    print("  %s %s %s/%s sized %s %s unknown %s %.0f files/s %s" % (
                        c(ICON["arrow"], "magenta"), c(bar(n / float(len(missing))), "magenta"), format(n, ","),
                        format(len(missing), ","), c(format(got, ","), "green"), ICON["mid"], format(fail, ","),
                        n / max(1, time.time() - t0), c(tfmt(time.time() - t0), "gray")))
        except KeyboardInterrupt:
            STOP.set()
            print(c("\n interrupted - keeping the sizes found so far", "red"))
            for fu in pending:
                fu.cancel()
        finally:
            ex.shutdown(wait=False)
        tmp = tsv + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            for u, s in rows:
                f.write("%s\t%s\n" % (u, "" if s is None else s))
        os.replace(tmp, tsv)
    # coverage per target (also feeds the summary)
    for tg in targets:
        tg.st["tsv_files"] = tg.st["tsv_sized"] = tg.st["tsv_bytes"] = 0
    for u, s in rows:
        sp = urlsplit(u)
        cands = [tg for tg in targets if tg.netloc == sp.netloc.lower()]
        if cands:
            tg = max(cands, key=lambda t: len(t.base) if sp.path.startswith(t.base) else -1)
            tg.st["tsv_files"] += 1
            if s is not None:
                tg.st["tsv_sized"] += 1
                tg.st["tsv_bytes"] += s
    for tg in targets:
        if tg.st["tsv_bytes"] > tg.st["size"]:
            tg.st["size"] = tg.st["tsv_bytes"]


# ------------------------------ summary & reports ------------------------------
def host_view(tg):
    ok = [n for n in tg.nodes.values() if "error" not in n]
    return {"dirs": len(tg.nodes), "files": tg.st["files"], "size": tg.st["size"],
            "depth": max([n["depth"] for n in tg.nodes.values()] or [0])}


def status_label(tg):
    if tg.partial:
        return c("PARTIAL", "red")
    return c("COMPLETE", "green")


def cov_text(targets):
    n = sum(t.st.get("tsv_files", 0) for t in targets)
    k = sum(t.st.get("tsv_sized", 0) for t in targets)
    if not n:
        return "-"
    return "%d%% of files (%s / %s)%s" % (round(100.0 * k / n), format(k, ","), format(n, ","),
                                          "" if k == n else "  -> total size is a MINIMUM")


def summary_lines(probes, targets, folder):
    L = ["", rule("SUMMARY", "═")]
    alive = sum(1 for p in probes if p["status"] == 200)
    idx = sum(1 for p in probes if p["index_like"])
    tf = sum(t.st["files"] for t in targets)
    td = sum(len(t.nodes) for t in targets)
    ts = sum(t.st["size"] for t in targets)
    el = time.time() - STATS["t0"]
    L += ["  hosts probed : %s  (alive %s | index-like %s)" % (len(probes), alive, c(idx, "green")),
          "  dirs scanned : %s" % format(td, ","),
          "  files found  : %s%s" % (c(format(tf, ","), "green"), ("   (%s listed)" % human(ts)) if ts else ""),
          "  size known   : %s" % (cov_text(targets)),
          "  requests     : %s  (%s downloaded)" % (format(STATS["req"], ","), human(STATS["bytes"])),
          "  elapsed      : %s  (%.1f req/s)" % (tfmt(el), STATS["req"] / max(1.0, el))]
    if targets:
        L += ["", rule("PER HOST")]
        L.append(c("  %-22s %6s %7s %9s %3s  %s" % ("host", "dirs", "files", "size", "dep", "status"), "gray"))
        for t in targets:
            v = host_view(t)
            sp = urlsplit(t.start)
            name = sp.netloc + (("?" + sp.query) if sp.query else (sp.path if sp.path != "/" else ""))
            L.append("  %-22s %6d %7d %9s %3d  %s" % (clip(name, 22), v["dirs"], v["files"],
                                                      human(v["size"]) if v["size"] else "-", v["depth"], status_label(t)))
        L += ["", rule("LEARNED (automatic)")]
        for t in targets:
            p, g = t.prof, t.gov
            avg = (g.lat_sum / g.lat_n) if g.lat_n else 0
            L.append("  %s" % c(clip(t.netloc, width() - 4), "bold"))
            L.append("    format=%s  server=%s" % (p["style"], p["engine"]))
            L.append("    nav=%s page=%s ignored=%s" % (sorted(p["nav"]) or "path", sorted(p["page"]) or "-",
                                                         sorted(p["noise"]) or "-"))
            L.append("    conns peak=%d final=%d | avg latency %.2fs | slowdowns %d | retries %d" % (
                g.peak, int(g.limit), avg, g.throttles, t.st["retries"]))
            extra = []
            if t.st["dups"]:
                extra.append("loop/alias skipped: %d" % t.st["dups"])
            if t.st["traps"]:
                extra.append("path-cycle traps: %d" % t.st["traps"])
            if t.st["guard"]:
                extra.append("runaway guard fired")
            if t.st["pages"]:
                extra.append("paged listings: %d extra pages" % t.st["pages"])
            if t.st["heads"]:
                extra.append("HEAD checks: %d" % t.st["heads"])
            if t.st.get("tsv_files"):
                extra.append("sizes known: %d%%" % round(100.0 * t.st["tsv_sized"] / t.st["tsv_files"]))
            if t.netloc in INSECURE:
                extra.append("SSL cert unverified")
            if extra:
                L.append("    " + "; ".join(extra))
    allext = Counter()
    for t in targets:
        allext.update(t.exts)
    if allext:
        L += ["", rule("TOP EXTENSIONS")]
        top = allext.most_common(8)
        for e, n in top:
            L.append("  %-8s %s %s" % (e, c(bar(n / float(top[0][1]), 18), "cyan"), format(n, ",")))
    big = sorted(((u, v, t) for t in targets for u, v in t.nodes.items() if "error" not in v),
                 key=lambda x: -x[1]["files"])[:5]
    if big and big[0][1]["files"]:
        L += ["", rule("BIGGEST DIRECTORIES")]
        for u, v, t in big:
            L.append("  %6d files  %s" % (v["files"], c(clip(t.netloc + where(u), width() - 16), "gray")))
    L += ["", rule("NEXT")]
    if any(t.partial for t in targets):
        L.append("  Interrupted -> run again and answer Y to RESUME exactly where it stopped.")
    else:
        L.append("  Crawl finished: every reachable folder was visited. See files.tsv / links.txt.")
    return L


def tree_lines(tg):
    L = ["", "HOST: " + tg.start, "-" * 60]
    for url in sorted(tg.nodes, key=lambda u: unquote(u)):
        v = tg.nodes[url]
        pad = "  " * min(v["depth"], 40)
        if "error" in v:
            L.append("%s- %s [ERROR %s]" % (pad, unquote(url), v["error"]))
            continue
        L.append("%s- %s (dirs=%d, files=%d%s)%s" % (pad, unquote(url), v["subdirs"], v["files"],
                                                    ", " + human(v["size"]) if v["size"] else "",
                                                    "  [dup of %s]" % where(v["dup"]) if v.get("dup") else ""))
        if v["sample"]:
            L.append("%s    e.g. %s" % (pad, ", ".join(v["sample"])))
    return L


def save_reports(folder, probes, targets):
    global COLOR
    keep, COLOR = COLOR, False
    try:
        lines = ["DIRSCAN 3 report  %s" % datetime.now().strftime("%Y-%m-%d %H:%M:%S"), ""]
        lines.append("PROBE (%d hosts)" % len(probes))
        for p in probes:
            tag = "INDEX" if p["index_like"] else ("site" if p["status"] == 200 else "dead")
            lines.append("  %-6s %-32s %s | %s | score=%s | %s" % (tag, p["host"], p["url"] or "-", p["style"],
                                                                 p["score"], p["title"]))
        lines += summary_lines(probes, targets, folder)
        for t in targets:
            lines += tree_lines(t)
        with open(os.path.join(folder, "report.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    finally:
        COLOR = keep
    with open(os.path.join(folder, "report.json"), "w", encoding="utf-8") as f:
        json.dump({"probes": [{k: v for k, v in p.items() if k not in ("target", "targets")} for p in probes],
                   "hosts": [{"start": t.start, "stats": t.st, "exts": dict(t.exts),
                              "learned": {k: (sorted(v) if isinstance(v, set) else v) for k, v in t.prof.items()},
                              "nodes": t.nodes} for t in targets]}, f, ensure_ascii=False, indent=1)
    n = 0
    tsv = os.path.join(folder, "files.tsv")
    if os.path.exists(tsv):
        with open(tsv, encoding="utf-8") as fi, open(os.path.join(folder, "links.txt"), "w", encoding="utf-8") as fo:
            for line in fi:
                fo.write(line.split("\t", 1)[0] + "\n")
                n += 1
    return n


# ------------------------------ folders / resume ------------------------------
def script_dir():
    try:
        return os.path.dirname(os.path.abspath(__file__))
    except NameError:
        return os.getcwd()


def roots():
    out = [os.path.join(script_dir(), OUT_NAME)]
    alt = os.path.join(os.getcwd(), OUT_NAME)
    return out + ([alt] if alt not in out else [])


def pick_folder():
    stamp = datetime.now().strftime("dirscan_%Y%m%d_%H%M%S")
    for root in roots():
        try:
            p = os.path.join(root, stamp)
            os.makedirs(p, exist_ok=True)
            return p
        except Exception:
            continue
    return "."


def find_resumable():
    best = None
    for root in roots():
        try:
            for name in sorted(os.listdir(root), reverse=True):
                p = os.path.join(root, name, "state.json")
                if name.startswith("dirscan_") and os.path.exists(p):
                    with open(p, encoding="utf-8") as f:
                        if not json.load(f).get("finished"):
                            return os.path.join(root, name)
        except Exception:
            continue
    return best


def find_json():
    for d in (script_dir(), os.getcwd(), os.path.join(script_dir(), OUT_NAME)):
        p = os.path.join(d, JSON_FILE)
        if os.path.exists(p):
            return p


def dedupe_targets(tgs):
    out = []
    for t in sorted(tgs, key=lambda x: len(x.start)):
        sp = urlsplit(t.start)
        covered = False
        for o in out:
            so = urlsplit(o.start)
            if so.netloc.lower() == sp.netloc.lower() and not so.query and sp.path.startswith(so.path.rsplit("/", 1)[0] + "/") \
                    and (so.path.endswith("/") or so.path == sp.path):
                covered = True
                break
        if not covered:
            out.append(t)
    return out


# ------------------------------ main ------------------------------
def main():
    banner()
    folder, targets, probes, notes = None, [], [], []
    res_dir = find_resumable() if RESUME != "no" else None
    resumed = False
    if res_dir:
        ans = "y" if RESUME == "yes" else ""
        if RESUME == "ask":
            try:
                ans = input(" Unfinished run found: %s\n Resume it? [Y/n] " % res_dir).strip().lower() or "y"
            except (EOFError, KeyboardInterrupt, OSError):
                ans = "n"
        if ans.startswith("y"):
            folder, targets, resumed = res_dir, load_state(res_dir), True
            print(" %s resumed %d target(s); %s pending dirs" % (
                c(ICON["ok"], "green"), len(targets), format(sum(t.open_work() for t in targets), ",")))
    if not resumed:
        folder = pick_folder()
        hosts = []
        jp = find_json()
        if jp:
            hosts, notes = load_hosts(jp)
            print(" %s loaded %d hosts from %s" % (c(ICON["ok"], "green"), len(hosts), jp))
            for n in notes:
                print("   %s %s" % (c(ICON["dot"], "yellow"), c(n, "yellow")))
        else:
            print(" %s %s not found (put it next to the script)" % (c(ICON["bad"], "red"), JSON_FILE))
        try:
            print("\n" + rule("PHASE 1  PROBE"))
            probes = probe_all(hosts)
            ok = sum(1 for p in probes if p["index_like"])
            print(" %s probe finished in %s: %d index-like host(s) out of %d" % (
                c(ICON["ok"], "green"), tfmt(time.time() - STATS["t0"]), ok, len(probes)))
        except KeyboardInterrupt:
            STOP.set()
        for p in probes:
            targets.extend(p.get("targets") or [])
        for u in EXTRA_URLS:
            targets.append(Target(u))
        targets = dedupe_targets(targets)
        for t in targets:
            t.queue.append((t.start, 0, 0, None))

    if MODE != "probe" and targets and not STOP.is_set():
        FILES_OUT["fh"] = open(os.path.join(folder, "files.tsv"), "a", encoding="utf-8")
        print("\n" + rule("PHASE 2  CRAWL  (%d targets, adaptive)" % len(targets)))
        for t in targets:
            print(" %s %s" % (c(ICON["arrow"], "magenta"), t.start))
        print()
        run(targets, folder)
        finished = not any(t.partial for t in targets)
        save_state(folder, targets, finished)
        FILES_OUT["fh"].close()
        if not STOP.is_set():
            fill_sizes(folder, targets)
    elif MODE == "probe":
        print("\n MODE='probe' -> not crawling. Set MODE = 'full' to crawl INDEX hosts.")

    for line in summary_lines(probes, targets, folder):
        print(line)
    n = save_reports(folder, probes, targets)
    print("\n" + rule("FILES"))
    print("  folder : " + c(folder, "cyan"))
    print("  files  : report.txt, report.json, files.tsv (url<TAB>size), links.txt (%s links)" % format(n, ","))
    print(c("\n  done.", "green"))


main()