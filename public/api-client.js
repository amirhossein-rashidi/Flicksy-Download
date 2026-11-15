// Static data-access layer: same interface as api-client.js (window.Api) but reads plain JSON files produced by
// `python -m flicksy_dl.staticgen`. Search/filter/paging run in the browser. Contract: docs/API-CONTRACT.md
(function () {
  const SHARD = 500;
  const DIAC = /[\u064B-\u065F\u0670\u0640]/g;
  const MAP = { 'ي': 'ی', 'ك': 'ک', 'ۀ': 'ه', 'ة': 'ه', 'أ': 'ا', 'إ': 'ا', 'ٱ': 'ا', '‌': ' ', '‏': ' ', '‎': ' ', '&': ' and ' };
  '۰۱۲۳۴۵۶۷۸۹'.split('').forEach((c, i) => { MAP[c] = String(i); });
  '٠١٢٣٤٥٦٧٨٩'.split('').forEach((c, i) => { MAP[c] = String(i); });
  // same rules as flicksy_dl/textnorm.py norm()
  function norm(t) {
    if (!t) return '';
    t = String(t).replace(DIAC, '').replace(/[\s\S]/g, (c) => (c in MAP ? MAP[c] : c)).toLowerCase().replace(/'/g, '');
    return t.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }
  function err(code, message, status) { const e = new Error(message || code); e.code = code; e.status = status; return e; }
  const cache = {};
  function getJSON(path, signal) {
    if (!cache[path]) {
      cache[path] = fetch(path, { signal, headers: { Accept: 'application/json' } }).then((r) => {
        if (!r.ok) throw err('NOT_FOUND', 'HTTP ' + r.status, r.status);
        return r.json();
      }).catch((e) => { delete cache[path]; throw e; });
    }
    return cache[path];
  }
  const meta = (s) => getJSON('data/meta.json', s);
  let prepared = null;
  async function prepare(signal) {
    if (prepared) return prepared;
    prepared = (async () => {
      const [m, raw] = await Promise.all([meta(signal), getJSON('data/index.json', signal)]);
      const gname = {}; m.facets.genres.forEach((g) => { gname[g.id] = g.title; });
      const items = raw.map((r) => ({
        id: r[0], kind: r[1] === 0 ? 'movie' : 'series', title: r[2], titleFa: r[3], year: r[4], imdbScore: r[5], image: r[6],
        genreIds: r[7], genres: r[7].map((g) => gname[g]).filter(Boolean).join('، '), countries: r[8], linkCount: r[9],
        _words: norm([r[2], r[3], r[10]].filter(Boolean).join(' ')).split(' '), _first: norm(r[2] || r[3] || ''),
      }));
      return items;
    })().catch((e) => { prepared = null; throw e; });
    return prepared;
  }
  const pub = (x) => { const o = Object.assign({}, x); delete o.genreIds; delete o._words; delete o._first; return o; };
  window.Api = {
    facets: async (s) => ({ success: true, ...(await meta(s)).facets }),
    health: async (s) => ({ success: true, ...(await meta(s)).health }),
    featured: async (limit, s) => ({ success: true, items: (await meta(s)).featured.slice(0, limit || 12) }),
    titles: async (p, s) => {
      p = p || {};
      const all = await prepare(s);
      const limit = Math.max(1, Math.min(parseInt(p.limit, 10) || 24, 60));
      const offset = Math.max(0, parseInt(p.offset, 10) || 0);
      const terms = norm((p.q || '').slice(0, 100)).split(' ').filter(Boolean).slice(0, 6);
      const kind = p.kind === 'movie' || p.kind === 'series' ? p.kind : null;
      const year = p.year ? parseInt(p.year, 10) : null;
      const genre = p.genre ? parseInt(p.genre, 10) : null;
      let rows = all.filter((x) => (!kind || x.kind === kind) && (!year || x.year === year) && (!genre || x.genreIds.includes(genre)));
      if (terms.length) {
        const scored = [];
        for (const x of rows) {
          let ok = true;
          for (const t of terms) if (!x._words.some((w) => w.startsWith(t))) { ok = false; break; }
          if (ok) scored.push([x._first === terms.join(' ') ? 0 : x._first.startsWith(terms[0]) ? 1 : 2, x]);
        }
        scored.sort((a, b) => a[0] - b[0]); // stable: ties keep newest-first order
        rows = scored.map((a) => a[1]);
      }
      const page = rows.slice(offset, offset + limit + 1);
      return { success: true, items: page.slice(0, limit).map(pub), limit, offset, hasMore: page.length > limit };
    },
    title: async (id, s) => {
      id = parseInt(id, 10);
      if (!(id >= 0)) throw err('BAD_PARAMETER', 'شناسه نامعتبر', 400);
      let shard;
      try { shard = await getJSON('data/t/' + Math.floor(id / SHARD) + '.json', s); } catch (e) { throw err('NOT_FOUND', 'عنوان پیدا نشد', 404); }
      const d = shard[String(id)];
      if (!d) throw err('NOT_FOUND', 'عنوان پیدا نشد', 404);
      return { success: true, title: d };
    },
  };
})();
