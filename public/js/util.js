/* BoundBuild — util helpers, icons, formatting */
'use strict';

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* localStorage may throw in sandboxed previews — never let it crash the app */
const mem = {};
function storeGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return mem[k] || null; } }
function storeSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { mem[k] = v; } }
function storeDel(k) { try { window.localStorage.removeItem(k); } catch (e) { delete mem[k]; } }

function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtSecs(ms) {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}

function initials(name) {
  return String(name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

const TYPE_COLORS = {
  'Variation': '#FF6A00',
  'Delay': '#FFB020',
  'Site instruction': '#4CC38A',
  'Scope change': '#5AA9FF',
  'Unforeseen condition': '#C084FC',
  'Material substitution': '#4CC3C3',
  'Other commercial event': '#9AA3AD',
};

function typeChip(type) {
  const c = TYPE_COLORS[type] || '#9AA3AD';
  return `<span class="chip" style="color:${c};border-color:${c}55;background:${c}1f;">${esc(type)}</span>`;
}

function statusChip(status) {
  const map = { draft: ['#9AA3AD', 'Draft'], sent: ['#FFB020', 'Sent'], reviewed: ['#4CC38A', 'Reviewed'] };
  const [c, label] = map[status] || map.draft;
  return `<span class="chip" style="color:${c};border-color:${c}55;background:${c}1f;">${label}</span>`;
}

const I = {
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="17" x2="12" y2="22"/></svg>',
  photo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 15l-5-5L5 20"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
  dollar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16"/><path d="M15 9h4a2 2 0 0 1 2 2v10"/><line x1="9" y1="7" x2="11" y2="7"/><line x1="9" y1="11" x2="11" y2="11"/><line x1="9" y1="15" x2="11" y2="15"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="20" x2="20" y2="20"/><rect x="5" y="11" width="3.5" height="6"/><rect x="10.5" y="7" width="3.5" height="10"/><rect x="16" y="4" width="3.5" height="13"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
  stripes: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M0 8l8-8h2L2 10H0zm10 0l8-8h2l-8 8h-2zm10 0l4-4v2l-2 2h-2zM0 18l8-8h2l-8 8H0zm10 0l8-8h2l-8 8h-2zm10 0l4-4v2l-2 2h-2zM0 28l8-8h2l-8 8H0zm10 0l8-8h2l-8 8h-2z"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.7L19.6 10l-5.7 1.9L12 17.6l-1.9-5.7L4.4 10l5.7-1.9z"/><path d="M19 15l.9 2.6L22.5 18.5l-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z"/></svg>',
};

function logoMark(size) {
  return `<span class="logo-mark" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.58)}px;line-height:${size}px;">B</span>`;
}

/* Tiny SVG bar/line charts, dependency-free */
function barChart(data, { height = 120, color = '#FF6A00', labelEvery = 2 } = {}) {
  const w = 320, h = height, pad = 6;
  const max = Math.max(1, ...data.map((d) => d.count));
  const bw = (w - pad * 2) / data.length;
  let bars = '';
  data.forEach((d, i) => {
    const bh = Math.max(2, (d.count / max) * (h - 34));
    const x = pad + i * bw + bw * 0.18;
    bars += `<rect x="${x.toFixed(1)}" y="${(h - 16 - bh).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${d.count ? color : '#23282E'}" opacity="${d.count ? 1 : 0.5}">`;
    bars += `<title>${esc(d.label)}: ${d.count}</title></rect>`;
    if (i % labelEvery === 0 || i === data.length - 1) {
      bars += `<text x="${(x + bw * 0.32).toFixed(1)}" y="${h - 4}" font-size="9" fill="#6B7480" text-anchor="middle" font-family="system-ui">${esc(d.label)}</text>`;
    }
  });
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;">${bars}</svg>`;
}

function lineChart(data, { height = 120, color = '#4CC38A' } = {}) {
  const w = 320, h = height, pad = 10;
  const max = Math.max(1, ...data.map((d) => d.count));
  const step = (w - pad * 2) / Math.max(1, data.length - 1);
  const pts = data.map((d, i) => [pad + i * step, h - 18 - (d.count / max) * (h - 36)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const dots = pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6" fill="${color}"><title>${esc(data[i].label)}: ${data[i].count} active</title></circle>`).join('');
  let labels = '';
  data.forEach((d, i) => {
    if (i % 2 === 0 || i === data.length - 1) labels += `<text x="${(pad + i * step).toFixed(1)}" y="${h - 4}" font-size="9" fill="#6B7480" text-anchor="middle" font-family="system-ui">${esc(d.label)}</text>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;"><path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>${dots}${labels}</svg>`;
}

function sparkline(data, { height = 34, color = '#FF6A00' } = {}) {
  // Tiny 30-day activity sparkline (bars). Each bar = events + captures that day.
  const w = 320, h = height;
  const vals = data.map((d) => d.events + d.captures + (d.dispatches || 0));
  const max = Math.max(1, ...vals);
  const bw = w / vals.length;
  let bars = '';
  vals.forEach((v, i) => {
    const bh = Math.max(1.5, (v / max) * (h - 2));
    bars += `<rect x="${(i * bw).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(2, bw - 1.5).toFixed(1)}" height="${bh.toFixed(1)}" rx="1" fill="${v ? color : '#23282E'}"><title>${esc(data[i].label)}: ${v} activity</title></rect>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px;display:block;">${bars}</svg>`;
}

function downloadFile(name, content, mime) {
  const a = document.createElement('a');
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function toast(msg, kind = 'ok') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<span class="toast-ic">${kind === 'ok' ? I.check : kind === 'err' ? I.alert : I.alert}</span><span>${esc(msg)}</span>`;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3800);
}
