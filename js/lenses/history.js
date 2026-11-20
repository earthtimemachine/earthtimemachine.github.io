// History lens: rulers through time (historical borders + Wikipedia/Wikidata), the place today, rocks, plates and deep-time positions.
import { $, $$, esc, state, getJSON, fmtYear, pool, km } from '../core.js';
import { map, lensGroup } from '../map.js';

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M6 4h11a2 2 0 0 1 2 2v11"/><path d="M6 4a2 2 0 0 0-2 2v1h4V6a2 2 0 0 0-2-2z"/><path d="M8 7v11a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-1H12"/><path d="M11 10h5M11 13h5"/></svg>';
export const YEARS = [-123000, -10000, -8000, -5000, -4000, -3000, -2000, -1500, -1000, -700, -500, -400, -323, -300, -200, -100, -1, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1279, 1300, 1400, 1492, 1500, 1530, 1600, 1650, 1700, 1715, 1783, 1800, 1815, 1878, 1880, 1900, 1914, 1920, 1930, 1938, 1945, 1960, 1994, 2000, 2010];
const fileFor = y => `data/hist/world_${y < 0 ? 'bc' + (-y) : y}.json`;
const slices = {};
export function getSlice(y) { return slices[y] ||= fetch(fileFor(y)).then(r => { if (!r.ok) throw 0; return r.json(); }).then(j => { j.features.forEach(f => f.bb = bbox(f.geometry)); return j; }); }
function bbox(g) { const a = [180, 90, -180, -90]; const w = c => { if (typeof c[0] === 'number') { if (c[0] < a[0]) a[0] = c[0]; if (c[1] < a[1]) a[1] = c[1]; if (c[0] > a[2]) a[2] = c[0]; if (c[1] > a[3]) a[3] = c[1]; } else c.forEach(w); }; if (g) w(g.coordinates); return a; }
function inRing(p, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1]; if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) c = !c; } return c; }
function inGeom(p, g) { if (!g) return false; const poly = rs => inRing(p, rs[0]) && !rs.slice(1).some(r => inRing(p, r)); return g.type === 'Polygon' ? poly(g.coordinates) : g.type === 'MultiPolygon' ? g.coordinates.some(poly) : false; }
export function featureAt(fc, p) { return fc.features.find(f => f.bb && p[0] >= f.bb[0] && p[0] <= f.bb[2] && p[1] >= f.bb[1] && p[1] <= f.bb[3] && inGeom(p, f.geometry)); }
const hue = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 360; };

let root, eraIdx = YEARS.length - 1, rule = {}, eraLayer = null, plates = null, gen = 0, geoGen = 0, playT = null, paleo = {}, maSel = 100;
const group = lensGroup('history'), plateLayer = L.layerGroup().addTo(group);
const bPane = map.createPane('borders'); bPane.style.zIndex = 400;
const pPane = map.createPane('plates'); pPane.style.zIndex = 410; pPane.style.pointerEvents = 'none';
fetch('data/plate-boundaries.json').then(r => r.json()).then(j => L.geoJSON(j, { pane: 'plates', interactive: false, style: { color: '#ff7a6e', weight: 1.3, opacity: .8, dashArray: '4 3' } }).addTo(plateLayer)).catch(() => { });
fetch('data/plates.json').then(r => r.json()).then(j => { j.features.forEach(f => f.bb = bbox(f.geometry)); plates = j; if (state.place && root) renderGeo(); }).catch(() => { });
const q = s => $(s, root);

/* ---------- era map ---------- */
async function showEra(i) {
  eraIdx = Math.max(0, Math.min(YEARS.length - 1, i)); const y = YEARS[eraIdx];
  q('.era').value = eraIdx; q('.eraLbl').textContent = fmtYear(y);
  const who = rule[y]; q('.eraWho').innerHTML = state.place ? (who ? `Here: <b>${esc(who.NAME)}</b>${who.SUBJECTO && who.SUBJECTO !== who.NAME ? ` <span class="muted">(subject to ${esc(who.SUBJECTO)})</span>` : ''}` : '<span class="muted">Here: no recorded state</span>') : '<span class="muted">Drag through time. Pick a place to see who ruled it.</span>';
  $$('.ev', root).forEach(e => e.classList.toggle('cur', +e.dataset.from <= y && y < (+e.dataset.to || 1e9)));
  try {
    const fc = await getSlice(y); if (YEARS[eraIdx] !== y) return;
    const hit = state.place ? featureAt(fc, [state.place.lng, state.place.lat]) : null;
    const nl = L.geoJSON(fc, { pane: 'borders',
      style: f => f === hit ? { color: '#e3b964', weight: 2.5, fillColor: `hsl(${hue(f.properties.NAME)},50%,50%)`, fillOpacity: .45 } : { color: 'rgba(234,242,245,.5)', weight: .7, fillColor: `hsl(${hue(f.properties.NAME)},50%,50%)`, fillOpacity: .22 },
      onEachFeature: (f, l) => l.bindTooltip(`<b>${esc(f.properties.NAME || '—')}</b>${f.properties.SUBJECTO && f.properties.SUBJECTO !== f.properties.NAME ? '<br>subject to ' + esc(f.properties.SUBJECTO) : ''}<br>${fmtYear(y)}`, { sticky: true }) });
    if (eraLayer) group.removeLayer(eraLayer); eraLayer = nl.addTo(group);
  } catch (e) { }
}
function play() {
  if (playT) { clearInterval(playT); playT = null; q('[data-act=play]').textContent = '▶'; return; }
  if (eraIdx >= YEARS.length - 1) showEra(0); q('[data-act=play]').textContent = '❚❚';
  playT = setInterval(() => { if (eraIdx >= YEARS.length - 1) return play(); showEra(eraIdx + 1); }, 1300);
}

/* ---------- who ruled here ---------- */
export async function rulersAt(p, onProgress) {
  const pt = [p.lng, p.lat], res = {}; let done = 0;
  await pool([...YEARS].reverse(), 6, async y => { try { const f = featureAt(await getSlice(y), pt); res[y] = f ? f.properties : null; } catch (e) { res[y] = undefined; } done++; onProgress && onProgress(done); });
  const groups = []; YEARS.forEach(y => { const r = res[y], n = r ? r.NAME : null, last = groups[groups.length - 1]; if (last && last.name === n) last.years.push(y); else groups.push({ name: n, r, years: [y] }); });
  groups.forEach((g, i) => { g.from = g.years[0]; g.to = groups[i + 1] ? groups[i + 1].years[0] : null; });
  return { res, groups: groups.filter(g => g.name).reverse() };
}
async function buildTimeline() {
  const my = ++gen; rule = {};
  q('.tl').innerHTML = '<p class="muted small">Looking through 54 historical maps…</p>';
  const { res, groups } = await rulersAt(state.place, n => { if (my === gen && n % 9 === 0) q('.tl').innerHTML = `<p class="muted small">Looking through historical maps… ${n}/${YEARS.length}</p>`; });
  if (my !== gen) return; rule = res;
  q('.tl').innerHTML = groups.length ? groups.map(g => { const sub = g.r.SUBJECTO && g.r.SUBJECTO !== g.r.NAME ? `subject to ${esc(g.r.SUBJECTO)}` : (g.r.PARTOF && g.r.PARTOF !== g.r.NAME ? `part of ${esc(g.r.PARTOF)}` : '');
    return `<div class="ev" data-from="${g.from}" data-to="${g.to ?? ''}" data-name="${esc(g.name)}" style="--c:hsl(${hue(g.name)},55%,58%)"><div class="yr">${fmtYear(g.from)} – ${g.to == null ? 'present' : fmtYear(g.to)}</div>
      <div class="nm" role="button" tabindex="0">${esc(g.name)}</div>${sub ? `<div class="sub">${sub}</div>` : ''}<div class="more"></div></div>`; }).join('') : '<p class="muted small">No historical states recorded here (open sea or unclaimed land).</p>';
  $$('.ev .nm', root).forEach(el => { const go = () => { const ev = el.parentElement; showEra(YEARS.indexOf(+ev.dataset.from)); toggleInfo(ev); }; el.onclick = go; el.onkeydown = e => { if (e.key === 'Enter') go(); }; });
  $$('.ev', root).slice(0, 2).forEach(ev => toggleInfo(ev, true));
  showEra(eraIdx);
}
const infoCache = {};
const WD = { P38: 'Currency', P36: 'Capital', P37: 'Language', P140: 'Religion', P122: 'Government' };
const wdYear = t => { const m = /^([+-])(\d+)-/.exec(t || ''); return m ? (m[1] === '-' ? `${+m[2]} BCE` : `${+m[2]} CE`) : null; };
export function polityInfo(name, hint = '') {
  const key = name + '|' + hint; if (infoCache[key]) return infoCache[key];
  return infoCache[key] = (async () => {
    const s = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent((name + ' ' + hint).trim())}&srlimit=1&format=json&origin=*`, { ttl: 864e5 });
    const title = s.query?.search?.[0]?.title; if (!title) return null;
    const sum = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, { ttl: 864e5 });
    const out = { title: sum.title, extract: sum.extract, thumb: sum.thumbnail?.source, url: sum.content_urls?.mobile?.page, facts: [] };
    if (sum.wikibase_item) {
      const e = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${sum.wikibase_item}&props=claims&format=json&origin=*`, { ttl: 864e5 });
      const cl = e.entities?.[sum.wikibase_item]?.claims || {}, wanted = [];
      Object.keys(WD).forEach(p => (cl[p] || []).slice(0, 4).forEach(c => { const v = c.mainsnak?.datavalue?.value; if (v?.id) wanted.push([p, v.id]); }));
      const labels = {};
      if (wanted.length) { const lj = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${[...new Set(wanted.map(w => w[1]))].slice(0, 50).join('|')}&props=labels&languages=en&format=json&origin=*`, { ttl: 864e5 });
        Object.entries(lj.entities || {}).forEach(([id, v]) => labels[id] = v.labels?.en?.value); }
      Object.keys(WD).forEach(p => { const vals = [...new Set(wanted.filter(w => w[0] === p).map(w => labels[w[1]]).filter(Boolean))]; if (vals.length) out.facts.push([WD[p], vals.join(', ')]); });
      const t0 = wdYear(cl.P571?.[0]?.mainsnak?.datavalue?.value?.time), t1 = wdYear(cl.P576?.[0]?.mainsnak?.datavalue?.value?.time);
      if (t0 || t1) out.facts.unshift(['Existed', `${t0 || '?'} – ${t1 || '?'}`]);
    }
    return out;
  })().catch(() => null);
}
async function toggleInfo(ev, open) {
  const box = ev.querySelector('.more'); if (box.innerHTML && !open) { box.innerHTML = ''; return; } if (box.innerHTML) return;
  box.innerHTML = '<div class="info"><span class="muted small">Loading details…</span></div>';
  const i = await polityInfo(ev.dataset.name, 'kingdom empire dynasty history');
  if (!i) { box.innerHTML = `<div class="info"><span class="muted small">No encyclopedia entry found. <a href="https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(ev.dataset.name)}" target="_blank" rel="noopener">Search Wikipedia</a></span></div>`; return; }
  box.innerHTML = `<div class="info">${i.thumb ? `<img src="${esc(i.thumb)}" alt="" loading="lazy">` : ''}<div><b>${esc(i.title)}</b>
    ${i.facts.length ? `<dl class="kv">${i.facts.map(f => `<dt>${esc(f[0])}</dt><dd>${esc(f[1])}</dd>`).join('')}</dl>` : ''}
    <p class="note" style="margin:6px 0 4px">${esc((i.extract || '').slice(0, 300))}${(i.extract || '').length > 300 ? '…' : ''}</p>${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">Read on Wikipedia</a>` : ''}</div></div>`;
}

/* ---------- today ---------- */
async function renderToday() {
  const a = state.place?.admin; const box = q('.today');
  if (!a) { box.innerHTML = '<span class="muted small">Loading…</span>'; return; }
  const rows = [['Country', a.country], ['State or region', a.state], ['District', a.district], ['Town or village', a.local]].filter(r => r[1]);
  box.innerHTML = `<dl class="kv">${rows.map(r => `<dt>${r[0]}</dt><dd>${esc(r[1])}</dd>`).join('')}<dt>Currency</dt><dd class="cur muted">…</dd></dl>`;
  if (a.country) { const i = await polityInfo(a.country, 'country'); const c = i?.facts.find(f => f[0] === 'Currency'); const el = q('.cur'); if (el) { el.textContent = c ? c[1] : '–'; el.classList.remove('muted'); } }
}

/* ---------- ground & deep time ---------- */
const MOTION = { 'India': 'moving north-northeast about 4–5 cm a year, still pushing into Asia and raising the Himalaya', 'Eurasia': 'moving slowly east, about 1–2 cm a year', 'Africa': 'moving north-east about 2 cm a year', 'Somalia': 'slowly pulling away from Africa along the East African Rift', 'North America': 'moving west-southwest about 2 cm a year', 'South America': 'moving west about 1–2 cm a year', 'Pacific': 'moving north-west 7–10 cm a year, the fastest large plate', 'Australia': 'moving north-northeast about 6–7 cm a year', 'Antarctica': 'almost stationary, under 1 cm a year', 'Arabia': 'moving north-northeast 2–3 cm a year into Eurasia', 'Nazca': 'moving east 5–7 cm a year, sliding under South America', 'Philippine Sea': 'moving west-northwest 6–8 cm a year', 'Cocos': 'moving north-east 6–8 cm a year under Central America', 'Caribbean': 'moving east about 1–2 cm a year', 'Sunda': 'moving slowly east-southeast, about 1 cm a year', 'Juan de Fuca': 'sliding under North America about 3–4 cm a year' };
const MAS = [0, 10, 50, 100, 150, 200, 250, 300, 400, 500];
const MA_NOTE = { 10: 'Miocene: grasslands spreading, apes in Africa and Asia', 50: 'Eocene: a warm world; India meeting Asia', 100: 'Cretaceous: dinosaurs; Gondwana breaking apart', 150: 'Jurassic: Pangaea splitting into Laurasia and Gondwana', 200: 'Early Jurassic: Pangaea starting to break up', 250: 'Permian–Triassic: Pangaea, after the largest mass extinction', 300: 'Carboniferous: coal forests; Pangaea assembling', 400: 'Devonian: first forests and four-legged animals', 500: 'Cambrian: early animals in the seas' };
async function renderGeo() {
  const my = ++geoGen, p = state.place, plate = plates ? featureAt(plates, [p.lng, p.lat]) : null, pn = plate?.properties.PlateName;
  q('.geo').innerHTML = `<dl class="kv"><dt>Tectonic plate</dt><dd>${pn ? `${esc(pn)} Plate${MOTION[pn] ? `, ${MOTION[pn]}` : ''}` : '<span class="muted">loading…</span>'}</dd><dt>Rock here</dt><dd class="rock muted">loading…</dd></dl>`;
  try {
    const j = await getJSON(`https://macrostrat.org/api/v2/geologic_units/map?lat=${p.lat.toFixed(4)}&lng=${p.lng.toFixed(4)}`, { ttl: 864e5 }); if (my !== geoGen) return;
    const ord = { large: 0, medium: 1, small: 2, tiny: 3 }, u = (j.success?.data || []).sort((a, b) => (ord[a.scale] ?? 9) - (ord[b.scale] ?? 9))[0], el = q('.rock');
    if (u) { el.classList.remove('muted'); el.innerHTML = `<b>${esc(u.name || u.strat_name || 'Unnamed unit')}</b>${u.b_int_age != null && u.t_int_age != null ? `, ${esc(u.b_int_name || '')}${u.t_int_name && u.t_int_name !== u.b_int_name ? ' to ' + esc(u.t_int_name) : ''} (${Math.round(u.b_int_age)}–${Math.round(u.t_int_age)} million years old)` : ''}${u.lith ? `<br><span class="muted small">${esc(u.lith).slice(0, 160)}</span>` : ''}`; }
    else el.textContent = 'No geologic map unit recorded here (probably sea).';
  } catch (e) { const el = q('.rock'); if (el && my === geoGen) el.textContent = 'The geology service is not responding right now.'; }
  paleo = { 0: [p.lng, p.lat] }; q('.pinfo').textContent = 'Working out where this land was in the past…';
  await Promise.all(MAS.filter(t => t).map(async t => { try { const r = await getJSON(`https://gws.gplates.org/reconstruct/reconstruct_points/?lats=${p.lat.toFixed(4)}&lons=${p.lng.toFixed(4)}&time=${t}&model=PALEOMAP`, { ttl: 864e5 }); const pt = findPoint(r); if (pt) paleo[t] = pt; } catch (e) { } }));
  if (my !== geoGen) return; drawMa(); drawPaleo(maSel);
}
function findPoint(j) { if (!j) return null; if (Array.isArray(j.lons) && Array.isArray(j.lats)) return [j.lons[0], j.lats[0]]; if (j.coordinates) { const c = j.coordinates; return typeof c[0] === 'number' ? c : c[0]; }
  if (Array.isArray(j) && j.length === 2 && typeof j[0] === 'number') return j; if (Array.isArray(j)) { for (const x of j) { const p = findPoint(x); if (p) return p; } } if (typeof j === 'object') { for (const k in j) { const p = findPoint(j[k]); if (p) return p; } } return null; }
function drawMa() { q('.mabtns').innerHTML = MAS.map(t => `<button class="chip${t === maSel ? ' on' : ''}" data-ma="${t}">${t ? t + ' Ma' : 'Today'}</button>`).join(''); $$('.mabtns .chip', root).forEach(b => b.onclick = () => { maSel = +b.dataset.ma; drawMa(); drawPaleo(maSel); }); }
const coast = {};
async function drawPaleo(t) {
  const X = l => l + 180, Y = l => 90 - l, has = Object.keys(paleo).length > 1, cur = paleo[t];
  q('.pinfo').innerHTML = !has ? 'The past-positions service (GPlates) is not responding, so the deep-time map is unavailable right now.'
    : cur ? `<b>${t ? `${t} million years ago` : 'Today'}</b>${t ? `: ${MA_NOTE[t]}` : ''}<br>This spot was at <b>${Math.abs(cur[1]).toFixed(0)}°${cur[1] >= 0 ? 'N' : 'S'}, ${Math.abs(cur[0]).toFixed(0)}°${cur[0] >= 0 ? 'E' : 'W'}</b>${t ? `, about ${Math.round(km([paleo[0][1], paleo[0][0]], [cur[1], cur[0]])).toLocaleString()} km from where it is today` : ''}. The dashed line traces its journey.` : `No position for ${t} Ma (this crust may be younger).`;
  let d = '';
  try { coast[t] ||= getJSON(`https://gws.gplates.org/reconstruct/coastlines/?time=${t}&model=PALEOMAP`, { ttl: 864e5, timeout: 40000 }); const g = await coast[t];
    const ring = r => 'M' + r.map(c => `${X(c[0]).toFixed(1)},${Y(c[1]).toFixed(1)}`).join('L') + 'Z';
    (g.features || []).forEach(f => { const gm = f.geometry; if (!gm) return; if (gm.type === 'Polygon') d += gm.coordinates.map(ring).join(''); else if (gm.type === 'MultiPolygon') gm.coordinates.forEach(pp => d += pp.map(ring).join('')); }); } catch (e) { }
  const track = MAS.filter(m => paleo[m]).map(m => `${X(paleo[m][0]).toFixed(1)},${Y(paleo[m][1]).toFixed(1)}`);
  q('.paleo').innerHTML = `<rect width="360" height="180" fill="#0d2c44"/><path d="M0,90H360M180,0V180" stroke="rgba(234,242,245,.12)" stroke-width=".4"/>
    ${d ? `<path d="${d}" fill="#4d6b4a" stroke="#8fae8b" stroke-width=".25" fill-rule="evenodd"/>` : '<text x="180" y="94" fill="#9fb6c3" font-size="8" text-anchor="middle">coastlines unavailable</text>'}
    ${track.length > 1 ? `<polyline points="${track.join(' ')}" fill="none" stroke="#e3b964" stroke-width=".9" stroke-dasharray="2 1.5"/>` : ''}
    ${cur ? `<circle cx="${X(cur[0])}" cy="${Y(cur[1])}" r="3.4" fill="#e3b964" stroke="#fff" stroke-width=".8"/>` : ''}<text x="5" y="11" fill="#d8e4ea" font-size="8">${t ? t + ' million years ago' : 'Today'}</text>`;
}

export default {
  id: 'history', title: 'History', icon: ICON, base: 'relief', desc: 'Who ruled this place, its rocks and where the land was long ago',
  init(el) {
    root = el;
    el.innerHTML = `
      <div class="sec" style="position:sticky;top:0;background:var(--abyss);z-index:2">
        <div class="row"><button class="btn" data-act="prev" aria-label="Earlier">‹</button><b class="eraLbl" style="min-width:86px;color:var(--ochre);font-family:var(--display)"></b>
          <input type="range" class="era grow" min="0" max="${YEARS.length - 1}" step="1" aria-label="Year"><button class="btn" data-act="next" aria-label="Later">›</button><button class="btn" data-act="play" aria-label="Play through time">▶</button></div>
        <div class="eraWho small" style="margin-top:6px"></div></div>
      <div class="sec"><h2>Who ruled here</h2><div class="tl"><p class="muted small">Pick a place to see its rulers from prehistory to today.</p></div></div>
      <div class="sec"><h2>Today</h2><div class="today"><span class="muted small">–</span></div></div>
      <div class="sec"><h2>Ground and deep time <label class="aside"><input type="checkbox" class="plTog" checked> plate edges</label></h2><div class="geo"><span class="muted small">–</span></div>
        <div class="chips mabtns" style="margin:10px 0 8px"></div><svg class="paleo" viewBox="0 0 360 180" style="width:100%;aspect-ratio:2/1;border-radius:10px;display:block"></svg><p class="note pinfo" style="margin-top:8px"></p></div>
      <div class="sec note">Borders: <a href="https://github.com/aourednik/historical-basemaps" target="_blank" rel="noopener">historical-basemaps</a> (A. Ourednik, GPL-3.0), simplified. They are approximate, change only at the snapshot years and contain mistakes: check important facts on Wikipedia.
        Details: Wikipedia and Wikidata. Rocks: <a href="https://macrostrat.org/" target="_blank" rel="noopener">Macrostrat</a> (CC BY 4.0). Plates: Bird (2002), PB2002. Past positions: <a href="https://www.gplates.org/" target="_blank" rel="noopener">GPlates</a>, PALEOMAP model.</div>`;
    q('.era').oninput = e => showEra(+e.target.value);
    q('[data-act=prev]').onclick = () => showEra(eraIdx - 1); q('[data-act=next]').onclick = () => showEra(eraIdx + 1); q('[data-act=play]').onclick = play;
    q('.plTog').onchange = e => e.target.checked ? plateLayer.addTo(group) : group.removeLayer(plateLayer);
    showEra(eraIdx);
  },
  show() { if (map.getZoom() > 8) map.setZoom(7); },
  hide() { if (playT) play(); },
  update(place, why) {
    const k = place ? `${place.lat},${place.lng}` : 'none';
    if (this._k !== k) { this._k = k; if (place) { buildTimeline(); renderGeo(); } }
    if (place) renderToday();
  },
};
