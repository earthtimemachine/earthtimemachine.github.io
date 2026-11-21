// One persistent map shared by every lens.
import { state, emit, rememberView, syncUrl, setPlace } from './core.js';

export const map = L.map('map', { center: [20, 80], zoom: 4, minZoom: 2, maxZoom: 19, zoomControl: false, worldCopyJump: true });
L.control.zoom({ position: 'bottomright' }).addTo(map);

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const labelsPane = map.createPane('labels'); labelsPane.style.zIndex = 450; labelsPane.style.pointerEvents = 'none';
const BASES = {
  satellite: () => L.layerGroup([
    L.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 19, maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }),
    L.tileLayer(`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { pane: 'labels', maxNativeZoom: 19, maxZoom: 19 })]),
  map: () => L.tileLayer(`${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 19, maxZoom: 19, attribution: 'Map © Esri, HERE, Garmin, © OpenStreetMap contributors' }),
  dark: () => L.layerGroup([
    L.tileLayer(`${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 16, maxZoom: 19, attribution: 'Basemap © Esri, HERE, Garmin, © OpenStreetMap contributors' }),
    L.tileLayer(`${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { pane: 'labels', maxNativeZoom: 16, maxZoom: 19 })]),
  relief: () => L.layerGroup([
    L.tileLayer(`${ESRI}/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 13, maxZoom: 19, opacity: .6, attribution: 'Relief © Esri' })]),
  none: () => L.layerGroup(),
};
let baseLayer = null, baseName = null;
export function setBase(name) {
  if (name === baseName) return; baseName = name;
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = BASES[name]().addTo(map); baseLayer.eachLayer?.(l => l.bringToBack?.());
  if (baseLayer.bringToBack) baseLayer.bringToBack();
  document.querySelectorAll('#baseSeg button').forEach(b => b.classList.toggle('on', b.dataset.b === name));
}
export const getBase = () => baseName;

/* base switcher (Map / Satellite / Dark) */
const tools = L.DomUtil.create('div', 'map-tools', document.getElementById('map'));
tools.innerHTML = `<div class="seg" id="baseSeg" role="group" aria-label="Base map"><button data-b="map">Map</button><button data-b="satellite">Satellite</button><button data-b="dark">Dark</button></div>`;
L.DomEvent.disableClickPropagation(tools);
tools.querySelectorAll('button').forEach(b => b.onclick = () => { setBase(b.dataset.b); emit('basechange', b.dataset.b); });
export const mapTools = tools;

/* pin */
const pinIcon = L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
let pinM = null;
export function showPin(p) {
  if (!p) { if (pinM) { map.removeLayer(pinM); pinM = null; } return; }
  if (!pinM) pinM = L.marker([p.lat, p.lng], { icon: pinIcon, draggable: true, zIndexOffset: 2000, keyboard: false })
    .addTo(map).on('dragend', e => { const ll = e.target.getLatLng(); setPlace(ll.lat, ll.lng); });
  else pinM.setLatLng([p.lat, p.lng]);
}
let clickHandler = null;           // a lens may take over map clicks (rare)
export const setClickHandler = fn => { clickHandler = fn; };
map.on('click', e => { if (clickHandler && clickHandler(e) === false) return; setPlace(e.latlng.lat, e.latlng.lng); });

map.on('moveend', () => { const c = map.getCenter(); state.view = { lat: c.lat, lng: c.lng, z: map.getZoom() }; rememberView(); syncUrl(); });

/* per-lens layer groups */
const groups = {};
export function lensGroup(id) { return groups[id] ||= L.layerGroup(); }
export function showLensGroup(id) { Object.entries(groups).forEach(([k, g]) => { if (k === id) g.addTo(map); else map.removeLayer(g); }); lensGroup(id).addTo(map); }

/* simple banner over the map */
const banner = L.DomUtil.create('div', 'map-banner hidden', document.getElementById('map'));
export function mapBanner(text) { banner.textContent = text || ''; banner.classList.toggle('hidden', !text); }

/* ---------- compare swipe between two tile layers ---------- */
const paneL = map.createPane('swipeL'); paneL.style.zIndex = 260;
const paneR = map.createPane('swipeR'); paneR.style.zIndex = 255;
export const SWIPE_PANES = { left: 'swipeL', right: 'swipeR' };
let swipe = null;
export function startSwipe(leftLabel, rightLabel) {
  if (swipe) { swipe.label(leftLabel, rightLabel); return swipe; }
  const host = document.getElementById('map');
  const wrap = L.DomUtil.create('div', 'swipe', host); wrap.innerHTML = '<div class="line"></div><div class="knob" aria-label="Drag to compare">⇆</div>';
  const tagL = L.DomUtil.create('div', 'swipe-tag', host), tagR = L.DomUtil.create('div', 'swipe-tag', host);
  let pct = .5;
  const clip = () => { const s = map.getSize(), nw = map.containerPointToLayerPoint([0, 0]), se = map.containerPointToLayerPoint(s), cx = map.containerPointToLayerPoint([s.x * pct, 0]).x;
    paneL.style.clip = `rect(${nw.y}px, ${cx}px, ${se.y}px, ${nw.x}px)`; wrap.style.left = (pct * 100) + '%';
    tagL.style.left = '10px'; tagR.style.right = '10px'; };
  const knob = wrap.querySelector('.knob'); let drag = false;
  knob.addEventListener('pointerdown', e => { drag = true; knob.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation(); });
  knob.addEventListener('pointermove', e => { if (!drag) return; const r = host.getBoundingClientRect(); pct = Math.min(.97, Math.max(.03, (e.clientX - r.left) / r.width)); clip(); });
  knob.addEventListener('pointerup', () => drag = false);
  L.DomEvent.disableClickPropagation(wrap);
  map.on('move zoom resize viewreset', clip); clip();
  swipe = {
    label(a, b) { tagL.textContent = '◀ ' + a; tagR.textContent = b + ' ▶'; },
    stop() { map.off('move zoom resize viewreset', clip); paneL.style.clip = ''; wrap.remove(); tagL.remove(); tagR.remove(); swipe = null; },
  };
  swipe.label(leftLabel, rightLabel);
  return swipe;
}
export function stopSwipe() { if (swipe) swipe.stop(); }
export const swipeOn = () => !!swipe;

/* small helpers for lenses */
export function emojiIcon(ch, size = 20) { return L.divIcon({ className: '', html: `<div class="emk">${ch}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }); }
export function fitRadius(center, metres) {
  const c = L.circle([center.lat, center.lng], { radius: metres }); map.addLayer(c); const b = c.getBounds(); map.removeLayer(c);
  if (map.getZoom() < 8 || !map.getBounds().contains(b)) map.fitBounds(b, { padding: [24, 24] });
}
export function ensureZoom(p, minZ, maxZ = 19) { const z = map.getZoom(); if (z < minZ) map.setView([p.lat, p.lng], minZ); else if (z > maxZ) map.setView([p.lat, p.lng], maxZ); else if (!map.getBounds().contains([p.lat, p.lng])) map.panTo([p.lat, p.lng]); }
