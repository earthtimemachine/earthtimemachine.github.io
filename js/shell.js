// App shell: lens tabs, search, place header, mobile sheet, start-up.
import { $, $$, esc, state, on, setLens, setPlace, setDate, readUrl, store, toast, getJSON, yesterday } from './core.js';
import { map, setBase, showPin, showLensGroup, mapBanner, stopSwipe } from './map.js';
import { attachSearch } from './search.js';
import overview from './lenses/overview.js';
import imagery from './lenses/imagery.js';
import hazards from './lenses/hazards.js';
import history from './lenses/history.js';
import economy from './lenses/economy.js';
import explore from './lenses/explore.js';
import news from './lenses/news.js';
import routes from './lenses/routes.js';

const LENSES = [overview, imagery, hazards, routes, history, economy, explore, news];
const byId = Object.fromEntries(LENSES.map(l => [l.id, l]));
const ALIASES = { daily: 'imagery', hires: 'imagery', resources: 'economy', res: 'economy', haz: 'hazards', hist: 'history', exp: 'explore', route: 'routes', roads: 'routes' };

/* ---------- tabs ---------- */
const tabs = $('#lensTabs'), body = $('#panelBody');
tabs.innerHTML = LENSES.map(l => `<button class="lens-tab" data-id="${l.id}" type="button" title="${esc(l.desc)}">${l.icon}<span>${esc(l.title)}</span></button>`).join('');
$$('.lens-tab', tabs).forEach(b => b.onclick = () => activate(b.dataset.id));

const mounted = {}, seen = {};
let current = null;
function placeKey(p) { return p ? `${p.lat.toFixed(5)},${p.lng.toFixed(5)}|${p.ready ? 1 : 0}` : 'none'; }
function activate(id) {
  id = ALIASES[id] || id; const lens = byId[id] || overview;
  if (current === lens) return;
  if (current) { current.hide?.(); mounted[current.id].classList.remove('on'); }
  stopSwipe(); mapBanner('');
  if (!mounted[lens.id]) { const v = document.createElement('section'); v.className = 'lens-view'; v.dataset.lens = lens.id; body.appendChild(v); mounted[lens.id] = v; lens.init(v); }
  current = lens; mounted[lens.id].classList.add('on'); body.scrollTop = 0;
  $$('.lens-tab', tabs).forEach(b => { const on = b.dataset.id === lens.id; b.classList.toggle('on', on); if (on) b.scrollIntoView({ inline: 'nearest', block: 'nearest' }); });
  setLens(lens.id); setBase(lens.base || 'satellite'); showLensGroup(lens.id);
  lens.show?.();
  refreshLens(lens);
  document.title = state.place ? `${state.place.name} · ${lens.title} · Earth Time Machine` : `${lens.title} · Earth Time Machine`;
}
function refreshLens(lens) { const k = placeKey(state.place); if (seen[lens.id] !== k) { seen[lens.id] = k; lens.update?.(state.place, state.place?.ready ? 'info' : 'place'); } }
export const openLens = activate;
window.ETM = { openLens: activate };

/* ---------- place header ---------- */
function drawPlace() {
  const p = state.place;
  if (!p) { $('#placeName').textContent = 'Pick a place'; $('#placeSub').textContent = 'Search above, use your location, or tap the map.'; return; }
  $('#placeName').textContent = p.name || 'Finding place…';
  const a = p.admin || {};
  const parts = [a.district && a.district !== p.name ? a.district : '', a.state, a.country].filter(Boolean);
  $('#placeSub').textContent = (parts.length ? parts.join(', ') + '  ·  ' : '') + `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
  if (current) document.title = `${p.name} · ${current.title} · Earth Time Machine`;
}
on('place', p => { showPin(p); drawPlace(); if (current) refreshLens(current); });
on('placeinfo', p => { drawPlace(); if (current) refreshLens(current); });

/* ---------- search ---------- */
const q = $('#q'), results = $('#results');
attachSearch(q, results, it => {
  q.value = '';
  const z = it.zoom || 13;
  map.setView([+it.lat, +it.lng], Math.max(map.getZoom() > z ? map.getZoom() : z, 4));
  setPlace(+it.lat, +it.lng, it.coord ? '' : it.name);
  sheet('half');
}, { near: () => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng, z: map.getZoom() }; }, recent: () => store.get('etm-recent') || [] });
document.addEventListener('click', e => { if (!e.target.closest('.search')) results.classList.add('hidden'); });

$('#locate').onclick = () => {
  if (!navigator.geolocation) return toast('This browser cannot share your location. Search for your town instead.');
  toast('Finding your location…');
  navigator.geolocation.getCurrentPosition(pos => { const { latitude: la, longitude: lo } = pos.coords; map.setView([la, lo], 13); setPlace(la, lo); sheet('half'); },
    err => toast(err.code === 1 ? 'Location access is off. Allow it in your browser settings, or search for your town.' : 'Your location could not be found. Search for your town instead.'),
    { timeout: 12000 });
};
$('#share').onclick = async () => {
  try { await navigator.clipboard.writeText(location.href); toast('Link copied. Anyone with it sees this place and view.'); }
  catch (e) { toast('Copy the address from your browser bar to share this view.'); }
};

/* ---------- mobile bottom sheet ---------- */
const panel = $('#panel'), grab = $('#grab');
const SNAP = { peek: 0.24, half: 0.5, full: 0.88 };
let sheetState = 'half';
function setSheetH(px) { document.documentElement.style.setProperty('--sheet-h', px + 'px'); }
function sheet(s) { if (!matchMedia('(max-width:820px)').matches) return; sheetState = s; const c = map.getCenter(); setSheetH(Math.round(innerHeight * SNAP[s])); setTimeout(() => { map.invalidateSize(); if (state.place) map.panTo([state.place.lat, state.place.lng], { animate: false }); else map.panTo(c, { animate: false }); }, 270); }
(() => {
  let y0 = 0, h0 = 0, dragging = false;
  grab.addEventListener('pointerdown', e => { dragging = true; y0 = e.clientY; h0 = panel.getBoundingClientRect().height; panel.classList.add('dragging'); document.body.classList.add('dragging'); grab.setPointerCapture(e.pointerId); });
  grab.addEventListener('pointermove', e => { if (!dragging) return; const hgt = Math.max(innerHeight * .16, Math.min(innerHeight * .92, h0 + (y0 - e.clientY))); setSheetH(hgt); });
  grab.addEventListener('pointerup', e => { if (!dragging) return; dragging = false; panel.classList.remove('dragging'); document.body.classList.remove('dragging');
    const frac = panel.getBoundingClientRect().height / innerHeight; const moved = Math.abs(e.clientY - y0) > 6;
    if (!moved) return sheet(sheetState === 'peek' ? 'half' : sheetState === 'half' ? 'full' : 'peek');
    sheet(Object.entries(SNAP).sort((a, b) => Math.abs(a[1] - frac) - Math.abs(b[1] - frac))[0][0]); });
  tabs.addEventListener('click', () => { if (sheetState === 'peek') sheet('half'); });
  addEventListener('resize', () => { sheet(sheetState); map.invalidateSize(); });
  sheet('half');
})();
export { sheet };

/* ---------- start-up ---------- */
(function start() {
  const u = readUrl(), saved = store.get('etm-view'), dates = store.get('etm-date');
  if (u.d || (dates && dates.date)) setDate(u.d || dates.date, u.d2 || (u.d ? null : (dates && dates.compare ? dates.dateB : null)) || null);
  if (u.c) { const [a, b, z] = u.c.split(',').map(Number); map.setView([a, b], z || 10); }
  else if (saved && saved.lat != null) map.setView([saved.lat, saved.lng], Math.max(3, Math.min(17, Math.round(saved.z || 10))));
  let pin = null;
  if (u.p) { const [a, b] = u.p.split(',').map(Number); pin = [a, b]; if (!u.c) map.setView(pin, 11); }
  else if (saved && saved.pin) pin = saved.pin;
  activate(u.lens || 'overview');
  if (pin) setPlace(pin[0], pin[1], '', { skipRecent: true });
  else { toast('Search a place, use your location, or tap the map to begin.', 5000); sheet('peek'); }
})();
