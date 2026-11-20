// Core: shared state, events, URL sync, storage and network helpers used by every lens.

/* ---------- tiny DOM helpers ---------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, '0');
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => localDay();
export const yesterday = () => localDay(new Date(Date.now() - 864e5));
export const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const addMonths = (s, n) => { const d = new Date(s + 'T00:00:00Z'), day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return d.toISOString().slice(0, 10); };
export const fmtDate = (s, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => s ? new Date((s.length === 10 ? s + 'T00:00:00Z' : s)).toLocaleDateString(undefined, { timeZone: 'UTC', ...opts }) : '';
export const fmtDay = s => fmtDate(s, { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtYear = y => y < 0 ? `${(-y).toLocaleString()} BCE` : `${y} CE`;

/* ---------- geo ---------- */
export function km(a, b) { // [lat,lng] pairs or {lat,lng}
  const A = Array.isArray(a) ? a : [a.lat, a.lng], B = Array.isArray(b) ? b : [b.lat, b.lng];
  const R = 6371, r = Math.PI / 180, dLat = (B[0] - A[0]) * r, dLng = (B[1] - A[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(A[0] * r) * Math.cos(B[0] * r) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x));
}
export const fmtKm = d => d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(d < 10 ? 1 : 0)} km`;
export const wrapLng = lng => ((lng + 540) % 360) - 180;

/* ---------- events ---------- */
const listeners = {};
export const on = (evt, fn) => (listeners[evt] ||= []).push(fn);
export const emit = (evt, data) => (listeners[evt] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(evt, e); } });

/* ---------- storage ---------- */
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
};

/* ---------- shared state ---------- */
export const state = {
  lens: 'overview',
  place: null,            // { lat, lng, name, admin:{local,district,state,country,countryCode}, ready }
  view: null,             // { lat, lng, z }
  date: yesterday(),      // imagery / news date
  date2: null,            // compare date (left side), or null
};

export function setLens(id) { if (state.lens === id) return; state.lens = id; emit('lens', id); syncUrl(); }
export function setDate(d, d2 = state.date2) { state.date = d; state.date2 = d2; store.set('etm-date', { date: d, dateB: d2, compare: !!d2 }); emit('date', state); syncUrl(); }

let placeSeq = 0;
export async function setPlace(lat, lng, name = '', opts = {}) {
  const seq = ++placeSeq;
  state.place = { lat: +lat, lng: wrapLng(+lng), name: name || '', admin: null, ready: false };
  rememberView(); emit('place', state.place); syncUrl();
  try {
    const j = await getJSON(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=14&addressdetails=1&accept-language=en&lat=${(+lat).toFixed(5)}&lon=${wrapLng(+lng).toFixed(5)}`, { ttl: 864e5 });
    if (seq !== placeSeq) return;
    const a = j.address || {};
    state.place.admin = {
      local: a.village || a.town || a.city || a.suburb || a.hamlet || a.municipality || '',
      district: (a.state_district || a.county || a.city_district || '').replace(/\s+district$/i, ''),
      state: a.state || a.region || '', country: a.country || '', countryCode: (a.country_code || '').toUpperCase(),
    };
    if (!name) state.place.name = state.place.admin.local || state.place.admin.district || state.place.admin.state || state.place.admin.country || 'Open sea';
  } catch (e) { if (seq !== placeSeq) return; if (!name) state.place.name = `${(+lat).toFixed(3)}, ${(+lng).toFixed(3)}`; state.place.admin = {}; }
  state.place.ready = true;
  if (!opts.skipRecent && state.place.admin && state.place.admin.country) remember(state.place);
  emit('placeinfo', state.place);
}
function remember(p) {
  const rec = (store.get('etm-recent') || []).filter(r => r.name !== p.name);
  rec.unshift({ name: p.name, lat: p.lat, lng: p.lng }); store.set('etm-recent', rec.slice(0, 6));
}
export function rememberView() {
  const v = state.view || {}, p = state.place;
  store.set('etm-view', { lat: v.lat ?? p?.lat, lng: v.lng ?? p?.lng, z: v.z ?? 11, pin: p ? [p.lat, p.lng] : null });
}

/* ---------- URL (#lens=…&p=lat,lng&c=lat,lng,z&d=…&d2=…) ---------- */
let urlTimer;
export function syncUrl() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    const p = new URLSearchParams();
    p.set('lens', state.lens);
    if (state.place) p.set('p', `${state.place.lat.toFixed(5)},${state.place.lng.toFixed(5)}`);
    if (state.view) p.set('c', `${state.view.lat.toFixed(4)},${state.view.lng.toFixed(4)},${state.view.z}`);
    if (state.date && state.date !== yesterday()) p.set('d', state.date);
    if (state.date2) p.set('d2', state.date2);
    for (const [k, v] of Object.entries(extraUrl)) if (v != null && v !== '') p.set(k, v);
    try { history.replaceState(null, '', '#' + p.toString()); } catch (e) { }
  }, 150);
}
const extraUrl = {};
export function setUrlParam(k, v) { extraUrl[k] = v; syncUrl(); }
export function readUrl() {
  const p = new URLSearchParams(location.hash.slice(1)); const out = {};
  for (const [k, v] of p) out[k] = v;
  return out;
}

/* ---------- busy indicator & toast ---------- */
let busy = 0;
export function spin(on) { busy = Math.max(0, busy + (on ? 1 : -1)); const s = document.getElementById('spinner'); if (s) s.classList.toggle('on', busy > 0); }
let toastT;
export function toast(msg, ms = 4200) { const t = document.getElementById('toast'); if (!t) return; t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }

/* ---------- network ---------- */
const cache = new Map();
export async function getJSON(url, { ttl = 10 * 60e3, timeout = 25000, init } = {}) {
  const key = init ? url + '|' + (init.body || '') : url, hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
  spin(true);
  try {
    const r = await fetch(url, { ...(init || {}), signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const v = await r.json(); cache.set(key, { t: Date.now(), v }); return v;
  } finally { clearTimeout(timer); spin(false); }
}
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
export async function overpass(q) {
  let last;
  for (const ep of OVERPASS) {
    try { return await getJSON(ep, { ttl: 30 * 60e3, timeout: 45000, init: { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } }); }
    catch (e) { last = e; }
  }
  throw last || new Error('overpass');
}
export const elLL = e => e.lat != null ? [e.lat, e.lon] : e.center ? [e.center.lat, e.center.lon] : null;
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/* run async tasks with a concurrency limit */
export async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = undefined; } } }));
  return out;
}
