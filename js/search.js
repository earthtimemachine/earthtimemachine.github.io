// Place search shared by the top bar, the home page and the Routes tab.
// Google Places Autocomplete (New) when a key is set in config.js; otherwise Photon (OpenStreetMap,
// typo-tolerant, search-as-you-type, biased to the map view), falling back to Nominatim.
import CONFIG from './config.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cache = new Map();
async function j(url, init, ms = 12000) {
  const key = init ? null : url; if (key && cache.has(key)) return cache.get(key);
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { ...init, signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); const o = await r.json(); if (key) cache.set(key, o); return o; }
  finally { clearTimeout(t); }
}
export const provider = () => (CONFIG.googleMapsKey ? 'google' : 'osm');

const ZOOM = { country: 5, state: 7, region: 7, county: 9, district: 12, city: 11, town: 12, municipality: 11, village: 14, locality: 14, suburb: 14, hamlet: 15, street: 16, house: 17 };
const KIND = { country: 'Country', state: 'State', county: 'District', city: 'City', town: 'Town', village: 'Village', hamlet: 'Hamlet', suburb: 'Area', locality: 'Locality', district: 'Area', street: 'Street', house: 'Address' };

/* ---------- Google ---------- */
let gSession = null;
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
async function google(text, near) {
  gSession ||= uuid();
  const body = { input: text, sessionToken: gSession, languageCode: 'en' };
  if (near) body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 } };
  const r = await j('https://places.googleapis.com/v1/places:autocomplete', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': CONFIG.googleMapsKey }, body: JSON.stringify(body) });
  return (r.suggestions || []).filter(s => s.placePrediction).map(s => { const p = s.placePrediction, f = p.structuredFormat || {};
    return { name: f.mainText?.text || p.text?.text, sub: f.secondaryText?.text || '', placeId: p.placeId, kind: (p.types || [])[0]?.replace(/_/g, ' ') || '', provider: 'google' }; });
}
async function googleDetails(it) {
  const r = await j(`https://places.googleapis.com/v1/places/${encodeURIComponent(it.placeId)}?sessionToken=${gSession || ''}&languageCode=en`, { headers: { 'X-Goog-Api-Key': CONFIG.googleMapsKey, 'X-Goog-FieldMask': 'location,displayName,types,viewport' } });
  gSession = null;
  const t = r.types || [], z = t.includes('country') ? 5 : t.includes('administrative_area_level_1') ? 7 : t.includes('administrative_area_level_2') ? 9 : t.includes('locality') ? 12 : t.some(x => /sublocality|neighborhood/.test(x)) ? 14 : t.includes('route') ? 16 : 16;
  return { ...it, lat: r.location.latitude, lng: r.location.longitude, name: r.displayName?.text || it.name, zoom: z };
}

/* ---------- OpenStreetMap ---------- */
async function photon(text, near) {
  const u = `https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=8&lang=en${near ? `&lat=${near.lat.toFixed(3)}&lon=${near.lng.toFixed(3)}&zoom=${Math.round(near.z || 8)}&location_bias_scale=0.2` : ''}`;
  const r = await j(u);
  const seen = new Set();
  return (r.features || []).map(f => { const p = f.properties || {}, [lng, lat] = f.geometry.coordinates;
    const name = p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || p.city || p.county;
    const type = p.type || p.osm_value || '';
    const sub = [p.name && p.street && p.name !== p.street ? p.street : '', p.district !== name ? p.district : '', p.city !== name ? p.city : '', p.county !== name ? p.county : '', p.state !== name ? p.state : '', p.country !== name ? p.country : ''].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    const poi = !ZOOM[type] && p.osm_key && !/^(place|boundary|highway)$/.test(p.osm_key);
    return { name, sub, lat, lng, zoom: (p.osm_key === 'place' && ZOOM[p.osm_value]) || ZOOM[type] || (poi ? 16 : 13), kind: (p.osm_key === 'place' && KIND[p.osm_value]) || KIND[type] || (poi ? (p.osm_value || '').replace(/_/g, ' ') : ''), cc: p.countrycode, provider: 'osm' };
  }).filter(x => { const k = x.name + '|' + x.sub; if (!x.name || seen.has(k)) return false; seen.add(k); return true; });
}
async function nominatim(text) {
  const r = await j(`https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=en&q=${encodeURIComponent(text)}`);
  return (r || []).map(x => { const parts = x.display_name.split(','); return { name: parts[0], sub: parts.slice(1, 4).join(',').trim(), lat: +x.lat, lng: +x.lon, zoom: ZOOM[x.type] || (x.class === 'boundary' ? 10 : 13), kind: KIND[x.type] || '', provider: 'osm' }; });
}

const COORD = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
export async function searchPlaces(text, near) {
  const m = COORD.exec(text); if (m) return [{ name: `${(+m[1]).toFixed(5)}, ${(+m[2]).toFixed(5)}`, sub: 'Coordinates', lat: +m[1], lng: +m[2], zoom: 14, coord: true }];
  if (provider() === 'google') { try { const g = await google(text, near); if (g.length) return g; } catch (e) { console.warn('Google search failed, using OpenStreetMap', e); } }
  try { const p = await photon(text, near); if (p.length) return p; } catch (e) { /* fall through */ }
  return nominatim(text);
}
export async function resolvePlace(it) { return it.placeId && it.lat == null ? googleDetails(it) : it; }

/* ---------- dropdown UI ---------- */
// attachSearch(input, box, onPick, { near: () => ({lat,lng,z}), recent: () => [{name,lat,lng}] })
export function attachSearch(input, box, onPick, opts = {}) {
  let list = [], timer, seq = 0;
  const hide = () => { box.classList.add('hidden'); box.innerHTML = ''; };
  const render = (items, msg, head) => {
    list = items;
    box.innerHTML = (head ? `<div class="sr-head">${esc(head)}</div>` : '') + (items.length ? items.map((it, i) => `<button type="button" role="option" data-i="${i}"><span class="sr-n">${esc(it.name)}${it.kind ? ` <em>${esc(it.kind)}</em>` : ''}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`).join('') : `<div class="sr-msg">${esc(msg || 'No places found. Try a nearby town or check the spelling.')}</div>`)
      + (items.length && items[0].provider === 'google' ? '<div class="sr-foot">Search by Google</div>' : '');
    box.classList.remove('hidden');
    box.querySelectorAll('button[data-i]').forEach(b => b.onmousedown = e => e.preventDefault());
    box.querySelectorAll('button[data-i]').forEach(b => b.onclick = () => pick(list[+b.dataset.i]));
  };
  async function pick(it) {
    hide(); input.blur();
    try { const r = await resolvePlace(it); onPick(r); } catch (e) { render([], 'Could not open that place. Try another result.'); }
  }
  input.addEventListener('input', () => {
    clearTimeout(timer); const v = input.value.trim(), my = ++seq;
    if (v.length < 2) { showRecent(); return; }
    timer = setTimeout(async () => {
      box.innerHTML = '<div class="sr-msg">Searching…</div>'; box.classList.remove('hidden');
      try { const r = await searchPlaces(v, opts.near?.()); if (my === seq) render(r); }
      catch (e) { if (my === seq) render([], 'Place search is not responding. Paste coordinates instead, like 17.38, 78.48.'); }
    }, provider() === 'google' ? 200 : 280);
  });
  function showRecent() {
    const r = (opts.recent?.() || []).slice(0, 5).map(x => ({ ...x, sub: 'Recent', zoom: 13, provider: 'recent' }));
    if (r.length) render(r, '', ''); else hide();
  }
  input.addEventListener('focus', () => { if (!input.value.trim()) showRecent(); });
  input.addEventListener('blur', () => setTimeout(() => { if (!box.contains(document.activeElement) && document.activeElement !== input) hide(); }, 180));
  box.addEventListener('focusout', () => setTimeout(() => { if (!box.contains(document.activeElement) && document.activeElement !== input) hide(); }, 180));
  input.addEventListener('keydown', e => {
    const btns = [...box.querySelectorAll('button[data-i]')];
    if (e.key === 'Enter') { e.preventDefault(); if (btns[0]) btns[0].click(); }
    if (e.key === 'ArrowDown' && btns[0]) { e.preventDefault(); btns[0].focus(); }
    if (e.key === 'Escape') hide();
  });
  box.addEventListener('keydown', e => { const b = [...box.querySelectorAll('button[data-i]')], i = b.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i < b.length - 1) { e.preventDefault(); b[i + 1].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); i > 0 ? b[i - 1].focus() : input.focus(); }
    if (e.key === 'Escape') { hide(); input.focus(); } });
  return { hide };
}
