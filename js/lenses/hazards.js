// Hazards lens: cyclones, 16-day outlook (heat waves, wind, rain, flash floods, fire weather), rivers, wildfires, air quality.
import { $, $$, esc, state, on, getJSON, km, fmtKm, fmtDay, fmtDate, today, addDays } from '../core.js';
import { map, lensGroup, emojiIcon } from '../map.js';

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="2"/><path d="M12 4c-5 0-8 3-8 6M20 12c0 5-3 8-6 8M12 20c5 0 8-3 8-6M4 12c0-5 3-8 6-8"/></svg>';
const ALERT_COL = { red: '#ff5a4f', orange: '#ff9f2e', green: '#66d19e' };
const GDACS = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH';
const GIBS3857 = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', GIBS4326 = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
const FIRE_LAYERS = ['VIIRS_NOAA20_Thermal_Anomalies_375m_All', 'VIIRS_SNPP_Thermal_Anomalies_375m_All'];
const THR = { plains: 40, coastal: 37, hills: 30 };
const SAT = 0.38;
const ymd = d => d.toISOString().slice(0, 10);
const localDayN = n => { const d = new Date(Date.now() - n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

let root, terrain = 'plains', storms = [], floods = [], fires = [], fc = null, normals = null, relief = null, river = null, aq = null, fireCount = null, gen = 0, gdacsLoaded = 0;
const group = lensGroup('hazards');
const tcLayer = L.layerGroup().addTo(group), evLayer = L.layerGroup().addTo(group), fireLayer = L.layerGroup();
const firePane = map.createPane('fires'); firePane.style.zIndex = 420;
[1, 0].forEach(n => FIRE_LAYERS.forEach(id => L.tileLayer.wms(GIBS3857, { layers: id, format: 'image/png', transparent: true, version: '1.1.1', time: localDayN(n), pane: 'fires', tileSize: 512, maxZoom: 19 }).addTo(fireLayer)));
fireLayer.addTo(group);
const q = s => $(s, root);

/* ---------- GDACS events: cyclones, floods, wildfires ---------- */
async function gdacs(type, days) {
  const now = new Date(), from = new Date(Date.now() - days * 864e5);
  const j = await getJSON(`${GDACS}?eventlist=${type}&fromdate=${ymd(from)}&todate=${ymd(now)}&alertlevel=green;orange;red`, { ttl: 15 * 60e3 });
  return (j.features || []).filter(f => { const p = f.properties || {}; return String(p.iscurrent).toLowerCase() === 'true' || (p.todate && Date.now() - Date.parse(p.todate) < 2 * 864e5); });
}
async function loadEvents() {
  if (Date.now() - gdacsLoaded < 10 * 60e3) return; gdacsLoaded = Date.now();
  tcLayer.clearLayers(); evLayer.clearLayers();
  try {
    const tc = await gdacs('TC', 10), byId = new Map();
    tc.forEach(f => { const id = f.properties.eventid, cur = byId.get(id); if (!cur || (+f.properties.episodeid || 0) > (+cur.properties.episodeid || 0)) byId.set(id, f); });
    storms = [...byId.values()].filter(f => f.geometry).map(f => { const p = f.properties, c = f.geometry.coordinates;
      return { name: (p.eventname || p.name || 'Cyclone').replace(/^Tropical Cyclone\s*/i, ''), alert: (p.alertlevel || 'green').toLowerCase(), lat: c[1], lng: c[0],
        wind: p.severitydata ? Math.round(+p.severitydata.severity) : null, unit: p.severitydata ? (p.severitydata.severityunit || 'km/h') : '', text: p.severitydata ? p.severitydata.severitytext : '',
        country: p.country || '', geomUrl: p.url && p.url.geometry, report: p.url && p.url.report, points: [] }; });
    storms.forEach(s => {
      L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html: `<div class="tc-icon" style="background:${ALERT_COL[s.alert] || ALERT_COL.green}">🌀</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }) })
        .addTo(tcLayer).bindPopup(`<b>${esc(s.name)}</b><br>${esc(s.text || '')}${s.country ? '<br>Affects: ' + esc(s.country) : ''}${s.report ? `<br><a href="${esc(s.report)}" target="_blank" rel="noopener">GDACS report</a>` : ''}`);
      if (s.geomUrl) loadTrack(s);
    });
  } catch (e) { storms = null; }
  try {
    floods = (await gdacs('FL', 21)).map(f => ({ kind: 'flood', lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], alert: (f.properties.alertlevel || 'green').toLowerCase(), country: f.properties.country || '', desc: f.properties.description || 'Flood', report: f.properties.url && f.properties.url.report }));
    fires = (await gdacs('WF', 14)).map(f => ({ kind: 'fire', lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], alert: (f.properties.alertlevel || 'green').toLowerCase(), country: f.properties.country || '', desc: f.properties.description || 'Wildfire', report: f.properties.url && f.properties.url.report }));
    [...floods, ...fires].forEach(e => L.marker([e.lat, e.lng], { icon: emojiIcon(e.kind === 'flood' ? '🌊' : '🔥', 22) }).addTo(evLayer)
      .bindPopup(`<b>${esc(e.desc)}</b>${e.country ? '<br>' + esc(e.country) : ''}<br>GDACS alert: ${esc(e.alert)}${e.report ? `<br><a href="${esc(e.report)}" target="_blank" rel="noopener">GDACS report</a>` : ''}`));
  } catch (e) { }
  drawStorms(); drawAlerts();
}
const dateKey = /date|time|valid/i;
const propDate = p => { for (const k in p) if (dateKey.test(k) && p[k] && !isNaN(Date.parse(p[k]))) return p[k]; return null; };
async function loadTrack(s) {
  try {
    const g = await getJSON(s.geomUrl, { ttl: 15 * 60e3 }), col = ALERT_COL[s.alert] || ALERT_COL.green;
    L.geoJSON(g, {
      style: f => { const t = JSON.stringify(f.properties || {}).toLowerCase(), c = /red/.test(t) ? ALERT_COL.red : /orange/.test(t) ? ALERT_COL.orange : /green/.test(t) ? ALERT_COL.green : col;
        return f.geometry.type.includes('Polygon') ? { color: c, weight: 1, fillColor: c, fillOpacity: .12 } : { color: '#fff', weight: 2, dashArray: /forecast/.test(t) ? '5 5' : null }; },
      pointToLayer: (f, ll) => { s.points.push({ lat: ll.lat, lng: ll.lng, date: propDate(f.properties || {}) }); return L.circleMarker(ll, { radius: 3.5, color: '#fff', weight: 1, fillColor: col, fillOpacity: 1 }); },
      onEachFeature: (f, l) => { const d = propDate(f.properties || {}); if (d) l.bindTooltip(`${esc(s.name)}: ${new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`); },
    }).addTo(tcLayer);
    drawAlerts();
  } catch (e) { }
}
function drawStorms() {
  const box = q('.storms');
  if (storms === null) { box.innerHTML = '<span class="muted small">The cyclone feed is not responding. See <a href="https://www.gdacs.org/" target="_blank" rel="noopener">GDACS</a> or <a href="https://rsmcnewdelhi.imd.gov.in/" target="_blank" rel="noopener">IMD</a>.</span>'; return; }
  if (!storms.length) { box.innerHTML = '<span class="muted small">No tropical cyclones active anywhere right now.</span>'; return; }
  box.innerHTML = storms.map((s, i) => `<button class="chip" data-i="${i}"><span style="color:${ALERT_COL[s.alert]}">●</span> ${esc(s.name)}${s.wind ? ` · ${s.wind} ${esc(s.unit)}` : ''}</button>`).join('');
  $$('.chip', box).forEach(b => b.onclick = () => { const s = storms[+b.dataset.i]; map.flyTo([s.lat, s.lng], 5); });
}

/* ---------- forecast, normals, terrain ---------- */
async function loadPlace(my) {
  const p = state.place, lat = p.lat.toFixed(3), lng = p.lng.toFixed(3);
  fc = normals = relief = river = aq = fireCount = null; drawAll();
  const tasks = [
    getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max&hourly=precipitation,soil_moisture_3_to_9cm,relative_humidity_2m&forecast_days=16&timezone=auto`, { ttl: 30 * 60e3 })
      .then(j => { if (my !== gen) return; fc = j; if (j.elevation > 900 && terrain === 'plains') { terrain = 'hills'; q('.terrain').value = 'hills'; } drawAll(); })
      .catch(() => { if (my === gen) { fc = false; drawAll(); } }),
    getJSON(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=1991-01-01&end_date=2020-12-31&daily=temperature_2m_max&timezone=auto`, { ttl: 864e5 * 30, timeout: 40000 })
      .then(j => { if (my !== gen) return; normals = climNormals(j.daily); drawAll(); }).catch(() => { }),
    (async () => { const la = [], lo = [], d = 0.02; for (const a of [-d, 0, d]) for (const b of [-d, 0, d]) { la.push((+lat + a).toFixed(4)); lo.push((+lng + b).toFixed(4)); }
      const j = await getJSON(`https://api.open-meteo.com/v1/elevation?latitude=${la}&longitude=${lo}`, { ttl: 864e5 }); if (my !== gen) return; const e = (j.elevation || []).filter(v => v != null); relief = e.length ? Math.max(...e) - Math.min(...e) : null; drawAll(); })().catch(() => { }),
    loadRiver(my, lat, lng), loadAir(my, lat, lng), checkFires(my),
  ];
  await Promise.allSettled(tasks);
}
function climNormals(d) {
  const sum = new Array(366).fill(0), cnt = new Array(366).fill(0);
  d.time.forEach((t, i) => { const v = d.temperature_2m_max[i]; if (v == null) return; const k = doy(t); sum[k] += v; cnt[k]++; });
  const raw = sum.map((s, i) => cnt[i] ? s / cnt[i] : null);
  return raw.map((_, i) => { let s = 0, n = 0; for (let k = -7; k <= 7; k++) { const v = raw[(i + k + 366) % 366]; if (v != null) { s += v; n++; } } return n ? s / n : null; });
}
const doy = s => { const d = new Date(s + 'T00:00:00Z'); return Math.min(365, Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5)); };
function classifyHeat(t, dep) { if (t == null || t < THR[terrain]) return null; if (terrain === 'plains' && t >= 47) return 'shw'; if (dep != null && dep > 6.4) return 'shw'; if (terrain === 'plains' && t >= 45) return 'hw'; if (dep != null && dep >= 4.5) return 'hw'; return null; }
const WX = c => c == null ? '·' : c === 0 ? '☀️' : c <= 2 ? '🌤️' : c === 3 ? '☁️' : c <= 48 ? '🌫️' : c <= 57 ? '🌦️' : c <= 67 ? '🌧️' : c <= 77 ? '🌨️' : c <= 82 ? '🌧️' : c <= 86 ? '🌨️' : '⛈️';
const windCls = g => g >= 118 ? ['Very severe winds', 'sev'] : g >= 89 ? ['Severe winds', 'sev'] : g >= 62 ? ['Gale-force winds', 'wind'] : null;
const rainCls = p => p >= 204.5 ? ['Extremely heavy rain', 'sev'] : p >= 115.6 ? ['Very heavy rain', 'rain'] : p >= 64.5 ? ['Heavy rain', 'rain'] : null;
function hourlyByDay() {
  const H = fc && fc.hourly, out = {}; if (!H || !H.precipitation) return out;
  for (let i = 0; i < H.precipitation.length; i++) { const d = H.time[i].slice(0, 10), o = out[d] ||= { max3: 0, sum: 0, sm: null, smMax: null, rhMin: null }, v = H.precipitation[i] || 0;
    o.sum += v; o.max3 = Math.max(o.max3, v + (H.precipitation[i - 1] || 0) + (H.precipitation[i - 2] || 0));
    const sm = H.soil_moisture_3_to_9cm && H.soil_moisture_3_to_9cm[i]; if (sm != null) { if (o.sm == null) o.sm = sm; o.smMax = Math.max(o.smMax ?? 0, sm); }
    const rh = H.relative_humidity_2m && H.relative_humidity_2m[i]; if (rh != null) o.rhMin = o.rhMin == null ? rh : Math.min(o.rhMin, rh); }
  return out;
}
function flashLevel(f) { if (!f) return null; const i = (f.max3 >= 75 || f.sum >= 204.5) ? 3 : (f.max3 >= 50 || f.sum >= 115.6) ? 2 : (f.max3 >= 30 || f.sum >= 64.5) ? 1 : 0; if (!i) return null;
  const s = i + ((f.smMax != null && f.smMax >= SAT) ? 1 : 0) + ((relief != null && relief >= 150) ? 1 : 0); return s >= 3 ? 'High' : s === 2 ? 'Moderate' : 'Low'; }
function fireWeather(r) { const f = r.hb || {}; if (f.rhMin == null || r.tmax == null || (r.rain || 0) >= 1) return null; if (r.tmax >= 32 && f.rhMin <= 25 && (r.gust || 0) >= 35) return 'High'; if (r.tmax >= 28 && f.rhMin <= 35 && (r.gust || 0) >= 20) return 'Moderate'; return null; }
const spans = (rows, test) => { const out = []; let cur = null; rows.forEach(r => { if (test(r)) { if (!cur) out.push(cur = { items: [] }); cur.items.push(r); } else cur = null; }); return out; };
const range = s => { const a = s.items[0].t, b = s.items[s.items.length - 1].t; return a === b ? fmtDay(a) : `${fmtDay(a)} – ${fmtDay(b)}`; };
function rows() {
  if (!fc || !fc.daily) return [];
  const D = fc.daily, HB = hourlyByDay();
  return D.time.map((t, i) => { const tmax = D.temperature_2m_max[i], n = normals ? normals[doy(t)] : null, dep = (n != null && tmax != null) ? tmax - n : null;
    const r = { t, tmax, tmin: D.temperature_2m_min[i], feel: D.apparent_temperature_max[i], rain: D.precipitation_sum[i], gust: D.wind_gusts_10m_max[i], code: D.weather_code[i], n, dep, hb: HB[t] };
    r.hw = classifyHeat(tmax, dep); r.ff = flashLevel(HB[t]); r.fw = fireWeather(r); return r; });
}

/* ---------- rivers (GloFAS) ---------- */
async function loadRiver(my, lat, lng) {
  try {
    const base = `https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lng}`;
    const f = await getJSON(`${base}&daily=river_discharge,river_discharge_median,river_discharge_max,river_discharge_p25,river_discharge_p75&past_days=7&forecast_days=30`, { ttl: 3 * 36e5 });
    const h = await getJSON(`${base}&daily=river_discharge&start_date=1984-01-01&end_date=2021-12-31`, { ttl: 864e5 * 30, timeout: 40000 });
    if (my !== gen) return;
    const maxByYear = {}; let s = 0, n = 0;
    h.daily.time.forEach((t, i) => { const v = h.daily.river_discharge[i]; if (v == null) return; s += v; n++; const y = t.slice(0, 4); if (maxByYear[y] == null || v > maxByYear[y]) maxByYear[y] = v; });
    const am = Object.values(maxByYear).sort((a, b) => a - b), qn = p => { if (!am.length) return null; const i = (am.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return am[lo] + (am[hi] - am[lo]) * (i - lo); };
    river = { d: f.daily, mean: n ? s / n : 0, rp2: qn(.5), rp5: qn(.8), rp20: qn(.95), years: am.length };
  } catch (e) { if (my === gen) river = false; }
  if (my === gen) drawAll();
}
/* ---------- air quality (CAMS, India AQI scale) ---------- */
const BP = { pm25: [[0, 30, 0, 50], [30, 60, 50, 100], [60, 90, 100, 200], [90, 120, 200, 300], [120, 250, 300, 400], [250, 380, 400, 500]],
             pm10: [[0, 50, 0, 50], [50, 100, 50, 100], [100, 250, 100, 200], [250, 350, 200, 300], [350, 430, 300, 400], [430, 510, 400, 500]] };
const AQC = [[50, 'Good', '#3fbf62'], [100, 'Satisfactory', '#a3c853'], [200, 'Moderate', '#ffd84d'], [300, 'Poor', '#f29c33'], [400, 'Very poor', '#e93f33'], [1e9, 'Severe', '#b7322a']];
const sub = (c, bps) => { if (c == null) return null; for (const [lo, hi, a, b] of bps) if (c <= hi) return a + (c - lo) * (b - a) / (hi - lo); return 500; };
export const aqCat = v => AQC.find(a => v <= a[0]);
export function aqiFrom(pm25, pm10) { return Math.round(Math.max(sub(pm25, BP.pm25) || 0, sub(pm10, BP.pm10) || 0)); }
async function loadAir(my, lat, lng) {
  try {
    const j = await getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&hourly=pm2_5,pm10,dust&past_days=1&forecast_days=5&timezone=auto`, { ttl: 36e5 });
    if (my !== gen) return;
    const H = j.hourly, byDay = {}, avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    H.time.forEach((t, i) => { const o = byDay[t.slice(0, 10)] ||= { a: [], b: [], dust: 0 }; if (H.pm2_5[i] != null) o.a.push(H.pm2_5[i]); if (H.pm10[i] != null) o.b.push(H.pm10[i]); if (H.dust && H.dust[i] != null) o.dust = Math.max(o.dust, H.dust[i]); });
    const idx = Math.max(0, H.time.findIndex(t => Date.parse(t) > Date.now()) - 1), from = Math.max(0, idx - 23);
    const a = avg(H.pm2_5.slice(from, idx + 1).filter(v => v != null)), b = avg(H.pm10.slice(from, idx + 1).filter(v => v != null));
    const t0 = fc && fc.daily ? fc.daily.time[0] : H.time[idx].slice(0, 10);
    aq = { now: aqiFrom(a, b), a, b, days: Object.keys(byDay).filter(d => d >= t0).slice(0, 5).map(d => { const o = byDay[d], x = avg(o.a), y = avg(o.b), s1 = sub(x, BP.pm25) || 0, s2 = sub(y, BP.pm10) || 0; return { d, a: x, b: y, aqi: Math.round(Math.max(s1, s2)), main: s1 >= s2 ? 'PM2.5' : 'PM10', dust: o.dust }; }) };
  } catch (e) { if (my === gen) aq = false; }
  if (my === gen) drawAll();
}
/* ---------- satellite fire detections near the pin ---------- */
function countFire(id, day, bbox) {
  return new Promise(res => { const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { try { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, 256, 256).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; res(n); } catch (e) { res(null); } };
    img.onerror = () => res(null);
    img.src = `${GIBS4326}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&SRS=EPSG:4326&STYLES=&FORMAT=image/png&TRANSPARENT=true&WIDTH=256&HEIGHT=256&LAYERS=${id}&TIME=${day}&BBOX=${bbox}`; });
}
async function checkFires(my) {
  const p = state.place, R = .45, c = Math.max(.2, Math.cos(p.lat * Math.PI / 180)), bbox = [p.lng - R / c, p.lat - R, p.lng + R / c, p.lat + R].map(v => v.toFixed(4)).join(',');
  const counts = await Promise.all([1, 0].flatMap(n => FIRE_LAYERS.map(id => countFire(id, localDayN(n), bbox))));
  if (my !== gen) return; const ok = counts.filter(v => v != null); fireCount = ok.length ? Math.round(Math.max(...ok) / 6) : null; drawAll();
}

/* ---------- rendering ---------- */
let alertCache = [];
export function hazardAlerts() { return alertCache; }
function drawAll() { drawAlerts(); drawOutlook(); drawWater(); drawFire(); drawAir(); }
function drawAlerts() {
  if (!root) return; const p = state.place, out = [];
  if (p && storms && storms.length) { let best = null;
    storms.forEach(s => [{ lat: s.lat, lng: s.lng, now: true }, ...s.points].forEach(pt => { const d = km(p, pt); if (!best || d < best.d) best = { d, s, pt }; }));
    if (best && best.d < 1500) { const when = best.pt.now ? 'now' : best.pt.date ? 'around ' + new Date(best.pt.date).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit' }) : 'on its forecast track';
      out.push([best.d < 150 ? 'sev' : best.d < 500 ? 'hot' : 'info', '🌀', `${best.s.name}: closest about ${Math.round(best.d)} km ${when}`]); } }
  if (p) [...floods, ...fires].forEach(e => { const d = km(p, e); if (d < (e.kind === 'flood' ? 400 : 300)) out.push([e.alert === 'red' || e.alert === 'orange' ? 'sev' : 'hot', e.kind === 'flood' ? '🌊' : '🔥', `Active ${e.kind === 'flood' ? 'flood' : 'major wildfire'} ${Math.round(d)} km away${e.country ? ' (' + e.country + ')' : ''}`]); });
  const R = rows();
  spans(R, r => r.hw).forEach(s => { const sev = s.items.some(r => r.hw === 'shw'); out.push([sev ? 'sev' : 'hot', '🔥', `${sev ? 'Severe heat wave' : 'Heat wave'} ${range(s)}${s.items.length < 2 ? ' (one day; IMD declares after two)' : ''}`]); });
  spans(R, r => windCls(r.gust || 0)).forEach(s => { const top = s.items.reduce((a, b) => b.gust > a.gust ? b : a), w = windCls(top.gust); out.push([w[1], '💨', `${w[0]} ${range(s)}, gusts to ${Math.round(top.gust)} km/h`]); });
  spans(R, r => rainCls(r.rain || 0)).forEach(s => { const top = s.items.reduce((a, b) => b.rain > a.rain ? b : a), w = rainCls(top.rain); out.push([w[1], '🌧️', `${w[0]} ${range(s)}, up to ${Math.round(top.rain)} mm a day`]); });
  spans(R, r => r.ff).forEach(s => { const o = { Low: 1, Moderate: 2, High: 3 }, top = s.items.reduce((a, b) => o[b.ff] > o[a.ff] ? b : a); out.push([top.ff === 'High' ? 'sev' : 'rain', '⚡', `Flash-flood potential ${top.ff.toLowerCase()} ${range(s)}, bursts up to ${Math.round(top.hb.max3)} mm in 3 hours`]); });
  if (river && river.mean >= 2) { const fut = riverRows().filter(r => !r.past), lvl = v => v == null ? 0 : (river.rp20 && v >= river.rp20) ? 3 : (river.rp5 && v >= river.rp5) ? 2 : (river.rp2 && v >= river.rp2) ? 1 : 0;
    spans(fut, r => lvl(r.med ?? r.q)).forEach(s => { const top = s.items.reduce((a, b) => (b.med ?? b.q) > (a.med ?? a.q) ? b : a), L2 = lvl(top.med ?? top.q);
      out.push([L2 >= 2 ? 'sev' : 'rain', '🌊', `${['', 'River flooding likely (above the 2-year flood level)', 'Severe river flooding (above the 5-year level)', 'Extreme river flooding (above the 20-year level)'][L2]} ${range(s)}`]); }); }
  spans(R, r => r.fw).forEach(s => { const hi = s.items.some(r => r.fw === 'High'); out.push([hi ? 'sev' : 'hot', '🔥', `${hi ? 'High' : 'Moderate'} fire weather ${range(s)}: hot, dry and windy`]); });
  if (fireCount) out.push(['hot', '🔥', `Satellite fire detections within ~50 km in the last 2 days (about ${fireCount})`]);
  if (aq && aq.days) spans(aq.days, x => x.aqi > 200).forEach(s => { const top = s.items.reduce((a, b) => b.aqi > a.aqi ? b : a), c = aqCat(top.aqi);
    out.push([top.aqi > 300 ? 'sev' : 'hot', '🌫️', `${c[1]} air quality ${s.items.length > 1 ? fmtDay(s.items[0].d) + ' – ' + fmtDay(s.items[s.items.length - 1].d) : fmtDay(s.items[0].d)}, AQI up to ${top.aqi}`]); });
  alertCache = out;
  const box = q('.alerts');
  if (!p) { box.innerHTML = ''; return; }
  box.innerHTML = out.length ? out.map(([c, i, t]) => `<div class="al ${c}"><span class="ic">${i}</span><span>${esc(t)}</span></div>`).join('')
    : (fc ? '<div class="al ok"><span class="ic">✓</span><span>No heat wave, damaging wind, heavy rain, flood, fire or air-quality alert in the outlook.</span></div>' : '<div class="skeleton" style="height:38px"></div>');
}
function drawOutlook() {
  const R = rows(), days = q('.days'), chart = q('.tchart');
  if (fc === false) { days.innerHTML = '<span class="muted small">The weather forecast is not responding. Try again in a minute.</span>'; chart.innerHTML = ''; return; }
  if (!R.length) { days.innerHTML = ''; chart.innerHTML = ''; return; }
  days.innerHTML = R.map(r => { const w = windCls(r.gust || 0), rn = rainCls(r.rain || 0);
    return `<div class="day${r.hw ? ' ' + r.hw : ''}"><b>${fmtDay(r.t)}</b><div class="ic">${WX(r.code)}</div><div class="t">${r.tmax != null ? Math.round(r.tmax) : '–'}°<span class="muted" style="font:400 12px var(--body)"> / ${r.tmin != null ? Math.round(r.tmin) : '–'}°</span></div>
      ${r.dep != null ? `<div class="${r.dep >= 0 ? 'up' : 'dn'}">${r.dep >= 0 ? '+' : ''}${r.dep.toFixed(1)}° vs normal</div>` : ''}
      <div class="muted">Feels ${r.feel != null ? Math.round(r.feel) + '°' : '–'}</div><div class="muted">💨 ${r.gust != null ? Math.round(r.gust) : '–'} km/h</div><div class="muted">💧 ${r.rain != null ? r.rain.toFixed(r.rain < 10 ? 1 : 0) : '–'} mm</div>
      ${r.hw ? `<div class="f" style="color:${r.hw === 'shw' ? '#ff8a80' : '#ffab8f'}">${r.hw === 'shw' ? 'SEVERE HEAT WAVE' : 'HEAT WAVE'}</div>` : ''}${w ? `<div class="f" style="color:#8fd3ff">${w[0].toUpperCase()}</div>` : ''}${rn ? `<div class="f" style="color:#b9b3ff">${rn[0].toUpperCase()}</div>` : ''}${r.ff ? `<div class="f" style="color:#7fe0ff">FLASH FLOOD: ${r.ff.toUpperCase()}</div>` : ''}${r.fw ? `<div class="f" style="color:#ffb36b">FIRE WEATHER: ${r.fw.toUpperCase()}</div>` : ''}</div>`; }).join('');
  const W = 600, H = 120, P = 18, vals = R.flatMap(r => [r.tmax, r.n, r.tmin]).filter(v => v != null).concat([THR[terrain]]);
  const lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1), x = i => P + i * (W - 2 * P) / (R.length - 1), y = v => H - P - (v - lo) * (H - 2 * P) / (hi - lo);
  const line = (k, col, dash) => { const pts = R.map((r, i) => r[k] != null ? `${x(i).toFixed(1)},${y(r[k]).toFixed(1)}` : null).filter(Boolean); return pts.length > 1 ? `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="2" ${dash ? 'stroke-dasharray="4 4"' : ''}/>` : ''; };
  let g = `<line x1="${P}" x2="${W - P}" y1="${y(THR[terrain])}" y2="${y(THR[terrain])}" stroke="rgba(239,122,90,.6)" stroke-dasharray="2 4"/><text x="${W - P}" y="${y(THR[terrain]) - 4}" fill="#ffab8f" font-size="11" text-anchor="end">${THR[terrain]}° heat-wave threshold</text>`;
  R.forEach((r, i) => { if (r.hw) g += `<rect x="${x(i) - 8}" y="${P - 6}" width="16" height="${H - 2 * P + 6}" fill="${r.hw === 'shw' ? 'rgba(255,90,79,.22)' : 'rgba(239,122,90,.18)'}"/>`; });
  g += line('n', '#9fb6c3', true) + line('tmin', '#4fb3bf') + line('tmax', '#ef7a5a');
  g += `<text x="${P}" y="12" fill="#ef7a5a" font-size="11">max</text><text x="${P + 32}" y="12" fill="#4fb3bf" font-size="11">min</text><text x="${P + 60}" y="12" fill="#9fb6c3" font-size="11">normal max</text><text x="${P}" y="${H - 4}" fill="#9fb6c3" font-size="11">${lo}°</text><text x="${P}" y="${P + 12}" fill="#9fb6c3" font-size="11">${hi}°</text>`;
  chart.innerHTML = g;
  q('.fcnote').textContent = `16-day forecast (Open-Meteo, best-match models) compared with the 1991–2020 normal for each date${normals ? '' : ' (loading)'}. Heat waves use IMD criteria: at least ${THR[terrain]} °C here, and 4.5 °C or more above normal.`;
}
function riverRows() { const d = river.d, t0 = fc && fc.daily ? fc.daily.time[0] : today(); return d.time.map((t, i) => ({ t, past: t < t0, q: d.river_discharge[i], med: d.river_discharge_median?.[i], max: d.river_discharge_max?.[i], p25: d.river_discharge_p25?.[i], p75: d.river_discharge_p75?.[i] })); }
const fq = v => v == null ? '–' : v >= 100 ? Math.round(v).toLocaleString() : v >= 10 ? v.toFixed(0) : v.toFixed(1);
function drawWater() {
  const R = rows(), box = q('.water'), chart = q('.rchart');
  if (R.length) { const tot = R.reduce((a, r) => a + (r.rain || 0), 0), wk = R.slice(0, 7).reduce((a, r) => a + (r.rain || 0), 0), sm = (R[0].hb || {}).sm, wet = R.filter(r => (r.rain || 0) >= 2.5).length;
    const soil = sm == null ? 'unknown' : sm >= SAT ? 'near-saturated' : sm >= .3 ? 'wet' : sm >= .15 ? 'moist' : 'dry';
    box.innerHTML = `<dl class="kv"><dt>Rain, next 7 days</dt><dd><b>${Math.round(wk)} mm</b></dd><dt>Rain, next 16 days</dt><dd><b>${Math.round(tot)} mm</b> on ${wet} rainy day${wet === 1 ? '' : 's'}</dd><dt>Topsoil now</dt><dd>${soil}${sm != null ? ` (${sm.toFixed(2)} m³/m³)` : ''}</dd>${relief != null ? `<dt>Terrain</dt><dd>${relief >= 150 ? 'hilly' : 'fairly flat'} (${Math.round(relief)} m within ~2 km)</dd>` : ''}</dl>`; }
  else box.innerHTML = '';
  const info = q('.rinfo');
  if (river === false) { info.textContent = 'The river forecast is not responding right now.'; chart.innerHTML = ''; return; }
  if (!river) { info.textContent = ''; chart.innerHTML = ''; return; }
  if (river.mean < 2) { info.textContent = `No significant river within about 5 km (average flow ${fq(river.mean)} m³/s). Move the pin onto a river to see its 30-day flood forecast.`; chart.innerHTML = ''; return; }
  const rr = riverRows(), fut = rr.filter(r => !r.past), peak = fut.reduce((a, b) => ((b.med ?? b.q ?? 0) > (a.med ?? a.q ?? 0) ? b : a), fut[0] || {}), pv = peak.med ?? peak.q;
  info.innerHTML = `Average flow <b>${fq(river.mean)} m³/s</b>. Flood levels from ${river.years} years of yearly peaks: 2-year <b>${fq(river.rp2)}</b>, 5-year <b>${fq(river.rp5)}</b> m³/s. 30-day forecast peak <b>${fq(pv)} m³/s</b>${peak.t ? ` around ${fmtDay(peak.t)}` : ''}. Line: most likely; band: middle half of forecasts; dashed: highest.`;
  const W = 600, H = 110, P = 16, vals = rr.flatMap(r => [r.q, r.med, r.max, r.p75]).filter(v => v != null).concat([river.rp2 || 0]), hi = Math.max(...vals) * 1.08 || 1;
  const x = i => P + i * (W - 2 * P) / Math.max(1, rr.length - 1), y = v => H - P - v * (H - 2 * P) / hi;
  const path = (k, col, dash, w = 2, upto) => { const pts = rr.slice(0, upto ?? rr.length).map((r, i) => r[k] != null ? `${x(i).toFixed(1)},${y(r[k]).toFixed(1)}` : null).filter(Boolean); return pts.length > 1 ? `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="${w}" ${dash ? 'stroke-dasharray="4 4"' : ''}/>` : ''; };
  const band = rr.map((r, i) => r.p75 != null && r.p25 != null ? [x(i), y(r.p75), y(r.p25)] : null).filter(Boolean);
  let g = band.length > 1 ? `<polygon points="${band.map(b => `${b[0].toFixed(1)},${b[1].toFixed(1)}`).join(' ')} ${band.slice().reverse().map(b => `${b[0].toFixed(1)},${b[2].toFixed(1)}`).join(' ')}" fill="rgba(79,179,191,.2)"/>` : '';
  [['rp2', '2-year flood level', '#e3b964', W - P], ['rp5', '5-year', '#ef7a5a', W * .72], ['rp20', '20-year', '#ff5a4f', W * .5]].forEach(([k, l, c, lx]) => { const v = river[k]; if (v && v < hi) g += `<line x1="${P}" x2="${W - P}" y1="${y(v)}" y2="${y(v)}" stroke="${c}" stroke-dasharray="2 4"/><text x="${lx}" y="${y(v) - 3}" fill="${c}" font-size="10.5" text-anchor="end">${l}</text>`; });
  const ti = rr.findIndex(r => !r.past); if (ti > 0) g += `<line x1="${x(ti)}" x2="${x(ti)}" y1="${P - 6}" y2="${H - P}" stroke="rgba(234,242,245,.35)"/><text x="${x(ti) + 3}" y="${P}" fill="#9fb6c3" font-size="10.5">today</text>`;
  g += path('max', '#4fb3bf', true, 1.2) + path('med', '#4fb3bf') + path('q', 'rgba(234,242,245,.75)', false, 1.5, Math.max(2, ti + 1));
  chart.innerHTML = g;
}
function drawFire() {
  const box = q('.fire'), R = rows(), fw = spans(R, r => r.fw);
  box.innerHTML = `<p>${fireCount == null ? 'The satellite fire count near the pin is not available right now; the map may still show fire dots.' : fireCount ? `About <b>${fireCount}</b> satellite fire detections within ~50 km in the last 2 days (red and orange dots on the map). Crop-residue burning shows up too.` : 'No satellite fire detections within ~50 km in the last 2 days.'}</p>
    <p class="note">Fire weather (hot, dry, windy days): ${fw.length ? fw.map(s => `<b>${s.items.some(r => r.fw === 'High') ? 'high' : 'moderate'}</b> ${range(s)}`).join(', ') : 'none expected'}. Detections come from NASA VIIRS (375 m) and can miss small or cloud-covered fires.</p>`;
}
function drawAir() {
  const box = q('.air');
  if (aq === false) { box.innerHTML = '<span class="muted small">The air-quality forecast is not responding right now.</span>'; return; }
  if (!aq) { box.innerHTML = ''; return; }
  const c = aqCat(aq.now);
  box.innerHTML = `<p>Now (24-hour average): <b style="color:${c[2]}">AQI ${aq.now}, ${c[1]}</b> · PM2.5 ${aq.a != null ? Math.round(aq.a) : '–'} µg/m³ · PM10 ${aq.b != null ? Math.round(aq.b) : '–'} µg/m³</p>
    <div class="days">${aq.days.map(x => { const k = aqCat(x.aqi); return `<div class="day"><b>${fmtDay(x.d)}</b><div class="t" style="color:${k[2]}">${x.aqi}</div><div class="badge" style="background:${k[2]};color:#111">${k[1]}</div><div class="muted">PM2.5 ${x.a != null ? Math.round(x.a) : '–'}</div><div class="muted">PM10 ${x.b != null ? Math.round(x.b) : '–'}</div>${x.dust >= 100 ? `<div class="muted">dust ${Math.round(x.dust)}</div>` : ''}</div>`; }).join('')}</div>
    <p class="note" style="margin-top:6px">Forecast from the CAMS global model (~40 km), on India's CPCB AQI scale. Station readings: <a href="https://airquality.cpcb.gov.in/AQI_India/" target="_blank" rel="noopener">CPCB</a>.</p>`;
}

export default {
  id: 'hazards', title: 'Hazards', icon: ICON, base: 'dark', desc: 'Cyclones, heat waves, floods, wildfires and air quality',
  init(el) {
    root = el;
    el.innerHTML = `
      <div class="sec"><h2>Active cyclones</h2><div class="chips storms"><span class="muted small">Loading…</span></div></div>
      <div class="sec"><h2>Alerts for this place <span class="aside">next 16 days</span></h2><div class="alerts"></div>
        <div class="empty-msg muted small hidden">Pick a place to see its alerts.</div></div>
      <div class="sec"><h2>Weather outlook
          <select class="btn terrain aside" style="margin-left:auto" aria-label="Kind of place (IMD heat-wave threshold)"><option value="plains">Plains (≥40 °C)</option><option value="coastal">Coastal (≥37 °C)</option><option value="hills">Hills (≥30 °C)</option></select></h2>
        <svg class="chart tchart" viewBox="0 0 600 120" preserveAspectRatio="none" style="height:120px"></svg>
        <div class="days"></div><p class="note fcnote" style="margin-top:6px"></p></div>
      <div class="sec"><h2>Floods and water</h2><div class="water"></div>
        <svg class="chart rchart" viewBox="0 0 600 110" preserveAspectRatio="none" style="height:110px;margin-top:8px"></svg><p class="note rinfo"></p>
        <p class="note">Flash-flood potential (in the day cards) is an indicative score from forecast rain bursts, soil wetness and terrain, not an official warning. River levels: GloFAS (Copernicus) on a ~5 km grid.</p></div>
      <div class="sec"><h2>Wildfires <label class="aside"><input type="checkbox" class="fireTog" checked> show on map</label></h2><div class="fire"></div></div>
      <div class="sec"><h2>Air quality <span class="aside">5 days</span></h2><div class="air"></div></div>
      <div class="sec note">Follow official warnings: <a href="https://mausam.imd.gov.in/" target="_blank" rel="noopener">IMD</a> · <a href="https://rsmcnewdelhi.imd.gov.in/" target="_blank" rel="noopener">RSMC New Delhi (cyclones)</a> · <a href="https://www.gdacs.org/" target="_blank" rel="noopener">GDACS</a>.
        Global models soften the strongest winds and rain near a cyclone's eye, so treat those values as minimums.</div>`;
    q('.terrain').onchange = e => { terrain = e.target.value; drawAll(); };
    q('.fireTog').onchange = e => e.target.checked ? fireLayer.addTo(group) : group.removeLayer(fireLayer);
    setInterval(() => { if (state.lens === 'hazards') { gdacsLoaded = 0; loadEvents(); } }, 30 * 60e3);
  },
  show() { loadEvents(); if (!state.place) map.setZoom(Math.min(map.getZoom(), 5)); },
  update(place) {
    const k = place ? `${place.lat},${place.lng}` : 'none'; if (this._k === k) return; this._k = k;
    q('.empty-msg').classList.toggle('hidden', !!place);
    if (!place) { drawAll(); return; }
    if (map.getZoom() > 10) map.setView([place.lat, place.lng], 9);
    const my = ++gen; loadPlace(my);
  },
};
