// Routes lens: road routes between two places, and where a short new link road could cut the distance.
// Routing: OSRM public server (OpenStreetMap roads). Checks: Overpass (rivers, railways, tanks, tracks, villages), Open-Meteo elevation.
import { $, $$, esc, state, getJSON, overpass, km, fmtKm, toast, setPlace, setUrlParam, readUrl, sleep } from '../core.js';
import { map, lensGroup, setClickHandler } from '../map.js';

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8 17c5 0 2-6 6-8.5M15.6 7.4" /><path d="M6 15.8V12a3 3 0 0 1 3-3h1.5" stroke-dasharray="2 2.4"/></svg>';
const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
const CIRCUITY = 1.3;   // a new rural road is assumed ~30% longer than the straight line
const NEW_SPEED = 40;   // km/h assumed on a new two-lane rural link

let root, A = null, B = null, pick = null, gen = 0, routes = [], cuts = [];
const group = lensGroup('routes'), layer = L.layerGroup().addTo(group), cutLayer = L.layerGroup().addTo(group);
const q = s => $(s, root);
const fmtMin = m => m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`;
const ll = p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
const letter = (t, cls) => L.divIcon({ className: '', html: `<div class="rt-mk ${cls || ''}">${t}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });

/* ---------- picking places ---------- */
async function nameOf(p) {
  try { const j = await getJSON(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=14&lat=${p.lat}&lon=${p.lng}&accept-language=en`, { ttl: 864e5 });
    const a = j.address || {}; return a.village || a.town || a.city || a.suburb || a.hamlet || a.municipality || a.county || (j.display_name || '').split(',')[0] || ll(p); } catch (e) { return ll(p); }
}
async function setPoint(which, p, name) {
  const pt = { lat: +p.lat, lng: +p.lng, name: name || '…' };
  if (which === 'a') A = pt; else B = pt;
  drawFields(); saveUrl();
  if (!name) { pt.name = await nameOf(pt); drawFields(); }
  if (A && B) run();
}
function saveUrl() { setUrlParam('ra', A ? ll(A) : ''); setUrlParam('rb', B ? ll(B) : ''); }
function drawFields() {
  for (const [w, p] of [['a', A], ['b', B]]) {
    const inp = q(`.rt-in[data-w="${w}"]`); if (document.activeElement !== inp) inp.value = p ? p.name : '';
    q(`.rt-pick[data-w="${w}"]`).classList.toggle('on', pick === w);
  }
  q('.rt-hint').textContent = pick ? `Tap the map to set ${pick === 'a' ? 'the start' : 'the destination'}.` : (!A || !B ? 'Search two places, or tap ⌖ and then the map.' : '');
}
let sT;
function wireSearch(inp) {
  const w = inp.dataset.w, box = q(`.rt-res[data-w="${w}"]`);
  inp.oninput = () => { clearTimeout(sT); const v = inp.value.trim(); if (v.length < 3) { box.innerHTML = ''; return; }
    sT = setTimeout(async () => {
      const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(v);
      if (m) { box.innerHTML = `<button type="button" data-lat="${m[1]}" data-lng="${m[2]}">${esc(v)}</button>`; }
      else { try { const cc = state.place?.admin?.countryCode; const j = await getJSON(`https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=en&q=${encodeURIComponent(v)}${cc ? '&countrycodes=' + cc : ''}`, { ttl: 864e5 });
        box.innerHTML = (j || []).map(r => `<button type="button" data-lat="${r.lat}" data-lng="${r.lon}" data-n="${esc(r.display_name.split(',')[0])}">${esc(r.display_name.split(',').slice(0, 3).join(','))}</button>`).join('') || '<span class="muted small">No match</span>'; } catch (e) { box.innerHTML = '<span class="muted small">Search is busy. Try again.</span>'; } }
      $$('button', box).forEach(b => b.onclick = () => { box.innerHTML = ''; inp.blur(); setPoint(w, { lat: b.dataset.lat, lng: b.dataset.lng }, b.dataset.n); });
    }, 400); };
  inp.onkeydown = e => { if (e.key === 'Enter') { const b = $('button', box); if (b) b.click(); } };
  inp.onblur = () => setTimeout(() => { box.innerHTML = ''; drawFields(); }, 250);
}

/* ---------- routing ---------- */
async function route(a, b, alts) {
  const j = await getJSON(`${OSRM}${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&annotations=distance,duration${alts ? '&alternatives=3' : ''}`, { ttl: 36e5, timeout: 30000 });
  if (j.code !== 'Ok' || !j.routes?.length) throw new Error(j.message || 'No route');
  return j;
}
function profile(r) { // cumulative km and minutes at each vertex
  const c = r.geometry.coordinates.map(x => [x[1], x[0]]), an = r.legs[0].annotation || {}, s = [0], t = [0];
  for (let i = 1; i < c.length; i++) { s.push(s[i - 1] + (an.distance ? an.distance[i - 1] / 1000 : km(c[i - 1], c[i]))); t.push(t[i - 1] + (an.duration ? an.duration[i - 1] / 60 : 0)); }
  if (!an.duration) { const f = r.duration / 60 / (s[s.length - 1] || 1); for (let i = 0; i < t.length; i++) t[i] = s[i] * f; }
  return { c, s, t };
}
function resample(pr, step) {
  const out = []; let k = 0;
  for (let d = 0; d <= pr.s[pr.s.length - 1] + 1e-9; d += step) {
    while (k < pr.s.length - 2 && pr.s[k + 1] < d) k++;
    const seg = pr.s[k + 1] - pr.s[k] || 1, f = Math.min(1, Math.max(0, (d - pr.s[k]) / seg));
    out.push({ p: [pr.c[k][0] + (pr.c[k + 1][0] - pr.c[k][0]) * f, pr.c[k][1] + (pr.c[k + 1][1] - pr.c[k][1]) * f], s: d, t: pr.t[k] + (pr.t[k + 1] - pr.t[k]) * f });
  }
  const L = pr.c.length - 1; out.push({ p: pr.c[L], s: pr.s[L], t: pr.t[L] });
  return out;
}
// Find stretches where the road wanders far from the straight line between two of its points.
function findCuts(pr) {
  const total = pr.s[pr.s.length - 1], pts = resample(pr, Math.max(0.2, total / 450)), found = [];
  const maxD = Math.min(30, Math.max(3, total * 0.7));
  const cand = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 2; j < pts.length; j++) {
    const R = pts[j].s - pts[i].s; if (R < 2) continue;
    const d = km(pts[i].p, pts[j].p); if (d < 0.3 || d > maxD) continue;
    const save = R - d * CIRCUITY; if (save < Math.max(1.5, 0.25 * R) || R / d < 1.6) continue;
    cand.push({ i, j, d, R, save });
  }
  cand.sort((x, y) => y.save - x.save);
  for (const c of cand) {
    if (found.some(f => !(c.j <= f.i || c.i >= f.j))) continue;
    const a = pts[c.i], b = pts[c.j], newKm = c.d * CIRCUITY, newMin = newKm / NEW_SPEED * 60;
    found.push({ ...c, a: a.p, b: b.p, atKm: a.s, toKm: b.s, roadMin: b.t - a.t, newKm, newMin, saveMin: (b.t - a.t) - newMin });
    if (found.length >= 3) break;
  }
  return found;
}

async function run() {
  if (!A || !B) return; const my = ++gen;
  layer.clearLayers(); cutLayer.clearLayers(); routes = []; cuts = [];
  L.marker([A.lat, A.lng], { icon: letter('A'), zIndexOffset: 1000 }).addTo(layer); L.marker([B.lat, B.lng], { icon: letter('B'), zIndexOffset: 1000 }).addTo(layer);
  const straight = km(A, B);
  q('.rt-out').innerHTML = '<div class="skeleton" style="height:90px"></div>';
  let j;
  try { j = await route(A, B, true); } catch (e) {
    if (my !== gen) return;
    q('.rt-out').innerHTML = `<p class="al sev"><span>The routing service didn't answer (${esc(e.message || 'busy')}). It is a free shared service, so try again in a minute.</span></p>`; return;
  }
  if (my !== gen) return;
  routes = j.routes.map(r => ({ r, pr: profile(r) }));
  const main = routes[0];
  routes.slice(1).reverse().forEach((x, k) => L.polyline(x.pr.c, { color: '#9fb6c3', weight: 4, opacity: .85, dashArray: '6 6' }).addTo(layer).bindTooltip(`Option ${routes.length - k}: ${fmtKm(x.r.distance / 1000)}, ${fmtMin(x.r.duration / 60)}`));
  L.polyline(main.pr.c, { color: '#0f2a3d', weight: 8, opacity: .55 }).addTo(layer);
  L.polyline(main.pr.c, { color: '#4fb3bf', weight: 5 }).addTo(layer).bindTooltip(`Fastest: ${fmtKm(main.r.distance / 1000)}, ${fmtMin(main.r.duration / 60)}`);
  L.polyline([[A.lat, A.lng], [B.lat, B.lng]], { color: '#eaf2f5', weight: 1.5, dashArray: '2 6', interactive: false }).addTo(layer);
  map.fitBounds(L.latLngBounds(main.pr.c).extend([A.lat, A.lng]).extend([B.lat, B.lng]), { padding: [30, 30] });

  const roadKm = main.r.distance / 1000, ratio = roadKm / (straight || 1);
  const snap = (j.waypoints || []).map((w, i) => w.distance > 700 ? `${i ? 'The destination' : 'The start'} is ${fmtKm(w.distance / 1000)} from the nearest mapped road.` : '').filter(Boolean).join(' ');
  const verdict = ratio < 1.25 ? ['ok', 'Well connected: the road is close to a straight line.'] : ratio < 1.6 ? ['info', 'Some detour: the road is noticeably longer than the straight line.'] : ['hot', 'Big detour: the road goes well out of the way.'];
  cuts = findCuts(main.pr);
  q('.rt-out').innerHTML = `
    <div class="facts">
      <div class="fact"><div class="v">${fmtKm(roadKm)}</div><div class="l">by road · ${fmtMin(main.r.duration / 60)}</div></div>
      <div class="fact"><div class="v">${fmtKm(straight)}</div><div class="l">straight line</div></div>
      <div class="fact"><div class="v">${ratio.toFixed(2)}×</div><div class="l">road vs straight</div></div>
    </div>
    <p class="al ${verdict[0]}" style="margin-top:10px"><span>${verdict[1]}${snap ? ' ' + esc(snap) : ''}</span></p>
    ${routes.length > 1 ? `<h3 class="rt-h">Road options today</h3><div class="rt-opts">${routes.map((x, i) => `<div class="rt-opt"><span class="rt-sw" style="background:${i ? '#9fb6c3' : '#4fb3bf'}"></span>${i ? 'Option ' + (i + 1) : 'Fastest'} <b>${fmtKm(x.r.distance / 1000)}</b> · ${fmtMin(x.r.duration / 60)}</div>`).join('')}</div>` : ''}
    <h3 class="rt-h">Possible shortcuts</h3>
    ${cuts.length ? cuts.map((c, k) => `<div class="rt-cut" data-k="${k}">
        <button class="rt-cut-h" type="button" aria-expanded="false"><span class="rt-mk cut">${k + 1}</span><span class="grow">${c.i === 0 && c.j >= 0 && c.toKm >= roadKmOf() - 0.3 ? '<span class="small" style="color:var(--ochre)">Direct link from A to B</span><br>' : ''}<b>Saves about ${fmtKm(c.save)} and ${fmtMin(Math.max(0, c.saveMin))}</b><br><span class="small muted">A ${fmtKm(c.newKm)} link instead of ${fmtKm(c.R)} of road (km ${c.atKm.toFixed(1)} → ${c.toKm.toFixed(1)} of the route)</span></span></button>
        <div class="rt-cut-b hidden"></div></div>`).join('')
      + `<p class="note">With shortcut 1 the trip would be about <b>${fmtKm(roadKm - cuts[0].save)}</b> and <b>${fmtMin(main.r.duration / 60 - Math.max(0, cuts[0].saveMin))}</b>.</p>`
      : '<p class="muted small">No stretch of this route makes a big detour, so a new link would save little.</p>'}
    <p class="note">These are estimates. A new link is assumed to run along the dashed line plus ${Math.round((CIRCUITY - 1) * 100)}% for bends, at ${NEW_SPEED} km/h. Roads come from OpenStreetMap, so very new roads may be missing.</p>`;
  cuts.forEach((c, k) => {
    const mid = [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2];
    L.polyline([c.a, c.b], { color: '#e3b964', weight: 5, dashArray: '9 7' }).addTo(cutLayer).on('click', () => openCut(k, true));
    [c.a, c.b].forEach(p => L.circleMarker(p, { radius: 5, color: '#e3b964', fillColor: '#0f2a3d', fillOpacity: 1, weight: 2 }).addTo(cutLayer));
    L.marker(mid, { icon: letter(k + 1, 'cut') }).addTo(cutLayer).on('click', () => openCut(k, true));
  });
  $$('.rt-cut-h', root).forEach(b => b.onclick = () => openCut(+b.parentElement.dataset.k));
  if (cuts.length) openCut(0, false, true);
}

const roadKmOf = () => routes[0] ? routes[0].r.distance / 1000 : 0;
/* ---------- checking a shortcut ---------- */
const checked = {};
async function openCut(k, fromMap, quiet) {
  const box = $(`.rt-cut[data-k="${k}"]`, root); if (!box) return;
  const body = $('.rt-cut-b', box), btn = $('.rt-cut-h', box), open = body.classList.contains('hidden') || fromMap;
  body.classList.toggle('hidden', !open); btn.setAttribute('aria-expanded', open);
  if (fromMap) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const c = cuts[k]; if (!open || !c) return;
  if (!quiet) map.fitBounds(L.latLngBounds([c.a, c.b]), { padding: [60, 60], maxZoom: 15 });
  if (checked[k] === c) return; checked[k] = c;
  body.innerHTML = '<div class="skeleton" style="height:70px"></div>';
  const my = gen, line = `${c.a[0].toFixed(5)},${c.a[1].toFixed(5)},${c.b[0].toFixed(5)},${c.b[1].toFixed(5)}`;
  const [ex, os, el] = await Promise.all([
    route({ lat: c.a[0], lng: c.a[1] }, { lat: c.b[0], lng: c.b[1] }, false).catch(() => null),
    overpass(`[out:json][timeout:30];(way(around:40,${line})["waterway"~"^(river|canal|stream|drain)$"];way(around:40,${line})["railway"~"^(rail|light_rail|narrow_gauge)$"];way(around:30,${line})["natural"="water"];way(around:30,${line})["highway"~"^(motorway|trunk|primary)$"];way(around:120,${line})["highway"~"^(track|path|unclassified|residential|tertiary|service)$"];node(around:1500,${line})["place"~"^(village|hamlet|town|suburb|neighbourhood)$"];);out tags center 300;`).catch(() => null),
    elevations(c).catch(() => null),
  ]);
  if (my !== gen) return;
  const E = os?.elements || [], T = e => e.tags || {}, nm = e => T(e)['name:en'] || T(e).name;
  const uniq = a => [...new Set(a.filter(Boolean))];
  const rivers = uniq(E.filter(e => /river|canal|stream|drain/.test(T(e).waterway || '')).map(e => nm(e) || (T(e).waterway === 'river' ? 'unnamed river' : T(e).waterway === 'canal' ? 'unnamed canal' : 'stream')));
  const rails = E.filter(e => T(e).railway).length, tanks = uniq(E.filter(e => T(e).natural === 'water').map(e => nm(e) || 'unnamed tank or lake'));
  const majors = uniq(E.filter(e => /motorway|trunk|primary/.test(T(e).highway || '')).map(e => T(e).ref || nm(e) || 'main road'));
  const tracks = E.filter(e => /track|path|unclassified|residential|tertiary|service/.test(T(e).highway || '')).length;
  const places = E.filter(e => e.type === 'node' && T(e).place).map(e => ({ n: nm(e), ll: [e.lat, e.lon] })).filter(x => x.n);
  const near = p => places.slice().sort((x, y) => km(x.ll, p) - km(y.ll, p))[0];
  const nA = near(c.a), nB = near(c.b), served = uniq(places.map(x => x.n)).slice(0, 8);
  let kind;
  if (ex) { const r = ex.routes[0], rk = r.distance / 1000;
    kind = rk <= c.d * 1.6 ? `<p class="al info"><span>A road already exists here (about ${fmtKm(rk)}, ${fmtMin(r.duration / 60)} by the router's estimate). It is probably narrow or unpaved, so this is a case for <b>upgrading</b> it rather than building new.</span></p>`
      : `<p class="al ok"><span>No direct road today: the shortest drive between these two points is ${fmtKm(rk)}. This would be a <b>new link</b>.</span></p>`; }
  else kind = '<p class="al info"><span>Couldn\'t check for an existing road (routing service busy).</span></p>';
  const rows = [
    ['Between', nA && nB ? `near ${esc(nA.n)} and near ${esc(nB.n)}` : 'two points on the route'],
    ['Crosses water', rivers.length || tanks.length ? esc([...rivers, ...tanks].slice(0, 5).join(', ')) + ' (bridge or causeway needed)' : 'no mapped river, canal or tank'],
    ['Crosses railway', rails ? `yes (${rails} line${rails > 1 ? 's' : ''}): needs an over- or under-bridge` : 'no'],
    ['Crosses main road', majors.length ? esc(majors.slice(0, 3).join(', ')) + ': needs a junction' : 'no'],
    ['Existing tracks nearby', tracks ? `${tracks} mapped track${tracks > 1 ? 's' : ''} or village road${tracks > 1 ? 's' : ''} within 120 m of the line` : 'none mapped'],
    ['Ground', el || 'no elevation data'],
    ['Villages within 1.5 km', served.length ? esc(served.join(', ')) : 'none mapped'],
  ];
  const g = `https://www.google.com/maps/dir/?api=1&origin=${c.a[0]},${c.a[1]}&destination=${c.b[0]},${c.b[1]}&travelmode=driving`;
  body.innerHTML = `${kind}<dl class="kv">${rows.map(r => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join('')}</dl>
    <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:8px"><button class="btn" type="button" data-img>See it on satellite images</button><a class="btn" href="${g}" target="_blank" rel="noopener">Check in Google Maps</a></div>`;
  $('[data-img]', body).onclick = () => { const m = [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2]; map.fitBounds(L.latLngBounds([c.a, c.b]), { padding: [40, 40] }); setPlace(m[0], m[1]); window.ETM.openLens('imagery'); };
}
async function elevations(c) {
  const n = 12, lat = [], lng = [];
  for (let i = 0; i < n; i++) { const f = i / (n - 1); lat.push((c.a[0] + (c.b[0] - c.a[0]) * f).toFixed(5)); lng.push((c.a[1] + (c.b[1] - c.a[1]) * f).toFixed(5)); }
  const j = await getJSON(`https://api.open-meteo.com/v1/elevation?latitude=${lat.join(',')}&longitude=${lng.join(',')}`, { ttl: 864e5 });
  const e = j.elevation; if (!e?.length) return null;
  const step = c.d * 1000 / (n - 1); let g = 0; for (let i = 1; i < e.length; i++) g = Math.max(g, Math.abs(e[i] - e[i - 1]) / step * 100);
  const lo = Math.min(...e), hi = Math.max(...e);
  return `${Math.round(lo)}–${Math.round(hi)} m above sea level, steepest about ${g.toFixed(1)}% · ${g < 4 ? 'easy to build on' : g < 8 ? 'some grading needed' : 'hilly: costly cuts and fills'}`;
}

/* ---------- lens ---------- */
export default {
  id: 'routes', title: 'Routes', icon: ICON, base: 'map', desc: 'Road routes between two places and where a new link road could shorten them',
  init(el) {
    root = el;
    el.innerHTML = `
      <div class="sec">
        <div class="rt-pt"><span class="rt-mk">A</span><div class="rt-f"><input class="btn rt-in" data-w="a" placeholder="Start: search a place" autocomplete="off" aria-label="Start"><div class="rt-res" data-w="a"></div></div><button class="btn rt-pick" data-w="a" type="button" title="Pick the start on the map" aria-label="Pick the start on the map">⌖</button></div>
        <div class="rt-pt"><span class="rt-mk">B</span><div class="rt-f"><input class="btn rt-in" data-w="b" placeholder="Destination: search a place" autocomplete="off" aria-label="Destination"><div class="rt-res" data-w="b"></div></div><button class="btn rt-pick" data-w="b" type="button" title="Pick the destination on the map" aria-label="Pick the destination on the map">⌖</button></div>
        <div class="row" style="gap:8px;margin-top:6px"><button class="chip" type="button" data-act="here">Start from my selected place</button><button class="chip" type="button" data-act="swap">Swap</button><span class="grow"></span></div>
        <p class="small muted rt-hint" style="margin:8px 0 0"></p>
      </div>
      <div class="sec rt-out"><p class="muted small">Choose a start and a destination to see the road route, how far it strays from a straight line, and where a short new link could save distance.</p></div>`;
    $$('.rt-in', el).forEach(wireSearch);
    $$('.rt-pick', el).forEach(b => b.onclick = () => { pick = pick === b.dataset.w ? null : b.dataset.w; drawFields(); if (pick) toast(`Tap the map to set ${pick === 'a' ? 'the start (A)' : 'the destination (B)'}`); });
    q('[data-act=here]').onclick = () => { const p = state.place; if (p) setPoint('a', p, p.name); else toast('Pick a place first.'); };
    q('[data-act=swap]').onclick = () => { [A, B] = [B, A]; drawFields(); saveUrl(); if (A && B) run(); };
    const u = readUrl(), parse = s => { const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(s || ''); return m ? { lat: +m[1], lng: +m[2] } : null; };
    const ua = parse(u.ra), ub = parse(u.rb);
    if (ua) setPoint('a', ua); if (ub) setPoint('b', ub);
    drawFields();
  },
  show() {
    setClickHandler(e => { if (!pick) return; const w = pick; pick = null; setPoint(w, e.latlng); return false; });
    saveUrl();
  },
  hide() { pick = null; setClickHandler(null); setUrlParam('ra', ''); setUrlParam('rb', ''); },
  update(place) {
    if (!A && place && place.name) setPoint('a', place, place.name);
    else if (A && !A.name && place) drawFields();
  },
};
