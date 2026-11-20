// Overview lens: a one-screen summary of the place, linking into every other lens.
import { $, $$, esc, state, getJSON, fmtDate, fmtDay, fmtYear, addMonths, today, km } from '../core.js';
import { map, lensGroup, ensureZoom } from '../map.js';
import { getSlice, featureAt } from './history.js';
import { topCrops } from './economy.js';
import { notablePlaces } from './explore.js';
import { gdelt, sortArticles, localQuery } from './news.js';
import { aqiFrom, aqCat } from './hazards.js';

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>';
const WXT = c => c == null ? '' : c === 0 ? 'Clear' : c <= 2 ? 'Partly cloudy' : c === 3 ? 'Overcast' : c <= 48 ? 'Fog' : c <= 57 ? 'Drizzle' : c <= 67 ? 'Rain' : c <= 77 ? 'Snow' : c <= 82 ? 'Showers' : c <= 86 ? 'Snow showers' : 'Thunderstorm';
const WXI = c => c == null ? '' : c === 0 ? '☀️' : c <= 2 ? '🌤️' : c === 3 ? '☁️' : c <= 48 ? '🌫️' : c <= 57 ? '🌦️' : c <= 67 ? '🌧️' : c <= 77 ? '🌨️' : c <= 82 ? '🌧️' : c <= 86 ? '🌨️' : '⛈️';
const ERAS = [2010, 1878, 1700, 1492, 1200, 1000, 600, 400, -200];
let root, gen = 0;
lensGroup('overview');
const q = s => $(s, root);
const go = id => window.ETM && window.ETM.openLens(id);

function skeleton() {
  return `
    <div class="sec"><div class="facts">
      <div class="fact now"><div class="skeleton" style="height:44px"></div></div><div class="fact air"><div class="skeleton" style="height:44px"></div></div>
      <div class="fact elev"><div class="skeleton" style="height:44px"></div></div><div class="fact sun"><div class="skeleton" style="height:44px"></div></div></div></div>
    <div class="sec"><h2>Alerts <span class="aside"><a href="#" data-go="hazards">Full outlook</a></span></h2><div class="alerts ov-alerts"><div class="skeleton" style="height:38px"></div></div></div>
    <div class="sec"><h2>Latest satellite view <span class="aside"><a href="#" data-go="imagery">All imagery</a></span></h2><div class="ov-sat row" style="align-items:flex-start;flex-wrap:nowrap"><div class="skeleton" style="width:120px;height:120px"></div></div></div>
    <div class="sec"><h2>Through time <span class="aside"><a href="#" data-go="history">Full history</a></span></h2><div class="ov-hist"><div class="skeleton" style="height:40px"></div></div></div>
    <div class="sec"><div class="tiles">
      <a class="tile" href="#" data-go="economy"><h3>🌾 Main crops</h3><div class="ov-crops"><div class="skeleton" style="height:50px"></div></div></a>
      <a class="tile" href="#" data-go="explore"><h3>📍 Worth seeing</h3><div class="ov-see"><div class="skeleton" style="height:50px"></div></div></a></div></div>
    <div class="sec"><h2>In the news <span class="aside"><a href="#" data-go="news">More news</a></span></h2><div class="ov-news"><div class="skeleton" style="height:60px"></div></div></div>`;
}
function wire() { $$('[data-go]', root).forEach(a => a.onclick = e => { e.preventDefault(); go(a.dataset.go); }); }

async function weather(my) {
  const p = state.place;
  try {
    const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(3)}&longitude=${p.lng.toFixed(3)}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&daily=weather_code,temperature_2m_max,precipitation_sum,wind_gusts_10m_max,sunrise,sunset&forecast_days=10&timezone=auto`, { ttl: 20 * 60e3 });
    if (my !== gen) return;
    const c = j.current || {}, D = j.daily;
    q('.now').innerHTML = `<div class="v">${WXI(c.weather_code)} ${Math.round(c.temperature_2m)}°C</div><div class="l">${WXT(c.weather_code)}, feels ${Math.round(c.apparent_temperature)}° · wind ${Math.round(c.wind_speed_10m)} km/h</div>`;
    q('.elev').innerHTML = `<div class="v">${Math.round(j.elevation)} m</div><div class="l">above sea level</div>`;
    const t = s => s ? s.slice(11, 16) : '–', lt = new Date().toLocaleTimeString('en-GB', { timeZone: j.timezone, hour: '2-digit', minute: '2-digit' });
    q('.sun').innerHTML = `<div class="v">${lt}</div><div class="l">local time · sun ${t(D.sunrise[0])}–${t(D.sunset[0])}</div>`;
    const out = [];
    D.time.forEach((d, i) => { const r = D.precipitation_sum[i], g = D.wind_gusts_10m_max[i], tx = D.temperature_2m_max[i];
      if (r >= 64.5) out.push(['rain', '🌧️', `${r >= 204.5 ? 'Extremely heavy' : r >= 115.6 ? 'Very heavy' : 'Heavy'} rain ${fmtDay(d)}, about ${Math.round(r)} mm`]);
      if (g >= 62) out.push([g >= 89 ? 'sev' : 'wind', '💨', `${g >= 89 ? 'Severe' : 'Gale-force'} winds ${fmtDay(d)}, gusts to ${Math.round(g)} km/h`]);
      if (tx >= 40) out.push([tx >= 45 ? 'sev' : 'hot', '🔥', `Very hot ${fmtDay(d)}, up to ${Math.round(tx)}°C`]); });
    try {
      const now = new Date(), from = new Date(Date.now() - 10 * 864e5), y = d => d.toISOString().slice(0, 10);
      const g = await getJSON(`https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&fromdate=${y(from)}&todate=${y(now)}&alertlevel=green;orange;red`, { ttl: 15 * 60e3 });
      (g.features || []).filter(f => String(f.properties?.iscurrent).toLowerCase() === 'true' && f.geometry).forEach(f => { const d = km(p, { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] });
        if (d < 1200) out.unshift([d < 300 ? 'sev' : 'hot', '🌀', `Cyclone ${(f.properties.eventname || '').replace(/^Tropical Cyclone\s*/i, '')} about ${Math.round(d)} km away`]); });
    } catch (e) { }
    if (my !== gen) return;
    const seen = new Set(), list = out.filter(a => { const k = a[2].split(' ')[0] + a[0]; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3);
    q('.ov-alerts').innerHTML = list.length ? list.map(([c, i, t]) => `<div class="al ${c}"><span class="ic">${i}</span><span>${esc(t)}</span></div>`).join('') : '<div class="al ok"><span class="ic">✓</span><span>No major weather alert in the next 10 days. The Hazards lens adds heat waves, floods, fires and air quality.</span></div>';
  } catch (e) { if (my === gen) { q('.now').innerHTML = '<div class="l">Weather not available right now.</div>'; q('.ov-alerts').innerHTML = '<p class="muted small">The forecast is not responding. Try again shortly.</p>'; } }
}
async function air(my) {
  const p = state.place;
  try { const j = await getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${p.lat.toFixed(3)}&longitude=${p.lng.toFixed(3)}&current=pm2_5,pm10&timezone=auto`, { ttl: 36e5 }); if (my !== gen) return;
    const v = aqiFrom(j.current?.pm2_5, j.current?.pm10), c = aqCat(v); q('.air').innerHTML = `<div class="v" style="color:${c[2]}">AQI ${v}</div><div class="l">air quality: ${c[1].toLowerCase()} (India scale, model estimate)</div>`;
  } catch (e) { if (my === gen) q('.air').innerHTML = '<div class="l">Air quality not available right now.</div>'; }
}
async function satellite(my) {
  const p = state.place, box = q('.ov-sat');
  try {
    const body = { collections: ['sentinel-2-l2a'], intersects: { type: 'Point', coordinates: [p.lng, p.lat] }, datetime: addMonths(today(), -3) + 'T00:00:00Z/..', limit: 30, query: { 'eo:cloud_cover': { lt: 25 } }, sortby: [{ field: 'datetime', direction: 'desc' }] };
    const j = await getJSON('https://planetarycomputer.microsoft.com/api/stac/v1/search', { ttl: 36e5, init: { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } });
    if (my !== gen) return; const f = (j.features || [])[0];
    if (!f) { box.innerHTML = '<p class="muted small">No clear Sentinel-2 pass in the last 3 months (cloudy season). See all imagery for older passes.</p>'; return; }
    const z = 13, n = 2 ** z, lat = p.lat * Math.PI / 180, x = (p.lng + 180) / 360 * n, y = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * n;
    const tile = (tx, ty) => `https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad/${z}/${tx}/${ty}@1x?collection=sentinel-2-l2a&item=${encodeURIComponent(f.id)}&assets=visual&asset_bidx=visual%7C1%2C2%2C3&nodata=0&format=png`;
    const size = 120, half = size / 2; let imgs = '';
    for (let tx = Math.floor(x - half / 256); tx <= Math.floor(x + half / 256); tx++) for (let ty = Math.floor(y - half / 256); ty <= Math.floor(y + half / 256); ty++) imgs += `<img alt="" src="${tile(tx, ty)}" style="left:${half + (tx - x) * 256}px;top:${half + (ty - y) * 256}px">`;
    const d = f.properties.datetime.slice(0, 10);
    box.innerHTML = `<a href="#" data-go="imagery" class="card" style="flex-shrink:0"><div class="tile-view" style="width:${size}px;height:${size}px">${imgs}<i class="xh"></i></div></a>
      <div style="margin-left:12px"><b>${fmtDate(d)}</b><p class="note" style="margin:2px 0 6px">Sentinel-2 pass, 10 m detail, ${Math.round(f.properties['eo:cloud_cover'])}% cloud over the whole scene.</p><a href="#" data-go="imagery">Watch this spot change over time</a></div>`;
    wire();
  } catch (e) { if (my === gen) box.innerHTML = '<p class="muted small">Satellite search is not responding right now.</p>'; }
}
async function history(my) {
  const p = state.place, pt = [p.lng, p.lat];
  try { const hits = await Promise.all(ERAS.map(async y => { const f = featureAt(await getSlice(y), pt); return f ? { y, n: f.properties.NAME } : null; }));
    if (my !== gen) return;
    const chain = []; hits.filter(Boolean).forEach(h => { if (!chain.length || chain[chain.length - 1].n !== h.n) chain.push(h); });
    q('.ov-hist').innerHTML = chain.length ? `<p style="margin:0">${chain.map((c, i) => `<b${i ? '' : ' style="color:var(--ochre)"'}>${esc(c.n)}</b> <span class="muted small">${fmtYear(c.y)}</span>`).join(' <span class="muted">←</span> ')}</p><p class="note" style="margin:6px 0 0">Snapshots from historical world maps. The History lens shows every era, with currency and capital.</p>` : '<p class="muted small">No historical states recorded here.</p>';
  } catch (e) { if (my === gen) q('.ov-hist').innerHTML = '<p class="muted small">Historical maps could not be loaded.</p>'; }
}
async function crops(my) {
  try { const { top } = await topCrops(state.place.admin || {}); if (my !== gen) return; q('.ov-crops').innerHTML = top.length ? `<ol>${top.map(t => `<li>${esc(t)}</li>`).join('')}</ol>` : '<div class="m">No crop information found.</div>'; }
  catch (e) { if (my === gen) q('.ov-crops').innerHTML = '<div class="m">Not available right now.</div>'; }
}
async function sights(my) {
  try { const pages = (await notablePlaces(state.place, 10000)).slice(0, 3); if (my !== gen) return; q('.ov-see').innerHTML = pages.length ? `<ol>${pages.map(x => `<li>${esc(x.title)}</li>`).join('')}</ol>` : '<div class="m">No notable places listed nearby.</div>'; }
  catch (e) { if (my === gen) q('.ov-see').innerHTML = '<div class="m">Not available right now.</div>'; }
}
async function headlines(my) {
  const a = state.place.admin || {}, name = a.local || a.district; if (!name) { q('.ov-news').innerHTML = '<p class="muted small">No place name to search news for.</p>'; return; }
  try {
    const end = today(), start = addMonths(end, -1);
    let { main } = sortArticles(await gdelt(localQuery(name, a, 'sourcelang:english'), start, end, 60), name);
    let label = name;
    if (!main.length && a.district && a.district !== name) { label = a.district; ({ main } = sortArticles(await gdelt(localQuery(a.district, a, 'sourcelang:english'), start, end, 60), a.district)); }
    if (my !== gen) return;
    q('.ov-news').innerHTML = main.length ? `<div class="list">${main.slice(0, 3).map(x => `<a class="item" href="${esc(x.url)}" target="_blank" rel="noopener"><div style="min-width:0"><div class="t">${esc(x.title)}</div><div class="m">${esc(x.domain || '')}${x.iso ? ' · ' + fmtDate(x.iso.slice(0, 10)) : ''}</div></div></a>`).join('')}</div>`
      : `<p class="muted small">No local headlines about ${esc(label)} in the past month.</p>`;
  } catch (e) { if (my === gen) q('.ov-news').innerHTML = '<p class="muted small">The news service is busy. Open the News lens to try again.</p>'; }
}

export default {
  id: 'overview', title: 'Overview', icon: ICON, base: 'satellite', desc: 'A summary of this place',
  init(el) { root = el; el.innerHTML = `<div class="empty"><b>Pick any place on Earth</b>Search above, use your location, or tap the map. This page then sums up the place: weather and alerts, the latest satellite view, who ruled it, what it grows, what to see and what's in the news.</div>`; },
  show() { if (state.place) ensureZoom(state.place, 9, 15); },
  update(place) {
    if (!place) return;
    const k = `${place.lat},${place.lng}`;
    if (this._k !== k) { this._k = k; this._info = false; const my = ++gen; root.innerHTML = skeleton(); wire(); ensureZoom(place, 9, 15); weather(my); air(my); satellite(my); history(my); }
    if (place.admin && !this._info) { this._info = true; const my = gen; crops(my); sights(my); headlines(my); }
  },
};
