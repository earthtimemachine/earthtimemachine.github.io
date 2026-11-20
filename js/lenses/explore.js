// Explore lens: notable places (Wikipedia), sights, restaurants and stays (OpenStreetMap).
import { $, $$, esc, state, getJSON, overpass, elLL, km, fmtKm } from '../core.js';
import { map, lensGroup, emojiIcon, fitRadius } from '../map.js';

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5a2 2 0 0 0 2 2M9 3v5a2 2 0 0 1-2 2"/><path d="M17 21V3c-2 1-3 4-3 7a3 3 0 0 0 3 3"/></svg>';
const ICONS = t => t.amenity === 'restaurant' ? '🍽️' : t.amenity === 'cafe' ? '☕' : t.amenity === 'fast_food' ? '🍔' : t.amenity === 'ice_cream' ? '🍦' : t.amenity === 'food_court' ? '🥘' :
  t.tourism === 'hotel' || t.tourism === 'motel' ? '🏨' : t.tourism === 'resort' ? '🏝️' : t.tourism === 'guest_house' || t.tourism === 'hostel' ? '🛏️' : t.tourism === 'museum' ? '🏛️' : t.tourism === 'viewpoint' ? '🔭' : t.tourism === 'zoo' ? '🦁' : t.tourism === 'aquarium' ? '🐠' :
  t.tourism === 'theme_park' || t.leisure === 'water_park' ? '🎢' : t.tourism === 'gallery' ? '🖼️' : t.historic === 'fort' || t.historic === 'castle' ? '🏰' : t.historic === 'temple' || t.religion === 'hindu' ? '🛕' : t.historic ? '🏯' :
  t.natural === 'beach' ? '🏖️' : t.natural === 'waterfall' ? '💧' : t.natural === 'peak' ? '⛰️' : t.natural === 'cave_entrance' ? '🕳️' : t.leisure === 'park' || t.leisure === 'nature_reserve' ? '🌳' : '⭐';
const CAT = t => /^(restaurant|cafe|fast_food|food_court|ice_cream)$/.test(t.amenity || '') ? 'food' : /^(hotel|guest_house|hostel|resort|motel)$/.test(t.tourism || '') ? 'stay' : 'sight';
const KIND = t => ((t.cuisine ? t.cuisine.replace(/_/g, ' ').replace(/;/g, ', ') + ' ' : '') + (t.amenity || t.tourism || t.historic || t.natural || t.leisure || '').replace(/_/g, ' ')).trim();
const isVeg = t => /yes|only/.test(t['diet:vegetarian'] || '') || /vegetarian/.test(t.cuisine || '');

let root, radius = 5000, places = [], cat = 'all', veg = false, gen = 0, circle = null;
const group = lensGroup('explore'), layer = L.layerGroup().addTo(group);
const q = s => $(s, root);

async function run() {
  const p = state.place; if (!p) return; const my = ++gen, LL = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  if (circle) group.removeLayer(circle); circle = L.circle([p.lat, p.lng], { radius, color: '#4fb3bf', weight: 1.5, fill: false, dashArray: '5 5', interactive: false }).addTo(group); fitRadius(p, radius);
  loadWiki(my); q('.list').innerHTML = '<div class="skeleton" style="height:120px"></div>'; layer.clearLayers(); q('.count').textContent = '';
  try {
    const R = radius, j = await overpass(`[out:json][timeout:35];(
      nwr(around:${R},${LL})["tourism"~"^(attraction|museum|viewpoint|zoo|theme_park|gallery|aquarium)$"];nwr(around:${R},${LL})["historic"~"^(monument|memorial|castle|fort|ruins|archaeological_site|temple|tomb|palace|city_gate|monastery)$"]["name"];
      nwr(around:${R},${LL})["natural"~"^(beach|waterfall|peak|cave_entrance)$"]["name"];nwr(around:${R},${LL})["leisure"~"^(park|nature_reserve|water_park)$"]["name"];
      nwr(around:${R},${LL})["amenity"~"^(restaurant|cafe|fast_food|food_court|ice_cream)$"]["name"];nwr(around:${R},${LL})["tourism"~"^(hotel|guest_house|hostel|resort|motel)$"]["name"];
    );out center tags 700;`);
    if (my !== gen) return;
    places = (j.elements || []).map(e => { const ll = elLL(e), t = e.tags || {}, name = t['name:en'] || t.name; if (!ll || !name) return null; return { ll, d: km([p.lat, p.lng], ll), t, name, cat: CAT(t), icon: ICONS(t) }; }).filter(Boolean).sort((a, b) => a.d - b.d);
    draw();
  } catch (e) { if (my === gen) q('.list').innerHTML = '<p class="muted small">Map data is busy right now. Try again in a minute.</p>'; }
}
function links(x) { const g = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(x.name + ' ' + x.ll[0].toFixed(5) + ',' + x.ll[1].toFixed(5))}`, w = x.t.website || x.t['contact:website'];
  return `<a href="${g}" target="_blank" rel="noopener">Reviews and hours</a>${w ? ` · <a href="${esc(w)}" target="_blank" rel="noopener">Website</a>` : ''}${x.t.phone ? ` · ${esc(x.t.phone)}` : ''}`; }
function draw() {
  layer.clearLayers();
  const n = c => places.filter(x => x.cat === c).length, shown = places.filter(x => (cat === 'all' || x.cat === cat) && (!veg || x.cat !== 'food' || isVeg(x.t)));
  const pl = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  q('.count').textContent = places.length ? `${pl(n('sight'), 'sight', 'sights')}, ${pl(n('food'), 'place to eat', 'places to eat')}, ${pl(n('stay'), 'place to stay', 'places to stay')}` : '';
  shown.slice(0, 400).forEach(x => L.marker(x.ll, { icon: emojiIcon(x.icon) }).addTo(layer).bindPopup(`<b>${esc(x.name)}</b><br>${esc(KIND(x.t))}<br>${fmtKm(x.d)} away${x.t.opening_hours ? '<br>Open: ' + esc(x.t.opening_hours) : ''}<br>${links(x)}`));
  q('.list').innerHTML = !places.length ? '<p class="muted small">Nothing mapped within this distance. Try a larger radius.</p>' : !shown.length ? '<p class="muted small">No places match this filter.</p>' :
    `<div class="list">${shown.slice(0, 120).map((x, i) => `<div class="item" data-i="${i}"><span class="ic">${x.icon}</span><div style="min-width:0"><div class="t">${esc(x.name)}</div>
      <div class="m">${esc(KIND(x.t))}${isVeg(x.t) && x.cat === 'food' ? ' · vegetarian' : ''} · ${fmtKm(x.d)}${x.t.opening_hours ? ' · ' + esc(x.t.opening_hours).slice(0, 50) : ''}</div><div class="m">${links(x)}</div></div></div>`).join('')}</div>${shown.length > 120 ? `<p class="muted small">…and ${shown.length - 120} more on the map.</p>` : ''}`;
  $$('.list .item', root).forEach(el => el.onclick = e => { if (e.target.tagName === 'A') return; map.setView(shown[+el.dataset.i].ll, Math.max(map.getZoom(), 16)); });
}
export async function notablePlaces(p, R = 10000) {
  const j = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${p.lat.toFixed(5)}%7C${p.lng.toFixed(5)}&ggsradius=${Math.min(R, 10000)}&ggslimit=25&prop=coordinates%7Cpageimages%7Cdescription&piprop=thumbnail&pithumbsize=240&format=json&origin=*`, { ttl: 864e5 });
  return Object.values(j.query?.pages || {}).filter(x => x.coordinates && !/^(List of|Template:)/.test(x.title)).map(x => ({ ...x, d: km([p.lat, p.lng], [x.coordinates[0].lat, x.coordinates[0].lon]) }))
    .sort((a, b) => (b.thumbnail ? 1 : 0) - (a.thumbnail ? 1 : 0) || a.d - b.d).slice(0, 20);
}
async function loadWiki(my) {
  q('.wiki').innerHTML = '<div class="skeleton" style="width:100%;height:150px"></div>';
  try { const pages = await notablePlaces(state.place, radius); if (my !== gen) return;
    q('.wiki').innerHTML = pages.length ? pages.map(x => `<a class="card" style="width:150px" href="https://en.m.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g, '_'))}" target="_blank" rel="noopener">
      ${x.thumbnail ? `<img src="${esc(x.thumbnail.source)}" alt="" loading="lazy" style="width:150px;height:96px;object-fit:cover;display:block">` : '<div style="width:150px;height:96px;display:grid;place-items:center;font-size:26px;background:var(--shelf-2)">📖</div>'}
      <div class="cap"><b>${esc(x.title)}</b><span>${esc((x.description || '').slice(0, 56))}${x.description ? ' · ' : ''}${fmtKm(x.d)}</span></div></a>`).join('') : '<p class="muted small">No Wikipedia articles about places nearby.</p>';
  } catch (e) { if (my === gen) q('.wiki').innerHTML = '<p class="muted small">Wikipedia is not responding right now.</p>'; }
}

export default {
  id: 'explore', title: 'Explore', icon: ICON, base: 'map', desc: 'Sights, restaurants and places to stay',
  init(el) {
    root = el;
    el.innerHTML = `
      <div class="sec"><h2>Notable places <span class="aside">from Wikipedia</span></h2><div class="hscroll wiki"><p class="muted small">Pick a place.</p></div></div>
      <div class="sec"><div class="row" style="margin-bottom:10px"><h2 style="margin:0">Nearby</h2><span class="grow"></span>
          <select class="btn rad" aria-label="Distance"><option value="2000">2 km</option><option value="5000" selected>5 km</option><option value="10000">10 km</option><option value="25000">25 km</option></select></div>
        <div class="row" style="margin-bottom:8px"><div class="chips cats"><button class="chip on" data-c="all">All</button><button class="chip" data-c="sight">Sights</button><button class="chip" data-c="food">Food</button><button class="chip" data-c="stay">Stay</button><button class="chip vegc">Vegetarian</button></div></div>
        <p class="count note" style="margin:0 0 6px"></p><div class="list"><p class="muted small">Pick a place.</p></div></div>
      <div class="sec note">Places from <a href="https://www.openstreetmap.org/" target="_blank" rel="noopener">OpenStreetMap</a> contributors and Wikipedia. Hours are added by volunteers and may be out of date: check "Reviews and hours" before you go.</div>`;
    q('.rad').onchange = e => { radius = +e.target.value; run(); };
    $$('.cats [data-c]', el).forEach(c => c.onclick = () => { cat = c.dataset.c; $$('.cats [data-c]', el).forEach(x => x.classList.toggle('on', x === c)); draw(); });
    q('.vegc').onclick = () => { veg = !veg; q('.vegc').classList.toggle('on', veg); draw(); };
  },
  update(place) { if (!place) return; const k = `${place.lat},${place.lng}`; if (this._k === k) return; this._k = k; run(); },
};
