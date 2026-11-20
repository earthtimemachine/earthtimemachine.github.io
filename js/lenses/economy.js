// Economy lens: top crops, services, manufacturing, universities; mines/quarries/metal works; what the local rock yields.
import { $, $$, esc, state, getJSON, overpass, elLL, km, fmtKm } from '../core.js';
import { map, lensGroup, emojiIcon, fitRadius } from '../map.js';

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"/><path d="M5 20V10l4 3V10l4 3V6l6 4v10"/></svg>';
const CROPS = [['Rice (paddy)', /\b(rice|paddy)\b/g], ['Cotton', /\bcotton\b/g], ['Chillies', /\b(chill?ies|chill?i|mirchi)\b/g], ['Tobacco', /\btobacco\b/g], ['Groundnut', /\b(groundnuts?|peanuts?)\b/g], ['Sugarcane', /\bsugar ?cane\b/g], ['Maize', /\bmaize\b/g], ['Wheat', /\bwheat\b/g],
  ['Pulses', /\b(pulses|black gram|green gram|red gram|bengal gram|lentils?|chickpeas?)\b/g], ['Millets', /\b(millets?|jowar|bajra|ragi|sorghum)\b/g], ['Mango', /\bmangoe?s?\b/g], ['Banana', /\bbananas?\b/g], ['Coconut', /\bcoconuts?\b/g], ['Citrus', /\b(citrus|sweet lime|mosambi|lemons?|oranges?)\b/g],
  ['Turmeric', /\bturmeric\b/g], ['Soybean', /\bsoy ?beans?\b/g], ['Mustard', /\bmustard\b/g], ['Tea', /\btea (gardens?|estates?|plantations?)\b/g], ['Coffee', /\bcoffee\b/g], ['Rubber', /\brubber\b/g], ['Spices', /\b(black pepper|cardamom)\b/g], ['Cashew', /\bcashews?\b/g],
  ['Fish and shrimp farming', /\b(aquaculture|shrimps?|prawns?|fish farming|fisheries)\b/g], ['Vegetables', /\bvegetables\b/g], ['Fruit orchards', /\b(orchards?|horticulture)\b/g], ['Jute', /\bjute\b/g], ['Sunflower', /\bsunflowers?\b/g], ['Onion', /\bonions?\b/g]];
const SERVICES = [['IT and corporate offices', 'nwr(around:R,LL)["office"~"^(it|company|telecommunication|software|coworking|consulting)$"];'], ['Healthcare', 'nwr(around:R,LL)["amenity"~"^(hospital|clinic|doctors|dentist|pharmacy)$"];'],
  ['Retail and markets', 'nwr(around:R,LL)["shop"~"^(mall|supermarket|department_store|wholesale|electronics|car|clothes|jewelry|hardware|furniture)$"];nwr(around:R,LL)["amenity"="marketplace"];'], ['Banking and finance', 'nwr(around:R,LL)["amenity"="bank"];nwr(around:R,LL)["office"~"^(financial|insurance|tax_advisor|accountant)$"];'],
  ['Hotels and tourism', 'nwr(around:R,LL)["tourism"~"^(hotel|guest_house|resort|hostel|motel|attraction)$"];'], ['Education and training', 'nwr(around:R,LL)["amenity"~"^(college|university|training|language_school|driving_school)$"];'],
  ['Transport and logistics', 'nwr(around:R,LL)["building"="warehouse"];nwr(around:R,LL)["industrial"~"^(warehouse|port|logistics)$"];nwr(around:R,LL)["amenity"~"^(ferry_terminal|bus_station)$"];nwr(around:R,LL)["railway"="station"];'], ['Government and public offices', 'nwr(around:R,LL)["office"="government"];nwr(around:R,LL)["amenity"~"^(townhall|courthouse|police|post_office)$"];']];
const MFG = [['Food and agro processing', /food|\brice\b|rice mill|dairy|milk|sugar|oil mill|edible oil|cold storage|seafood|aqua|feed|spice|tobacco|beverage|bakery|flour|cashew|processing/], ['Textiles and garments', /textile|spinning|cotton|garment|apparel|yarn|jute|weaving|handloom/],
  ['Pharma and chemicals', /pharma|chemical|drug|fertili[sz]|labs?\b|bulk drug|pesticide|paint/], ['Metals and engineering', /steel|metal|foundry|engineering|forging|alloy|fabricat|machin|tools/], ['Automotive and parts', /\bauto|motor|vehicle|tyre|tire\b/], ['Electronics and solar', /electronic|semiconductor|solar|battery|electrical/],
  ['Cement and building materials', /cement|brick|tiles?\b|ceramic|granite|concrete|marble/], ['Power generation', /power|thermal|energy|wind ?farm/], ['Paper, plastics and packaging', /paper|plastic|packag|polymer|rubber/], ['Port and shipbuilding', /\bport\b|shipyard|harbour|harbor|dock/], ['Industrial parks and SEZs', /special economic zone|\bsez\b|industrial (park|estate|area|corridor)|apiic|midc|kiadb/]];
const RES = [['coal', '⚫', 'Coal or lignite', /coal|lignite/], ['iron', '🟤', 'Iron ore', /iron[_ ]?ore|hematite|magnetite|\biron\b/], ['bauxite', '🟠', 'Bauxite (aluminium)', /bauxite|alumin/], ['copper', '🟢', 'Copper', /copper/], ['gold', '🟡', 'Gold', /\bgold\b/], ['zinc', '⚪', 'Zinc, lead or silver', /zinc|\blead\b|silver/],
  ['manganese', '🟣', 'Manganese', /mangan/], ['limestone', '🤍', 'Limestone or cement', /limestone|cement|dolomite|\blime\b/], ['granite', '🪨', 'Granite or marble', /granite|marble|slate|dimension/], ['sand', '🏖️', 'Sand or gravel', /sand|gravel/], ['mica', '✨', 'Mica, feldspar or quartz', /mica|feldspar|quartz|silica/],
  ['clay', '🧱', 'Clay or bricks', /clay|brick|kaolin/], ['salt', '🧂', 'Salt', /\bsalt\b/], ['oil', '🛢️', 'Oil or gas', /\boil\b|natural gas|petroleum|\bongc\b/], ['metalworks', '🏭', 'Metal works (steel, smelters)', /steel|smelt|metal|foundry|alloy|ferro|rolling mill/], ['stone', '⛰️', 'Stone quarry or crusher', /stone|crusher|basalt|aggregate|blue metal|rock/]];
const OTHER = ['other', '⛏️', 'Mine or quarry (product not recorded)', null];
const ROCK = [[/coal|lignite/, 'coal'], [/banded iron|hematite|magnetite|iron formation/, 'iron ore'], [/laterite|bauxite/, 'bauxite and some iron ore'], [/kimberlite|lamproite/, 'possible diamonds'], [/ultramafic|peridotite|serpentin|dunite/, 'chromite, nickel and platinum-group metals'], [/limestone|dolomite|marl|carbonate/, 'limestone for cement and lime'], [/marble/, 'marble'],
  [/granite|charnockite/, 'granite for building stone, crushed stone, feldspar and quartz'], [/gneiss|migmatite/, 'crushed and building stone, sometimes mica and feldspar'], [/schist|pegmatite/, 'mica, feldspar and quartz; pegmatites can hold gemstones'], [/basalt|dolerite|trap|gabbro/, 'crushed stone for roads and concrete'], [/sandstone|quartzite/, 'building stone and silica sand'], [/shale|mudstone|clay/, 'brick and tile clay'], [/alluvi|sand|gravel|sediment/, 'sand, gravel and groundwater'], [/greenstone|schist belt/, 'gold and copper in some belts']];

let root, radius = 25000, sites = [], filter = null, gen = 0;
const group = lensGroup('economy'), siteLayer = L.layerGroup().addTo(group);
let circle = null;
const q = s => $(s, root);

function classify(t) { const txt = [t.resource, t.product, t.mineral, t['mine:resource'], t.name, t.operator, t.industrial, t.description].filter(Boolean).join(' ').toLowerCase(); for (const r of RES) if (r[3].test(txt)) return r; if (t.man_made === 'works') return RES.find(r => r[0] === 'metalworks'); if (t.landuse === 'quarry') return RES.find(r => r[0] === 'stone'); return OTHER; }

export async function topCrops(admin) {
  const scores = {}; let src = '';
  for (const qq of [admin.district && `${admin.district} district ${admin.state || ''}`, admin.state && `Agriculture in ${admin.state}`, admin.state].filter(Boolean)) {
    const sr = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(qq)}&srlimit=1&format=json&origin=*`, { ttl: 864e5 });
    const title = sr.query?.search?.[0]?.title; if (!title) continue;
    const ex = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=wiki&titles=${encodeURIComponent(title)}&format=json&origin=*`, { ttl: 864e5 });
    const txt = Object.values(ex.query.pages)[0].extract || '', secs = txt.split(/\n==+\s*/).filter(x => /^(econom|agricult|crops?|farming|irrigation|horticult)/i.test(x)), body = (secs.length ? secs.join('\n') : txt).toLowerCase();
    CROPS.forEach(([n, re]) => { const c = (body.match(re) || []).length; if (c) scores[n] = (scores[n] || 0) + c * (secs.length ? 2 : 1); });
    if (!src) src = title; if (Object.keys(scores).length >= 3) break;
  }
  return { top: Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]), src };
}
async function loadCrops(my) {
  const box = q('.crops'); const a = state.place?.admin; if (!a) return;
  try { const { top, src } = await topCrops(a); if (my !== gen) return;
    box.innerHTML = top.length ? `<ol>${top.map(n => `<li>${esc(n)}</li>`).join('')}</ol>${src ? `<div class="m">from <a href="https://en.m.wikipedia.org/wiki/${encodeURIComponent(src.replace(/ /g, '_'))}" target="_blank" rel="noopener">${esc(src)}</a></div>` : ''}` : '<div class="m">No crop information found.</div>';
  } catch (e) { if (my === gen) box.innerHTML = '<div class="m">Not available right now.</div>'; }
}
async function loadServices(my, LL) {
  try { const qq = '[out:json][timeout:40];' + SERVICES.map(([, sel]) => `(${sel.replace(/R,LL/g, radius + ',' + LL)});out count;`).join('');
    const j = await overpass(qq); if (my !== gen) return;
    const top = (j.elements || []).filter(e => e.type === 'count').map((e, i) => [SERVICES[i][0], +(e.tags?.total) || 0]).filter(c => c[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
    q('.serv').innerHTML = top.length ? `<ol>${top.map(([n, c]) => `<li>${esc(n)} <span class="muted">(${c.toLocaleString()})</span></li>`).join('')}</ol>` : '<div class="m">Few services mapped here.</div>';
  } catch (e) { if (my === gen) q('.serv').innerHTML = '<div class="m">Map data is busy. Try again shortly.</div>'; }
}
async function loadIndustry(my, LL) {
  try {
    const RU = Math.max(radius, 25000), qq = `[out:json][timeout:45];(
      nwr(around:${radius},${LL})["landuse"="quarry"];nwr(around:${radius},${LL})["man_made"~"^(mineshaft|adit|mine)$"];nwr(around:${radius},${LL})["industrial"~"^(mine|quarry|mining|smelter|steelmaking|steelworks|cement)$"];
      nwr(around:${radius},${LL})["resource"];nwr(around:${radius},${LL})["man_made"="works"];nwr(around:${radius},${LL})["industrial"]["industrial"!~"^(warehouse)$"];
      nwr(around:${radius},${LL})["landuse"="industrial"]["name"];nwr(around:${radius},${LL})["building"~"^(industrial|factory)$"]["name"];nwr(around:${radius},${LL})["power"="plant"];
    );out center tags 800;(nwr(around:${RU},${LL})["amenity"="university"];);out center tags 60;(nwr(around:${RU},${LL})["amenity"="college"]["name"];);out center tags 60;`;
    const j = await overpass(qq); if (my !== gen) return;
    const els = j.elements || [], here = [state.place.lat, state.place.lng];
    const isMine = t => t.landuse === 'quarry' || /^(mineshaft|adit|mine)$/.test(t.man_made || '') || /^(mine|quarry|mining|smelter|steelmaking|steelworks|cement)$/.test(t.industrial || '') || t.resource || (t.man_made === 'works' && /steel|iron|alumin|copper|zinc|metal|ferro|cement|alloy/i.test(t.product || ''));
    // manufacturing
    const mc = {}, mx = {};
    els.filter(e => !/^(university|college)$/.test(e.tags?.amenity || '')).forEach(e => { const t = e.tags || {}; const txt = [t.name, t.product, t.industrial, t.operator, t.power === 'plant' ? 'power' : ''].filter(Boolean).join(' ').toLowerCase();
      const m = MFG.find(([, re]) => re.test(txt)); if (!m) return; mc[m[0]] = (mc[m[0]] || 0) + 1; if (t.name && !mx[m[0]]) mx[m[0]] = t.name; });
    const topM = Object.entries(mc).sort((a, b) => b[1] - a[1]).slice(0, 3);
    q('.mfg').innerHTML = topM.length ? `<ol>${topM.map(([n, c]) => `<li>${esc(n)} <span class="muted">(${c})</span>${mx[n] ? `<div class="m">e.g. ${esc(mx[n]).slice(0, 44)}</div>` : ''}</li>`).join('')}</ol>` : '<div class="m">Few factories mapped here.</div>';
    // universities
    const rank = l => l.map(e => ({ e, d: km(here, elLL(e) || here), n: !!(e.tags.wikidata || e.tags.wikipedia) })).sort((a, b) => (b.n - a.n) || a.d - b.d);
    const seen = new Set(), pick = [...rank(els.filter(e => e.tags?.amenity === 'university' && e.tags.name)), ...rank(els.filter(e => e.tags?.amenity === 'college' && e.tags.name))].filter(x => { const k = x.e.tags.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3);
    q('.uni').innerHTML = pick.length ? `<ol>${pick.map(x => { const t = x.e.tags, w = t.wikipedia ? `https://en.m.wikipedia.org/wiki/${encodeURIComponent((t.wikipedia.split(':').slice(1).join(':') || t.wikipedia).replace(/ /g, '_'))}` : (t.website || '');
      return `<li>${w ? `<a href="${esc(w)}" target="_blank" rel="noopener">${esc(t['name:en'] || t.name)}</a>` : esc(t['name:en'] || t.name)} <span class="muted">(${fmtKm(x.d)}${t.amenity === 'college' ? ', college' : ''})</span></li>`; }).join('')}</ol>` : `<div class="m">None within ${Math.round(RU / 1000)} km.</div>`;
    // mines, quarries, metal works
    const seenS = new Set();
    sites = els.filter(e => isMine(e.tags || {})).map(e => { const p = elLL(e); if (!p) return null; const t = e.tags || {}; return { id: e.type + '/' + e.id, ll: p, d: km(here, p), t, c: classify(t), name: t.name || t['name:en'] || '' }; })
      .filter(Boolean).filter(s => { const k = (s.name || s.id) + s.c[0] + Math.round(s.ll[0] * 500) + Math.round(s.ll[1] * 500); if (seenS.has(k)) return false; seenS.add(k); return true; }).sort((a, b) => a.d - b.d);
    filter = null; drawSites();
  } catch (e) { if (my === gen) { ['.mfg', '.uni'].forEach(s => q(s).innerHTML = '<div class="m">Map data is busy. Try again shortly.</div>'); q('.sites').innerHTML = '<p class="muted small">Map data is busy. Try again in a minute.</p>'; } }
}
function drawSites() {
  siteLayer.clearLayers();
  const groups = {}; sites.forEach(s => { (groups[s.c[0]] ||= { c: s.c, n: 0 }).n++; });
  q('.schips').innerHTML = Object.values(groups).sort((a, b) => b.n - a.n).map(g => `<button class="chip${filter === g.c[0] ? ' on' : ''}" data-k="${g.c[0]}">${g.c[1]} ${esc(g.c[2])} (${g.n})</button>`).join('');
  $$('.schips .chip', root).forEach(ch => ch.onclick = () => { filter = filter === ch.dataset.k ? null : ch.dataset.k; drawSites(); });
  const shown = sites.filter(s => !filter || s.c[0] === filter);
  shown.forEach(s => L.marker(s.ll, { icon: emojiIcon(s.c[1]) }).addTo(siteLayer).bindPopup(`<b>${esc(s.name || s.c[2])}</b><br>${esc(s.c[2])}${s.t.operator ? '<br>Operator: ' + esc(s.t.operator) : ''}<br>${fmtKm(s.d)} from the pin<br><a href="https://www.openstreetmap.org/${s.id}" target="_blank" rel="noopener">OpenStreetMap</a>`));
  q('.sites').innerHTML = !sites.length ? '<p class="muted small">No mines, quarries or metal works are mapped within this distance.</p>' :
    `<div class="list">${shown.slice(0, 120).map((s, i) => `<div class="item" data-i="${i}" role="button" tabindex="0"><span class="ic">${s.c[1]}</span><div><div class="t">${esc(s.name || 'Unnamed site')}</div><div class="m">${esc(s.c[2])}${s.t.operator ? ' · ' + esc(s.t.operator) : ''} · ${fmtKm(s.d)}</div></div></div>`).join('')}</div>${shown.length > 120 ? `<p class="muted small">…and ${shown.length - 120} more on the map.</p>` : ''}`;
  $$('.sites .item', root).forEach(el => el.onclick = () => map.setView(shown[+el.dataset.i].ll, Math.max(map.getZoom(), 15)));
}
async function loadRock(my) {
  try { const p = state.place, j = await getJSON(`https://macrostrat.org/api/v2/geologic_units/map?lat=${p.lat.toFixed(4)}&lng=${p.lng.toFixed(4)}`, { ttl: 864e5 }); if (my !== gen) return;
    const ord = { large: 0, medium: 1, small: 2, tiny: 3 }, u = (j.success?.data || []).sort((a, b) => (ord[a.scale] ?? 9) - (ord[b.scale] ?? 9))[0];
    if (!u) { q('.rock').textContent = 'No geologic map unit recorded here (probably sea).'; return; }
    const txt = [u.name, u.strat_name, u.lith, u.descrip].filter(Boolean).join(' ').toLowerCase(), y = [...new Set(ROCK.filter(r => r[0].test(txt)).map(r => r[1]))];
    q('.rock').innerHTML = `<b>${esc(u.name || u.strat_name || 'Unnamed unit')}</b>${u.b_int_name ? ', ' + esc(u.b_int_name) : ''}${u.lith ? `<br><span class="muted small">${esc(u.lith).slice(0, 160)}</span>` : ''}<br>${y.length ? `Rocks like these typically yield <b>${y.map(esc).join('; ')}</b>.` : 'No typical mineral resources are linked to these rock types.'}<p class="note" style="margin:6px 0 0">A guide from regional geology maps, not proof that a deposit exists here.</p>`;
  } catch (e) { if (my === gen) q('.rock').textContent = 'The geology service is not responding right now.'; }
}
function run() {
  const p = state.place; if (!p) return; const my = ++gen, LL = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  if (circle) group.removeLayer(circle); circle = L.circle([p.lat, p.lng], { radius, color: '#e3b964', weight: 1.5, fill: false, dashArray: '5 5', interactive: false }).addTo(group); fitRadius(p, radius);
  ['.serv', '.mfg', '.uni'].forEach(s => q(s).innerHTML = '<div class="skeleton" style="height:56px"></div>'); q('.sites').innerHTML = '<div class="skeleton" style="height:80px"></div>'; q('.schips').innerHTML = ''; siteLayer.clearLayers();
  loadServices(my, LL); loadIndustry(my, LL); loadRock(my);
}

export default {
  id: 'economy', title: 'Economy', icon: ICON, base: 'satellite', desc: 'Crops, services, industry, universities and mineral resources',
  init(el) {
    root = el;
    el.innerHTML = `
      <div class="sec"><div class="row"><h2 style="margin:0">At a glance</h2><span class="grow"></span><label class="small muted">Within <select class="btn rad"><option value="10000">10 km</option><option value="25000" selected>25 km</option><option value="50000">50 km</option></select></label></div>
        <div class="tiles" style="margin-top:10px">
          <div class="tile"><h3>🌾 Main crops</h3><div class="crops"><div class="m">Pick a place.</div></div></div>
          <div class="tile"><h3>🛎️ Services</h3><div class="serv"><div class="m">–</div></div></div>
          <div class="tile"><h3>🏭 Manufacturing</h3><div class="mfg"><div class="m">–</div></div></div>
          <div class="tile"><h3>🎓 Universities</h3><div class="uni"><div class="m">–</div></div></div></div>
        <p class="note" style="margin:8px 0 0">Crops come from the district's Wikipedia article; services, factories and universities are counted from OpenStreetMap, so rural areas may be under-mapped.</p></div>
      <div class="sec"><h2>Mines, quarries and metal works</h2><div class="chips schips" style="margin-bottom:8px"></div><div class="sites"><p class="muted small">Pick a place.</p></div></div>
      <div class="sec"><h2>What the local rock yields</h2><div class="rock"><span class="muted small">–</span></div></div>
      <div class="sec note">Sites from <a href="https://www.openstreetmap.org/" target="_blank" rel="noopener">OpenStreetMap</a> contributors (ODbL). Official data: <a href="https://ibm.gov.in/" target="_blank" rel="noopener">Indian Bureau of Mines</a>, <a href="https://www.gsi.gov.in/" target="_blank" rel="noopener">Geological Survey of India</a>.</div>`;
    q('.rad').onchange = e => { radius = +e.target.value; run(); };
  },
  update(place) {
    if (!place) return;
    const k = `${place.lat},${place.lng}`;
    if (this._k !== k) { this._k = k; this._crops = false; run(); }
    if (place.admin && !this._crops) { this._crops = true; loadCrops(gen); }
  },
};
