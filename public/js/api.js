/* BoundBuild — API client with offline queue-and-sync */
'use strict';

const API = (() => {
  let token = storeGet('bb_token') || '';

  async function req(method, path, body, { raw = false, headers = {} } = {}) {
    const opts = { method, headers: { ...headers } };
    if (token) opts.headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) {
      if (raw) {
        // Raw uploads (audio/photos) send the blob/bytes as the body verbatim.
        opts.body = body;
      } else {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
    }
    const res = await fetch(path, opts);
    if (res.status === 401) {
      token = ''; storeDel('bb_token');
      location.hash = '#/login';
      throw new Error('Session expired — sign in again');
    }
    if (!res.ok) {
      let msg = 'Request failed (' + res.status + ')';
      try { msg = (await res.json()).error || msg; } catch (e) { /* ignore */ }
      throw new Error(msg);
    }
    return res;
  }

  async function json(method, path, body) {
    const res = await req(method, path, body);
    return res.json();
  }

  /* ---- offline queue: text drafts + small photos survive; big media syncs live ---- */
  function queueList() {
    try { return JSON.parse(storeGet('bb_queue') || '[]'); } catch (e) { return []; }
  }
  function queueAdd(item) {
    const q = queueList();
    q.push({ ...item, queuedAt: new Date().toISOString() });
    storeSet('bb_queue', JSON.stringify(q));
  }
  function queueRemove(id) {
    storeSet('bb_queue', JSON.stringify(queueList().filter((x) => x.localId !== id)));
  }

  async function syncQueue() {
    const q = queueList();
    const results = [];
    for (const item of q) {
      try {
        const ev = await json('POST', '/api/events', item.payload);
        results.push({ ok: true, item, event: ev });
        queueRemove(item.localId);
      } catch (e) {
        results.push({ ok: false, item, error: e.message });
      }
    }
    return results;
  }

  return {
    token, setToken: (t) => { token = t; if (t) storeSet('bb_token', t); else storeDel('bb_token'); },

    login: (email, password) => json('POST', '/api/auth/login', { email, password }),
    register: (body) => json('POST', '/api/auth/register', body),
    logout: () => json('POST', '/api/auth/logout'),
    me: () => json('GET', '/api/me'),

    projects: () => json('GET', '/api/projects'),
    createProject: (body) => json('POST', '/api/projects', body),

    startCapture: (projectId) => json('POST', '/api/capture/start', { projectId }),
    transcribe: (mediaId) => json('POST', '/api/transcribe', { mediaId }),
    structure: (body) => json('POST', '/api/ai/structure', body),

    createEvent: (body) => json('POST', '/api/events', body),
    events: (params = {}) => {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
      return json('GET', '/api/events' + (qs ? '?' + qs : ''));
    },
    event: (id) => json('GET', '/api/events/' + id),
    updateEvent: (id, body) => json('PUT', '/api/events/' + id, body),
    dispatchEvent: (id, body) => json('POST', '/api/events/' + id + '/dispatch', body),
    reviewEvent: (id) => json('POST', '/api/events/' + id + '/review'),

    uploadMedia: async (kind, blob, ext) => {
      const res = await req('POST', `/api/upload?kind=${kind}&ext=${encodeURIComponent(ext)}`, blob, { raw: true, headers: { 'Content-Type': blob.type || (kind === 'audio' ? 'audio/webm' : 'image/jpeg') } });
      return res.json();
    },
    attachMedia: (mediaIds, eventId) => json('POST', '/api/media/attach', { mediaIds, eventId }),

    metrics: () => json('GET', '/api/admin/metrics'),
    usage: () => json('GET', '/api/admin/usage'),
    emailStatus: () => json('GET', '/api/admin/email-status'),
    emailTest: (to) => json('POST', '/api/admin/email-test', { to }),
    companies: () => json('GET', '/api/admin/companies'),
    users: () => json('GET', '/api/admin/users'),
    createUser: (body) => json('POST', '/api/admin/users', body),
    outbox: () => json('GET', '/api/admin/outbox'),

    /* offline capture: saves a draft locally when the network is gone */
    queueAdd, queueRemove, queueList, syncQueue,

    /* event creation that degrades to the offline queue */
    saveEventOfflineSafe: async (payload) => {
      try {
        return { ok: true, event: await API.createEvent(payload) };
      } catch (e) {
        const isNetwork = /failed to fetch|network|load failed|offline/i.test(e.message || '');
        if (!isNetwork) throw e;
        const localId = 'q' + Date.now();
        API.queueAdd({ localId, payload });
        return { ok: false, error: e.message, localId, queued: true };
      }
    },

    _raw: req,
  };
})();
