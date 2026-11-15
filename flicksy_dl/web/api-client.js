// Data-access layer. The UI (app.js) only talks to window.Api, never to fetch() directly, so the backend
// (or Flicksy itself, later) can be swapped without touching the UI. Contract: docs/API-CONTRACT.md
(function () {
  async function http(path, signal) {
    const r = await fetch(path, { signal, headers: { Accept: 'application/json' } });
    const j = await r.json().catch(() => ({ success: false, error: 'BAD_RESPONSE' }));
    if (!r.ok || !j.success) {
      const e = new Error(j.message || j.error || 'HTTP ' + r.status);
      e.code = j.error; e.status = r.status;
      throw e;
    }
    return j;
  }
  window.Api = {
    facets: (signal) => http('/api/v2/facets', signal),
    featured: (limit, signal) => http('/api/v2/featured?limit=' + (limit || 12), signal),
    health: (signal) => http('/api/v2/health', signal),
    titles: (p, signal) => {
      const qs = new URLSearchParams();
      Object.entries(p || {}).forEach(([k, v]) => { if (v !== '' && v != null) qs.set(k, v); });
      return http('/api/v2/titles?' + qs, signal);
    },
    title: (id, signal) => http('/api/v2/titles/' + encodeURIComponent(id), signal),
  };
})();
