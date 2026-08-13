/* BoundBuild — app shell, router, views */
'use strict';

const App = (() => {
  const state = {
    user: null, company: null, projects: [], currentProjectId: storeGet('bb_project') || null,
    capture: null, // active capture flow state
    filters: { q: '', status: '', type: '', project: '' },
  };

  /* ---------------- routing ---------------- */
  const routes = {
    '#/login': viewLogin, '#/register': viewRegister,
    '#/home': viewHome, '#/capture': viewCapture, '#/ledger': viewLedger,
    '#/projects': viewProjects, '#/settings': viewSettings, '#/admin': viewAdmin,
    '#/event/': viewEventDetail, '#/edit/': viewEditEvent,
  };

  async function router() {
    const full = location.hash || '#/home';
    const hash = full.split('?')[0]; // strip query params for route matching
    const authOk = !!state.user;
    if (!authOk && hash !== '#/login' && hash !== '#/register') { location.hash = '#/login'; return; }
    if (authOk && (hash === '#/login' || hash === '#/register')) { location.hash = '#/home'; return; }

    let view = routes[hash];
    let param = null;
    if (!view) {
      for (const [k, fn] of Object.entries(routes)) {
        if (hash.startsWith(k)) { view = fn; param = hash.slice(k.length); break; }
      }
    }
    if (!view) view = viewHome;

    $('#view').innerHTML = '<div class="page-loading">' + I.sparkle + ' Loading…</div>';
    try {
      const html = await view(param);
      $('#view').innerHTML = html;
      renderTopbar();
      renderNav();
      window.scrollTo(0, 0);
    } catch (e) {
      $('#view').innerHTML = `<div class="page-loading">${esc(e.message)}</div>`;
    }
  }

  async function boot() {
    window.addEventListener('hashchange', () => App.router());
    if (API.token) {
      try {
        const { user, company } = await API.me();
        state.user = user; state.company = company;
        state.projects = await API.projects();
        if (!state.projects.some((p) => p.id === state.currentProjectId)) state.currentProjectId = state.projects[0] ? state.projects[0].id : null;
        if (state.currentProjectId) storeSet('bb_project', state.currentProjectId);
      } catch (e) { API.setToken(''); }
    }
    try { navigator.serviceWorker && navigator.serviceWorker.register('/sw.js').catch(() => {}); } catch (e) {}
    App.router();
  }

  /* ---------------- shell ---------------- */
  function renderTopbar() {
    const el = $('#topbar');
    if (!state.user) { el.innerHTML = ''; el.classList.remove('show'); return; }
    el.classList.add('show');
    const adminBtn = (state.user.role === 'admin' || state.user.role === 'founder')
      ? `<a class="topbar-btn" href="#/admin" title="Pilot console">${I.chart}<span>Pilot</span></a>` : '';
    const pending = queueCount();
    el.innerHTML = `
      <a class="brand" href="#/home">${logoMark(30)}<span class="brand-name">BOUNDBUILD<span class="brand-tag">CAPTURE · DOCUMENT · GET PAID</span></span></a>
      <div class="topbar-right">
        ${pending ? `<a class="topbar-btn pending" href="#/settings" title="Pending sync">${I.alert}<span>${pending}</span></a>` : ''}
        ${adminBtn}
        <a class="topbar-btn avatar" href="#/settings" title="${esc(state.user.name)}">${esc(initials(state.user.name))}</a>
      </div>`;
  }

  function queueCount() {
    try { return JSON.parse(storeGet('bb_queue') || '[]').length; } catch (e) { return 0; }
  }

  function renderNav() {
    const el = $('#bottomnav');
    if (!state.user) { el.innerHTML = ''; el.classList.remove('show'); return; }
    el.classList.add('show');
    const hash = (location.hash || '#/').split('?')[0];
    const item = (href, icon, label) => {
      const active = hash === href || (href === '#/home' && (hash === '' || hash === '#/'));
      return `<a class="nav-item ${active ? 'active' : ''}" href="${href}">${icon}<span>${label}</span></a>`;
    };
    el.innerHTML = `
      ${item('#/home', I.home, 'Home')}
      ${item('#/ledger', I.list, 'Ledger')}
      <a class="nav-fab" href="#/capture" title="Capture an event">${I.mic}<span>Record</span></a>
      ${item('#/projects', I.building, 'Projects')}
      ${item('#/settings', I.settings, 'Settings')}`;
  }

  /* ---------------- shared components ---------------- */
  function projectOptions(selectedId) {
    return `<option value="">Select project…</option>` + state.projects.map((p) =>
      `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  }

  const TYPE_OPTIONS = ['Variation', 'Delay', 'Site instruction', 'Scope change', 'Unforeseen condition', 'Material substitution', 'Other commercial event']
    .map((t) => `<option value="${t}">${t}</option>`).join('');

  function eventCard(e) {
    const thumb = e.media.find((m) => m.kind === 'image');
    return `<a class="ev-card" href="#/event/${e.id}">
      ${thumb ? `<div class="ev-thumb"><img src="/media/${thumb.filename}" alt="" loading="lazy"></div>` : ''}
      <div class="ev-body">
        <div class="ev-meta"><span class="ev-ref">${esc(e.ref)}</span>${statusChip(e.status)}</div>
        <div class="ev-title">${esc(e.title)}</div>
        <div class="ev-sub">${esc(e.projectName)}${e.location ? ' · ' + esc(e.location) : ''}</div>
        <div class="ev-foot"><span>${typeChip(e.type)}</span><span class="ev-time">${I.clock}${esc(timeAgo(e.createdAt))}</span></div>
      </div>
    </a>`;
  }

  function impactField(label, icon, key, value, accent) {
    const flag = value && value.flag;
    return `<div class="field">
      <label>${icon} ${label}</label>
      <div class="impact-toggle ${flag ? 'on' : ''}" style="--impact:${accent}" data-impact-key="${key}">
        <button type="button" class="impact-switch" data-toggle="${key}"><span class="knob"></span></button>
        <span class="impact-label">${flag ? 'Flagged' : 'Not flagged'}</span>
      </div>
      <input class="impact-note" data-note="${key}" type="text" placeholder="Note (e.g. est. 2–3 days, ~$4,500)" value="${esc(value ? value.note : '')}" ${flag ? '' : 'disabled'}>
    </div>`;
  }

  /* Shared event form (used by capture review + edit). Returns html + mount() */
  function eventForm(opts) {
    const d = opts.draft;
    const el = document.createElement('div');
    el.className = 'form';
    const isEdit = !!opts.event;
    el.innerHTML = `
      ${opts.aiBadge ? `<div class="ai-badge">${I.sparkle} ${esc(opts.aiBadge)}</div>` : ''}
      ${opts.warning ? `<div class="notice warn">${I.alert} ${esc(opts.warning)}</div>` : ''}
      <div class="field"><label>Event title *</label><input data-f="title" type="text" maxlength="140" placeholder="e.g. Buried slab found in Unit 6 excavation" value="${esc(d.title || '')}"></div>
      <div class="field-row">
        <div class="field"><label>Event type *</label><select data-f="type">${TYPE_OPTIONS}</select></div>
        <div class="field"><label>Project *</label><select data-f="projectId">${projectOptions(d.projectId || opts.defaultProjectId)}</select></div>
      </div>
      <div class="field"><label>Location / area</label><input data-f="location" type="text" maxlength="120" placeholder="e.g. Unit 6 — foundation zone" value="${esc(d.location || '')}"></div>
      <div class="field"><label>Description / summary</label><textarea data-f="summary" rows="5" placeholder="What happened, where, and what's needed…">${esc(d.summary || '')}</textarea></div>
      <div class="field"><label>Instructed by</label><input data-f="instructedBy" type="text" maxlength="80" placeholder="e.g. Architect, Engineer, Client" value="${esc(d.instructedBy || '')}"></div>
      <div class="field"><label>Quick text note (optional)</label><input data-f="notes" type="text" maxlength="200" placeholder="Anything else for the office" value="${esc(d.notes || '')}"></div>
      ${impactField('Time impact', I.clock, 'timeImpact', d.timeImpact, '#FFB020')}
      ${impactField('Cost impact', I.dollar, 'costImpact', d.costImpact, '#FF6A00')}
      <div class="media-strip" data-media-strip></div>
      ${opts.audio ? `<div class="audio-chip" data-audio-chip>${I.mic} Audio attached — original voice note kept on record</div>` : ''}
    `;
    // set select values (default to current project, else first available)
    el.querySelector('[data-f="type"]').value = d.type || 'Variation';
    const fallbackProj = state.currentProjectId || (state.projects[0] && state.projects[0].id) || '';
    el.querySelector('[data-f="projectId"]').value = d.projectId || opts.defaultProjectId || fallbackProj;
    // impact toggles
    el.querySelectorAll('.impact-switch').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.toggle;
        const wrap = el.querySelector(`[data-impact-key="${key}"]`);
        const note = el.querySelector(`[data-note="${key}"]`);
        const on = wrap.classList.toggle('on');
        wrap.querySelector('.impact-label').textContent = on ? 'Flagged' : 'Not flagged';
        note.disabled = !on;
        if (!on) note.value = '';
      });
    });

    const mediaStrip = el.querySelector('[data-media-strip]');
    const renderStrip = () => {
      mediaStrip.innerHTML = (opts.media || []).map((m, i) => `
        <div class="thumb-cell">
          <img src="${m.dataUrl || '/media/' + m.filename}" alt="photo ${i + 1}">
          <button type="button" class="thumb-x" data-rm="${m.id}">${I.x}</button>
        </div>`).join('');
      mediaStrip.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
        opts.media = opts.media.filter((m) => m.id !== b.dataset.rm);
        if (opts.onRemoveMedia) opts.onRemoveMedia(b.dataset.rm);
        renderStrip();
      }));
    };
    renderStrip();

    const collect = () => {
      const out = {};
      el.querySelectorAll('[data-f]').forEach((i) => {
        if (i.dataset.f === 'projectId') out.projectId = i.value;
        else out[i.dataset.f] = i.value.trim();
      });
      for (const key of ['timeImpact', 'costImpact']) {
        const on = el.querySelector(`[data-impact-key="${key}"]`).classList.contains('on');
        out[key] = { flag: on, note: el.querySelector(`[data-note="${key}"]`).value.trim() };
      }
      out.media = opts.media || [];
      return out;
    };
    return { el, collect, getMedia: () => opts.media || [] };
  }

  async function bootstrapAfterAuth() {
    const me = await API.me();
    state.company = me.company;
    state.projects = await API.projects();
    if (!state.projects.some((p) => p.id === state.currentProjectId)) {
      state.currentProjectId = state.projects[0] ? state.projects[0].id : null;
    }
    if (state.currentProjectId) storeSet('bb_project', state.currentProjectId);
    return state.projects;
  }

  /* ---------------- auth views ---------------- */
  async function viewLogin() {
    return `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-logo">${logoMark(54)}<div class="auth-name">BOUNDBUILD</div><div class="auth-tag">CAPTURE · DOCUMENT · GET PAID</div></div>
        <div class="stripes"></div>
        <form id="login-form" class="form">
          <div class="field"><label>Email</label><input name="email" type="email" required autocomplete="email" placeholder="you@company.co.nz"></div>
          <div class="field"><label>Password</label><input name="password" type="password" required autocomplete="current-password" placeholder="••••••••"></div>
          <button class="btn primary block" type="submit">Sign in</button>
        </form>
        <p class="auth-switch">New pilot company? <a href="#/register">Set up your company</a></p>
        <div class="demo-box">
          <div class="demo-title">${I.sparkle} Pilot demo — one tap</div>
          <div class="demo-users">
            <button class="demo-user" data-email="foreman1@kowhaiconstruction.co.nz"><span class="avatar">CT</span><span><b>Chris Taylor</b><small>Foreman — capture & dispatch</small></span></button>
            <button class="demo-user" data-email="qs@kowhaiconstruction.co.nz"><span class="avatar">AM</span><span><b>Alex Morgan</b><small>QS — review & pilot console</small></span></button>
          </div>
          <div class="demo-pw">All demo accounts use password <code>boundbuild-demo</code></div>
        </div>
      </div>
    </div>`;
  }

  async function viewRegister() {
    return `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-logo">${logoMark(54)}<div class="auth-name">BOUNDBUILD</div><div class="auth-tag">START YOUR PILOT</div></div>
        <div class="stripes"></div>
        <form id="register-form" class="form">
          <div class="field"><label>Your name</label><input name="name" required placeholder="e.g. Sam Carter"></div>
          <div class="field"><label>Company name</label><input name="companyName" required placeholder="e.g. Carter Construction Ltd"></div>
          <div class="field"><label>Work email</label><input name="email" type="email" required placeholder="you@company.co.nz"></div>
          <div class="field"><label>Password (min 8 chars)</label><input name="password" type="password" required minlength="8" placeholder="••••••••"></div>
          <button class="btn primary block" type="submit">Create company & account</button>
        </form>
        <p class="auth-switch">Already have an account? <a href="#/login">Sign in</a></p>
      </div>
    </div>`;
  }

  /* ---------------- home ---------------- */
  async function viewHome() {
    const events = await API.events();
    const mine = events.filter((e) => e.createdById === state.user.id);
    const weekAgo = Date.now() - 7 * 864e5;
    const weekCount = events.filter((e) => new Date(e.createdAt).getTime() >= weekAgo).length;
    const recent = events.slice(0, 5);
    const proj = state.projects.find((p) => p.id === state.currentProjectId);

    return `
      <div class="home-hero">
        <div class="home-greeting">G'DAY, ${esc((state.user.name.split(' ')[0] || '').toUpperCase())}</div>
        <div class="home-project">${proj ? `${I.building} ${esc(proj.name)}` : 'No project selected'}</div>
        <button class="record-btn" data-go-capture title="Capture a commercial event">
          <span class="record-ring"></span>
          <span class="record-inner">${I.mic}</span>
          <span class="record-label">TAP TO CAPTURE</span>
        </button>
        <div class="record-hint">Voice note → AI draft → review → dispatch. Under a minute.</div>
        <div class="home-stats">
          <div class="stat"><b>${weekCount}</b><span>events this week</span></div>
          <div class="stat"><b>${mine.length}</b><span>captured by you</span></div>
          <div class="stat"><b>${events.filter((e) => e.sentAt).length}</b><span>dispatched to office</span></div>
        </div>
      </div>
      <div class="section">
        <div class="section-head"><h2>Recent events</h2><a href="#/ledger" class="link">View ledger →</a></div>
        ${recent.length ? recent.map(eventCard).join('') : `<div class="empty"><b>No events yet</b><span>Tap the orange button to capture your first commercial event.</span><a class="btn primary" href="#/capture">${I.mic} Capture now</a></div>`}
      </div>`;
  }

  /* ---------------- capture flow ---------------- */
  async function viewCapture() {
    state.capture = {
      step: 'record',
      projectId: state.currentProjectId,
      transcript: '', note: '', audio: null, media: [], draft: null,
      sessionId: null, startedAt: Date.now(), recording: false, liveText: '',
      fieldsChanged: 0,
      recordMode: 'auto', // 'auto' | 'media' | 'webaudio' — auto-switches after empty capture
    };
    return captureRender();
  }

  function captureRender() {
    const c = state.capture;
    if (c.step === 'record') return captureRecordView();
    if (c.step === 'note') return captureNoteView();
    if (c.step === 'structuring') return captureStructuringView();
    if (c.step === 'review') return captureReviewView();
    if (c.step === 'done') return captureDoneView();
    return '';
  }

  /* re-render the current capture step into #view and re-bind */
  function refreshCapture() {
    $('#view').innerHTML = captureRender();
    captureMount();
  }

  function captureRecordView() {
    const c = state.capture;
    const mic = Recorder.micSupported();
    const speech = Recorder.speechSupported();
    return `
      <div class="cap-screen">
        <div class="cap-head"><a class="icon-btn" href="#/home">${I.back}</a><div class="cap-title">Capture event</div><span></span></div>
        ${mic ? `
        <div class="rec-area">
          <button class="rec-btn ${c.recording ? 'recording' : ''}" id="rec-toggle" title="Record voice note">
            <span class="rec-pulse"></span><span class="rec-inner">${I.mic}</span>
          </button>
          <div class="rec-timer" id="rec-timer">${c.recording ? '00:00' : 'Tap to record'}</div>
          <div class="rec-meter-wrap"><div class="rec-meter" id="rec-meter"></div></div>
          ${speech ? `<div class="rec-live" id="rec-live">${c.liveText ? esc(c.liveText) : 'Live captioning on — speak naturally…'}</div>` : ''}
        </div>` : `
        <div class="notice err">${I.alert} Microphone isn't available here (this preview blocks mic access). You can still capture — type the description or load a sample voice note.</div>
        `}
        <div class="rec-actions">
          <button class="btn ghost block" id="rec-skip">${I.edit} Type the description instead</button>
          <details class="samples"><summary>${I.sparkle} Try a sample voice note (demo)</summary>
            ${SAMPLE_NOTES.map((s, i) => `<button class="sample-note" data-i="${i}">“${esc(s.slice(0, 90))}…”</button>`).join('')}
          </details>
        </div>
      </div>`;
  }

  function captureNoteView() {
    const c = state.capture;
    return `
      <div class="cap-screen">
        <div class="cap-head"><button class="icon-btn" id="back-note">${I.back}</button><div class="cap-title">Review raw note</div><span></span></div>
        <div class="form">
          <div class="field">
            <label>${c.audio ? I.mic + ' Voice note captured — description below' : 'Event description'}</label>
            <textarea id="cap-transcript" rows="7" placeholder="Describe the event: what happened, where, who instructed it, any impact on time or cost…">${esc(c.transcript)}</textarea>
          </div>
          <div class="field"><label>Project</label><select id="cap-project">${projectOptions(c.projectId)}</select></div>
          <div class="field">
            <label>${I.photo} Photos (optional — max ~6)</label>
            <div class="photo-row">
              <label class="photo-add">${I.photo}<span>Add photos</span><input type="file" accept="image/*" multiple id="cap-photos" hidden></label>
              <div class="photo-thumbs" id="photo-thumbs"></div>
            </div>
          </div>
          <button class="btn primary block" id="cap-structure">${I.sparkle} Create AI draft</button>
          <button class="btn ghost block" id="cap-discard">Discard</button>
        </div>
      </div>`;
  }

  function captureStructuringView() {
    return `
      <div class="cap-screen center">
        <div class="struct-spinner">${I.sparkle}</div>
        <div class="struct-title">Structuring your event…</div>
        <div class="struct-sub">Extracting type, location, instructed-by and impacts from your voice note.</div>
      </div>`;
  }

  function captureReviewView() {
    const c = state.capture;
    return `
      <div class="cap-screen">
        <div class="cap-head"><button class="icon-btn" id="back-review">${I.back}</button><div class="cap-title">Review draft</div><span></span></div>
        <div id="form-mount"></div>
        <div class="form-actions">
          <button class="btn primary block" id="cap-save">${I.check} Save event</button>
          <button class="btn ghost block" id="cap-discard2">Discard</button>
        </div>
      </div>`;
  }

  function captureDoneView() {
    const c = state.capture;
    return `
      <div class="cap-screen center">
        <div class="done-check">${I.check}</div>
        <div class="done-title">Event saved${c.queued ? ' to device' : ''}</div>
        <div class="done-sub">${c.queued ? 'You\'re offline — BoundBuild will sync this event automatically when the connection returns.' : esc(c.savedEvent ? c.savedEvent.ref + ' · ' + c.savedEvent.title : '')}</div>
        ${!c.queued && c.captureSec != null ? `<div class="done-metric"><b>${c.captureSec}s</b><span>start to saved — target is under 60s</span></div>` : ''}
        ${!c.queued ? `
        <div class="done-actions">
          <button class="btn primary block" id="done-dispatch">${I.send} Dispatch to QS / office</button>
          <button class="btn ghost block" id="done-ledger">${I.list} View in ledger</button>
        </div>` : `
        <button class="btn primary block" id="done-ledger">${I.list} Back to home</button>`}
      </div>`;
  }

  function captureMount() {
    const c = state.capture;
    if (!c) return;
    if (c.step === 'record') {
      const btn = $('#rec-toggle');
      const timer = $('#rec-timer');
      if (btn) btn.addEventListener('click', async () => {
        if (!c.recording) {
          try {
            await Recorder.start({
              forceMode: c.recordMode,
              onLevel: (v) => { const el = $('#rec-meter'); if (el) el.style.width = Math.round(v * 100) + '%'; },
              onLive: (t) => { c.liveText = t; const el = $('#rec-live'); if (el) el.textContent = t || 'Live captioning on — speak naturally…'; },
              onEnd: async ({ blob, mime, transcript, bytes }) => {
                const empty = !blob || !blob.size;
                const tiny = !empty && blob.size < 1000;
                if (empty || tiny) {
                  // No usable audio captured. If we haven't already, switch to the
                  // WebAudio WAV recorder (works where MediaRecorder yields nothing)
                  // and ask for one more take.
                  if (empty && c.recordMode !== 'webaudio') {
                    c.recordMode = 'webaudio';
                    toast('No audio captured — tap record again (compatibility recorder will be used)', 'warn');
                    refreshCapture();
                    return;
                  }
                  if (tiny) {
                    toast('Recording was too short or silent — try a longer note, or type the description', 'warn');
                    refreshCapture();
                    return;
                  }
                  toast('Mic captured no audio — check microphone permission, or type the description', 'warn');
                  c.step = 'note'; refreshCapture();
                  return;
                }
                timer.textContent = 'Uploading audio…';
                const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
                let serverTranscript = null;
                let sttError = null;
                try {
                  const up = await API.uploadMedia('audio', blob, ext);
                  c.audio = { mediaId: up.id, url: up.url, mime };
                  // Server-side STT when configured (phone → BoundBuild → STT API);
                  // otherwise this returns provider:'browser' and we fall back below.
                  timer.textContent = 'Transcribing…';
                  try {
                    const r = await API.transcribe(up.id);
                    if (r && r.transcript) serverTranscript = r.transcript;
                    else if (r && r.error) sttError = r.error;
                  } catch (e) { sttError = e.message || 'transcription request failed'; }
                } catch (e) {
                  toast('Audio upload failed (offline?) — continuing with your text', 'warn');
                }
                c.transcript = (serverTranscript || transcript || '').trim();
                if (!serverTranscript && !c.transcript) {
                  if (sttError) {
                    toast('Voice transcription failed: ' + sttError.slice(0, 140) + ' — you can type the description below', 'warn');
                  } else {
                    toast('No transcription available on this device — type the description below', 'warn');
                  }
                }
                c.step = 'note'; refreshCapture();
              },
            });
            c.recording = true; c.startedAt = Date.now(); c.sessionId = null;
            try { const s = await API.startCapture(c.projectId); c.sessionId = s.id; } catch (e) { /* offline — fine */ }
            btn.classList.add('recording');
            timer.textContent = '00:00';
            const t0 = Date.now();
            const iv = setInterval(() => {
              if (!c.recording) { clearInterval(iv); return; }
              const s = Math.floor((Date.now() - t0) / 1000);
              timer.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
            }, 250);
            btn.dataset.iv = iv;
            btn.querySelector('.rec-inner').innerHTML = I.x;
          } catch (e) {
            toast('Microphone unavailable — type the description or use a sample note', 'err');
          }
        } else {
          c.recording = false;
          clearInterval(Number(btn.dataset.iv));
          Recorder.stop();
          btn.classList.remove('recording');
          timer.textContent = 'Stopping…';
        }
      });
      const skip = $('#rec-skip');
      if (skip) skip.addEventListener('click', () => { c.step = 'note'; refreshCapture(); });
      $$('.sample-note').forEach((b) => b.addEventListener('click', () => {
        c.transcript = SAMPLE_NOTES[Number(b.dataset.i)];
        c.audio = null;
        c.step = 'note'; refreshCapture();
      }));
    }
    if (c.step === 'note') {
      const ta = $('#cap-transcript');
      const back = $('#back-note');
      back.addEventListener('click', () => { c.step = 'record'; refreshCapture(); });
      ta.addEventListener('input', () => { c.transcript = ta.value; });
      const proj = $('#cap-project');
      proj.addEventListener('change', () => { c.projectId = proj.value; state.currentProjectId = proj.value; storeSet('bb_project', proj.value); });
      const fileInput = $('#cap-photos');
      fileInput.addEventListener('change', async () => {
        for (const file of Array.from(fileInput.files).slice(0, 6 - c.media.length)) {
          try {
            const dataUrl = await compressImage(file, 1280, 0.82);
            const blob = dataUrlToBlob(dataUrl);
            const up = await API.uploadMedia('image', blob, 'jpg');
            c.media.push({ id: up.id, filename: up.filename, dataUrl: up.url });
            renderPhotoThumbs(c.media);
          } catch (e) { toast('Photo upload failed: ' + e.message, 'err'); }
        }
        fileInput.value = '';
      });
      $('#cap-structure').addEventListener('click', async () => {
        if (!c.transcript.trim() || c.transcript.trim().length < 5) return toast('Add a description of the event first', 'warn');
        c.step = 'structuring'; refreshCapture();
        try {
          const { draft } = await API.structure({ transcript: c.transcript, projectId: c.projectId });
          c.draft = { ...draft, projectId: c.projectId };
          c.fieldsChanged = 0;
          c.step = 'review'; refreshCapture();
        } catch (e) {
          toast('AI structuring failed: ' + e.message, 'err');
          c.step = 'note'; refreshCapture();
        }
      });
      $('#cap-discard').addEventListener('click', () => { state.capture = null; location.hash = '#/home'; });
    }
    if (c.step === 'review') {
      const back = $('#back-review');
      back.addEventListener('click', () => { c.step = 'note'; refreshCapture(); });
      // mount the live form element (eventForm carries its own listeners)
      const form = eventForm({
        draft: c.draft, media: c.media, defaultProjectId: c.projectId, audio: !!c.audio,
        aiBadge: `AI draft · ${c.draft.confidence || 80}% confidence · engine ${c.draft.engine || 'heuristic-v1'}`,
        warning: 'This draft was generated by AI. Verify and edit every field — it is not final legal or commercial advice.',
      });
      const mountEl = $('#form-mount');
      mountEl.appendChild(form.el);
      $('#cap-save').addEventListener('click', async () => {
        const formEl = $('.cap-screen .form');
        const draft = c.draft;
        const vals = {};
        formEl.querySelectorAll('[data-f]').forEach((i) => vals[i.dataset.f] = i.value.trim());
        const impacts = {};
        for (const k of ['timeImpact', 'costImpact']) {
          impacts[k] = { flag: formEl.querySelector(`[data-impact-key="${k}"]`).classList.contains('on'), note: formEl.querySelector(`[data-note="${k}"]`).value.trim() };
        }
        let changed = 0;
        if (vals.title !== draft.title) changed++;
        if (vals.type !== draft.type) changed++;
        if (vals.location !== (draft.location || '')) changed++;
        if (vals.summary !== (draft.summary || '')) changed++;
        if (vals.instructedBy !== (draft.instructedBy || '')) changed++;
        if (impacts.timeImpact.flag !== !!draft.timeImpact.flag) changed++;
        if (impacts.costImpact.flag !== !!draft.costImpact.flag) changed++;
        if (!vals.projectId) return toast('Select a project', 'warn');

        const payload = {
          title: vals.title, type: vals.type, projectId: vals.projectId,
          summary: vals.summary, location: vals.location, instructedBy: vals.instructedBy,
          notes: vals.notes || '', timeImpact: impacts.timeImpact, costImpact: impacts.costImpact,
          mediaIds: c.media.map((m) => m.id),
          captureSessionId: c.sessionId,
          fieldsChangedAfterDraft: changed,
          ai: { used: true, confidence: draft.confidence, engine: draft.engine },
        };
        const btn = $('#cap-save');
        btn.disabled = true; btn.textContent = 'Saving…';
        const res = await API.saveEventOfflineSafe(payload);
        btn.disabled = false;
        if (res.ok) {
          c.savedEvent = res.event;
          c.queued = false;
          c.captureSec = c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : null;
        } else {
          c.queued = true;
          c.captureSec = c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : null;
          toast('Offline — saved to device queue, will sync later', 'warn');
        }
        c.step = 'done'; refreshCapture();
      });
      $('#cap-discard2').addEventListener('click', () => { state.capture = null; location.hash = '#/home'; });
    }
    if (c.step === 'done') {
      $('#done-ledger').addEventListener('click', () => { state.capture = null; location.hash = '#/ledger'; });
      const dispatchBtn = $('#done-dispatch');
      if (dispatchBtn) dispatchBtn.addEventListener('click', () => { openDispatchModal(c.savedEvent); });
    }
  }

  function renderPhotoThumbs(media) {
    const el = $('#photo-thumbs');
    if (!el) return;
    el.innerHTML = media.map((m, i) => `<div class="thumb-cell"><img src="${m.dataUrl}" alt=""><button class="thumb-x" data-i="${i}">${I.x}</button></div>`).join('');
    el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
      state.capture.media.splice(Number(b.dataset.i), 1);
      renderPhotoThumbs(state.capture.media);
    }));
  }

  function compressImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  function dataUrlToBlob(dataUrl) {
    const [head, body] = dataUrl.split(',');
    const mime = head.match(/:(.*?);/)[1];
    const bin = atob(body);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  /* ---------------- ledger ---------------- */
  async function viewLedger() {
    // support #/ledger?project=X (links from Projects)
    const qp = new URLSearchParams((location.hash.split('?')[1]) || '');
    if (qp.get('project')) state.filters.project = qp.get('project');
    const params = { q: state.filters.q, status: state.filters.status, type: state.filters.type, project: state.filters.project };
    const events = await API.events(params);
    const statuses = [['', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['reviewed', 'Reviewed']];
    return `
      <div class="page">
        <div class="page-head"><h1>Ledger</h1><span class="page-count">${events.length} events</span></div>
        <div class="ledger-search">${I.search}<input id="ledger-q" type="search" placeholder="Search title, summary, ref…" value="${esc(state.filters.q)}"></div>
        <div class="chip-row" id="status-chips">
          ${statuses.map(([v, l]) => `<button class="chip-btn ${state.filters.status === v ? 'active' : ''}" data-v="${v}">${l}</button>`).join('')}
        </div>
        <div class="filter-row">
          <select id="filter-type"><option value="">All types</option>${TYPE_OPTIONS}</select>
          <select id="filter-project"><option value="">All projects</option>${state.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
        </div>
        <div id="ledger-list">${events.map(eventCard).join('') || `<div class="empty"><b>No events match</b><span>Try a different filter, or capture a new event.</span></div>`}</div>
      </div>`;
  }

  /* ---------------- event detail ---------------- */
  async function viewEventDetail(id) {
    const e = await API.event(id);
    const audio = e.media.find((m) => m.kind === 'audio');
    const photos = e.media.filter((m) => m.kind === 'image');
    const isAdmin = state.user.role === 'admin' || state.user.role === 'founder';
    return `
      <div class="page">
        <div class="page-head"><a class="icon-btn" href="#/ledger">${I.back}</a>
          <div class="page-title-stack"><span>${esc(e.ref)}</span>${statusChip(e.status)}</div>
          <a class="icon-btn" href="#/edit/${e.id}" title="Edit">${I.edit}</a></div>
        <h1 class="ev-detail-title">${esc(e.title)}</h1>
        <div class="ev-detail-meta">${typeChip(e.type)}<span>${esc(e.projectName)}${e.projectLocation ? ' · ' + esc(e.projectLocation) : ''}</span></div>
        <div class="ev-detail-sub">Captured ${esc(fmtDateTime(e.createdAt))} by <b>${esc(e.createdByName)}</b> · Updated ${esc(timeAgo(e.updatedAt))}</div>

        <div class="detail-card"><div class="detail-label">Description</div><p>${esc(e.summary || '—')}</p></div>

        <div class="detail-grid">
          <div class="detail-cell"><span>Location / area</span><b>${esc(e.location || '—')}</b></div>
          <div class="detail-cell"><span>Instructed by</span><b>${esc(e.instructedBy || '—')}</b></div>
          <div class="detail-cell"><span>Time impact</span><b style="color:${e.timeImpact.flag ? '#FFB020' : '#9AA3AD'}">${e.timeImpact.flag ? esc(e.timeImpact.note) : 'Not flagged'}</b></div>
          <div class="detail-cell"><span>Cost impact</span><b style="color:${e.costImpact.flag ? '#FF6A00' : '#9AA3AD'}">${e.costImpact.flag ? esc(e.costImpact.note) : 'Not flagged'}</b></div>
          ${e.notes ? `<div class="detail-cell wide"><span>Quick note</span><b>${esc(e.notes)}</b></div>` : ''}
        </div>

        ${photos.length ? `<div class="section"><div class="section-head"><h2>Photos (${photos.length})</h2></div><div class="gallery">${photos.map((m) => `<a href="/media/${m.filename}" target="_blank" class="gal-item"><img src="/media/${m.filename}" alt="" loading="lazy"></a>`).join('')}</div></div>` : ''}
        ${audio ? `<div class="section"><div class="section-head"><h2>Original voice note</h2></div>
          <div class="audio-player"><button class="icon-btn" data-play="${audio.id}">${I.play}</button><div class="audio-meta">${esc(audio.filename.split('/').pop())} · ${audio.size ? Math.round(audio.size / 1024) + ' KB' : ''}</div><audio id="audio-${audio.id}" src="/media/${audio.filename}" preload="none"></audio></div></div>` : ''}

        <div class="section">
          <div class="section-head"><h2>Timeline</h2></div>
          <div class="timeline">${(e.audit || []).map((a) => `<div class="tl-item"><div class="tl-dot"></div><div><b>${esc(a.action)}</b><div class="tl-detail">${esc(a.detail || '')} · ${esc(a.by ? a.by.name : '')}</div><div class="tl-time">${esc(fmtDateTime(a.at))}</div></div></div>`).join('') || '<div class="empty">No activity yet</div>'}</div>
        </div>

        <div class="detail-actions">
          <button class="btn primary block" id="ev-dispatch">${I.send} ${e.sentAt ? 'Dispatch again / notify' : 'Dispatch to QS / office'}</button>
          ${isAdmin && e.status !== 'reviewed' ? `<button class="btn ghost block" id="ev-review">${I.check} Mark as reviewed</button>` : ''}
          <button class="btn ghost block" id="ev-pdf">${I.download} Download PDF (what the QS receives)</button>
        </div>
      </div>`;
  }

  /* ---------------- edit event ---------------- */
  let pendingEditForm = null;
  async function viewEditEvent(id) {
    const e = await API.event(id);
    window.__bbRemovedMedia = [];
    pendingEditForm = eventForm({
      draft: {
        title: e.title, type: e.type, projectId: e.projectId, location: e.location,
        summary: e.summary, instructedBy: e.instructedBy, notes: e.notes,
        timeImpact: e.timeImpact, costImpact: e.costImpact,
      },
      media: e.media.filter((m) => m.kind === 'image').map((m) => ({ id: m.id, filename: m.filename })),
      audio: !!e.media.find((m) => m.kind === 'audio'),
      defaultProjectId: e.projectId,
      warning: 'Editing a saved event — changes are recorded in the audit trail.',
      onRemoveMedia: (rmId) => window.__bbRemovedMedia.push(rmId),
    });
    return `
      <div class="page">
        <div class="page-head"><a class="icon-btn" href="#/event/${e.id}">${I.back}</a><div class="cap-title">Edit event</div><span></span></div>
        <div id="edit-form-mount"></div>
        <div class="form-actions">
          <button class="btn primary block" id="edit-save">${I.check} Save changes</button>
        </div>
      </div>`;
  }

  /* ---------------- projects ---------------- */
  async function viewProjects() {
    const canAdmin = state.user.role === 'admin' || state.user.role === 'founder';
    const projects = await API.projects();
    return `
      <div class="page">
        <div class="page-head"><h1>Projects</h1><span class="page-count">${projects.length}</span></div>
        ${projects.map((p) => `
          <a class="proj-card" href="#/ledger?project=${p.id}">
            <div class="proj-name">${I.building} ${esc(p.name)}</div>
            <div class="proj-sub">${esc(p.location || 'No location')} · ${p.eventCount} events</div>
            <div class="proj-recip">Dispatch to: ${(p.defaultRecipients || []).map((r) => `<code>${esc(r)}</code>`).join(' ') || '<span class="muted">none set</span>'}</div>
          </a>`).join('') || '<div class="empty"><b>No projects yet</b><span>Ask your admin to add a project, or create one below.</span></div>'}
        ${canAdmin ? `
        <div class="section">
          <div class="section-head"><h2>New project</h2></div>
          <form id="project-form" class="form">
            <div class="field"><label>Project name *</label><input name="name" required maxlength="80" placeholder="e.g. Rimu Ridge Terraces"></div>
            <div class="field"><label>Location</label><input name="location" maxlength="120" placeholder="e.g. Waimakariri, Christchurch"></div>
            <div class="field"><label>Default dispatch recipients (comma separated emails)</label><input name="recipients" type="text" placeholder="qs@company.co.nz, pm@company.co.nz"></div>
            <button class="btn primary block" type="submit">${I.plus} Create project</button>
          </form>
        </div>` : ''}
      </div>`;
  }

  /* ---------------- settings ---------------- */
  async function viewSettings() {
    const q = queueListLocal();
    const u = state.user;
    return `
      <div class="page">
        <div class="page-head"><h1>Settings</h1></div>
        <div class="card">
          <div class="settings-row"><span class="avatar big">${esc(initials(u.name))}</span>
            <div><b>${esc(u.name)}</b><div class="muted">${esc(u.email)}</div>
            <div class="chip" style="color:#FF6A00;border-color:#FF6A0055;background:#FF6A001f;margin-top:6px;">${esc(u.role.toUpperCase())}</div></div>
          </div>
          <div class="settings-row"><div><b>${esc(state.company ? state.company.name : '—')}</b><div class="muted">${state.company ? esc(state.company.industry || 'Pilot company') : ''} · Pilot: <b>${state.company ? esc(state.company.pilotStatus) : ''}</b></div></div></div>
          <div class="field"><label>Default project</label><select id="set-project">${state.projects.map((p) => `<option value="${p.id}" ${p.id === state.currentProjectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        </div>

        <div class="section">
          <div class="section-head"><h2>Offline queue</h2><span class="page-count">${q.length} pending</span></div>
          ${q.length ? q.map((item) => `<div class="queue-item"><div><b>${esc(item.payload.title || 'Untitled event')}</b><div class="muted">Queued ${esc(timeAgo(item.queuedAt))}</div></div><button class="btn small" data-retry="${item.localId}">Retry</button></div>`).join('') + '<button class="btn primary block" id="sync-all">' + I.send + ' Sync now</button>' : '<div class="muted">Nothing pending — all captures synced.</div>'}
        </div>

        <div class="section">
          <div class="section-head"><h2>App</h2></div>
          <div class="card">
            <div class="settings-row"><div><b>BoundBuild MVP v0.1.0</b><div class="muted">Voice capture → AI draft → review → dispatch → ledger</div></div></div>
            <div class="settings-row"><div class="muted">Demo build — audio transcription uses the browser's built-in speech service; the structuring engine is heuristic v1 (plug in OPENAI_API_KEY for LLM drafts, see .env.example).</div></div>
            <button class="btn ghost block" id="btn-logout">${I.logout} Sign out</button>
          </div>
        </div>
      </div>`;
  }

  function queueListLocal() {
    try { return JSON.parse(storeGet('bb_queue') || '[]'); } catch (e) { return []; }
  }

  /* ---------------- admin / pilot console ---------------- */
  async function viewAdmin() {
    const m = await API.metrics();
    const em = await API.emailStatus();
    const isFounder = state.user.role === 'founder';
    const tabs = [['overview', 'Overview'], ['usage', 'Usage'], ['outbox', 'Outbox'], ['team', 'Team'], ['exports', 'Exports']];
    if (isFounder) tabs.push(['companies', 'Companies']);
    const tab = (location.hash.split('?')[1] || 'overview');
    const met = m.metrics;
    return `
      <div class="page">
        <div class="page-head"><a class="icon-btn" href="#/home">${I.back}</a><h1>Pilot console</h1><span class="page-count">${esc(state.company ? state.company.name : 'All companies')}</span></div>
        <div class="chip-row">${tabs.map(([id, label]) => `<a class="chip-btn ${tab === id ? 'active' : ''}" href="#/admin?${id}">${label}</a>`).join('')}</div>
        ${tab === 'overview' ? adminOverview(m, em) : ''}
        ${tab === 'usage' ? '<div id="usage-wrap"><div class="page-loading">Loading…</div></div>' : ''}
        ${tab === 'outbox' ? '<div id="outbox-wrap"><div class="page-loading">Loading…</div></div>' : ''}
        ${tab === 'team' ? '<div id="team-wrap"><div class="page-loading">Loading…</div></div>' : ''}
        ${tab === 'exports' ? adminExports(m) : ''}
        ${tab === 'companies' && isFounder ? '<div id="companies-wrap"><div class="page-loading">Loading…</div></div>' : ''}
      </div>`;
  }

  function emailBannerHtml(em) {
    if (em && em.configured) {
      const who = em.provider === 'resend' ? `Resend · ${esc(em.from)}` : `SMTP · ${esc(em.host || '')}`;
      return `
      <div class="notice" style="border-color:#4CC38A55;color:#4CC38A;background:#4CC38A0d;">
        ${I.check} <div><b>Email delivery live</b> via ${esc(who)} — dispatches include the branded Commercial Event PDF.
        <div style="margin-top:8px;display:flex;gap:8px;align-items:center;">
          <input id="email-test-to" type="email" placeholder="test@yourqs.com" style="max-width:240px;padding:9px 12px;font-size:13px;">
          <button class="btn small" id="email-test-send">Send test email</button>
        </div></div>
      </div>`;
    }
    return `
    <div class="notice warn">${I.alert} <div><b>Email not configured</b> — dispatches are queued in the <b>Outbox</b> (branded email preview, PDF, .eml, recipient link) but no real email is sent yet.
      <div style="margin-top:6px;">Add <code>RESEND_API_KEY</code> (or <code>SMTP_*</code>) to <code>.env</code> and restart — then test delivery below:</div>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center;">
        <input id="email-test-to" type="email" placeholder="test@yourqs.com" style="max-width:240px;padding:9px 12px;font-size:13px;">
        <button class="btn small" id="email-test-send">Send test email</button>
      </div></div>
    </div>`;
  }

  function adminOverview(m, em) {
    const met = m.metrics;
    const cards = [
      ['Median capture time', met.medianCaptureSec + 's', 'target < 60s', met.medianCaptureSec <= 60 ? '#4CC38A' : '#FFB020'],
      ['Completion rate', met.completionRate + '%', 'of started captures saved', met.completionRate >= 70 ? '#4CC38A' : '#FFB020'],
      ['Usable AI draft', met.usableDraftRate + '%', 'drafts accepted with ≤2 edits', met.usableDraftRate >= 75 ? '#4CC38A' : '#FFB020'],
      ['Dispatch rate', met.dispatchRate + '%', 'of events reach the office', met.dispatchRate >= 50 ? '#4CC38A' : '#FFB020'],
      ['Weekly active', met.wau + '%', 'of users active this week', met.wau >= 40 ? '#4CC38A' : '#FFB020'],
      ['Events / user / wk', met.eventsPerUserWeek, 'habit & adoption', met.eventsPerUserWeek >= 1 ? '#4CC38A' : '#FFB020'],
    ];
    const totalBar = (label, v, max, color) => {
      const pct = max ? Math.round(v / max * 100) : 0;
      return `<div class="bar-row"><span>${label}</span><div class="bar"><div style="width:${pct}%;background:${color}"></div></div><b>${v}</b></div>`;
    };
    const typeMax = Math.max(1, ...Object.values(m.byType));
    return `
      <div style="margin-top:14px;">${emailBannerHtml(em)}</div>
      <div class="metric-grid">${cards.map(([l, v, s, c]) => `<div class="metric-card"><div class="metric-label">${l}</div><div class="metric-value" style="color:${c}">${v}</div><div class="metric-sub">${s}</div></div>`).join('')}</div>
      <div class="chart-card"><div class="chart-title">Events captured — last 14 days</div>${barChart(m.days)}</div>
      <div class="chart-card"><div class="chart-title">Active users — last 14 days</div>${lineChart(m.activeByDay)}</div>
      <div class="chart-card"><div class="chart-title">Events by type</div>
        ${Object.entries(m.byType).sort((a, b) => b[1] - a[1]).map(([t, v]) => totalBar(t, v, typeMax, { 'Variation': '#FF6A00', 'Delay': '#FFB020' }[t] || '#5AA9FF')).join('')}
      </div>
      <div class="chart-card"><div class="chart-title">Status breakdown</div>
        <div class="status-dots">${[['draft', m.byStatus.draft], ['sent', m.byStatus.sent], ['reviewed', m.byStatus.reviewed]].map(([s, v]) => `<span>${statusChip(s)} <b>${v}</b></span>`).join('')}</div>
      </div>
      <div class="section"><div class="section-head"><h2>Recent events</h2></div>
        ${m.recentEvents.slice(0, 5).map((e) => `<a class="ev-card" href="#/event/${e.id}"><div class="ev-body"><div class="ev-meta"><span class="ev-ref">${esc(e.ref)}</span>${statusChip(e.status)}</div><div class="ev-title">${esc(e.title)}</div><div class="ev-foot"><span>${typeChip(e.type)}</span><span class="ev-time">${I.clock}${esc(timeAgo(e.createdAt))}</span></div></div></a>`).join('')}
      </div>`;
  }

  function adminExports(m) {
    return `
      <div class="section">
        <div class="section-head"><h2>Pilot instrumentation</h2><span class="page-count">${m.totals.events} events</span></div>
        <div class="card">
          <div class="settings-row"><div><b>Events export (CSV)</b><div class="muted">Every event with type, status, impacts, timestamps, AI edit count.</div></div><button class="btn small" id="exp-events">${I.download} CSV</button></div>
          <div class="settings-row"><div><b>Capture sessions export (CSV)</b><div class="muted">Start → save timing, completion, drop-off — the raw speed metric.</div></div><button class="btn small" id="exp-captures">${I.download} CSV</button></div>
        </div>
      </div>`;
  }

  /* ---------------- dispatch modal ---------------- */
  function openDispatchModal(evt) {
    const project = state.projects.find((p) => p.id === evt.projectId);
    const defaults = (project && project.defaultRecipients) || [];
    const root = $('#modal-root');
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal">
          <div class="modal-head"><h3>${I.send} Dispatch event</h3><button class="icon-btn" id="modal-close">${I.x}</button></div>
          <div class="modal-body">
            <div class="ev-title sm">${esc(evt.ref)} · ${esc(evt.title)}</div>
            <div class="field"><label>Recipient email *</label><input id="dsp-to" type="email" required value="${esc(defaults[0] || '')}" placeholder="qs@company.co.nz"></div>
            ${defaults.length > 1 ? `<div class="chip-row">${defaults.map((r) => `<button class="chip-btn" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : ''}
            <div class="field"><label>Message to recipient (optional)</label><textarea id="dsp-note" rows="2" placeholder="e.g. Needs pricing before Friday's CVI meeting"></textarea></div>
            <div class="notice">${I.send} The recipient receives the branded <b>Commercial Event PDF</b> attached to the email, plus a secure link to the full record with photos and audio.</div>
            <button class="btn primary block" id="dsp-send">${I.send} Dispatch now</button>
            <div id="dsp-result"></div>
          </div>
        </div>
      </div>`;
    $('#modal-close').addEventListener('click', closeModal);
    root.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });
    root.querySelectorAll('.chip-btn[data-r]').forEach((b) => b.addEventListener('click', () => { $('#dsp-to').value = b.dataset.r; }));
    $('#dsp-send').addEventListener('click', async () => {
      const to = $('#dsp-to').value.trim();
      const note = $('#dsp-note').value.trim();
      if (!to) return toast('Enter a recipient email', 'warn');
      const btn = $('#dsp-send');
      btn.disabled = true; btn.textContent = 'Dispatching…';
      try {
        const res = await API.dispatchEvent(evt.id, { to, note });
        const st = res.emailStatus;
        const statusTxt = st === 'sent' ? 'Email sent to ' + to : st === 'failed' ? 'SMTP failed — queued in outbox with link' : 'Queued (SMTP not configured) — outbox + link ready';
        $('#dsp-result').innerHTML = `
          <div class="dsp-ok">${I.check} ${esc(statusTxt)}</div>
          <div class="dsp-link"><span>Secure recipient link:</span><code id="dsp-linkval">${esc(res.recipientLink)}</code></div>
          <div class="dsp-actions"><button class="btn small" id="dsp-copy">${I.link} Copy link</button><a class="btn small" href="${res.recipientLink}" target="_blank">${I.link} Open</a></div>`;
        $('#dsp-copy').addEventListener('click', () => {
          const val = $('#dsp-linkval').textContent;
          (navigator.clipboard ? navigator.clipboard.writeText(val) : Promise.reject()).then(() => toast('Link copied')).catch(() => toast('Copy failed — select and copy manually', 'warn'));
        });
        // refresh event state if we're on its detail page
        if (location.hash.startsWith('#/event/')) App.router();
      } catch (e) {
        $('#dsp-result').innerHTML = `<div class="dsp-err">${I.alert} ${esc(e.message)}</div>`;
      } finally {
        btn.disabled = false; btn.textContent = 'Dispatch now';
      }
    });
  }

  function closeModal() { $('#modal-root').innerHTML = ''; }

  /* ---------------- view mounting (post-render bindings) ---------------- */
  async function mount() {
    const full = location.hash || '#/home';
    const hash = full.split('?')[0];
    const c = state.capture;

    /* global bindings that apply on many screens */
    const goCapture = $('[data-go-capture]');
    if (goCapture) goCapture.addEventListener('click', () => location.hash = '#/capture');

    if (hash === '#/login' || hash === '#/register') {
      const form = $('#login-form') || $('#register-form');
      if (form) form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true; btn.textContent = 'Signing in…';
        try {
          const res = form.id === 'login-form' ? await API.login(data.email, data.password) : await API.register(data);
          API.setToken(res.token);
          state.user = res.user;
          await bootstrapAfterAuth();
          location.hash = '#/home';
        } catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.textContent = 'Sign in'; }
      });
      $$('.demo-user').forEach((b) => b.addEventListener('click', async () => {
        try {
          const res = await API.login(b.dataset.email, 'boundbuild-demo');
          API.setToken(res.token);
          state.user = res.user;
          await bootstrapAfterAuth();
          location.hash = '#/home';
        } catch (err) { toast(err.message, 'err'); }
      }));
      return;
    }

    if (hash === '#/capture') { captureMount(); return; }

    if (hash === '#/home') {
      if (c && c.savedEvent) state.capture = null;
      return;
    }

    if (hash === '#/ledger') {
      const qInput = $('#ledger-q');
      qInput.addEventListener('input', debounce((el) => { state.filters.q = el.value; reloadLedgerList(); }, 300));
      $('#status-chips').querySelectorAll('.chip-btn').forEach((b) => b.addEventListener('click', () => {
        state.filters.status = b.dataset.v;
        App.router();
      }));
      const ft = $('#filter-type'); const fp = $('#filter-project');
      if (state.filters.type) ft.value = state.filters.type;
      if (state.filters.project) fp.value = state.filters.project;
      ft.addEventListener('change', () => { state.filters.type = ft.value; reloadLedgerList(); });
      fp.addEventListener('change', () => { state.filters.project = fp.value; reloadLedgerList(); });
      return;
    }

    if (hash.startsWith('#/event/')) {
      const id = hash.slice('#/event/'.length);
      $('#ev-dispatch').addEventListener('click', async () => { openDispatchModal(await API.event(id)); });
      const rev = $('#ev-review');
      if (rev) rev.addEventListener('click', async () => {
        await API.reviewEvent(id);
        toast('Marked as reviewed');
        App.router();
      });
      const pdfBtn = $('#ev-pdf');
      if (pdfBtn) pdfBtn.addEventListener('click', async () => {
        try {
          const res = await API._raw('GET', `/api/events/${id}/pdf`);
          const blob = await res.blob();
          const e2 = await API.event(id);
          downloadFile(`BoundBuild-${e2.ref || id}.pdf`, blob, 'application/pdf');
        } catch (err) { toast('PDF download failed: ' + err.message, 'err'); }
      });
      const playBtn = $('[data-play]');
      if (playBtn) playBtn.addEventListener('click', () => {
        const a = $('#audio-' + playBtn.dataset.play);
        if (a.paused) { a.play(); playBtn.innerHTML = I.x; } else { a.pause(); playBtn.innerHTML = I.play; }
        a.onended = () => { playBtn.innerHTML = I.play; };
      });
      return;
    }

    if (hash.startsWith('#/edit/')) {
      const id = hash.slice('#/edit/'.length);
      const formEl = $('#edit-form-mount');
      if (pendingEditForm) formEl.appendChild(pendingEditForm.el);
      $('#edit-save').addEventListener('click', async () => {
        const fEl = formEl.querySelector('.form');
        const vals = {};
        fEl.querySelectorAll('[data-f]').forEach((i) => vals[i.dataset.f] = i.value.trim());
        const impacts = {};
        for (const k of ['timeImpact', 'costImpact']) {
          impacts[k] = { flag: fEl.querySelector(`[data-impact-key="${k}"]`).classList.contains('on'), note: fEl.querySelector(`[data-note="${k}"]`).value.trim() };
        }
        const rm = window.__bbRemovedMedia || [];
        const btn = $('#edit-save');
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          await API.updateEvent(id, { ...vals, timeImpact: impacts.timeImpact, costImpact: impacts.costImpact, removeMedia: rm });
          toast('Changes saved');
          location.hash = '#/event/' + id;
        } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = 'Save changes'; }
      });
      return;
    }

    if (hash === '#/projects') {
      const form = $('#project-form');
      if (form) form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        const recipients = String(data.recipients || '').split(',').map((x) => x.trim()).filter(Boolean);
        try {
          await API.createProject({ name: data.name, location: data.location, defaultRecipients: recipients });
          toast('Project created');
          state.projects = await API.projects();
          App.router();
        } catch (err) { toast(err.message, 'err'); }
      });
      return;
    }

    if (hash === '#/settings') {
      $('#set-project').addEventListener('change', (e) => { state.currentProjectId = e.target.value; storeSet('bb_project', e.target.value); toast('Default project updated'); });
      $$('[data-retry]').forEach((b) => b.addEventListener('click', async () => {
        const res = await API.syncQueue();
        toast(res.some((r) => r.ok) ? 'Synced ' + res.filter((r) => r.ok).length + ' events' : 'Still offline — try again later', res.some((r) => r.ok) ? 'ok' : 'warn');
        App.router();
      }));
      const syncAllBtn = $('#sync-all');
      if (syncAllBtn) syncAllBtn.addEventListener('click', async () => {
        const res = await API.syncQueue();
        toast(res.some((r) => r.ok) ? 'Synced ' + res.filter((r) => r.ok).length + ' events' : 'Still offline — try again later', res.some((r) => r.ok) ? 'ok' : 'warn');
        App.router();
      });
      const logoutBtn = $('#btn-logout');
      if (logoutBtn) logoutBtn.addEventListener('click', async () => {
        try { await API.logout(); } catch (e) { /* ignore */ }
        API.setToken(''); state.user = null; state.company = null;
        location.hash = '#/login';
      });
      return;
    }

    if (hash.startsWith('#/admin')) {
      const tab = full.split('?')[1] || 'overview';
      const testBtn = $('#email-test-send');
      if (testBtn) testBtn.addEventListener('click', async () => {
        const to = $('#email-test-to').value.trim();
        if (!to) return toast('Enter a recipient email', 'warn');
        testBtn.disabled = true; testBtn.textContent = 'Sending…';
        try {
          const r = await API.emailTest(to);
          const ok = r.emailStatus === 'sent';
          toast(ok ? `Test email sent to ${to} via ${r.provider} — check the inbox` : `Email queued to outbox (${r.emailStatus}) — no provider configured yet`, ok ? 'ok' : 'warn');
        } catch (e) { toast(e.message, 'err'); }
        testBtn.disabled = false; testBtn.textContent = 'Send test email';
      });
      if (tab === 'usage') mountUsage();
      if (tab === 'outbox') mountOutbox();
      if (tab === 'team') mountTeam();
      if (tab === 'companies') mountCompanies();
      if (tab === 'exports') {
        $('#exp-events').addEventListener('click', async () => {
          const res = await API._raw('GET', '/api/admin/export/events.csv');
          downloadFile('boundbuild-events.csv', await res.text(), 'text/csv');
        });
        $('#exp-captures').addEventListener('click', async () => {
          const res = await API._raw('GET', '/api/admin/export/captures.csv');
          downloadFile('boundbuild-captures.csv', await res.text(), 'text/csv');
        });
      }
      return;
    }
  }

  async function mountOutbox() {
    const wrap = $('#outbox-wrap');
    const list = await API.outbox();
    wrap.innerHTML = `
      <div class="section"><div class="section-head"><h2>Dispatch outbox</h2><span class="page-count">${list.length} dispatches</span></div>
      ${list.map((o) => `
        <div class="outbox-item">
          <div class="outbox-main"><b>${esc(o.eventRef)} · ${esc(o.eventTitle)}</b>
          <div class="muted">To <code>${esc(o.to)}</code> · ${esc(timeAgo(o.sentAt))}</div></div>
          <div class="outbox-actions">
            <button class="btn small" data-html="${o.id}">${I.send} Email</button>
            ${o.hasPdf ? `<a class="btn small" href="/api/admin/outbox/${o.id}.pdf">${I.download} PDF</a>` : ''}
            <a class="btn small" href="/api/admin/outbox/${o.id}.eml">${I.download} .eml</a>
          </div>
        </div>`).join('') || '<div class="empty"><b>No dispatches yet</b><span>Dispatched events land here with their full email body.</span></div>'}</div>`;
    wrap.querySelectorAll('[data-html]').forEach((b) => b.addEventListener('click', async () => {
      const res = await API._raw('GET', '/api/admin/outbox/' + b.dataset.html + '.html');
      const html = await res.text();
      const root = $('#modal-root');
      root.innerHTML = `<div class="modal-backdrop"><div class="modal wide"><div class="modal-head"><h3>Dispatch email preview</h3><button class="icon-btn" id="modal-close">${I.x}</button></div><iframe class="email-frame" sandbox="" srcdoc="${esc(html)}"></iframe></div></div>`;
      $('#modal-close').addEventListener('click', closeModal);
      root.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });
    }));
  }

  async function mountTeam() {
    const wrap = $('#team-wrap');
    const users = await API.users();
    wrap.innerHTML = `
      <div class="section"><div class="section-head"><h2>Team</h2><span class="page-count">${users.length}</span></div>
      ${users.map((u) => `
        <div class="settings-row"><span class="avatar">${esc(initials(u.name))}</span>
          <div><b>${esc(u.name)}</b><div class="muted">${esc(u.email)}</div></div>
          <span class="chip" style="color:#FF6A00;border-color:#FF6A0055;background:#FF6A001f;">${esc(u.role.toUpperCase())}</span>
        </div>`).join('')}
      </div>
      <div class="section"><div class="section-head"><h2>Add team member</h2></div>
        <form id="user-form" class="form">
          <div class="field"><label>Name *</label><input name="name" required maxlength="80"></div>
          <div class="field"><label>Email *</label><input name="email" type="email" required></div>
          <div class="field"><label>Role</label><select name="role"><option value="user">Foreman / site user</option><option value="site manager">Site Manager</option><option value="admin">Admin / QS / office</option></select></div>
          <div class="field"><label>Temporary password * (min 8 chars)</label><input name="password" type="text" required minlength="8" placeholder="Give them something to change later"></div>
          <button class="btn primary block" type="submit">${I.plus} Add user</button>
        </form>
      </div>`;
    $('#user-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      try {
        await API.createUser(data);
        toast('User added');
        mountTeam();
      } catch (err) { toast(err.message, 'err'); }
    });
  }

  async function mountCompanies() {
    const wrap = $('#companies-wrap');
    const list = await API.companies();
    wrap.innerHTML = `
      <div class="section"><div class="section-head"><h2>Companies (founder)</h2><span class="page-count">${list.length}</span></div>
      ${list.map((c) => `
        <div class="settings-row"><div><b>${esc(c.name)}</b><div class="muted">${c.userCount} users · ${c.projectCount} projects · ${c.eventCount} events · Pilot: ${esc(c.pilotStatus)}</div></div>
        <span class="chip" style="color:#4CC38A;border-color:#4CC38A55;background:#4CC38A1f;">${esc(c.pilotStatus)}</span></div>`).join('')}
      </div>`;
  }

  async function mountUsage() {
    const wrap = $('#usage-wrap');
    const u = await API.usage();
    const companies = (u.companies || []).slice().sort((a, b) => {
      const t = (c) => c.lastActiveAt ? new Date(c.lastActiveAt).getTime() : 0;
      return t(b) - t(a);
    });
    const rows = companies.map((c) => {
      const badge = c.quiet
        ? `<span class="chip" style="color:#FFB020;border-color:#FFB02055;background:#FFB0201f;">QUIET</span>`
        : `<span class="chip" style="color:#4CC38A;border-color:#4CC38A55;background:#4CC38A1f;">ACTIVE</span>`;
      const last = c.lastActiveAt ? timeAgo(c.lastActiveAt) : 'never';
      return `
        <div class="usage-company">
          <div class="usage-head">
            <div><b>${esc(c.name)}</b><div class="muted">${esc(c.pilotStatus || 'pilot')} · ${c.users.active7}/${c.users.total} users active this week</div></div>
            <div class="usage-badges">${badge}<span class="usage-last">last active ${esc(last)}</span></div>
          </div>
          <div class="usage-stats">
            <div class="u-stat"><b>${c.events.total}</b><span>events</span></div>
            <div class="u-stat"><b>${c.events.last30}</b><span>events 30d</span></div>
            <div class="u-stat"><b>${c.captures.last30}</b><span>captures 30d</span></div>
            <div class="u-stat"><b>${c.dispatches.total}</b><span>dispatches</span></div>
          </div>
          <div class="usage-spark">${sparkline(c.activityByDay)}</div>
        </div>`;
    }).join('');
    wrap.innerHTML = `
      <div class="section">
        <div class="section-head"><h2>Pilot builder usage</h2><span class="page-count">${companies.length} builders</span></div>
        <div class="muted" style="margin-bottom:12px;">How often each builder's team is using the app — events + captures per day over the last 30 days. Sorted by most recently active.</div>
        ${rows || '<div class="empty"><b>No pilot companies yet</b><span>Registered builders appear here with their usage.</span></div>'}
      </div>`;
  }

  async function reloadLedgerList() {
    const params = { q: state.filters.q, status: state.filters.status, type: state.filters.type, project: state.filters.project };
    const events = await API.events(params);
    $('#ledger-list').innerHTML = events.map(eventCard).join('') || '<div class="empty"><b>No events match</b><span>Try a different filter.</span></div>';
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /* expose the form's removed-media hook for edit view */
  window.__bbRemovedMedia = [];

  return { boot, router, mount, openDispatchModal, closeModal };
})();

/* Render + bind after each route change */
const _origRouter = App.router;
App.router = async function () {
  await _origRouter.call(App);
  await App.mount();
};

document.addEventListener('DOMContentLoaded', () => App.boot());
