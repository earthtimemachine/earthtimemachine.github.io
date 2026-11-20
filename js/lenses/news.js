// News lens: local headlines (GDELT), newest first, ending on the shared date; scope village/district/state; topics.
import { $, $$, esc, state, on, setDate, addDays, fmtDate, today, yesterday, sleep } from '../core.js';
import { lensGroup } from '../map.js';

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3" y="5" width="14" height="15" rx="1.5"/><path d="M17 9h3v9a2 2 0 0 1-2 2"/><path d="M6.5 9h7M6.5 12.5h7M6.5 16h4"/></svg>';
const TOPIC = { all: '', weather: '(flood OR cyclone OR rain OR drought OR heatwave OR storm OR landslide OR earthquake OR fire)', farm: '(farmers OR crop OR paddy OR harvest OR agriculture OR irrigation OR fertiliser OR fertilizer)',
  biz: '(port OR project OR investment OR industry OR factory OR road OR railway OR company OR jobs)', civic: '(minister OR election OR government OR collector OR municipal OR council OR protest OR scheme)', crime: '(police OR arrested OR accident OR murder OR theft OR crime OR killed)' };
let root, scope = 0, scopes = [], topic = 'all', span = 30, between = false, gen = 0, lastReq = 0;
lensGroup('news');
const q = s => $(s, root);

export async function gdelt(query, start, end, max = 100) {
  const f = s => s.replace(/-/g, '');
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=${max}&sort=datedesc&startdatetime=${f(start)}000000&enddatetime=${f(end)}235959`;
  const wait = Math.max(0, 5200 - (Date.now() - lastReq)); if (wait) await sleep(wait); lastReq = Date.now();   // GDELT asks for one request every 5 seconds
  let txt;
  try { const r = await fetch(url); txt = await r.text(); }
  catch (e) { return jsonp(url); }
  try { return JSON.parse(txt); } catch (e) { if (/limit requests/i.test(txt)) throw new Error('rate'); if (!txt.trim()) return { articles: [] }; throw new Error('bad'); }
}
function jsonp(url) { return new Promise((res, rej) => { const cb = 'gd' + Math.random().toString(36).slice(2), s = document.createElement('script');
  window[cb] = d => { res(d); delete window[cb]; s.remove(); }; s.onerror = () => { rej(new Error('jsonp')); delete window[cb]; s.remove(); };
  s.src = url.replace('format=json', 'format=jsonp') + '&callback=' + cb; document.head.appendChild(s); setTimeout(() => rej(new Error('timeout')), 20000); }); }
export function sortArticles(j, name) {
  const seen = new Set();
  const arts = (j.articles || []).filter(a => { const k = (a.title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); if (!k || seen.has(k)) return false; seen.add(k); return true; })
    .map(a => ({ ...a, iso: a.seendate ? `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}T${a.seendate.slice(9, 11)}:${a.seendate.slice(11, 13)}:00Z` : null })).sort((a, b) => (b.iso || '').localeCompare(a.iso || ''));
  const n = name.toLowerCase(), slug = n.replace(/[^a-z0-9]+/g, '-'), about = a => (a.title || '').toLowerCase().includes(n) || (a.url || '').toLowerCase().includes(slug) || (a.url || '').toLowerCase().includes(n.replace(/\s+/g, ''));
  return { main: arts.filter(about), rest: arts.filter(a => !about(a)) };
}
export const localQuery = (name, admin, extra = '') => `"${name}"${extra ? ' ' + extra : ''}${admin?.country ? ' sourcecountry:' + admin.country.toLowerCase().replace(/[^a-z]/g, '') : ''}`;

function drawScopes() {
  const a = state.place?.admin || {};
  scopes = [[a.local, a.local], [a.district, a.district], [a.state, a.state]].filter(x => x[1]).filter((x, i, arr) => arr.findIndex(y => y[1] === x[1]) === i).map(([label, qq]) => ({ label, q: qq }));
  if (scope >= scopes.length) scope = 0;
  q('.scopes').innerHTML = scopes.length ? scopes.map((s, i) => `<button class="chip${i === scope ? ' on' : ''}" data-i="${i}">${esc(s.label)}</button>`).join('') : '<span class="muted small">No place name here. Try tapping on land.</span>';
  $$('.scopes .chip', root).forEach(c => c.onclick = () => { scope = +c.dataset.i; drawScopes(); load(); });
}
function drawDates() {
  q('.endIn').value = state.date;
  const chips = [];
  if (state.date !== today() && state.date !== yesterday()) chips.push('<button class="chip" data-d="latest">Latest</button>');
  if (state.date2) chips.push(`<button class="chip${between ? ' on' : ''}" data-d="between">Between compared dates</button>`);
  q('.dchips').innerHTML = chips.join('');
  $$('.dchips .chip', root).forEach(c => c.onclick = () => { if (c.dataset.d === 'latest') { between = false; setDate(today(), state.date2); } else { between = !between; drawDates(); load(); } });
}
async function load() {
  if (!state.place || !scopes.length) return;
  const my = ++gen, s = scopes[scope], end = state.date > today() ? today() : state.date;
  let start = between && state.date2 ? (state.date2 < end ? state.date2 : addDays(end, -span)) : addDays(end, -span), clipped = false;
  if (start < addDays(end, -90)) { start = addDays(end, -90); clipped = true; }
  const g = `https://www.google.com/search?tbm=nws&q=${encodeURIComponent('"' + s.q + '"')}&tbs=cdr:1,cd_min:${start.slice(5, 7)}/${start.slice(8, 10)}/${start.slice(0, 4)},cd_max:${end.slice(5, 7)}/${end.slice(8, 10)}/${end.slice(0, 4)}`;
  q('.meta').innerHTML = `${fmtDate(start)} to ${fmtDate(end)}, newest first.${clipped ? ' The news search covers 3 months at a time.' : ''} <a href="${g}" target="_blank" rel="noopener">Google News for these dates</a>`;
  if (end < '2017-01-01') { q('.news').innerHTML = '<p class="muted small">The news archive starts in January 2017. Use the Google News link for older stories.</p>'; return; }
  q('.news').innerHTML = '<div class="skeleton" style="height:140px"></div>';
  const extra = (TOPIC[topic] || '') + (q('.eng').checked ? ' sourcelang:english' : '');
  try {
    const j = await gdelt(q('.loc').checked ? localQuery(s.q, state.place.admin, extra) : `"${s.q}" ${extra}`, start, end); if (my !== gen) return;
    const { main, rest } = sortArticles(j, s.q);
    const block = list => { let out = '', last = ''; list.forEach(a => { const d = a.iso ? new Date(a.iso) : null, key = d ? d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Undated';
      if (key !== last) { out += `<div class="small" style="margin:12px 0 2px;color:var(--ochre);font-weight:600">${esc(key)}</div>`; last = key; }
      out += `<a class="item" href="${esc(a.url)}" target="_blank" rel="noopener">${a.socialimage ? `<img class="thumb" src="${esc(a.socialimage)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="thumb" style="display:grid;place-items:center;font-size:20px">📰</span>'}
        <div style="min-width:0"><div class="t">${esc(a.title)}</div><div class="m">${esc(a.domain || '')}${d ? ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}${a.language && a.language !== 'English' ? ` <span class="badge">${esc(a.language)}</span>` : ''}</div></div></a>`; }); return out; };
    q('.news').innerHTML = (main.length ? `<h2 style="margin:4px 0 0">About ${esc(s.label)} <span class="aside">${main.length}</span></h2><div class="list">${block(main)}</div>`
        : `<p class="muted small">No headlines are about ${esc(s.label)} itself in this period.${scope < scopes.length - 1 ? ` <a href="#" class="widen">Try ${esc(scopes[scope + 1].label)}</a>` : ''}</p>`)
      + (rest.length ? `<details style="margin-top:10px"><summary class="small muted" style="cursor:pointer">Also mentioned in ${rest.length} other ${rest.length > 1 ? 'stories' : 'story'}</summary><div class="list">${block(rest)}</div></details>` : '');
    const w = q('.widen'); if (w) w.onclick = e => { e.preventDefault(); scope++; drawScopes(); load(); };
  } catch (e) {
    if (my !== gen) return;
    q('.news').innerHTML = e.message === 'rate' ? '<p class="muted small">The news service asks for a short pause between searches. Retrying…</p>' : '<p class="muted small">The news service is not responding. Use the Google News link above, or try again in a minute.</p>';
    if (e.message === 'rate') setTimeout(() => { if (my === gen) load(); }, 6000);
  }
}

export default {
  id: 'news', title: 'News', icon: ICON, base: 'map', desc: 'Local headlines for this place, newest first',
  init(el) {
    root = el;
    el.innerHTML = `
      <div class="sec">
        <div class="row" style="margin-bottom:8px"><span class="small muted">About</span><div class="chips scopes"></div></div>
        <div class="row" style="margin-bottom:8px"><span class="small muted">Up to</span><input type="date" class="btn endIn" aria-label="Up to date">
          <select class="btn spanSel" aria-label="Period"><option value="7">past week</option><option value="30" selected>past month</option><option value="90">past 3 months</option></select><div class="chips dchips"></div></div>
        <div class="chips topics" style="margin-bottom:8px"><button class="chip on" data-t="all">All</button><button class="chip" data-t="weather">Weather and disasters</button><button class="chip" data-t="farm">Farming</button><button class="chip" data-t="biz">Business and projects</button><button class="chip" data-t="civic">Politics and civic</button><button class="chip" data-t="crime">Crime and safety</button></div>
        <div class="row small muted"><label><input type="checkbox" class="loc" checked> Local outlets only</label><label><input type="checkbox" class="eng" checked> English only</label></div>
      </div>
      <div class="sec"><p class="note meta" style="margin-top:0"></p><div class="news"><p class="muted small">Pick a place.</p></div></div>
      <div class="sec note">Headlines found through the <a href="https://www.gdeltproject.org/" target="_blank" rel="noopener">GDELT Project</a> news index (from 2017, up to 3 months per search), limited to outlets in the place's country. Each links to the original publisher. Stories are matched by place name, so a few may be about another place with the same name.</div>`;
    q('.endIn').max = today(); q('.endIn').min = '2017-01-01';
    q('.endIn').onchange = e => { if (e.target.value) { between = false; setDate(e.target.value, state.date2); } };
    q('.spanSel').onchange = e => { span = +e.target.value; between = false; drawDates(); load(); };
    $$('.topics .chip', el).forEach(c => c.onclick = () => { topic = c.dataset.t; $$('.topics .chip', el).forEach(x => x.classList.toggle('on', x === c)); load(); });
    q('.loc').onchange = load; q('.eng').onchange = load;
    on('date', () => { if (state.lens === 'news') { drawDates(); load(); } else this._stale = true; });
  },
  show() { drawDates(); if (this._stale) { this._stale = false; drawScopes(); load(); } },
  update(place) {
    if (!place) return;
    const k = `${place.lat},${place.lng}|${place.admin ? 1 : 0}`; if (this._k === k) return; this._k = k;
    if (!place.admin) { q('.scopes').innerHTML = '<span class="muted small">Finding place names…</span>'; return; }
    scope = 0; drawScopes(); drawDates(); load();
  },
};
