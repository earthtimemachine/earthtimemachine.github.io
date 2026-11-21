// Imagery lens: one timeline for four imagery sources (NASA daily, Sentinel-2, Landsat, aerial/hi-res).
import { $, $$, esc, h, state, on, setDate, toast, getJSON, pool, addDays, addMonths, fmtDate, fmtDay, yesterday, today, km, setUrlParam, readUrl } from '../core.js';
import { map, lensGroup, startSwipe, stopSwipe, swipeOn, SWIPE_PANES, mapBanner, ensureZoom } from '../map.js';

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M3 4l4 4M21 20l-4-4M9 12H4M20 12h-5M4 9v6M20 9v6"/></svg>';
const GIBS3857 = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', GIBS4326 = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
const PRODUCTS = [
  ['VIIRS_NOAA20_CorrectedReflectance_TrueColor', 'True colour · VIIRS NOAA-20', '2017-12-01'],
  ['VIIRS_SNPP_CorrectedReflectance_TrueColor', 'True colour · VIIRS Suomi NPP', '2015-11-24'],
  ['MODIS_Terra_CorrectedReflectance_TrueColor', 'True colour · MODIS Terra (since 2000)', '2000-02-24'],
  ['MODIS_Aqua_CorrectedReflectance_TrueColor', 'True colour · MODIS Aqua (since 2002)', '2002-07-04'],
  ['MODIS_Terra_CorrectedReflectance_Bands721', 'False colour · floods, burn scars, snow', '2000-02-24']];
const PC = 'https://planetarycomputer.microsoft.com/api';
const LS_RENDER = 'assets=red&assets=green&assets=blue&color_formula=gamma+RGB+2.7%2C+saturation+1.5%2C+sigmoidal+RGB+15+0.55&nodata=0&format=png';
const SOURCES = {
  daily:   { label: 'Daily', what: 'NASA satellites photograph the whole planet every day (250–375 m detail). Best for weather, smoke, floods and seasons.', minZ: 2, maxZ: 12,
             modes: [['week', 'Clearest day each week · 6 months'], ['month', 'Clearest day each month · 2 years'], ['year', 'Same week each year · since 2001'], ['day', 'Every day · last 30 days']] },
  s2:      { label: 'Sentinel-2', what: 'Every pass of the European Sentinel-2 satellites, 10 m detail, every few days since 2016. Best for fields, ports and construction.', minZ: 8, maxZ: 16,
             modes: [['month', 'Clearest each month · 2 years'], ['scene', 'Every clear pass · 6 months'], ['quarter', 'Clearest each quarter · since 2016'], ['year', 'Clearest each year · since 2016']] },
  aerial:  { label: 'Hi-res', what: 'Sharp aerial and satellite photos (about 0.5 m) from Esri, with every version since 2014. Updated every few months to years.', minZ: 12, maxZ: 19,
             modes: [['15', 'Changes over ~3.5 km'], ['16', 'Changes over ~1.8 km'], ['17', 'Changes over ~900 m'], ['18', 'Changes over ~450 m']] },
  landsat: { label: 'Landsat', what: 'NASA/USGS Landsat, 30 m detail, back to 1984. Best for long-term change: cities, reservoirs, coastlines.', minZ: 7, maxZ: 14,
             modes: [['year', 'Clearest each year · since 1984'], ['quarter', 'Clearest each quarter · since 2013'], ['scene', 'Every clear pass · 12 months']] },
};

let root, src = 'daily', mode = {}, product = PRODUCTS[0][0], items = [], sel = null, left = null, side = 'right', gen = 0, playing = null, mainLayer = null, leftLayer = null, waybackAll = null;
const group = lensGroup('imagery');
const q = s => $(s, root);

const dayLabel = d => d.slice(0, 4) === today().slice(0, 4) ? fmtDay(d) : fmtDate(d);
/* ---------- layer factories ---------- */
function dailyLayer(date, pane) { return L.tileLayer.wms(GIBS3857, { layers: product, time: date, format: 'image/jpeg', transparent: false, version: '1.1.1', tileSize: 512, pane, maxZoom: 19, attribution: 'Imagery © NASA GIBS / EOSDIS' }); }
const pcTile = (coll, id, extra) => `${PC}/data/v1/item/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?collection=${coll}&item=${encodeURIComponent(id)}&${extra}`;
const S2_RENDER = 'assets=visual&asset_bidx=visual%7C1%2C2%2C3&nodata=0&format=png';
function tileLayer(tpl, pane, opts = {}) { return L.tileLayer(tpl, { pane, maxZoom: 19, ...opts }); }
function makeLayer(it, pane = 'tilePane') { return it.layer(pane); }

/* ---------- thumbnails ---------- */
function tilePos(z) { const n = 2 ** z, lat = state.place.lat * Math.PI / 180; return { x: (state.place.lng + 180) / 360 * n, y: (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * n }; }
function fillTiles(el, urlFor, z, size) {
  el.innerHTML = ''; el.style.width = el.style.height = size + 'px';
  const p = tilePos(z), half = size / 2, n = 2 ** z;
  for (let x = Math.floor(p.x - half / 256); x <= Math.floor(p.x + half / 256); x++) for (let y = Math.floor(p.y - half / 256); y <= Math.floor(p.y + half / 256); y++) {
    const im = new Image(); im.loading = 'lazy'; im.alt = ''; im.src = urlFor(z, ((x % n) + n) % n, y);
    im.style.left = (half + (x - p.x) * 256) + 'px'; im.style.top = (half + (y - p.y) * 256) + 'px'; el.appendChild(im);
  }
  el.insertAdjacentHTML('beforeend', '<i class="xh"></i>');
}
const tplUrl = tpl => (z, x, y) => tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{s}', 'wayback');
function dailyBox(kmSize = 100) { const p = state.place, dLat = kmSize / 111.32 / 2, dLon = dLat / Math.max(.15, Math.cos(p.lat * Math.PI / 180)); return [p.lng - dLon, p.lat - dLat, p.lng + dLon, p.lat + dLat].map(v => v.toFixed(4)).join(','); }
const dailyThumbUrl = (date, px = 160) => `${GIBS4326}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&SRS=EPSG:4326&STYLES=&FORMAT=image/jpeg&LAYERS=${product}&TIME=${date}&BBOX=${dailyBox()}&WIDTH=${px}&HEIGHT=${px}`;
function scoreImage(url) {
  return new Promise(res => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { try { const c = document.createElement('canvas'); c.width = c.height = 48; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 48, 48);
      const d = x.getImageData(0, 0, 48, 48).data; let cl = 0, nd = 0; const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); if (mx <= 4) nd++; else if (mx > 185 && mx - mn < 38) cl++; }
      res({ ok: true, cloud: cl / Math.max(1, n - nd), nodata: nd / n }); } catch (e) { res({ ok: true, cloud: null, nodata: 0 }); } };
    img.onerror = () => res({ ok: false }); img.src = url;
  });
}

/* ---------- building the timeline for each source ---------- */
async function buildDaily(my) {
  const m = mode.daily || 'week', end = state.date || yesterday(), prodStart = PRODUCTS.find(p => p[0] === product)[2], groups = [];
  const N = { week: 26, month: 24, year: 26, day: 30 }[m];
  for (let i = N - 1; i >= 0; i--) {
    const anchor = m === 'week' ? addDays(end, -7 * i) : m === 'month' ? addMonths(end, -i) : m === 'year' ? addMonths(end, -12 * i) : addDays(end, -i);
    const cands = m === 'day' ? [anchor] : [0, 1, 2, 3, 4, 5, 6].map(k => addDays(anchor, -k));
    const ok = cands.filter(d => d >= prodStart && d <= today()); if (ok.length) groups.push(ok);
  }
  items = groups.map(g => ({ key: g[0], date: g[0], label: dayLabel(g[0]), sub: 'scoring…', pending: true, cands: g,
    layer: pane => dailyLayer(itemsDate(g), pane), thumb: (el, size) => { const im = new Image(); im.alt = ''; im.src = dailyThumbUrl(itemsDate(g), size); im.style.cssText = `width:${size}px;height:${size}px;object-fit:cover;position:static`; el.innerHTML = ''; el.appendChild(im); } }));
  drawStrip();
  // pick the clearest day in each group (newest groups first)
  const order = items.map((_, i) => i).reverse();
  await pool(order, 6, async i => {
    const it = items[i]; if (my !== gen) return;
    const scored = await Promise.all(it.cands.map(async d => ({ d, s: await scoreImage(dailyThumbUrl(d, 96)) })));
    if (my !== gen) return;
    const good = scored.filter(x => x.s.ok).sort((a, b) => bad(a.s) - bad(b.s));
    if (!good.length) { it.sub = 'no image'; it.pending = false; it.dead = true; updateCard(i); return; }
    const b = good[0]; it.date = it.key = b.d; it.label = dayLabel(b.d); it.cloud = b.s.cloud; it.nodata = b.s.nodata; it.pending = false; it.chosen = b.d;
    it.sub = b.s.nodata > .5 ? 'no pass here' : b.s.cloud == null ? '' : `☁ ${Math.round(b.s.cloud * 100)}%`;
    updateCard(i);
  });
  function bad(s) { return s.cloud == null ? .5 : s.nodata > .5 ? 2 + s.nodata : s.cloud + s.nodata * 1.5; }
  function itemsDate(g) { const it = items.find(x => x.cands === g); return (it && it.chosen) || g[0]; }
}
const SCENE = {
  s2: { coll: 'sentinel-2-l2a', render: S2_RENDER, km: 110, label: 'Sentinel-2', res: '10 m', thumbZ: 13,
        modes: { scene: { from: () => addMonths(today(), -6), cloud: 30 }, month: { from: () => addMonths(today(), -24), cloud: 60, g: 'm' }, quarter: { from: () => '2016-01-01', cloud: 60, g: 'q' }, year: { from: () => '2016-01-01', cloud: 40, g: 'y' } } },
  landsat: { coll: 'landsat-c2-l2', render: LS_RENDER, km: 185, label: 'Landsat', res: '30 m', thumbZ: 12, keep: (id, d) => !(id.startsWith('LE07') && d > '2003-05-30') && !id.startsWith('LT04') && !id.startsWith('LM'),
        modes: { scene: { from: () => addMonths(today(), -12), cloud: 30 }, quarter: { from: () => '2013-01-01', cloud: 50, g: 'q' }, year: { from: () => '1984-01-01', cloud: 40, g: 'y' } } },
};
async function buildScenes(my) {
  const S = SCENE[src], m = S.modes[mode[src] || Object.keys(S.modes).find(k => SOURCES[src].modes[0][0] === k)], p = state.place;
  const body = { collections: [S.coll], intersects: { type: 'Point', coordinates: [p.lng, p.lat] }, datetime: m.from() + 'T00:00:00Z/..', limit: 1000,
    query: { 'eo:cloud_cover': { lt: m.cloud } }, sortby: [{ field: 'datetime', direction: 'desc' }],
    fields: { include: ['id', 'properties.datetime', 'properties.eo:cloud_cover'], exclude: ['assets', 'links', 'geometry', 'bbox'] } };
  let js;
  try { js = await getJSON(`${PC}/stac/v1/search`, { ttl: 36e5, init: { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } }); }
  catch (e) { delete body.fields; js = await getJSON(`${PC}/stac/v1/search`, { ttl: 36e5, init: { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } }); }
  let feats = js.features || [];
  for (let page = 0; page < 4; page++) { const nx = (js.links || []).find(l => l.rel === 'next'); if (!nx) break;
    try { js = nx.method === 'POST' ? await getJSON(nx.href, { init: { method: 'POST', body: JSON.stringify({ ...body, ...(nx.body || {}) }), headers: { 'Content-Type': 'application/json' } } }) : await getJSON(nx.href); feats = feats.concat(js.features || []); } catch (e) { break; } }
  if (my !== gen) return;
  const byDay = new Map();
  feats.forEach(f => { const d = f.properties.datetime.slice(0, 10), c = f.properties['eo:cloud_cover'] ?? 100; if (S.keep && !S.keep(f.id, d)) return; const cur = byDay.get(d); if (!cur || c < cur.c) byDay.set(d, { id: f.id, d, c }); });
  let sc = [...byDay.values()];
  if (m.g) { const g = new Map(); sc.forEach(x => { const k = m.g === 'm' ? x.d.slice(0, 7) : m.g === 'y' ? x.d.slice(0, 4) : x.d.slice(0, 4) + 'Q' + (Math.floor((+x.d.slice(5, 7) - 1) / 3) + 1); const cur = g.get(k); if (!cur || x.c < cur.c) g.set(k, x); }); sc = [...g.values()]; }
  sc.sort((a, b) => a.d.localeCompare(b.d));
  items = sc.map(x => { const tpl = pcTile(S.coll, x.id, S.render);
    return { key: x.id, date: x.d, label: fmtDate(x.d), sub: `☁ ${Math.round(x.c)}% scene`, cloud: x.c,
      layer: pane => tileLayer(tpl, pane, { minZoom: 7, maxNativeZoom: S.thumbZ + 3, attribution: `${S.label} (Copernicus / NASA-USGS) via Microsoft Planetary Computer` }),
      thumb: (el, size) => fillTiles(el, tplUrl(tpl), S.thumbZ, size) }; });
  drawStrip();
}
async function buildAerial(my) {
  if (!window.Wayback) throw new Error('wayback');
  if (!waybackAll) waybackAll = await Wayback.getWaybackItems();
  const z = +(mode.aerial || '15'), p = state.place, step = 360 / 2 ** z, latStep = step * Math.cos(p.lat * Math.PI / 180), seen = new Map(), pts = [];
  for (const dy of [0, -1, 1]) for (const dx of [0, -1, 1]) pts.push({ longitude: p.lng + dx * step, latitude: p.lat + dy * latStep });
  let ok = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const rs = await Promise.allSettled(pts.slice(i, i + 3).map(pt => Wayback.getWaybackItemsWithLocalChanges(pt, z)));
    if (my !== gen) return;
    rs.forEach(r => { if (r.status === 'fulfilled') { ok++; r.value.forEach(it => seen.set(it.releaseNum, it)); } });
    q('.strip-note').textContent = `Checking the area around the pin… ${Math.min(i + 3, 9)}/9`;
  }
  if (!ok) throw new Error('wayback');
  const found = [...seen.values()].sort((a, b) => a.releaseDatetime - b.releaseDatetime);
  items = found.map(w => { const tpl = w.itemURL.replace('{level}', '{z}').replace('{row}', '{y}').replace('{col}', '{x}').replace('//wayback.maptiles', '//{s}.maptiles');
    return { key: 'wb' + w.releaseNum, date: new Date(w.releaseDatetime).toISOString().slice(0, 10), label: 'Version ' + w.releaseDateLabel, sub: 'loading date…', wb: w,
      layer: pane => tileLayer(tpl, pane, { subdomains: ['wayback', 'wayback-a', 'wayback-b'], maxNativeZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics; Wayback © Esri' }),
      thumb: (el, size) => fillTiles(el, tplUrl(tpl), Math.min(19, z - 1), size) }; });
  drawStrip();
  // photo capture dates
  await pool(items.map((_, i) => i), 4, async i => { const it = items[i];
    try { const m = await Wayback.getMetadata({ longitude: p.lng, latitude: p.lat }, Math.min(23, z + 2), it.wb.releaseNum); if (my !== gen) return;
      if (m) { it.label = 'Photo ' + fmtDate(new Date(m.date).toISOString().slice(0, 10)); it.date = new Date(m.date).toISOString().slice(0, 10); it.sub = [m.provider || m.source, m.resolution ? m.resolution + ' m' : ''].filter(Boolean).join(' · '); }
      else it.sub = ''; } catch (e) { it.sub = ''; }
    updateCard(i); });
}

/* ---------- strip & selection ---------- */
function drawStrip() {
  const strip = q('.strip'); const size = innerWidth < 560 ? 104 : 120;
  if (!items.length) { strip.innerHTML = `<div class="muted small" style="padding:8px 0">No images found for this spot and period. Try another interval or source.</div>`; return; }
  strip.innerHTML = items.map((it, i) => `<div class="card" data-i="${i}" role="button" tabindex="0" aria-label="${esc(it.label)}"><div class="tile-view" style="width:${size}px;height:${size}px"></div><div class="cap"><b>${esc(it.label)}</b><span>${esc(it.sub || '')}</span></div></div>`).join('');
  $$('.card', strip).forEach(c => {
    const i = +c.dataset.i; items[i].thumb(c.querySelector('.tile-view'), size);
    const pick = () => { stopPlay(); choose(items[i]); };
    c.onclick = pick; c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
  });
  requestAnimationFrame(() => strip.scrollLeft = strip.scrollWidth);
  q('.strip-note').textContent = `${items.length} image${items.length > 1 ? 's' : ''}, oldest on the left. Tap one to show it on the map.`;
  if (src !== 'daily' && !sel) choose(items[items.length - 1], true);
  markCards();
}
function updateCard(i) {
  const c = q(`.card[data-i="${i}"]`), it = items[i]; if (!c) return;
  c.querySelector('.cap').innerHTML = `<b>${esc(it.label)}</b><span>${esc(it.sub || '')}</span>`;
  if (src === 'daily' && it.chosen) it.thumb(c.querySelector('.tile-view'), parseInt(c.querySelector('.tile-view').style.width));
  c.style.opacity = it.dead ? .45 : ''; fillCmp();
}
function markCards() { fillCmp(); $$('.card', q('.strip')).forEach(c => { const it = items[+c.dataset.i]; c.classList.toggle('on', !!sel && it === sel); c.classList.toggle('left', !!left && it === left); }); }
function choose(it, quiet) {
  if (!it || it.dead) return;
  if (swipeOn() && side === 'left') { left = it; showLeft(); }
  else { sel = it; showMain(); if (swipeOn()) showLeft(); if (!quiet && it.date) setDate(it.date, state.date2); }
  markCards(); describe();
}
function showMain() {
  const old = mainLayer;
  if (src !== 'daily' && !sel) { if (old) group.removeLayer(old); mainLayer = null; zoomBanner(); return; }
  mainLayer = (src === 'daily' && !sel) ? dailyLayer(state.date, swipeOn() ? SWIPE_PANES.right : 'tilePane') : makeLayer(sel, swipeOn() ? SWIPE_PANES.right : 'tilePane');
  mainLayer.addTo(group);
  if (old) { let done = false; const rm = () => { if (!done) { done = true; group.removeLayer(old); } }; mainLayer.once('load', rm); setTimeout(rm, 2500); }
  zoomBanner();
}
function showLeft() { if (leftLayer) group.removeLayer(leftLayer); if (!left) return; leftLayer = makeLayer(left, SWIPE_PANES.left).addTo(group); startSwipe(left.label, sel ? sel.label : dayLabel(state.date)); state.date2 = left.date; }
function describe() {
  const it = sel, s = SOURCES[src];
  let t = '';
  if (src === 'daily') t = `Showing <b>${fmtDate(it ? it.date : state.date)}</b> · ${PRODUCTS.find(p => p[0] === product)[1]}${it && it.cloud != null ? ` · ☁ about ${Math.round(it.cloud * 100)}% cloud near the pin` : ''}`;
  else if (it) t = `Showing <b>${esc(it.label)}</b>${it.sub ? ' · ' + esc(it.sub) : ''}`;
  if (left) t = `Before <b>${esc(left.label)}</b> (left) · After <b>${esc(sel ? sel.label : dayLabel(state.date))}</b> (right)`;
  q('.now').innerHTML = t || `<span class="muted">${esc(s.what)}</span>`;
}
function zoomBanner() { const z = map.getZoom(), s = SOURCES[src]; mapBanner(z < s.minZ ? `Zoom in to see ${s.label} imagery` : ''); }

/* ---------- time-lapse on the map ---------- */
function stopPlay() { if (playing) { clearTimeout(playing); playing = null; q('[data-act=play]').textContent = '▶ Time-lapse'; } }
function play() {
  if (playing) return stopPlay();
  const list = items.filter(i => !i.dead && !i.pending); if (list.length < 2) return toast('Wait for the images to load, then try again.');
  if (swipeOn()) toggleCompare(false);
  q('[data-act=play]').textContent = '❚❚ Pause'; let k = 0;
  const step = () => { sel = list[k]; showMain(); markCards(); describe(); const c = q(`.card[data-i="${items.indexOf(sel)}"]`); c?.scrollIntoView({ inline: 'center', block: 'nearest' });
    k = (k + 1) % list.length; playing = setTimeout(step, src === 'daily' ? 1100 : 1600); };
  step();
}

/* ---------- compare ---------- */
function toggleCompare(on) {
  on = on ?? !swipeOn();
  q('[data-act=compare]').classList.toggle('on', on); q('[data-act=compare]').textContent = on ? 'Stop comparing' : 'Compare dates'; q('.cmp').classList.toggle('hidden', !on);
  if (!on) { stopSwipe(); if (leftLayer) group.removeLayer(leftLayer); leftLayer = null; left = null; state.date2 = null; setDate(state.date, null); showMain(); markCards(); describe(); return; }
  stopPlay();
  const avail = items.filter(i => !i.dead && !i.pending);
  if (!sel) sel = avail[avail.length - 1] || (src === 'daily' ? dayItem(state.date) : null);
  left = avail.find(i => i !== sel && i.date <= addMonths(sel ? sel.date : state.date, -12)) || avail.find(i => i !== sel) || (src === 'daily' ? dayItem(addMonths(sel ? sel.date : state.date, -12)) : null);
  startSwipe(left ? left.label : '', sel ? sel.label : '');
  showMain(); showLeft(); setSide('left'); markCards(); describe();
  if (!left) toast('Wait for the pictures to load, then pick Before and After.');
  if (left) setDate(state.date, left.date);
}
function dayItem(d) { return { key: 'd' + d, date: d, label: dayLabel(d), custom: true, layer: pane => dailyLayer(d, pane) }; }
function setCmp(sd, it) {
  if (it.dead) return toast('No image that day here. Pick another.');
  if (sd === 'left') { left = it; showLeft(); setDate(state.date, it.date); }
  else { sel = it; showMain(); showLeft(); setDate(it.date, left ? left.date : state.date2); }
  markCards(); describe();
}
function fillCmp() {
  if (!root || q('.cmp').classList.contains('hidden')) return;
  const daily = src === 'daily';
  for (const [sd, cur] of [['left', left], ['right', sel]]) {
    const sx = q(`.cmpSel[data-side="${sd}"]`), dx = q(`.cmpDate[data-side="${sd}"]`);
    const opts = items.map((it, i) => it.dead ? '' : `<option value="${i}">${esc(it.label)}${it.sub && !it.pending ? ' · ' + esc(it.sub) : ''}</option>`).join('');
    const idx = cur ? items.indexOf(cur) : -1;
    sx.innerHTML = (idx < 0 ? `<option value="" selected>${cur ? esc(cur.label) : 'Choose an image'}</option>` : '') + opts;
    if (idx >= 0) sx.value = String(idx);
    sx.classList.toggle('hidden', daily); dx.classList.toggle('hidden', !daily); if (daily && cur) dx.value = cur.date;
  }
}
function setSide(s) { side = s; $$('.sides button', root).forEach(b => b.classList.toggle('on', b.dataset.side === s)); }

/* ---------- rebuild ---------- */
async function rebuild() {
  const my = ++gen; stopPlay(); sel = null; left = null; if (swipeOn()) toggleCompare(false);
  items = []; q('.strip').innerHTML = '<div class="skeleton" style="width:100%;height:150px"></div>';
  q('.strip-note').textContent = 'Finding images of this spot…';
  if (!state.place) { q('.strip').innerHTML = ''; q('.strip-note').textContent = 'Pick a place to see how it changed.'; showMain(); describe(); return; }
  if (src === 'daily') showMain();
  try { if (src === 'daily') await buildDaily(my); else if (src === 'aerial') await buildAerial(my); else await buildScenes(my); }
  catch (e) { if (my === gen) { q('.strip').innerHTML = ''; q('.strip-note').textContent = `${SOURCES[src].label} images could not be loaded right now. Try again in a moment or pick another source.`; } }
  describe();
}
function setSource(s) {
  src = s; setUrlParam('src', s === 'daily' ? null : s);
  $$('.srcSeg button', root).forEach(b => b.classList.toggle('on', b.dataset.s === s));
  q('.what').textContent = SOURCES[s].what;
  q('.dailyRow').classList.toggle('hidden', s !== 'daily');
  q('.modeSel').innerHTML = SOURCES[s].modes.map(([k, l]) => `<option value="${k}"${(mode[s] || SOURCES[s].modes[0][0]) === k ? ' selected' : ''}>${l}</option>`).join('');
  if (state.place) { const S = SOURCES[s]; ensureZoom(state.place, Math.max(S.minZ, s === 'aerial' ? 15 : s === 's2' ? 11 : s === 'landsat' ? 10 : 5), S.maxZ); }
  rebuild();
}

export default {
  id: 'imagery', title: 'Imagery', icon: ICON, base: 'dark', desc: 'Satellite and aerial images of this place through time',
  init(el) {
    root = el;
    el.innerHTML = `
      <div class="sec">
        <div class="seg srcSeg" role="tablist" aria-label="Imagery source" style="width:100%;display:flex">${Object.entries(SOURCES).map(([k, s]) => `<button data-s="${k}" style="flex:1">${s.label}</button>`).join('')}</div>
        <p class="what note" style="margin:8px 0 0"></p>
        <div class="dailyRow" style="margin-top:10px">
          <select class="btn prodSel" aria-label="Satellite product" style="width:100%">${PRODUCTS.map(p => `<option value="${p[0]}">${p[1]}</option>`).join('')}</select>
          <div class="row" style="margin-top:8px"><span class="small muted">Map date</span><span class="grow"></span>
            <button class="btn" data-act="dprev" title="Day before" aria-label="Day before">‹</button><input type="date" class="btn dateIn" aria-label="Date"><button class="btn" data-act="dnext" title="Day after" aria-label="Day after">›</button></div>
        </div>
        <div class="now note" style="margin-top:10px"></div>
      </div>
      <div class="sec">
        <h2>This spot over time</h2>
        <div class="row" style="margin-bottom:8px"><select class="btn modeSel" aria-label="Interval"></select><span class="grow"></span>
          <button class="btn" data-act="play">▶ Time-lapse</button><button class="btn" data-act="compare">Compare dates</button></div>
        <div class="cmp hidden" role="group" aria-label="Compare two dates">
          <label class="cmp-row"><span class="cmp-k">Before</span><select class="btn cmpSel" data-side="left" aria-label="Before image"></select><input type="date" class="btn cmpDate" data-side="left" aria-label="Before date"></label>
          <label class="cmp-row"><span class="cmp-k">After</span><select class="btn cmpSel" data-side="right" aria-label="After image"></select><input type="date" class="btn cmpDate" data-side="right" aria-label="After date"></label>
          <div class="row cmp-tap"><span class="small muted">Tapping a picture below sets</span><div class="seg sides"><button data-side="left">Before</button><button data-side="right">After</button></div></div>
          <p class="note" style="margin:0">Drag the line on the map to slide between them. Before is on the left.</p>
        </div>
        <div class="strip hscroll"></div>
        <p class="strip-note note" style="margin:6px 0 0"></p>
      </div>
      <div class="sec note">Imagery: NASA GIBS (daily), Copernicus Sentinel-2 and NASA/USGS Landsat via Microsoft Planetary Computer, Esri World Imagery Wayback (hi-res).
        Cloud estimates are approximate; snow and bright sand can look like cloud.</div>`;
    $$('.srcSeg button', el).forEach(b => b.onclick = () => setSource(b.dataset.s));
    q('.modeSel').onchange = e => { mode[src] = e.target.value; rebuild(); };
    q('.prodSel').onchange = e => { product = e.target.value; rebuild(); };
    q('.dateIn').max = today(); q('.dateIn').min = '2000-02-24';
    q('.dateIn').onchange = e => { if (e.target.value) { setDate(e.target.value, state.date2); rebuild(); } };
    q('[data-act=dprev]').onclick = () => { setDate(addDays(state.date, -1), state.date2); sel = null; showMain(); describe(); q('.dateIn').value = state.date; };
    q('[data-act=dnext]').onclick = () => { if (state.date >= today()) return; setDate(addDays(state.date, 1), state.date2); sel = null; showMain(); describe(); q('.dateIn').value = state.date; };
    q('[data-act=play]').onclick = play;
    q('[data-act=compare]').onclick = () => toggleCompare();
    $$('.sides button', el).forEach(b => b.onclick = () => setSide(b.dataset.side));
    $$('.cmpSel', el).forEach(x => x.onchange = () => { const it = items[+x.value]; if (it) setCmp(x.dataset.side, it); });
    $$('.cmpDate', el).forEach(x => { x.max = today(); x.min = '2000-02-24'; x.onchange = () => { if (x.value) setCmp(x.dataset.side, dayItem(x.value)); }; });
    map.on('zoomend', () => { if (state.lens === 'imagery') zoomBanner(); });
    on('date', s => { if (root && q('.dateIn')) q('.dateIn').value = s.date; });
    const u = readUrl(); src = SOURCES[u.src] ? u.src : 'daily';
    q('.dateIn').value = state.date;
  },
  show() { if (mainLayer) mainLayer.addTo(group); zoomBanner(); },
  hide() { stopPlay(); if (swipeOn()) toggleCompare(false); mapBanner(''); },
  update(place) { const k = place ? `${place.lat},${place.lng}` : 'none'; if (this._k === k) return; this._k = k; setSource(src); },
};
