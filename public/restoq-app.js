"use strict";
const BOOT = (() => { try { const el = document.getElementById('boot'); return el ? JSON.parse(el.textContent) : null; } catch(e){ return null; } })();
const MODE_API = !!BOOT; // restoq.no: data via egen server. Ellers prototype (Claude-artifact eller lokalt).
const SEED = (() => { try { const el = document.getElementById('seed'); return el ? JSON.parse(el.textContent) : null; } catch(e){ return null; } })() || {items:[], weeks:[], suppliers:[]};
const BASE_ITEMS = SEED.items;
/* Anbefalt bestillingsfrekvens per lagertype (dager mellom hver gang varetypen fylles opp) */
const FREQ_DEFAULT = {'Kjøl':3.5, 'Frys':7, 'Tørr':14, 'Romtemp.':14};
const FREQ_TXT = {'Kjøl':'Ferskvare: 2 ganger i uka', 'Frys':'Frysevarer: 1 gang i uka', 'Tørr':'Tørrvare: annenhver uke', 'Romtemp.':'Romtemperatur (drikke, emballasje): annenhver uke'};
const DAY = 864e5;
const REASONS = ['Utgått på dato','Skadet','Feil i produksjon','Personalmat','Annet'];
const STORES = ['Kjøl','Frys','Tørr','Romtemp.'];
const WD = ['søn','man','tir','ons','tor','fre','lør'];
const WDL = ['søndag','mandag','tirsdag','onsdag','torsdag','fredag','lørdag'];

/* ---------- små hjelpere ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todayStr = () => { const d = new Date(); return iso(d); };
const iso = d => { const z = new Date(d.getTime() - d.getTimezoneOffset()*6e4); return z.toISOString().slice(0,10); };
const pd = s => { if(!s) return null; const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const daysBetween = (a,b) => Math.round((pd(b) - pd(a)) / DAY);
const addDays = (s,n) => { const d = pd(s); d.setDate(d.getDate()+n); return iso(d); };
const fmtD = s => { if(!s) return '–'; const d = pd(s); return d.getDate()+'.'+(d.getMonth()+1)+'.'; };
const fmtDL = s => { if(!s) return '–'; const d = pd(s); return WD[d.getDay()]+' '+d.getDate()+'.'+(d.getMonth()+1)+'.'+String(d.getFullYear()).slice(2); };
const nf0 = new Intl.NumberFormat('nb-NO',{maximumFractionDigits:0});
const nf1 = new Intl.NumberFormat('nb-NO',{maximumFractionDigits:1});
const kr = v => nf0.format(Math.round(v||0)) + ' kr';
const q = v => v == null || v === '' ? '–' : nf1.format(v);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const num = v => { if(v === '' || v == null) return null; const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
function toast(msg){ const t = document.createElement('div'); t.className='toast'; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(), 2600); }

/* ---------- lagring: delt database, ellers lokalt på enheten ---------- */
const S = { waste:[], orders:[], counts:[], invoices:[], slips:[], settings:null, itemcfg:{ov:{}}, brand:null, ready:false, mode:'connecting', canWrite:true, canManage:true, me:null };
let DB = null;
const LS_KEY = 'ac-dispo-v1';
function defaultSettings(){
  const sup = {};
  SEED.suppliers.forEach(s => sup[s.code] = {name:s.name, days:s.days, wd:s.wd, interval:s.interval, lead:s.lead, safety:s.safety, fees:s.fees, notes:s.notes});
  return { suppliers:sup, expectedSales:null, freq:{...FREQ_DEFAULT}, weeks: SEED.weeks.map(w => ({wk:w[0], from:w[1], sales:w[2]})) };
}
function localLoad(){ try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch(e){ return {}; } }
function localSave(){ try { localStorage.setItem(LS_KEY, JSON.stringify({waste:S.waste, orders:S.orders, counts:S.counts, settings:S.settings, itemcfg:S.itemcfg, brand:S.brand})); } catch(e){} }

async function api(method, path, body){
  const res = await fetch(path, {method, headers: body !== undefined ? {'Content-Type':'application/json'} : {}, body: body !== undefined ? JSON.stringify(body) : undefined, credentials:'same-origin'});
  if (res.status === 401){ location.href = '/login?next=/app'; throw {code:'auth'}; }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw {code: res.status === 403 ? 'forbidden' : 'http', message: j.error || 'Kunne ikke lagre.'};
  return j;
}
const store = {
  async put(col, id, data){
    data = JSON.parse(JSON.stringify(data));
    if (MODE_API){ try { await api('PUT', `/api/data/${col}/${encodeURIComponent(id)}`, data); } catch(e){ handleWriteErr(e); throw e; } upsertLocal(col, id, data); lastLocalWrite = Date.now(); render(); return; }
    if (DB){ try { await DB.collection(col).doc(id).set(data); } catch(e){ handleWriteErr(e); throw e; } }
    else { upsertLocal(col, id, data); localSave(); render(); }
  },
  async del(col, id){
    if (MODE_API){ try { await api('DELETE', `/api/data/${col}/${encodeURIComponent(id)}`); } catch(e){ handleWriteErr(e); throw e; } if (col !== 'config') S[col] = S[col].filter(x => x.id !== id); lastLocalWrite = Date.now(); render(); return; }
    if (DB){ try { await DB.collection(col).doc(id).delete(); } catch(e){ handleWriteErr(e); throw e; } }
    else { if (col === 'config') return; S[col] = S[col].filter(x => x.id !== id); localSave(); render(); }
  }
};
function upsertLocal(col, id, data){
  if (col === 'config'){ if (id === 'settings') S.settings = data; if (id === 'items') S.itemcfg = data; if (id === 'brand') S.brand = data; return; }
  const arr = S[col]; const i = arr.findIndex(x => x.id === id); const rec = {...data, id};
  if (i >= 0) arr[i] = rec; else arr.push(rec);
}
let lastLocalWrite = 0;
function handleWriteErr(e){
  if (e && (e.code === 'forbidden' || e.code === 'http')){ toast(e.message || 'Kunne ikke lagre.'); return; }
  if (e && e.code === 'auth') return;
  if (e && e.code === 'invalid_argument'){ S.canWrite = false; toast('Du har bare lesetilgang. Be eier om å gi deg Bidragsyter-tilgang.'); render(); }
  else if (e && e.code === 'quota_exceeded'){ toast('Databasen er full. Eksporter og slett gamle data under Innstillinger.'); }
  else toast('Kunne ikke lagre. Sjekk nettet og prøv igjen.');
}
function applyDocs(d){
  S.waste = d.waste || []; S.orders = d.orders || []; S.counts = d.counts || []; S.invoices = d.invoices || []; S.slips = d.slips || [];
  (d.config || []).forEach(c => { const {id, ...data} = c; if (id === 'settings') S.settings = data; if (id === 'items') S.itemcfg = data; if (id === 'brand') S.brand = data; });
}
async function apiLoad(first){
  try {
    const j = await api('GET', '/api/data');
    applyDocs(j.docs); S.me = j.me; S.canManage = !!j.me.canManage; S.mode = 'shared'; S.ready = true;
  } catch(e){ if (e && e.code === 'auth') return; S.mode = 'error'; S.ready = true; }
  // Ikke tegn siden på nytt midt i skriving, i en dialog eller i innstillingene
  const ae = document.activeElement; const busy = !first && ((ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) || $('#layer').innerHTML || view === 'oppsett' || countDirty || countSaving);
  if (!busy) render(); else renderTabs(C ? C.items.filter(r => r.status === 'bestill').length : 0);
}
async function connect(){
  if (MODE_API){
    await apiLoad(true);
    setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - lastLocalWrite > 3000) apiLoad(false); }, 20000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') apiLoad(false); });
    return;
  }
  let db = null;
  try { if (window.claude && window.claude.use) db = await window.claude.use('db'); } catch(e){ db = null; }
  if (!db){ startLocal(); return; }
  DB = db;
  try { const u = await window.claude.use('user'); if (u && u.can){ const w = await u.can('data.write'); if (w === false) S.canWrite = false; } } catch(e){}
  let pending = 4; const timer = setTimeout(() => { if (!S.ready){ S.mode='slow'; S.ready = true; render(); } }, 10000);
  const done = () => { if (--pending <= 0 && !S.ready){ clearTimeout(timer); S.ready = true; S.mode='shared'; render(); } };
  const sub = (col) => { let first = true;
    DB.collection(col).onSnapshot(snap => { S[col] = snap.docs.map(d => ({...d.data(), id:d.id})); if (first && !snap.metadata.fromCache){ first=false; done(); } if (S.ready){ S.mode='shared'; render(); } },
      err => { S.mode = 'error'; S.ready = true; render(); }); };
  ['waste','orders','counts'].forEach(sub);
  let firstCfg = true;
  DB.collection('config').onSnapshot(snap => {
    snap.docs.forEach(d => { if (d.id === 'settings') S.settings = d.data(); if (d.id === 'items') S.itemcfg = d.data(); if (d.id === 'brand') S.brand = d.data(); });
    if (firstCfg && !snap.metadata.fromCache){ firstCfg = false; done(); }
    if (S.ready) render();
  }, () => { S.mode='error'; S.ready = true; render(); });
}
function startLocal(){
  const L = localLoad();
  S.waste = L.waste || []; S.orders = L.orders || []; S.counts = L.counts || []; S.settings = L.settings || null; S.itemcfg = L.itemcfg || {ov:{}}; S.brand = L.brand || null;
  S.mode = 'local'; S.ready = true; render();
}
const SET = () => { const s = S.settings || defaultSettings(); if (!s.freq) s.freq = {...FREQ_DEFAULT}; if (!s.suppliers) s.suppliers = {}; if (!s.weeks) s.weeks = []; return s; };
const freqFor = (set, stor) => { const f = set.freq && set.freq[stor]; return f > 0 ? f : (FREQ_DEFAULT[stor] || 7); };
const BRAND_DEFAULT = {accent:'#D2372B', head:'#141A18', logo:null};
const BRAND = () => { const b = S.brand || {}; return {accent:b.accent||BRAND_DEFAULT.accent, head:b.head||BRAND_DEFAULT.head, logo:b.logo||null}; };
const inkFor = hex => { const h = (hex||'#000').replace('#',''); const r = parseInt(h.substr(0,2),16), g = parseInt(h.substr(2,2),16), b = parseInt(h.substr(4,2),16); return (0.299*r + 0.587*g + 0.114*b) > 160 ? '#141A18' : '#FFFFFF'; };
function applyBrand(){
  const b = BRAND(); const root = document.documentElement.style;
  root.setProperty('--brand', b.accent); root.setProperty('--head', b.head); root.setProperty('--head-ink', inkFor(b.head));
  const lg = $('#hLogo'), tt = $('#hTitle');
  const pw = $('#hSub');
  if (b.logo){ lg.src = b.logo; lg.alt = 'Logo'; lg.classList.remove('hide'); tt.classList.add('hide'); pw.classList.remove('hide'); }
  else { lg.classList.add('hide'); tt.classList.remove('hide'); tt.textContent = 'Restoq'; pw.classList.add('hide'); }
}
/* foreslå firmafarger fra logoen: vanligste mørke/fargesterke tone */
function colorsFromImage(img){
  const c = document.createElement('canvas'); const n = 64; c.width = n; c.height = n; const x = c.getContext('2d'); x.drawImage(img, 0, 0, n, n);
  const d = x.getImageData(0, 0, n, n).data; const bins = {};
  for (let i = 0; i < d.length; i += 4){ if (d[i+3] < 128) continue; const r = d[i]>>4, g = d[i+1]>>4, b = d[i+2]>>4; const k = (r<<8)|(g<<4)|b; bins[k] = (bins[k]||0) + 1; }
  const list = Object.entries(bins).map(([k,cnt]) => { k = +k; const r = ((k>>8)&15)*17, g = ((k>>4)&15)*17, b = (k&15)*17; const mx = Math.max(r,g,b), mn = Math.min(r,g,b); return {r,g,b,cnt, sat: mx ? (mx-mn)/mx : 0, lum: 0.299*r+0.587*g+0.114*b}; });
  const hex = o => '#' + [o.r,o.g,o.b].map(v => v.toString(16).padStart(2,'0')).join('');
  const notWhite = list.filter(o => o.lum < 235);
  const head = [...notWhite].sort((a,b) => b.cnt - a.cnt)[0];
  const accent = [...notWhite].filter(o => o.sat > .35 && o.lum > 40 && (!head || Math.abs(o.lum-head.lum) + Math.abs(o.r-head.r) > 40)).sort((a,b) => b.cnt*b.sat - a.cnt*a.sat)[0];
  return {head: head ? hex(head) : null, accent: accent ? hex(accent) : (head ? hex(head) : null)};
}
async function saveSettings(s){ await store.put('config','settings', s); }
async function saveItemCfg(c){ await store.put('config','items', c); }

/* ---------- varer (basisliste + justeringer + nye varer) ---------- */
function getItems(){
  const ov = (S.itemcfg && S.itemcfg.ov) || {};
  const list = BASE_ITEMS.map(b => ({...b, ...(ov[b.id] || {})}));
  Object.values(ov).forEach(o => { if (o.custom && !BASE_ITEMS.find(b => b.id === o.id)) list.push({h100:0, b13:0, b6:0, ...o}); });
  return list.filter(i => !i.removed);
}

/* ---------- beregningsmotor (samme logikk som Excel-arket) ---------- */
function expectedSales(set){
  if (set.expectedSales) return set.expectedSales;
  const w = [...set.weeks].sort((a,b) => a.from < b.from ? -1 : 1).slice(-4);
  return w.length ? w.reduce((s,x) => s + x.sales, 0) / w.length : 100000;
}
function avg13(set){ const w = [...set.weeks].sort((a,b)=>a.from<b.from?-1:1).slice(-13); return w.length ? w.reduce((s,x)=>s+x.sales,0)/w.length : 0; }
function nextDelivery(code, fromStr){
  const s = SET().suppliers[code]; const lead = Math.ceil(s.lead || 1); const wd = s.wd && s.wd.length ? s.wd : null;
  let d = addDays(fromStr, lead);
  if (!wd) return d;
  for (let i = 0; i < 21; i++){ if (wd.includes(pd(d).getDay())) return d; d = addDays(d, 1); }
  return addDays(fromStr, lead);
}
function compute(){
  const set = SET(); const today = todayStr(); const sales = expectedSales(set);
  const done = S.counts.filter(c => c.status === 'fullført').sort((a,b) => a.date < b.date ? 1 : (a.date > b.date ? -1 : (b.ts||0)-(a.ts||0)));
  const cur = done[0] || null, prev = done[1] || null;
  const rcv = []; const open = {};
  S.orders.forEach(o => (o.lines||[]).forEach(l => {
    if (o.status === 'mottatt') rcv.push({id:l.id, date:o.deliveryDate, qty: l.recv != null ? l.recv : l.qty});
    else if (o.status === 'bestilt') open[l.id] = (open[l.id]||0) + (l.qty||0);
  }));
  const sumIn = (arr, id, after, upTo) => arr.reduce((s,x) => s + ((x.id === id || x.itemId === id) && x.date > after && (!upTo || x.date <= upTo) ? (x.qty||0) : 0), 0);
  const wasteArr = S.waste.map(w => ({id:w.itemId, date:w.date, qty:w.qty}));
  const res = getItems().map(it => {
    const sp = set.suppliers[it.sup] || {interval:7, lead:1, safety:2};
    const cl = cur && cur.lines ? cur.lines[it.id] : null;
    const counted = cl && cl.q != null && cl.q !== '';
    const r = {...it, countDate: counted ? cur.date : null, stockAtCount: counted ? cl.q : 0, expiry: counted && cl.exp ? cl.exp : null};
    // faktisk forbruk mellom de to siste tellingene
    r.actual100 = null;
    if (counted && prev && prev.lines && prev.lines[it.id] && prev.lines[it.id].q != null && prev.lines[it.id].q !== '' && cur.sales > 0){
      const u = Math.max(0, prev.lines[it.id].q + sumIn(rcv, it.id, prev.date, cur.date) - sumIn(wasteArr, it.id, prev.date, cur.date) - cl.q);
      r.actualUsage = u; r.actual100 = u / (cur.sales / 1e5);
    }
    r.usageSource = it.manual != null && it.manual !== '' ? 'manuell' : (r.actual100 > 0 ? 'telling' : 'innkjøp');
    r.usageWeek = r.usageSource === 'manuell' ? Number(it.manual) : (r.actual100 > 0 ? r.actual100 : (it.h100||0)) * sales / 1e5;
    r.daysSince = r.countDate ? Math.max(0, daysBetween(r.countDate, today)) : 0;
    r.wasteSince = r.countDate ? sumIn(wasteArr, it.id, r.countDate) : 0;
    r.usedSince = r.countDate ? r.usageWeek / 7 * r.daysSince : 0;
    r.rcvSince = r.countDate ? sumIn(rcv, it.id, r.countDate) : 0;
    r.stockNow = Math.max(0, r.stockAtCount - r.wasteSince - r.usedSince + r.rcvSince);
    r.open = open[it.id] || 0;
    r.avail = r.stockNow + r.open;
    r.cover = r.usageWeek > 0 ? r.avail / (r.usageWeek / 7) : null;
    r.runsOut = r.cover != null ? addDays(today, Math.floor(r.cover)) : null;
    r.daysToExp = r.expiry ? daysBetween(today, r.expiry) : null;
    // Bestillingssyklus: så sjelden som lagertypen tilsier, men aldri oftere enn leverandøren leverer
    r.freq = freqFor(set, it.stor);
    r.cycle = Math.max(sp.interval||0, r.freq);
    const horizon = r.cycle + (sp.lead||0) + (sp.safety||0);
    r.horizon = it.shelf > 0 ? Math.min(it.shelf, horizon) : horizon;
    r.target = r.usageWeek / 7 * r.horizon;
    // Bestillingspunkt: må varen fylles på før neste mulige levering?
    r.reorderPoint = r.usageWeek / 7 * ((sp.interval||0) + (sp.lead||0) + (sp.safety||0));
    const pack = it.pack > 0 ? it.pack : 1;
    const due = !r.countDate || r.avail < r.reorderPoint;
    r.sugg = it.active && due ? Math.ceil(Math.max(0, Math.max(r.target, r.reorderPoint) - r.avail) / pack - 1e-9) * pack : 0;
    r.sugg = Math.round(r.sugg * 100) / 100;
    r.suggNok = r.sugg * (it.price||0);
    if (!it.active) r.status = 'behov';
    else if (!r.countDate) r.status = 'tell';
    else if ((r.cover ?? Infinity) < (sp.lead||0) + (sp.interval||0)) r.status = 'bestill';
    else if ((r.cover ?? Infinity) < (sp.lead||0) + (sp.interval||0) + (sp.safety||0)) r.status = 'snart';
    else r.status = 'ok';
    r.wasteRisk = r.daysToExp != null && r.cover != null && r.daysToExp < Math.min(r.cover, r.stockNow / Math.max(r.usageWeek, 0.0001) * 7);
    r.value = r.stockNow * (it.price||0);
    return r;
  });
  return {items:res, cur, prev, sales, today};
}
const STATUS = {bestill:['Bestill nå','p-bestill'], snart:['Snart','p-snart'], ok:['OK','p-ok'], tell:['Tell','p-tell'], behov:['Ved behov','p-behov']};
const pill = s => `<span class="pill ${STATUS[s][1]}">${STATUS[s][0]}</span>`;
const coverTxt = r => r.cover == null ? '<span class="muted">ingen forbruk</span>' : (r.cover > 365 ? '365+ d' : nf0.format(Math.floor(r.cover)) + ' d');
function coverBar(r){
  if (r.cover == null) return '';
  const pct = Math.min(100, r.cover / 30 * 100);
  const col = r.status === 'bestill' ? 'var(--red)' : r.status === 'snart' ? 'var(--amber)' : 'var(--green)';
  return `<div class="bar"><span style="width:${pct}%;background:${col}"></span></div>`;
}

/* ---------- navigasjon ---------- */
const TABS = [
  ['oversikt','Oversikt','<path d="M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z"/>'],
  ['bestill','Bestill','<path d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM5.2 5H21l-2 8H7.4l-.4 2H19v2H4.6l1.6-8L4 3H1V1h4.2z"/>'],
  ['mottak','Varemottak','<path d="M20 8h-3V4H3a2 2 0 0 0-2 2v11h2a3 3 0 0 0 6 0h6a3 3 0 0 0 6 0h2v-5zM6 18.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm13.5-9 2 2.5H17V9.5zM18 18.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/>'],
  ['telling','Varetelling','<path d="M19 3h-4.2A3 3 0 0 0 12 1a3 3 0 0 0-2.8 2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm-2 14-4-4 1.4-1.4L10 14.2l6.6-6.6L18 9z"/>'],
  ['svinn','Svinn','<path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/>'],
  ['varer','Varer','<path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/>'],
  ['faktura','Faktura','<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 7V3.5L18.5 9zM8 13h8v2H8zm0 4h8v2H8z"/>'],
].filter(t => t[0] !== 'faktura' || MODE_API);
let view = (location.hash || '#oversikt').slice(1);
if (!TABS.find(t => t[0] === view) && view !== 'oppsett') view = 'oversikt';
function go(v){ view = v; if (location.hash !== '#'+v) history.replaceState(null,'','#'+v); $('#main').scrollTop = 0; render(); }
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v && v !== view){ view = v; render(); } });
$('#btnSettings').onclick = () => go('oppsett');

/* ---------- UI-tilstand (ikke lagret delt) ---------- */
const UI = { sup:'SG', delivery:null, draft:{}, showAll:false, ordSearch:'',
  cStore:'Kjøl', cSearch:'', cOnlyOpen:false,
  wItem:null, wSearch:'', wQty:'', wReason:REASONS[0], wDate:null, wComment:'',
  vSearch:'', vSup:'', vStore:'', vStatus:'', vSort:'cover', vDir:1, vActive:true };
try { const d = JSON.parse(localStorage.getItem('ac-dispo-draft')); if (d) UI.draft = d; } catch(e){}
const saveDraft = () => { try { localStorage.setItem('ac-dispo-draft', JSON.stringify(UI.draft)); } catch(e){} };

let C = null; // siste beregning
function render(){
  const sync = $('#sync');
  const m = {connecting:['','Kobler til …'], shared:['ok', MODE_API ? 'Lagret' : 'Delt · lagres for alle'], local:['local','Lagres kun på denne enheten'], slow:['local','Venter på nett …'], error:['local', MODE_API ? 'Ingen kontakt med serveren' : 'Mistet forbindelsen']}[S.mode] || ['',''];
  sync.className = 'sync ' + m[0]; sync.lastElementChild.textContent = m[1] + (S.canWrite ? '' : ' · kun lesing');
  applyBrand();
  if (!S.ready){ $('#view').innerHTML = '<div class="empty">Laster lagerdata …</div>'; renderTabs(0); return; }
  C = compute();
  const nB = C.items.filter(r => r.status === 'bestill').length;
  renderTabs(nB);
  const ae = document.activeElement; const keep = ae && ae.id ? {id:ae.id, s:ae.selectionStart, e:ae.selectionEnd} : null;
  ({oversikt:vOversikt, bestill:vBestill, mottak:vMottak, telling:vTelling, svinn:vSvinn, varer:vVarer, faktura:vFaktura, oppsett:vOppsett}[view] || vOversikt)();
  if (keep){ const el = document.getElementById(keep.id); if (el && el !== document.activeElement){ el.focus(); try { if (keep.s != null) el.setSelectionRange(keep.s, keep.e); } catch(e){} } }
}
const nInv = () => S.invoices.filter(i => ['kontroll','avvik'].includes(i.status)).length;
function renderTabs(nB){
  const openO = S.orders.filter(o => o.status === 'bestilt').length;
  $('#tabs').innerHTML = TABS.map(([k,l,p]) => `<button class="${view===k?'on':''}" data-go="${k}" aria-label="${l}"><svg viewBox="0 0 24 24" fill="currentColor">${p}</svg>${l}${k==='oversikt'&&nB?`<span class="badge">${nB}</span>`:''}${k==='mottak'&&openO?`<span class="badge" style="background:var(--blue)">${openO}</span>`:''}${k==='faktura'&&nInv()?`<span class="badge" style="background:var(--amber)">${nInv()}</span>`:''}</button>`).join('');
}
document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g){ e.preventDefault(); if (g.dataset.sup) UI.sup = g.dataset.sup; if (g.dataset.sup) UI.delivery = null; go(g.dataset.go); } });
const ro = () => S.canWrite ? '' : 'disabled';
const roM = () => S.canWrite && S.canManage ? '' : 'disabled';
const roNote = () => S.canWrite ? '' : `<div class="note warn">Du har bare lesetilgang. Eier må gi deg tilgang som Bidragsyter for at du skal kunne registrere.</div>`;

/* ================= OVERSIKT ================= */
function vOversikt(){
  const it = C.items, set = SET();
  const act = it.filter(r => r.active);
  const nB = act.filter(r => r.status==='bestill'), nS = act.filter(r => r.status==='snart'), nT = act.filter(r => r.status==='tell'), wr = it.filter(r => r.wasteRisk);
  const value = it.reduce((s,r) => s + r.value, 0);
  const openO = S.orders.filter(o => o.status === 'bestilt');
  const today = C.today;
  const due = openO.filter(o => o.deliveryDate <= today);
  let h = `<div class="row between"><div><h2>God ${greet()}</h2><div class="muted">${cap(WDL[pd(today).getDay()])} ${fmtD(today)} · forventet matsalg ${kr(C.sales)} per uke</div></div>
    <div class="row"><button class="btn" data-go="svinn">+ Registrer svinn</button><button class="btn primary" data-go="bestill">Lag bestilling</button></div></div>`;
  h += roNote();
  if (S.mode === 'local') h += `<div class="note warn"><b>Lagres bare på denne enheten.</b>&nbsp;Åpne appen innlogget via lenken fra eier, så deler alle ansatte samme tall.</div>`;
  if (!getItems().length) h += `<div class="note info"><div><b>Kom i gang:</b> ${S.canManage ? 'legg inn leverandørene under Innstillinger, og importer varelista under Varer (Excel/CSV). Deretter teller dere varelageret.' : 'leder må legge inn leverandører og varer før dere kan telle og bestille.'}<div class="row" style="margin-top:10px">${S.canManage ? '<button class="btn primary" data-go="oppsett">Innstillinger</button><button class="btn" data-go="varer">Importer varer</button>' : ''}</div></div></div>`;
  else if (!C.cur) h += `<div class="note info"><div><b>Start med første varetelling.</b> Uten telling vet ikke systemet hva som står på lager, og alle varer står som «Tell». Når tellingen er ført, regner appen ut beholdning, hvor mange dager den holder og hva som bør bestilles.<div style="margin-top:10px"><button class="btn primary" data-go="telling">Gå til varetelling</button></div></div></div>`;
  else if (daysBetween(C.cur.date, today) > 35) h += `<div class="note warn">Siste telling var ${fmtDL(C.cur.date)} (${daysBetween(C.cur.date,today)} dager siden). Tell på nytt så tallene holder seg riktige.&nbsp;<button class="btn sm" data-go="telling">Tell nå</button></div>`;
  if (due.length) h += `<div class="note info">📦 ${due.length} bestilling${due.length>1?'er':''} skulle vært levert innen i dag. Registrer varemottak når varene er sjekket.&nbsp;<button class="btn sm" data-go="mottak">Til varemottak</button></div>`;
  h += `<div class="grid g4">
    <button class="tile red" data-filter="bestill"><span class="lbl">Bestill nå</span><span class="big">${nB.length}</span><span class="small muted">holder ikke til neste levering</span></button>
    <button class="tile amber" data-filter="snart"><span class="lbl">Snart</span><span class="big">${nS.length}</span><span class="small muted">tar av sikkerhetslageret</span></button>
    <button class="tile ${wr.length?'amber':'green'}" data-filter="svinn"><span class="lbl">Svinnrisiko</span><span class="big">${wr.length}</span><span class="small muted">går ut før det brukes opp</span></button>
    <button class="tile blue" data-go="varer"><span class="lbl">Lagerverdi nå</span><span class="big">${C.cur ? kr(value) : '–'}</span><span class="small muted">${C.cur ? 'beregnet, eks. mva' : 'krever telling'}</span></button>
  </div>`;
  // leverandørkort
  h += `<div class="grid g3">` + Object.keys(set.suppliers).map(code => {
    const s = set.suppliers[code]; const lines = act.filter(r => r.sup === code && r.sugg > 0);
    const tot = lines.reduce((a,r) => a + r.suggNok, 0); const urgent = lines.filter(r => r.status==='bestill').length;
    const nd = nextDelivery(code, today); const op = openO.filter(o => o.sup === code);
    return `<div class="card supcard"><div class="row between"><h3 translate="no">${esc(s.name.replace(/ (AS|ASA)$/,''))}</h3><span class="pill p-behov" translate="no">${esc(code)}</span></div>
      <dl class="kv"><dt>Leverer</dt><dd>${esc(s.days)}</dd><dt>Neste mulige</dt><dd>${fmtDL(nd)}</dd><dt>Forslag nå</dt><dd>${lines.length} varer · ${kr(tot)}</dd>${op.length?`<dt>Åpne ordre</dt><dd>${op.length} (levering ${op.map(o=>fmtD(o.deliveryDate)).join(', ')})</dd>`:''}</dl>
      ${urgent?`<div class="small" style="color:var(--red);font-weight:600">${urgent} vare${urgent>1?'r':''} må bestilles nå</div>`:''}
      <button class="btn ${urgent?'primary':''}" data-go="bestill" data-sup="${code}">Åpne bestilling <span translate="no">${esc(code)}</span></button></div>`;
  }).join('') + `</div>`;
  // går tom først
  const crit = act.filter(r => r.status==='bestill' || r.status==='snart').sort((a,b) => (a.cover??999)-(b.cover??999)).slice(0,12);
  h += `<div class="grid g2"><div class="card flush"><div style="padding:14px 16px 6px"><h3>Går tom først</h3><div class="small muted">Beregnet beholdning inkl. åpne bestillinger</div></div>`;
  h += crit.length ? `<table><thead><tr><th>Vare</th><th class="n">Har</th><th>Holder</th><th class="n">Forslag</th></tr></thead><tbody>${crit.map(r => `<tr class="click" data-item="${esc(r.id)}"><td><div class="iname">${esc(r.name)}</div><div class="isub">${r.sup} · ${esc(r.stor)} · tom ca. ${fmtD(r.runsOut)}</div></td><td class="n">${q(r.avail)} ${esc(r.unit)}</td><td><div class="row" style="gap:8px;flex-wrap:nowrap">${coverBar(r)}<span class="tab">${coverTxt(r)}</span></div></td><td class="n"><b>${q(r.sugg)}</b></td></tr>`).join('')}</tbody></table>` : `<div class="empty">${C.cur ? 'Ingen varer er i ferd med å gå tom. 👍' : 'Vises når første telling er ført.'}</div>`;
  h += `</div><div class="card flush"><div style="padding:14px 16px 6px"><h3>Bruk først (svinnrisiko)</h3><div class="small muted">Eldste pakning går ut før lageret er brukt opp</div></div>`;
  h += wr.length ? `<table><thead><tr><th>Vare</th><th class="n">Har</th><th>Går ut</th></tr></thead><tbody>${wr.sort((a,b)=>a.daysToExp-b.daysToExp).map(r => `<tr class="click" data-item="${esc(r.id)}"><td><div class="iname">${esc(r.name)}</div><div class="isub">Bruk i dagens rett/personalmat · bestill mindre neste gang</div></td><td class="n">${q(r.stockNow)} ${esc(r.unit)}</td><td><b>${fmtD(r.expiry)}</b> <span class="small muted">(${r.daysToExp} d)</span></td></tr>`).join('')}</tbody></table>` : `<div class="empty">Ingen varer med svinnrisiko. Datoene hentes fra «tidligste utløpsdato» i varetellingen.</div>`;
  h += `</div></div>`;
  if (nT.length && C.cur) h += `<div class="note info">${nT.length} aktive varer mangler telling og står som «Tell». Tell dem neste gang, eller sett dem til «Ved behov» under Varer.</div>`;
  $('#view').innerHTML = h;
  document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { const f = b.dataset.filter; UI.vStatus = f; UI.vSup=''; UI.vStore=''; UI.vSearch=''; go('varer'); });
  bindItemRows();
}
const greet = () => { const h = new Date().getHours(); return h < 10 ? 'morgen' : h < 17 ? 'dag' : 'kveld'; };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/* ================= BESTILL ================= */
function vBestill(){
  const set = SET();
  if (!Object.keys(set.suppliers).length){ $('#view').innerHTML = `<h2>Bestilling</h2><div class="card empty">Ingen leverandører er satt opp ennå. ${S.canManage ? '<button class="btn primary" data-go="oppsett">Legg til leverandør</button>' : 'Be leder legge inn leverandørene under Innstillinger.'}</div>`; return; }
  if (!set.suppliers[UI.sup]) UI.sup = Object.keys(set.suppliers)[0];
  const code = UI.sup; const s = set.suppliers[code];
  if (!UI.delivery) UI.delivery = nextDelivery(code, C.today);
  const draft = UI.draft[code] || (UI.draft[code] = {});
  const all = C.items.filter(r => r.sup === code);
  const sq = UI.ordSearch.trim().toLowerCase();
  let rows = all.filter(r => UI.showAll || sq || r.sugg > 0 || draft[r.id] != null);
  if (sq) rows = rows.filter(r => (r.name + ' ' + r.no).toLowerCase().includes(sq));
  const ord = {bestill:0, tell:1, snart:2, ok:3, behov:4};
  rows.sort((a,b) => (ord[a.status]-ord[b.status]) || (b.suggNok - a.suggNok));
  const qtyOf = r => draft[r.id] != null ? draft[r.id] : r.sugg;
  const chosen = all.filter(r => qtyOf(r) > 0);
  const total = chosen.reduce((a,r) => a + qtyOf(r) * (r.price||0), 0);
  const hr = new Date().getHours();
  let h = `<div class="row between"><div><h2>Bestilling</h2><div class="muted">Velg leverandør og leveringsdag. Forslagene tar hensyn til lager, åpne ordre, salg og holdbarhet.</div></div></div>`;
  h += roNote();
  h += `<div class="seg">` + Object.keys(set.suppliers).map(c => { const n = C.items.filter(r => r.sup===c && r.sugg>0).length; return `<button class="${c===code?'on':''}" data-sup="${c}"><b translate="no">${esc(set.suppliers[c].name)}</b><span class="small muted">${esc(set.suppliers[c].days)} · ${n} forslag</span></button>`; }).join('') + `</div>`;
  h += `<div class="card grid g2" style="align-items:end"><label class="f">Ønsket leveringsdato<input type="date" id="ordDel" value="${UI.delivery}"></label>
      <div class="note ${code==='OL'&&hr>=14?'warn':'info'}" style="margin:0"><div><b>${esc(s.days)}.</b> ${esc(s.notes||'')}<br><span class="small">Bestillingsrytme: ${STORES.filter(st => all.some(r => r.stor === st)).map(st => `${esc(st.toLowerCase())} hver ${q(Math.max(s.interval||0, freqFor(set, st)))}. dag`).join(' · ')}</span>${code==='OL'&&hr>=14?'<br><b>Klokka er over 14 – bestilling nå kan gi sen-gebyr.</b>':''}</div></div></div>`;
  if (!C.cur) h += `<div class="note warn">Ingen telling er ført ennå. Forslagene er da et fullt mållager per vare – sjekk hylla før du bestiller.</div>`;
  h += `<div class="row between"><div class="chips"><button class="chip ${!UI.showAll?'on':''}" id="fSugg">Bare forslag</button><button class="chip ${UI.showAll?'on':''}" id="fAll">Alle varer fra <span translate="no">${esc(code)}</span> (${all.length})</button></div>
       <div style="min-width:240px;flex:1;max-width:360px"><input type="search" id="ordSearch" placeholder="Søk vare eller varenummer" value="${esc(UI.ordSearch)}"></div></div>`;
  h += `<div class="card flush"><div class="tblwrap"><table><thead><tr><th>Vare</th><th>Status</th><th class="n">Har nå</th><th>Holder</th><th class="n">Bruk/uke</th><th class="n">Forslag</th><th>Bestill</th><th class="n">Sum</th></tr></thead><tbody>`;
  h += rows.length ? rows.map(r => { const v = qtyOf(r); const changed = draft[r.id] != null && draft[r.id] !== r.sugg; return `<tr>
      <td><div class="iname click" data-item="${esc(r.id)}" style="cursor:pointer">${esc(r.name)}</div><div class="isub">Varenr ${esc(r.no)} · ${esc(r.unit)}${r.pack!==1?' · pakning '+q(r.pack):''} · ${kr(r.price)}/${esc(r.unit)}${r.wasteRisk?' · <span style="color:var(--amber);font-weight:600">svinnrisiko</span>':''}</div></td>
      <td>${pill(r.status)}</td><td class="n">${q(r.avail)}</td><td><span class="tab">${coverTxt(r)}</span></td><td class="n">${q(r.usageWeek)}</td><td class="n">${q(r.sugg)}</td>
      <td><div class="stepper"><button data-step="-1" data-id="${esc(r.id)}" aria-label="Mindre" ${ro()}>−</button><input id="q-${esc(r.id)}" inputmode="decimal" data-qty="${esc(r.id)}" value="${v ? nf1.format(v).replace(/\s/g,'') : ''}" placeholder="0" style="${changed?'color:var(--blue)':''}" ${ro()}><button data-step="1" data-id="${esc(r.id)}" aria-label="Mer" ${ro()}>+</button></div></td>
      <td class="n">${v ? kr(v*(r.price||0)) : '–'}</td></tr>`; }).join('') : `<tr><td colspan="8"><div class="empty">${sq ? 'Ingen treff.' : 'Ingen forslag for '+code+' akkurat nå. Velg «Alle varer» for å legge til noe manuelt.'}</div></td></tr>`;
  h += `</tbody></table></div></div>`;
  h += `<div class="sticky-foot"><div class="footbar"><div><div class="small muted">${code} · levering ${fmtDL(UI.delivery)}</div><div style="font-family:var(--display);font-weight:700;font-size:20px">${chosen.length} varer · ${kr(total)}</div></div><div style="flex:1"></div>
      <button class="btn" id="ordReset">Tilbakestill til forslag</button><button class="btn" id="ordCopy" ${chosen.length?'':'disabled'}>Kopier liste</button><button class="btn" id="ordDl" ${chosen.length?'':'disabled'}>Last ned</button><button class="btn primary lg" id="ordSave" ${chosen.length&&S.canWrite?'':'disabled'}>Lagre som bestilt</button></div></div>`;
  $('#view').innerHTML = h;
  document.querySelectorAll('.seg [data-sup]').forEach(b => b.onclick = () => { UI.sup = b.dataset.sup; UI.delivery = null; render(); });
  $('#ordDel').onchange = e => { UI.delivery = e.target.value; render(); };
  $('#fSugg').onclick = () => { UI.showAll = false; render(); };
  $('#fAll').onclick = () => { UI.showAll = true; render(); };
  $('#ordSearch').oninput = e => { UI.ordSearch = e.target.value; render(); };
  document.querySelectorAll('[data-step]').forEach(b => b.onclick = () => { const r = C.items.find(x => x.id === b.dataset.id); const step = r.pack > 0 ? r.pack : 1; const cur = qtyOf(r); draft[r.id] = Math.max(0, Math.round((cur + step*Number(b.dataset.step))*100)/100); saveDraft(); render(); });
  document.querySelectorAll('[data-qty]').forEach(inp => inp.onchange = () => { const v = num(inp.value); draft[inp.dataset.qty] = v == null ? 0 : Math.max(0, v); saveDraft(); render(); });
  $('#ordReset').onclick = () => { UI.draft[code] = {}; saveDraft(); render(); };
  const lines = () => chosen.map(r => ({r, qty: qtyOf(r)}));
  $('#ordCopy').onclick = async () => { const txt = `Bestilling – ${s.name}\nØnsket levering: ${fmtDL(UI.delivery)}\n\n` + lines().map(x => `${x.r.no}\t${x.r.name}\t${nf1.format(x.qty)} ${x.r.unit}`).join('\n') + `\n\nSum ca. ${kr(total)} eks. mva`; try { await navigator.clipboard.writeText(txt); toast('Bestillingen er kopiert. Lim inn i e-post eller nettbutikk.'); } catch(e){ showText('Kopier bestillingen', txt); } };
  $('#ordDl').onclick = () => download(`bestilling-${code}-${UI.delivery}.csv`, csv([['Varenr','Vare','Antall','Enhet','Pris/enhet','Sum'], ...lines().map(x => [x.r.no, x.r.name, x.qty, x.r.unit, x.r.price, Math.round(x.qty*x.r.price)])]));
  $('#ordSave').onclick = () => confirmBox(`Lagre bestilling til ${s.name}?`, `${chosen.length} varer for ${kr(total)} med levering ${fmtDL(UI.delivery)}. Husk å sende bestillingen til leverandøren som vanlig (nettbutikk, e-post eller telefon). Varene teller som «åpne ordre» til de er registrert mottatt.`, 'Lagre som bestilt', async () => {
    const id = uid();
    await store.put('orders', id, {sup:code, orderDate:C.today, deliveryDate:UI.delivery, status:'bestilt', lines:lines().map(x => ({id:x.r.id, qty:x.qty, price:x.r.price})), total, ts:Date.now()});
    UI.draft[code] = {}; saveDraft(); toast('Bestillingen er lagret. Registrer mottak når varene kommer.'); render();
  });
  bindItemRows();
}

/* ================= VAREMOTTAK ================= */
let openOrderId = null;
function vMottak(){
  const set = SET(); const items = Object.fromEntries(C.items.map(r => [r.id, r]));
  const open = S.orders.filter(o => o.status === 'bestilt').sort((a,b) => a.deliveryDate < b.deliveryDate ? -1 : 1);
  const hist = S.orders.filter(o => o.status !== 'bestilt').sort((a,b) => (b.deliveryDate||'') < (a.deliveryDate||'') ? -1 : 1).slice(0,25);
  let h = `<div><h2>Varemottak</h2><div class="muted">Sjekk varene mot bestillingen, juster antall ved avvik og trykk «Registrer mottatt».</div></div>` + roNote();
  if (!open.length) h += `<div class="card empty">Ingen åpne bestillinger. Bestillinger du lagrer under «Bestill» dukker opp her.</div>`;
  open.forEach(o => {
    const late = o.deliveryDate < C.today, isOpen = openOrderId === o.id;
    h += `<div class="card" style="${late?'border-left:5px solid var(--amber)':''}"><div class="row between"><div><h3>${esc(set.suppliers[o.sup]?.name || o.sup)}</h3><div class="small muted">Bestilt ${fmtDL(o.orderDate)} · forventet ${fmtDL(o.deliveryDate)}${late?' · <b style="color:var(--amber)">forsinket / ikke registrert</b>':''} · ${o.lines.length} varer · ${kr(o.total)}</div></div>
      <button class="btn ${isOpen?'':'primary'}" data-open="${o.id}">${isOpen?'Lukk':'Ta imot varer'}</button></div>`;
    if (isOpen){
      h += `<div class="tblwrap" style="margin-top:12px"><table><thead><tr><th>Vare</th><th class="n">Bestilt</th><th>Mottatt</th></tr></thead><tbody>${o.lines.map((l,i) => { const it = items[l.id] || {name:l.id, unit:''}; const rv = l.recv != null ? l.recv : l.qty; return `<tr><td><div class="iname">${esc(it.name)}</div><div class="isub">Varenr ${esc(it.no||'')} · ${esc(it.unit)}</div></td><td class="n">${q(l.qty)}</td><td><div class="stepper"><button data-rs="-1" data-i="${i}" ${ro()}>−</button><input id="rv-${o.id}-${i}" inputmode="decimal" data-rv="${i}" value="${nf1.format(rv).replace(/\s/g,'')}" style="${rv!==l.qty?'color:var(--amber)':''}" ${ro()}><button data-rs="1" data-i="${i}" ${ro()}>+</button></div></td></tr>`; }).join('')}</tbody></table></div>
      <div class="row" style="margin-top:12px"><label class="f" style="max-width:220px">Faktisk leveringsdato<input type="date" id="rcvDate" value="${C.today}"></label><div style="flex:1"></div><button class="btn danger" id="ordCancel" ${ro()}>Kanseller bestilling</button><button class="btn primary lg" id="ordRecv" ${ro()}>Registrer mottatt</button></div>`;
    }
    h += `</div>`;
  });
  h += `<div class="card flush"><div style="padding:14px 16px 6px"><h3>Historikk</h3></div>${hist.length ? `<table><thead><tr><th>Levert</th><th>Leverandør</th><th class="n">Varer</th><th class="n">Verdi</th><th>Status</th><th></th></tr></thead><tbody>${hist.map(o => `<tr><td>${fmtDL(o.deliveryDate)}</td><td>${esc(o.sup)}</td><td class="n">${o.lines.length}</td><td class="n">${kr(o.total)}</td><td>${o.status==='mottatt'?'<span class="pill p-ok">Mottatt</span>':'<span class="pill p-behov">Kansellert</span>'}</td><td class="n"><button class="btn sm" data-undo="${o.id}" ${ro()}>Angre</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Ingen mottak registrert ennå.</div>'}</div>`;
  $('#view').innerHTML = h;
  document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { openOrderId = openOrderId === b.dataset.open ? null : b.dataset.open; render(); });
  const o = open.find(x => x.id === openOrderId);
  if (o){
    const work = JSON.parse(JSON.stringify(o));
    const setRv = (i, v) => { work.lines[i].recv = Math.max(0, Math.round(v*100)/100); const el = document.getElementById(`rv-${o.id}-${i}`); el.value = nf1.format(work.lines[i].recv).replace(/\s/g,''); el.style.color = work.lines[i].recv !== work.lines[i].qty ? 'var(--amber)' : ''; };
    document.querySelectorAll('[data-rs]').forEach(b => b.onclick = () => { const i = +b.dataset.i; const l = work.lines[i]; const step = (C.items.find(r=>r.id===l.id)||{}).pack || 1; setRv(i, (l.recv != null ? l.recv : l.qty) + step*Number(b.dataset.rs)); });
    document.querySelectorAll('[data-rv]').forEach(inp => inp.onchange = () => setRv(+inp.dataset.rv, num(inp.value) || 0));
    $('#ordRecv').onclick = async () => { work.lines.forEach(l => { if (l.recv == null) l.recv = l.qty; }); work.status = 'mottatt'; work.deliveryDate = $('#rcvDate').value || C.today; work.receivedTs = Date.now(); const id = work.id; delete work.id; await store.put('orders', id, work); openOrderId = null; toast('Varemottak registrert. Lageret er oppdatert.'); };
    $('#ordCancel').onclick = () => confirmBox('Kansellere bestillingen?', 'Varene fjernes fra åpne ordre og kommer tilbake som forslag.', 'Kanseller', async () => { const id = work.id; delete work.id; work.status = 'kansellert'; await store.put('orders', id, work); openOrderId = null; });
  }
  document.querySelectorAll('[data-undo]').forEach(b => b.onclick = () => confirmBox('Angre?', 'Bestillingen blir åpen igjen, og mottatte varer trekkes ut av lageret til den registreres på nytt.', 'Angre', async () => { const x = JSON.parse(JSON.stringify(S.orders.find(o => o.id === b.dataset.undo))); const id = x.id; delete x.id; x.status = 'bestilt'; await store.put('orders', id, x); }));
}

/* ================= VARETELLING ================= */
let countSaveTimer = null, countWork = null, countSaving = false, countDirty = false;
function vTelling(){
  const items = getItems();
  const draft = S.counts.find(c => c.status === 'pågår');
  const done = S.counts.filter(c => c.status === 'fullført').sort((a,b) => a.date < b.date ? 1 : -1);
  let h = `<div><h2>Varetelling</h2><div class="muted">Tell én gang i måneden, siste dag etter stenging. Gå hylle for hylle: kjøl, frys, tørrvare.</div></div>` + roNote();
  if (!draft){
    countWork = null;
    h += `<div class="card grid g2" style="align-items:end"><div><h3>Start ny telling</h3><div class="small muted">${done[0] ? 'Forrige telling: '+fmtDL(done[0].date) : 'Dette blir første telling. Faktisk forbruk beregnes fra og med andre telling.'}</div></div>
      <div class="row" style="flex-wrap:nowrap"><label class="f" style="flex:1">Tellingsdato<input type="date" id="cDate" value="${C.today}"></label><button class="btn primary lg" id="cStart" ${ro()}>Start telling</button></div></div>
      <div class="row"><button class="btn" id="cSheet">Last ned telleliste (for utskrift)</button><span class="small muted">Excel-fil sortert kjøl → frys → tørr, med kolonner å skrive i.</span></div>`;
  } else {
    if (!countWork || countWork.id !== draft.id || (!countDirty && !countSaving)) countWork = JSON.parse(JSON.stringify(draft));
    const L = countWork.lines || (countWork.lines = {});
    const prevC = done[0];
    const isCounted = i => L[i.id] && L[i.id].q != null && L[i.id].q !== '';
    const nDone = items.filter(isCounted).length;
    const byStore = s => items.filter(i => i.stor === s);
    const sq = UI.cSearch.trim().toLowerCase();
    let list = sq ? items.filter(i => (i.name+' '+i.no).toLowerCase().includes(sq)) : (UI.cStore === 'Alle' ? items : byStore(UI.cStore));
    if (UI.cOnlyOpen) list = list.filter(i => !isCounted(i));
    list = [...list].sort((a,b) => STORES.indexOf(a.stor)-STORES.indexOf(b.stor) || a.cat.localeCompare(b.cat,'nb') || a.name.localeCompare(b.name,'nb'));
    const val = items.reduce((s,i) => s + (isCounted(i) ? L[i.id].q * (i.price||0) : 0), 0);
    h += `<div class="card"><div class="row between"><div><h3>Telling ${fmtDL(countWork.date)}</h3><div class="small muted">Lagres automatisk mens du teller · ${countSaving ? 'lagrer …' : countDirty ? 'endringer venter' : 'alt er lagret'}</div></div>
      <div class="row"><span class="num"><b>${nDone}</b> av ${items.length} talt · ${kr(val)}</span><button class="btn danger sm" id="cDiscard" ${ro()}>Forkast</button></div></div>
      <div class="progress" style="margin-top:10px"><span style="width:${nDone/items.length*100}%"></span></div></div>`;
    h += `<div class="row between"><div class="chips">${[...STORES,'Alle'].map(s => { const arr = s==='Alle'?items:byStore(s); const d = arr.filter(isCounted).length; return `<button class="chip ${UI.cStore===s&&!sq?'on':''}" data-cs="${s}">${s} <span class="num muted">${d}/${arr.length}</span></button>`; }).join('')}
      <button class="chip ${UI.cOnlyOpen?'on':''}" id="cOpen">Bare utalte</button></div><div style="min-width:220px;flex:1;max-width:340px"><input type="search" id="cSearch" placeholder="Søk vare" value="${esc(UI.cSearch)}"></div></div>`;
    h += `<div class="card flush">` + (list.length ? list.map(i => { const l = L[i.id] || {}; const pv = prevC && prevC.lines && prevC.lines[i.id] ? prevC.lines[i.id].q : null; return `<div class="countrow ${isCounted(i)?'done':''}" id="row-${esc(i.id)}">
        <div><div class="iname">${esc(i.name)}</div><div class="isub">${esc(i.stor)} · ${esc(i.cat)} · ${i.sup} ${esc(i.no)} · telles i <b>${esc(i.unit)}</b>${pv!=null?' · forrige: '+q(pv):''}</div></div>
        <div class="row" style="gap:6px;flex-wrap:nowrap"><div class="stepper"><button data-cstep="-1" data-id="${esc(i.id)}" ${ro()}>−</button><input id="c-${esc(i.id)}" inputmode="decimal" data-cq="${esc(i.id)}" value="${l.q!=null&&l.q!==''?String(l.q).replace('.',','):''}" placeholder="–" ${ro()}><button data-cstep="1" data-id="${esc(i.id)}" ${ro()}>+</button></div><button class="btn sm" data-zero="${esc(i.id)}" title="Tom hylle" ${ro()}>Tom</button></div>
        <div class="expwrap"><input type="date" class="exp" id="e-${esc(i.id)}" data-ce="${esc(i.id)}" value="${l.exp||''}" title="Tidligste utløpsdato" aria-label="Tidligste utløpsdato" ${ro()}></div></div>`; }).join('') : `<div class="empty">${UI.cOnlyOpen ? 'Alt er talt her. 🎉' : 'Ingen varer.'}</div>`) + `</div>`;
    h += `<div class="note info small">Tell i enheten som står på varen. Skriv <b>0</b> eller trykk «Tom» hvis varen hører til lageret men er tom. La feltet stå tomt hvis varen ikke føres. Datofeltet er <b>tidligste utløpsdato</b> (eldste pakning) – den gir varsel om svinnrisiko.</div>`;
    h += `<div class="sticky-foot"><div class="footbar"><div class="num"><b>${nDone}</b> av ${items.length} varer talt</div><div style="flex:1"></div><button class="btn primary lg" id="cFinish" ${ro()}>Fullfør telling</button></div></div>`;
  }
  if (done.length){
    h += `<div class="card flush"><div style="padding:14px 16px 6px"><h3>Tidligere tellinger</h3></div><table><thead><tr><th>Dato</th><th class="n">Varer talt</th><th class="n">Lagerverdi</th><th class="n">Matsalg i perioden</th><th></th></tr></thead><tbody>${done.map((c,ix) => { const its = getItems(); const n = its.filter(i => c.lines[i.id] && c.lines[i.id].q != null && c.lines[i.id].q !== '').length; const v = its.reduce((s,i) => s + (c.lines[i.id] && c.lines[i.id].q ? c.lines[i.id].q*(i.price||0) : 0), 0); return `<tr><td>${fmtDL(c.date)}</td><td class="n">${n}</td><td class="n">${kr(v)}</td><td class="n">${c.sales?kr(c.sales):'–'}</td><td class="n">${ix===0&&!draft?`<button class="btn sm" data-reopen="${c.id}" ${ro()}>Åpne for retting</button>`:''}<button class="btn sm" data-cdl="${c.id}">Last ned</button></td></tr>`; }).join('')}</tbody></table></div>`;
  }
  $('#view').innerHTML = h;
  const sheetBtn = $('#cSheet'); if (sheetBtn) sheetBtn.onclick = () => download(`telleliste-${C.today}.csv`, csv([['Lager','Kategori','Leverandør','Varenr','Vare','Enhet','Antall','Tidligste utløpsdato'], ...[...items].sort((a,b)=>STORES.indexOf(a.stor)-STORES.indexOf(b.stor)||a.cat.localeCompare(b.cat,'nb')||a.name.localeCompare(b.name,'nb')).map(i => [i.stor,i.cat,i.sup,i.no,i.name,i.unit,'',''])]));
  const st = $('#cStart'); if (st) st.onclick = async () => { const d = $('#cDate').value || C.today; const id = uid(); await store.put('counts', id, {date:d, status:'pågår', lines:{}, ts:Date.now()}); toast('Tellingen er startet. Begynn med kjøl.'); };
  document.querySelectorAll('[data-reopen]').forEach(b => b.onclick = () => confirmBox('Åpne siste telling for retting?', 'Tellingen blir «pågår» igjen til du fullfører den på nytt. Beregningene bruker forrige telling så lenge.', 'Åpne', async () => { const c = JSON.parse(JSON.stringify(S.counts.find(x => x.id === b.dataset.reopen))); const id = c.id; delete c.id; c.status = 'pågår'; await store.put('counts', id, c); }));
  document.querySelectorAll('[data-cdl]').forEach(b => b.onclick = () => { const c = S.counts.find(x => x.id === b.dataset.cdl); download(`telling-${c.date}.csv`, csv([['Lager','Leverandør','Varenr','Vare','Enhet','Antall','Utløpsdato','Pris','Verdi'], ...getItems().map(i => { const l = c.lines[i.id] || {}; return [i.stor,i.sup,i.no,i.name,i.unit,l.q??'',l.exp||'',i.price,l.q?Math.round(l.q*i.price):'']; })])); });
  if (!draft) return;
  const L = countWork.lines;
  const mark = id => { const row = document.getElementById('row-'+id); const v = L[id] && L[id].q != null && L[id].q !== ''; if (row) row.classList.toggle('done', v); };
  const setQ = (id, v) => { L[id] = L[id] || {}; L[id].q = v; if (v == null) delete L[id].q; const inp = document.getElementById('c-'+id); if (inp && document.activeElement !== inp) inp.value = v == null ? '' : String(v).replace('.',','); mark(id); queueCountSave(); };
  document.querySelectorAll('[data-cs]').forEach(b => b.onclick = () => { UI.cStore = b.dataset.cs; UI.cSearch = ''; flushCount(); render(); });
  $('#cOpen').onclick = () => { UI.cOnlyOpen = !UI.cOnlyOpen; flushCount(); render(); };
  $('#cSearch').oninput = e => { UI.cSearch = e.target.value; render(); };
  document.querySelectorAll('[data-cq]').forEach(inp => { inp.oninput = () => setQ(inp.dataset.cq, num(inp.value)); inp.onkeydown = e => { if (e.key === 'Enter'){ e.preventDefault(); const all = [...document.querySelectorAll('[data-cq]')]; const n = all[all.indexOf(inp)+1]; if (n){ n.focus(); n.select(); } } }; });
  document.querySelectorAll('[data-cstep]').forEach(b => b.onclick = () => { const id = b.dataset.id; const it = items.find(i => i.id === id); const step = it.pack > 0 && it.pack < 1 ? it.pack : 1; const cur = L[id] && L[id].q != null ? L[id].q : 0; const v = Math.max(0, Math.round((cur + step*Number(b.dataset.cstep))*100)/100); setQ(id, v); document.getElementById('c-'+id).value = String(v).replace('.',','); });
  document.querySelectorAll('[data-zero]').forEach(b => b.onclick = () => { setQ(b.dataset.zero, 0); document.getElementById('c-'+b.dataset.zero).value = '0'; });
  document.querySelectorAll('[data-ce]').forEach(inp => inp.onchange = () => { const id = inp.dataset.ce; L[id] = L[id] || {}; if (inp.value) L[id].exp = inp.value; else delete L[id].exp; queueCountSave(); });
  $('#cDiscard').onclick = () => confirmBox('Forkaste tellingen?', 'Alt du har talt i denne tellingen slettes. Tidligere tellinger påvirkes ikke.', 'Forkast', async () => { clearTimeout(countSaveTimer); countDirty = false; await store.del('counts', draft.id); countWork = null; });
  $('#cFinish').onclick = () => finishCount(draft, done[0], items);
}
function queueCountSave(){ countDirty = true; clearTimeout(countSaveTimer); countSaveTimer = setTimeout(flushCount, 900); }
async function flushCount(){
  clearTimeout(countSaveTimer);
  if (!countWork || !countDirty || countSaving) return;
  countSaving = true; countDirty = false;
  const data = JSON.parse(JSON.stringify(countWork)); const id = data.id; delete data.id;
  try { await store.put('counts', id, data); } catch(e){ countDirty = true; }
  countSaving = false;
  if (countDirty) queueCountSave();
}
function finishCount(draft, prev, items){
  const L = countWork.lines; const n = items.filter(i => L[i.id] && L[i.id].q != null && L[i.id].q !== '').length;
  // foreslå matsalg fra ukesalget i innstillingene
  let suggested = '';
  if (prev){ const ws = SET().weeks.filter(w => w.from >= prev.date && addDays(w.from, 6) <= countWork.date); if (ws.length) suggested = Math.round(ws.reduce((s,w)=>s+w.sales,0)); }
  modal(`<h3>Fullfør telling ${fmtDL(countWork.date)}</h3>
    <div>${n} av ${items.length} varer er talt.${n < items.length ? ' Varer uten tall regnes som «føres ikke» og får status «Tell».' : ''}</div>
    ${prev ? `<label class="f">Matsalg mellom ${fmtD(prev.date)} og ${fmtD(countWork.date)} (kr eks. mva)<input type="text" inputmode="numeric" id="fSales" value="${suggested}" placeholder="Tripletex konto 3000 + 3005"></label><div class="small muted">Hentes fra Tripletex, konto 3000 + 3005 for perioden. Brukes til å regne ut faktisk forbruk per 100 000 kr i matsalg. Kan stå tomt, men da brukes innkjøpshistorikken videre.</div>` : '<div class="small muted">Første telling: faktisk forbruk regnes ut fra neste telling.</div>'}
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Fortsett å telle</button><button class="btn primary" id="fOk">Fullfør</button></div>`, m => {
    m.querySelector('#fOk').onclick = async () => { const sales = prev ? num((m.querySelector('#fSales').value||'').replace(/\s/g,'')) : null; clearTimeout(countSaveTimer); countDirty = false; const data = JSON.parse(JSON.stringify(countWork)); const id = data.id; delete data.id; data.status = 'fullført'; data.sales = sales; data.doneTs = Date.now(); closeModal(); await store.put('counts', id, data); countWork = null; toast('Tellingen er fullført. Beholdning og forslag er oppdatert.'); go('oversikt'); };
  });
}

/* ================= SVINN ================= */
function vSvinn(){
  const items = getItems(); if (!UI.wDate) UI.wDate = C.today;
  const sel = UI.wItem ? items.find(i => i.id === UI.wItem) : null;
  const sq = UI.wSearch.trim().toLowerCase();
  const hits = sq && !sel ? items.filter(i => (i.name+' '+i.no).toLowerCase().includes(sq)).slice(0,8) : [];
  const month = C.today.slice(0,7);
  const list = [...S.waste].sort((a,b) => a.date < b.date ? 1 : a.date > b.date ? -1 : (b.ts||0)-(a.ts||0));
  const thisM = list.filter(w => w.date.slice(0,7) === month);
  const byR = {}; thisM.forEach(w => byR[w.reason] = (byR[w.reason]||0) + (w.value||0));
  const totM = thisM.reduce((s,w)=>s+(w.value||0),0);
  let h = `<div><h2>Svinn</h2><div class="muted">Registrer alt som kastes, samme dag. Svinnet trekkes fra lageret og viser hva utgått og skadet vare koster.</div></div>` + roNote();
  h += `<div class="card grid" style="gap:14px"><h3>Ny registrering</h3>`;
  h += sel ? `<div class="row between note good" style="margin:0"><div><div class="iname">${esc(sel.name)}</div><div class="isub">${sel.sup} ${esc(sel.no)} · ${esc(sel.unit)} · ${kr(sel.price)}/${esc(sel.unit)}</div></div><button class="btn sm" id="wClear">Bytt vare</button></div>`
    : `<label class="f">Hvilken vare?<input type="search" id="wSearch" placeholder="Skriv navn, f.eks. «melk» eller «brioche»" value="${esc(UI.wSearch)}" autocomplete="off"></label>${hits.length?`<div class="card flush">${hits.map(i=>`<div class="countrow click" data-pick="${esc(i.id)}" style="grid-template-columns:1fr auto;cursor:pointer"><div><div class="iname">${esc(i.name)}</div><div class="isub">${i.sup} ${esc(i.no)} · ${esc(i.stor)}</div></div><span class="muted">${esc(i.unit)}</span></div>`).join('')}</div>`:sq?'<div class="small muted">Ingen treff.</div>':''}`;
  h += `<div class="grid g2"><label class="f">Antall${sel?' ('+esc(sel.unit)+')':''}<input type="text" inputmode="decimal" id="wQty" value="${esc(UI.wQty)}" placeholder="f.eks. 2 eller 0,5"></label><label class="f">Dato<input type="date" id="wDate" value="${UI.wDate}"></label></div>
    <div class="f" style="display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:var(--muted)">Årsak<div class="chips">${REASONS.map(r=>`<button class="chip ${UI.wReason===r?'on':''}" data-reason="${r}">${r}</button>`).join('')}</div></div>
    <label class="f">Kommentar (valgfritt)<input type="text" id="wComment" value="${esc(UI.wComment)}" placeholder="f.eks. kjøleskap 2 for varmt"></label>
    <div class="row between"><span class="muted">${sel && num(UI.wQty) ? 'Verdi: <b>'+kr(num(UI.wQty)*sel.price)+'</b>' : ''}</span><button class="btn primary lg" id="wSave" ${sel && num(UI.wQty) > 0 && S.canWrite ? '' : 'disabled'}>Registrer svinn</button></div></div>`;
  h += `<div class="grid g4"><div class="tile amber"><span class="lbl">Svinn denne måneden</span><span class="big">${kr(totM)}</span><span class="small muted">${thisM.length} registreringer</span></div>${REASONS.slice(0,3).map(r=>`<div class="tile"><span class="lbl">${r}</span><span class="big">${kr(byR[r]||0)}</span></div>`).join('')}</div>`;
  h += `<div class="card flush"><div style="padding:14px 16px 6px"><h3>Siste registreringer</h3></div>${list.length?`<div class="tblwrap"><table><thead><tr><th>Dato</th><th>Vare</th><th class="n">Antall</th><th>Årsak</th><th class="n">Verdi</th><th></th></tr></thead><tbody>${list.slice(0,60).map(w=>{ const i = items.find(x=>x.id===w.itemId)||{name:w.itemId,unit:''}; return `<tr><td>${fmtDL(w.date)}</td><td><div class="iname">${esc(i.name)}</div>${w.comment?`<div class="isub">${esc(w.comment)}</div>`:''}</td><td class="n">${q(w.qty)} ${esc(i.unit)}</td><td>${esc(w.reason)}</td><td class="n">${kr(w.value)}</td><td class="n"><button class="btn sm danger" data-wdel="${w.id}" aria-label="Slett" ${ro()}>Slett</button></td></tr>`; }).join('')}</tbody></table></div>`:'<div class="empty">Ingen svinn registrert ennå.</div>'}</div>`;
  $('#view').innerHTML = h;
  const ws = $('#wSearch'); if (ws) ws.oninput = e => { UI.wSearch = e.target.value; render(); };
  document.querySelectorAll('[data-pick]').forEach(d => d.onclick = () => { UI.wItem = d.dataset.pick; UI.wSearch = ''; render(); setTimeout(()=>{ const x=$('#wQty'); x && x.focus(); },0); });
  const wc = $('#wClear'); if (wc) wc.onclick = () => { UI.wItem = null; render(); };
  $('#wQty').oninput = e => { UI.wQty = e.target.value; render(); };
  $('#wDate').onchange = e => { UI.wDate = e.target.value; };
  $('#wComment').oninput = e => { UI.wComment = e.target.value; };
  document.querySelectorAll('[data-reason]').forEach(b => b.onclick = () => { UI.wReason = b.dataset.reason; render(); });
  $('#wSave').onclick = async () => { const qty = num(UI.wQty); await store.put('waste', uid(), {date:UI.wDate||C.today, itemId:sel.id, qty, reason:UI.wReason, comment:UI.wComment, value:Math.round(qty*sel.price*100)/100, ts:Date.now()}); toast(`Svinn registrert: ${nf1.format(qty)} ${sel.unit} ${sel.name}`); UI.wItem=null; UI.wQty=''; UI.wComment=''; render(); };
  document.querySelectorAll('[data-wdel]').forEach(b => b.onclick = () => confirmBox('Slette registreringen?', 'Svinnet legges tilbake i beregnet beholdning.', 'Slett', () => store.del('waste', b.dataset.wdel)));
}

/* ================= VARER ================= */
function vVarer(){
  let rows = C.items;
  const sq = UI.vSearch.trim().toLowerCase();
  if (sq) rows = rows.filter(r => (r.name+' '+r.no+' '+r.cat).toLowerCase().includes(sq));
  if (UI.vSup) rows = rows.filter(r => r.sup === UI.vSup);
  if (UI.vStore) rows = rows.filter(r => r.stor === UI.vStore);
  if (UI.vStatus === 'svinn') rows = rows.filter(r => r.wasteRisk); else if (UI.vStatus) rows = rows.filter(r => r.status === UI.vStatus);
  const key = UI.vSort, dir = UI.vDir;
  const get = r => key==='cover' ? (r.cover ?? 1e9) : key==='name' ? r.name : r[key];
  rows = [...rows].sort((a,b) => { const x = get(a), y = get(b); return (typeof x === 'string' ? x.localeCompare(y,'nb') : x - y) * dir; });
  const th = (k,l,n) => `<th class="sort ${n?'n':''}" data-sort="${k}">${l}${UI.vSort===k?(UI.vDir>0?' ▲':' ▼'):''}</th>`;
  let h = `<div class="row between"><div><h2>Varer og beholdning</h2><div class="muted">${rows.length} av ${C.items.length} varer · trykk på en vare for detaljer og innstillinger</div></div><div class="row"><button class="btn" id="vImp" ${roM()}>Importer varer (Excel/CSV)</button><button class="btn" id="vNew" ${roM()}>+ Ny vare</button></div></div>`;
  h += `<div class="card grid" style="gap:10px"><input type="search" id="vSearch" placeholder="Søk navn, varenummer eller kategori" value="${esc(UI.vSearch)}">
    <div class="row"><div class="chips"><button class="chip ${!UI.vStatus?'on':''}" data-vs="">Alle</button>${['bestill','snart','ok','tell','behov'].map(s=>`<button class="chip ${UI.vStatus===s?'on':''}" data-vs="${s}">${STATUS[s][0]}</button>`).join('')}<button class="chip ${UI.vStatus==='svinn'?'on':''}" data-vs="svinn">Svinnrisiko</button></div>
    <select id="vSup" style="width:auto"><option value="">Alle leverandører</option>${Object.keys(SET().suppliers).map(c=>`<option ${UI.vSup===c?'selected':''}>${c}</option>`).join('')}</select>
    <select id="vStore" style="width:auto"><option value="">Alle lager</option>${STORES.map(s=>`<option ${UI.vStore===s?'selected':''}>${s}</option>`).join('')}</select></div></div>`;
  h += `<div class="card flush"><div class="tblwrap" style="max-height:calc(100vh - 330px)"><table><thead><tr>${th('name','Vare')}<th>Status</th>${th('stockNow','Har nå',1)}${th('open','Åpne ordre',1)}${th('usageWeek','Bruk/uke',1)}${th('cover','Holder')}<th>Tom ca.</th>${th('sugg','Forslag',1)}${th('value','Verdi',1)}</tr></thead><tbody>
    ${rows.map(r => `<tr class="click" data-item="${esc(r.id)}"><td><div class="iname">${esc(r.name)}</div><div class="isub">${r.sup} ${esc(r.no)} · ${esc(r.stor)} · ${esc(r.unit)}${r.wasteRisk?' · <span style="color:var(--amber);font-weight:600">bruk først</span>':''}</div></td><td>${pill(r.status)}</td><td class="n">${r.countDate?q(r.stockNow):'–'}</td><td class="n">${r.open?q(r.open):''}</td><td class="n">${q(r.usageWeek)}</td><td><div class="row" style="gap:8px;flex-wrap:nowrap">${r.countDate?coverBar(r):''}<span class="tab">${r.countDate?coverTxt(r):''}</span></div></td><td>${r.countDate&&r.runsOut?fmtD(r.runsOut):''}</td><td class="n">${r.sugg?'<b>'+q(r.sugg)+'</b>':''}</td><td class="n">${r.countDate?kr(r.value):''}</td></tr>`).join('') || '<tr><td colspan="9"><div class="empty">Ingen varer passer filteret.</div></td></tr>'}
  </tbody></table></div></div>`;
  $('#view').innerHTML = h;
  $('#vSearch').oninput = e => { UI.vSearch = e.target.value; render(); };
  document.querySelectorAll('[data-vs]').forEach(b => b.onclick = () => { UI.vStatus = b.dataset.vs; render(); });
  $('#vSup').onchange = e => { UI.vSup = e.target.value; render(); };
  $('#vStore').onchange = e => { UI.vStore = e.target.value; render(); };
  document.querySelectorAll('[data-sort]').forEach(t => t.onclick = () => { const k = t.dataset.sort; if (UI.vSort === k) UI.vDir *= -1; else { UI.vSort = k; UI.vDir = k==='name'||k==='cover' ? 1 : -1; } render(); });
  $('#vNew').onclick = newItemModal;
  $('#vImp').onclick = importItemsModal;
  bindItemRows();
}
function bindItemRows(){ document.querySelectorAll('[data-item]').forEach(el => el.onclick = e => { if (e.target.closest('button,input')) return; itemDrawer(el.dataset.item); }); }

function itemDrawer(id){
  const r = C.items.find(x => x.id === id); if (!r) return;
  const set = SET(); const sp = set.suppliers[r.sup] || {};
  const srcTxt = {manuell:'manuelt satt forbruk', telling:'faktisk forbruk fra siste to tellinger', innkjøp:'innkjøp siste 13 uker (Tripletex)'}[r.usageSource];
  const html = `<div class="row between"><div><div class="small muted">${r.sup} · varenr ${esc(r.no)}</div><h2>${esc(r.name)}</h2></div><button class="btn" data-close>Lukk</button></div>
    <div class="row">${pill(r.status)}${r.wasteRisk?'<span class="pill p-svinn">Svinnrisiko</span>':''}<span class="muted small">${esc(r.cat)} · ${esc(r.stor)} · ${esc(r.area)}</span></div>
    <div class="grid g2"><div class="tile"><span class="lbl">Har nå (beregnet)</span><span class="big">${r.countDate?q(r.stockNow):'–'} <span style="font-size:16px">${esc(r.unit)}</span></span></div><div class="tile"><span class="lbl">Holder</span><span class="big">${r.countDate?coverTxt(r):'–'}</span><span class="small muted">${r.runsOut&&r.countDate?'tom ca. '+fmtDL(r.runsOut):''}</span></div></div>
    <div class="card"><h3 style="margin-bottom:8px">Slik er tallet regnet</h3>${r.countDate ? `<div class="calc">
      <span>Talt ${fmtDL(r.countDate)}</span><span class="num">${q(r.stockAtCount)}</span>
      <span>− Svinn siden telling</span><span class="num">${q(r.wasteSince)}</span>
      <span>− Forbruk ${r.daysSince} dager (${q(r.usageWeek)}/uke)</span><span class="num">${q(r.usedSince)}</span>
      <span>+ Mottatt siden telling</span><span class="num">${q(r.rcvSince)}</span>
      <span class="tot">= Har nå</span><span class="tot num">${q(r.stockNow)}</span>
      <span>+ Åpne bestillinger</span><span class="num">${q(r.open)}</span>
      <span class="tot">= Tilgjengelig</span><span class="tot num">${q(r.avail)}</span></div>` : '<div class="muted">Ikke talt ennå. Tell varen for å få beholdning.</div>'}
      <div class="small muted" style="margin-top:10px">Forbruk/uke bygger på ${srcTxt}${r.usageSource!=='manuell'?`, skalert til forventet matsalg ${kr(C.sales)}/uke`:''}. ${esc(r.stor)} fylles opp hver ${q(r.cycle)}. dag (${esc(FREQ_TXT[r.stor]||'')}${r.cycle > r.freq ? ', begrenset av leverandørens leveringsrytme' : ''}). Varen kommer på forslag når tilgjengelig er under ${q(r.reorderPoint)} (forbruk fram til neste levering + sikkerhet). Da bestilles det opp til mållageret: forbruk per dag × ${q(r.horizon)} dager (${q(r.cycle)} syklus + ${sp.lead} ledetid + ${sp.safety} sikkerhet${r.shelf && r.shelf < (r.cycle+sp.lead+sp.safety) ? ', begrenset av holdbarhet '+r.shelf+' d' : ''}) = ${q(r.target)}, rundet opp til pakning ${q(r.pack)}. Forslag nå: <b>${q(r.sugg)}</b>.</div></div>
    <div class="card"><dl class="kv"><dt>Pris</dt><dd>${kr(r.price)} per ${esc(r.unit)} eks. mva</dd><dt>Kjøpt 13 uker</dt><dd>${q(r.b13)} ${esc(r.unit)} · ${r.ndel||0} leveranser</dd><dt>Sist levert</dt><dd>${fmtDL(r.last)}</dd><dt>Tidligste utløp</dt><dd>${r.expiry?fmtDL(r.expiry)+' ('+r.daysToExp+' d)':'–'}</dd></dl></div>
    <div class="card grid" style="gap:12px"><h3>Innstillinger for varen</h3>
      <div class="grid g2"><label class="f">Pakningsstørrelse (minste bestilling)<input type="text" inputmode="decimal" id="iPack" value="${String(r.pack).replace('.',',')}"></label><label class="f">Holdbarhet (dager)<input type="text" inputmode="numeric" id="iShelf" value="${r.shelf??''}"></label></div>
      <label class="f">Manuelt forbruk per uke (${esc(r.unit)}) – tomt = automatisk<input type="text" inputmode="decimal" id="iMan" value="${r.manual!=null&&r.manual!==''?String(r.manual).replace('.',','):''}" placeholder="Bruk ved ny rett, event o.l."></label>
      <label class="f">Lager<select id="iStor">${STORES.map(s=>`<option ${r.stor===s?'selected':''}>${s}</option>`).join('')}</select></label>
      <label class="row" style="gap:10px;font-weight:600"><input type="checkbox" id="iAct" ${r.active?'checked':''} style="width:22px;height:22px"> Aktiv i planlegging (får bestillingsforslag)</label>
      <div class="row" style="justify-content:flex-end">${r.custom?`<button class="btn danger" id="iDel" ${roM()}>Fjern vare</button>`:''}<button class="btn primary" id="iSave" ${roM()}>Lagre endringer</button></div></div>`;
  drawer(html, d => {
    d.querySelector('#iSave').onclick = async () => {
      const cfg = JSON.parse(JSON.stringify(S.itemcfg || {ov:{}})); cfg.ov = cfg.ov || {};
      const o = cfg.ov[id] || (r.custom ? {} : {});
      o.pack = num(d.querySelector('#iPack').value) || 1; o.shelf = num(d.querySelector('#iShelf').value); const m = num(d.querySelector('#iMan').value); o.manual = m == null ? null : m;
      o.active = d.querySelector('#iAct').checked; o.stor = d.querySelector('#iStor').value;
      cfg.ov[id] = {...(cfg.ov[id]||{}), ...o};
      await saveItemCfg(cfg); closeLayer(); toast('Varen er oppdatert.');
    };
    const del = d.querySelector('#iDel'); if (del) del.onclick = async () => { const cfg = JSON.parse(JSON.stringify(S.itemcfg)); cfg.ov[id].removed = true; await saveItemCfg(cfg); closeLayer(); };
  });
}
function newItemModal(){
  const set = SET();
  modal(`<h3>Ny vare</h3><div class="small muted">For nye retter eller nye produkter. Siden varen ikke har innkjøpshistorikk, må du anslå forbruk per uke.</div>
    <div class="grid g2"><label class="f">Leverandør<select id="nSup">${Object.keys(set.suppliers).map(c=>`<option value="${esc(c)}">${esc(c)} – ${esc(set.suppliers[c].name)}</option>`).join('') || '<option value="">Legg til leverandør først</option>'}</select></label><label class="f">Varenummer<input type="text" id="nNo"></label></div>
    <label class="f">Varenavn (som på fakturaen)<input type="text" id="nName"></label>
    <div class="grid g2"><label class="f">Enhet<input type="text" id="nUnit" value="stk"></label><label class="f">Pris per enhet eks. mva<input type="text" inputmode="decimal" id="nPrice"></label></div>
    <div class="grid g2"><label class="f">Lager<select id="nStor">${STORES.map(s=>`<option>${s}</option>`).join('')}</select></label><label class="f">Kategori<input type="text" id="nCat" value="Annet"></label></div>
    <div class="grid g2"><label class="f">Forbruk per uke<input type="text" inputmode="decimal" id="nMan"></label><label class="f">Holdbarhet (dager)<input type="text" inputmode="numeric" id="nShelf" value="14"></label></div>
    <label class="f">Pakningsstørrelse<input type="text" inputmode="decimal" id="nPack" value="1"></label>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Avbryt</button><button class="btn primary" id="nOk">Legg til</button></div>`, m => {
    m.querySelector('#nOk').onclick = async () => {
      const g = s => m.querySelector(s).value.trim(); const sup = g('#nSup'), no = g('#nNo'), name = g('#nName');
      if (!no || !name){ toast('Fyll inn varenummer og navn.'); return; }
      const id = sup + '-' + no.replace(/[^A-Za-z0-9]/g,'');
      if (getItems().find(i => i.id === id)){ toast('Varen finnes allerede.'); return; }
      const cfg = JSON.parse(JSON.stringify(S.itemcfg || {ov:{}})); cfg.ov = cfg.ov || {};
      cfg.ov[id] = {id, custom:true, sup, no, name:name.toUpperCase(), unit:g('#nUnit')||'stk', price:num(g('#nPrice'))||0, stor:g('#nStor'), cat:g('#nCat')||'Annet', area:'Kjøkken', manual:num(g('#nMan')), shelf:num(g('#nShelf')), pack:num(g('#nPack'))||1, active:true, h100:0, b13:0, b6:0, ndel:0, last:null};
      await saveItemCfg(cfg); closeModal(); toast('Varen er lagt til.');
    };
  });
}

/* ================= INNSTILLINGER ================= */
function vOppsett(){
  const set = JSON.parse(JSON.stringify(SET()));
  const avg4 = (() => { const s = {...set, expectedSales:null}; return expectedSales(s); })();
  const a13 = avg13(set);
  const weeks = [...set.weeks].sort((a,b) => a.from < b.from ? 1 : -1);
  let h = `<div class="row between"><div><h2>Innstillinger</h2><div class="muted">${S.canManage ? 'Endringer gjelder for alle ansatte.' : 'Bare leder kan endre innstillingene.'}</div></div><button class="btn" data-go="oversikt">Tilbake</button></div>` + roNote();
  h += `<div class="card grid" style="gap:12px"><h3>Bestillingsfrekvens per lagertype</h3><div class="small muted">Hvor ofte hver varetype bør fylles opp. Sjeldnere bestilling gir færre, større ordre (mindre frakt og gebyrer); ferskvare bestilles ofte for å holde den fersk. Appen bestiller aldri oftere enn leverandøren leverer, og aldri mer enn holdbarheten tåler.</div>
    <div class="grid g4">${STORES.map(st => `<label class="f">${esc(st)} – dager mellom bestillinger<input type="text" inputmode="decimal" data-freq="${esc(st)}" value="${String(freqFor(set, st)).replace('.',',')}" ${roM()}><span class="small" style="font-weight:400">Anbefalt: ${esc(FREQ_TXT[st])} (${String(FREQ_DEFAULT[st]).replace('.',',')} d)</span></label>`).join('')}</div>
    <div class="row"><button class="btn sm" id="fDef" ${roM()}>Bruk anbefalte frekvenser</button></div></div>`;
  h += `<div class="card grid" style="gap:12px"><h3>Forventet matsalg</h3><div class="small muted">Alle forbruksprognoser skaleres med dette tallet. Øk før travle uker (ferie, eventer), senk i stille perioder.</div>
    <div class="grid g3" style="align-items:end"><label class="f">Forventet matsalg per uke (kr eks. mva)<input type="text" inputmode="numeric" id="sExp" value="${set.expectedSales||''}" placeholder="Auto: ${nf0.format(avg4)}"></label>
    <div class="small"><div class="muted">Snitt siste 4 uker</div><b>${kr(avg4)}</b></div><div class="small"><div class="muted">Snitt 13 uker · faktor nå</div><b>${kr(a13)} · ${nf1.format(expectedSales(set)/(a13||1)*100)} %</b></div></div></div>`;
  const itemsBySup = {}; getItems().forEach(i => itemsBySup[i.sup] = (itemsBySup[i.sup]||0) + 1);
  h += `<div class="card grid" style="gap:14px"><div class="row between"><h3>Leverandører</h3><button class="btn sm" id="supAdd" ${roM()}>+ Legg til leverandør</button></div>${Object.keys(set.suppliers).length ? '' : '<div class="muted">Ingen leverandører ennå.</div>'}${Object.keys(set.suppliers).map(c => { const s = set.suppliers[c]; return `<div class="grid" style="gap:10px;border-top:1px solid var(--line);padding-top:12px"><div class="row between"><b translate="no">${esc(s.name)} (${esc(c)})</b><span class="row"><span class="small muted">${itemsBySup[c]||0} varer</span>${itemsBySup[c] ? '' : `<button class="btn sm danger" data-supdel="${esc(c)}" ${roM()}>Fjern</button>`}</span></div>
      <div class="chips">${[1,2,3,4,5,6,0].map(d=>`<button class="chip ${s.wd&&s.wd.includes(d)?'on':''}" data-wd="${c}:${d}">${WD[d]}</button>`).join('')}<span class="small muted" style="align-self:center">leveringsdager</span></div>
      <div class="grid g3"><label class="f">Dager mellom leveranser<input type="text" inputmode="decimal" data-sp="${c}:interval" value="${String(s.interval).replace('.',',')}"></label><label class="f">Ledetid (dager)<input type="text" inputmode="decimal" data-sp="${c}:lead" value="${s.lead}"></label><label class="f">Sikkerhetsdager<input type="text" inputmode="decimal" data-sp="${c}:safety" value="${s.safety}"></label></div>
      <div class="grid g3"><label class="f">Leveringsdager (tekst)<input type="text" data-sp="${c}:days" value="${esc(s.days)}"></label><label class="f">Notat til den som bestiller<input type="text" data-sp="${c}:notes" value="${esc(s.notes)}"></label><label class="f">Org.nr (kobler fakturaer fra Tripletex)<input type="text" inputmode="numeric" data-sp="${c}:orgnr" value="${esc(s.orgnr||'')}"></label></div></div>`; }).join('')}</div>`;
  h += `<div class="card grid" style="gap:12px"><h3>Matsalg per uke (Tripletex 3000 + 3005)</h3><div class="small muted">Legg inn ny uke hver mandag. Snittet av de siste 4 ukene blir forventet salg når feltet over står tomt.</div>
    <div class="grid g3" style="align-items:end"><label class="f">Uke starter (mandag)<input type="date" id="wkFrom" value="${addDays(C.today, -((pd(C.today).getDay()+6)%7) - 7)}"></label><label class="f">Matsalg (kr eks. mva)<input type="text" inputmode="numeric" id="wkSales"></label><button class="btn" id="wkAdd">Legg til uke</button></div>
    <div class="tblwrap" style="max-height:300px"><table><thead><tr><th>Uke</th><th>Fra</th><th class="n">Matsalg</th><th></th></tr></thead><tbody>${weeks.map(w=>`<tr><td>${w.wk}</td><td>${fmtDL(w.from)}</td><td class="n">${kr(w.sales)}</td><td class="n"><button class="btn sm danger" data-wkdel="${w.from}">Slett</button></td></tr>`).join('')}</tbody></table></div></div>`;
  h += `<div class="row" style="justify-content:flex-end"><button class="btn primary lg" id="sSave" ${roM()}>Lagre innstillinger</button></div>`;
  if (MODE_API && S.canManage) h += `<div class="card grid" style="gap:12px" id="ttxCard"><h3>Tripletex</h3><div id="ttxBody" class="muted small">Henter status …</div></div>
    <div class="card grid" style="gap:12px" id="keysCard"><div class="row between"><h3>API-nøkler</h3><button class="btn sm" id="kAdd">+ Ny API-nøkkel</button></div><div class="small muted">For skannere, EDI og andre systemer som skal registrere fakturaer og pakksedler i Restoq. Se <a href="/api-dokumentasjon" target="_blank" rel="noopener">API-dokumentasjonen</a>.</div><div id="keysList" class="muted small">Henter …</div></div>`;
  if (MODE_API && S.canManage) h += `<div class="card grid" style="gap:12px" id="usersCard"><div class="row between"><h3>Brukere</h3><button class="btn sm" id="uAdd">+ Legg til ansatt</button></div><div class="small muted">Ansatte kan telle, bestille, ta imot varer og føre svinn. Ledere kan i tillegg endre innstillinger, varer, logo og brukere.</div><div id="usersList" class="muted small">Henter brukere …</div></div>`;
  const B = BRAND();
  h += `<div class="card grid" style="gap:14px"><h3>Logo og firmafarger</h3><div class="small muted">Last opp logoen til baren eller restauranten. Appen foreslår firmafargene fra logoen, og du kan justere dem selv. Da ser appen ut som stedets egen, med «powered by Restoq» ved siden av logoen.</div>
    <div class="row"><img id="bLogoPrev" class="logoprev ${B.logo?'':'hide'}" src="${B.logo||''}" alt="Logo"><label class="btn primary" style="cursor:pointer">${B.logo?'Bytt logo':'Last opp logo'}<input type="file" id="bLogo" accept="image/png,image/jpeg,image/svg+xml,image/webp" class="hide" ${roM()}></label>${B.logo?'<button class="btn danger" id="bLogoDel">Fjern logo</button>':''}<span class="small muted">PNG eller SVG med gjennomsiktig bakgrunn ser best ut.</span></div>
    <div class="grid g2">
      <div class="f" style="display:flex;flex-direction:column;gap:5px;font-size:14px;font-weight:600;color:var(--muted)">Hovedfarge<div class="swatch"><input type="color" id="bHead" value="${B.head}"><span class="small">toppfelt og knapper</span></div></div>
      <div class="f" style="display:flex;flex-direction:column;gap:5px;font-size:14px;font-weight:600;color:var(--muted)">Aksentfarge<div class="swatch"><input type="color" id="bAccent" value="${B.accent}"><span class="small">streker og markering</span></div></div></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" id="bReset" ${roM()}>Tilbakestill</button><button class="btn primary" id="bSave" ${roM()}>Lagre logo og farger</button></div></div>`;
  h += `<div class="card grid" style="gap:10px"><h3>Data</h3><div class="small muted">Sikkerhetskopi av alle tellinger, bestillinger, svinn og innstillinger.</div><div class="row"><button class="btn" id="dExp">Last ned sikkerhetskopi</button><button class="btn" id="dWaste">Svinnrapport (Excel)</button><label class="btn" style="cursor:pointer">Gjenopprett fra fil<input type="file" id="dImp" accept=".json" class="hide" ${roM()}></label></div></div>`;
  $('#view').innerHTML = h;
  if (!S.canManage) document.querySelectorAll('#view input, #view .chip[data-wd], #view button[data-wkdel], #wkAdd').forEach(el => el.disabled = true);
  const read = () => { const s = set; s.expectedSales = num($('#sExp').value.replace(/\s/g,'')); s.freq = s.freq || {}; document.querySelectorAll('[data-freq]').forEach(inp => { const v = num(inp.value); s.freq[inp.dataset.freq] = v > 0 ? v : FREQ_DEFAULT[inp.dataset.freq]; }); document.querySelectorAll('[data-sp]').forEach(inp => { const [c,k] = inp.dataset.sp.split(':'); s.suppliers[c][k] = ['days','notes','orgnr'].includes(k) ? inp.value.trim() : (num(inp.value) ?? 0); }); return s; };
  document.querySelectorAll('[data-wd]').forEach(b => b.onclick = () => { const [c,d] = b.dataset.wd.split(':'); const s = set.suppliers[c]; s.wd = s.wd || []; const n = +d; s.wd = s.wd.includes(n) ? s.wd.filter(x=>x!==n) : [...s.wd, n]; b.classList.toggle('on'); });
  $('#sSave').onclick = async () => { await saveSettings(read()); toast('Innstillingene er lagret.'); };
  $('#fDef').onclick = () => { document.querySelectorAll('[data-freq]').forEach(inp => inp.value = String(FREQ_DEFAULT[inp.dataset.freq]).replace('.',',')); toast('Anbefalte frekvenser er fylt inn. Trykk «Lagre innstillinger».'); };
  $('#supAdd').onclick = () => supplierModal(read());
  document.querySelectorAll('[data-supdel]').forEach(b => b.onclick = () => confirmBox('Fjerne leverandøren?', 'Leverandøren har ingen varer og fjernes fra oppsettet.', 'Fjern', async () => { const s = read(); delete s.suppliers[b.dataset.supdel]; await saveSettings(s); render(); }));
  if ($('#usersCard')) loadUsers();
  if ($('#ttxCard')) loadTtx();
  if ($('#keysCard')) loadKeys();
  $('#wkAdd').onclick = async () => { const f = $('#wkFrom').value, v = num($('#wkSales').value.replace(/\s/g,'')); if (!f || !v){ toast('Fyll inn dato og beløp.'); return; } const s = read(); s.weeks = s.weeks.filter(w => w.from !== f); s.weeks.push({wk:isoWeek(pd(f)), from:f, sales:v}); await saveSettings(s); toast('Uka er lagt til.'); };
  document.querySelectorAll('[data-wkdel]').forEach(b => b.onclick = async () => { const s = read(); s.weeks = s.weeks.filter(w => w.from !== b.dataset.wkdel); await saveSettings(s); });
  bindBrand();
  $('#dExp').onclick = () => download(`restoq-backup-${C.today}.json`, JSON.stringify({exported:new Date().toISOString(), waste:S.waste, orders:S.orders, counts:S.counts, settings:SET(), itemcfg:S.itemcfg, brand:S.brand}, null, 1));
  $('#dWaste').onclick = () => { const its = getItems(); download(`svinn-${C.today}.csv`, csv([['Dato','Leverandør','Varenr','Vare','Antall','Enhet','Årsak','Verdi','Kommentar'], ...[...S.waste].sort((a,b)=>a.date<b.date?-1:1).map(w => { const i = its.find(x=>x.id===w.itemId)||{}; return [w.date,i.sup,i.no,i.name,w.qty,i.unit,w.reason,w.value,w.comment||'']; })])); };
  $('#dImp').onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { let d; try { d = JSON.parse(t); } catch(x){ toast('Filen kunne ikke leses.'); return; }
    confirmBox('Gjenopprette fra sikkerhetskopi?', `Filen har ${d.counts?.length||0} tellinger, ${d.orders?.length||0} bestillinger og ${d.waste?.length||0} svinnlinjer. De legges inn i tillegg til eller over eksisterende data med samme ID.`, 'Gjenopprett', async () => {
      for (const col of ['counts','orders','waste']) for (const x of (d[col]||[])){ const c = {...x}; const id = c.id; delete c.id; await store.put(col, id, c); }
      if (d.settings) await saveSettings(d.settings); if (d.itemcfg) await saveItemCfg(d.itemcfg); if (d.brand) await store.put('config','brand', d.brand); toast('Data er gjenopprettet.'); }); }); };
}
function bindBrand(){
  let logo = BRAND().logo;
  const cur = () => ({accent:$('#bAccent').value, head:$('#bHead').value, logo});
  const live = () => { const keep = S.brand; S.brand = cur(); applyBrand(); S.brand = keep; };
  ['#bAccent','#bHead'].forEach(s => $(s).addEventListener('input', live));
  $('#bLogo').onchange = e => { const f = e.target.files[0]; if (!f) return;
    const img = new Image(); const url = URL.createObjectURL(f);
    img.onload = () => { const max = 320; const w = img.naturalWidth || max, h = img.naturalHeight || max; const sc = Math.min(1, max / Math.max(w, h)) || 1; const c = document.createElement('canvas'); c.width = Math.round(w*sc); c.height = Math.round(h*sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); const data = c.toDataURL('image/png'); URL.revokeObjectURL(url);
      if (data.length > 180000){ toast('Logoen er for stor. Bruk en enklere eller mindre fil.'); return; }
      logo = data; const p = $('#bLogoPrev'); p.src = logo; p.classList.remove('hide');
      const col = colorsFromImage(c); if (col.head) $('#bHead').value = col.head; if (col.accent) $('#bAccent').value = col.accent;
      live(); toast('Fargene er hentet fra logoen. Juster om du vil, og trykk Lagre.'); };
    img.onerror = () => toast('Kunne ikke lese bildet.'); img.src = url; };
  const del = $('#bLogoDel'); if (del) del.onclick = () => { logo = null; $('#bLogoPrev').classList.add('hide'); live(); };
  $('#bSave').onclick = async () => { await store.put('config','brand', cur()); toast('Logo og farger er lagret for alle.'); };
  $('#bReset').onclick = () => confirmBox('Tilbakestille utseendet?', 'Logoen fjernes og fargene settes tilbake til standard.', 'Tilbakestill', async () => { await store.put('config','brand', {...BRAND_DEFAULT}); render(); });
}
function supplierModal(set){
  modal(`<h3>Ny leverandør</h3>
    <div class="grid g2"><label class="f">Kode (2–4 tegn)<input type="text" id="sCode" maxlength="4" placeholder="f.eks. ASKO"></label><label class="f">Navn<input type="text" id="sName" placeholder="Leverandørens navn"></label></div>
    <div class="f" style="display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:var(--muted)">Leveringsdager<div class="chips" id="sWd">${[1,2,3,4,5,6,0].map(d=>`<button class="chip" data-d="${d}">${WD[d]}</button>`).join('')}</div></div>
    <div class="grid g3"><label class="f">Ledetid (dager)<input type="text" inputmode="decimal" id="sLead" value="1"></label><label class="f">Sikkerhetsdager<input type="text" inputmode="decimal" id="sSafe" value="2"></label><label class="f">Minste ordre / gebyr (notat)<input type="text" id="sNote"></label></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Avbryt</button><button class="btn primary" id="sOk">Legg til</button></div>`, m => {
    const wd = new Set();
    m.querySelectorAll('#sWd .chip').forEach(b => b.onclick = () => { const d = +b.dataset.d; wd.has(d) ? wd.delete(d) : wd.add(d); b.classList.toggle('on'); });
    m.querySelector('#sOk').onclick = async () => {
      const code = m.querySelector('#sCode').value.trim().toUpperCase().replace(/[^A-ZÆØÅ0-9]/g,''); const name = m.querySelector('#sName').value.trim();
      if (code.length < 2 || !name){ toast('Fyll inn kode og navn.'); return; }
      if (set.suppliers[code]){ toast('Koden er allerede i bruk.'); return; }
      const days = [...wd].sort((a,b)=>((a+6)%7)-((b+6)%7));
      const interval = days.length ? Math.round(7 / days.length * 10) / 10 : 7;
      set.suppliers[code] = {name, wd:days, days: days.length ? days.map(d => WDL[d]).join(', ') : 'Etter avtale', interval, lead: num(m.querySelector('#sLead').value) ?? 1, safety: num(m.querySelector('#sSafe').value) ?? 2, notes: m.querySelector('#sNote').value.trim(), fees:''};
      await saveSettings(set); closeModal(); toast('Leverandøren er lagt til.'); render();
    };
  });
}
/* Import av vareliste fra Excel (lagret som CSV) */
const IMPORT_COLS = [['sup',['leverandør','leverandor','lev','supplier']],['no',['varenr','varenummer','artikkelnr','item no','item no.']],['name',['navn','varenavn','vare','item name']],['unit',['enhet','unit']],['price',['pris','pris/enhet','pris per enhet','price']],['stor',['lager','lagertype','storage']],['cat',['kategori','category']],['pack',['pakning','pakningsstørrelse','pack size']],['shelf',['holdbarhet','holdbarhet (dager)','shelf life']],['manual',['forbruk per uke','forbruk/uke','usage/week']]];
function parseCsv(text){
  text = text.replace(/^\uFEFF/, ''); const first = text.split(/\r?\n/)[0] || ''; const sep = (first.match(/;/g)||[]).length >= (first.match(/,/g)||[]).length ? ';' : (first.includes('\t') ? '\t' : ',');
  const rows = []; let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++){ const c = text[i];
    if (inQ){ if (c === '"'){ if (text[i+1] === '"'){ cell += '"'; i++; } else inQ = false; } else cell += c; }
    else if (c === '"') inQ = true; else if (c === sep){ row.push(cell); cell = ''; } else if (c === '\n'){ row.push(cell.replace(/\r$/,'')); rows.push(row); row = []; cell = ''; } else cell += c; }
  if (cell || row.length){ row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
function normStore(s){ s = (s||'').toLowerCase(); if (/frys|frozen/.test(s)) return 'Frys'; if (/kjøl|kjol|fersk|chill/.test(s)) return 'Kjøl'; if (/rom|ambient/.test(s)) return 'Romtemp.'; return 'Tørr'; }
function importItemsModal(){
  modal(`<h3>Importer varer</h3><div class="small muted">Lagre vareliste fra Excel som CSV. Første rad må ha kolonnenavn. Kolonner: <b>Leverandør, Varenr, Navn</b> (påkrevd), Enhet, Pris, Lager (kjøl/frys/tørr/romtemp), Kategori, Pakning, Holdbarhet, Forbruk per uke. Finnes varen fra før (samme leverandør og varenr), oppdateres den.</div>
    <div class="row"><label class="btn primary" style="cursor:pointer">Velg fil<input type="file" id="impFile" accept=".csv,.txt,text/csv" class="hide"></label><button class="btn" id="impTpl">Last ned mal</button></div><div id="impRes"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Lukk</button><button class="btn primary hide" id="impOk">Importer</button></div>`, m => {
    let parsed = [];
    m.querySelector('#impTpl').onclick = () => download('restoq-varemal.csv', csv([['Leverandør','Varenr','Navn','Enhet','Pris','Lager','Kategori','Pakning','Holdbarhet','Forbruk per uke'],['SG','545657','SMØR 500G','stk',62.5,'Kjøl','Meieri',1,30,10]]));
    m.querySelector('#impFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; const rows = parseCsv(await f.text()); if (rows.length < 2){ m.querySelector('#impRes').innerHTML = '<div class="note bad">Fant ingen rader.</div>'; return; }
      const head = rows[0].map(h => h.trim().toLowerCase()); const idx = {}; IMPORT_COLS.forEach(([k, names]) => { const i = head.findIndex(h => names.includes(h)); if (i >= 0) idx[k] = i; });
      if (idx.sup == null || idx.no == null || idx.name == null){ m.querySelector('#impRes').innerHTML = '<div class="note bad">Fant ikke kolonnene Leverandør, Varenr og Navn i første rad.</div>'; return; }
      const g = (r,k) => idx[k] != null ? (r[idx[k]]||'').trim() : '';
      parsed = rows.slice(1).map(r => ({sup:g(r,'sup').toUpperCase(), no:g(r,'no'), name:g(r,'name'), unit:g(r,'unit')||'stk', price:num(g(r,'price'))||0, stor:normStore(g(r,'stor')), cat:g(r,'cat')||'Annet', pack:num(g(r,'pack'))||1, shelf:num(g(r,'shelf')), manual:num(g(r,'manual'))})).filter(x => x.sup && x.no && x.name);
      const sups = [...new Set(parsed.map(x => x.sup))]; const missing = sups.filter(s => !SET().suppliers[s]);
      m.querySelector('#impRes').innerHTML = `<div class="note good">${parsed.length} varer klare fra ${sups.length} leverandør${sups.length>1?'er':''}.${missing.length ? ' Nye leverandører opprettes: '+esc(missing.join(', '))+' (sjekk leveringsdager under Innstillinger etterpå).' : ''}</div>`;
      m.querySelector('#impOk').classList.toggle('hide', !parsed.length); };
    m.querySelector('#impOk').onclick = async () => {
      const set = JSON.parse(JSON.stringify(SET())); let newSup = false;
      parsed.forEach(x => { if (!set.suppliers[x.sup]){ set.suppliers[x.sup] = {name:x.sup, wd:[], days:'Etter avtale', interval:7, lead:1, safety:2, notes:'', fees:''}; newSup = true; } });
      if (newSup) await saveSettings(set);
      const cfg = JSON.parse(JSON.stringify(S.itemcfg || {ov:{}})); cfg.ov = cfg.ov || {};
      parsed.forEach(x => { const id = x.sup + '-' + x.no.replace(/[^A-Za-z0-9]/g,''); const prev = cfg.ov[id] || {}; cfg.ov[id] = {...prev, id, custom:true, removed:false, sup:x.sup, no:x.no, name:x.name, unit:x.unit, price:x.price, stor:x.stor, cat:x.cat, area:prev.area||'Kjøkken', pack:x.pack, shelf:x.shelf, manual: x.manual ?? prev.manual ?? null, active: prev.active ?? true, h100: prev.h100 || 0, b13: prev.b13 || 0, b6: prev.b6 || 0}; });
      await saveItemCfg(cfg); closeModal(); toast(`${parsed.length} varer er importert.`);
    };
  });
}
async function loadUsers(){
  const box = $('#usersList'); if (!box) return;
  try {
    const j = await api('GET', '/api/users');
    box.className = '';
    box.innerHTML = `<table><thead><tr><th>Navn</th><th>E-post</th><th>Rolle</th><th>Sist innlogget</th><th></th></tr></thead><tbody>${j.users.map(u => `<tr><td><span translate="no">${esc(u.name||'–')}</span>${u.me?' <span class="small muted">(deg)</span>':''}</td><td translate="no">${esc(u.email)}</td><td>${u.role==='owner'?'Leder':'Ansatt'}${u.must_change_password?' <span class="pill p-tell">invitert</span>':''}</td><td>${u.last_login_at?fmtDL(String(u.last_login_at).slice(0,10)):'–'}</td><td class="n">${u.me?'':`<button class="btn sm" data-ureset="${esc(u.email)}" data-uname="${esc(u.name)}" data-urole="${u.role}">Nytt passord</button> <button class="btn sm danger" data-udel="${u.id}">Fjern</button>`}</td></tr>`).join('')}</tbody></table>`;
    box.querySelectorAll('[data-udel]').forEach(b => b.onclick = () => confirmBox('Fjerne brukeren?', 'Brukeren mister tilgangen med en gang.', 'Fjern', async () => { try { await api('DELETE', '/api/users/' + b.dataset.udel); } catch(e){ toast(e.message || 'Kunne ikke fjerne.'); } loadUsers(); }));
    box.querySelectorAll('[data-ureset]').forEach(b => b.onclick = () => inviteUser({email:b.dataset.ureset, name:b.dataset.uname, role:b.dataset.urole}));
  } catch(e){ box.textContent = 'Kunne ikke hente brukerne.'; }
  const add = $('#uAdd'); if (add) add.onclick = () => inviteUser(null);
}
function inviteUser(pre){
  modal(`<h3>${pre ? 'Nytt passord' : 'Legg til ansatt'}</h3>
    <div class="grid g2"><label class="f">Navn<input type="text" id="iuName" value="${esc(pre?.name||'')}"></label><label class="f">E-post<input type="text" id="iuEmail" inputmode="email" value="${esc(pre?.email||'')}" ${pre?'readonly':''}></label></div>
    <label class="f">Rolle<select id="iuRole"><option value="staff" ${pre?.role!=='owner'?'selected':''}>Ansatt – teller, bestiller, mottak og svinn</option><option value="owner" ${pre?.role==='owner'?'selected':''}>Leder – også innstillinger, varer og brukere</option></select></label>
    <div class="small muted">Brukeren får et midlertidig passord på e-post og velger eget ved første innlogging. Har de Google-konto på samme adresse, kan de også logge inn med Google.</div><div id="iuRes"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Lukk</button><button class="btn primary" id="iuOk">${pre ? 'Lag nytt passord' : 'Legg til'}</button></div>`, m => {
    m.querySelector('#iuOk').onclick = async () => {
      const b = m.querySelector('#iuOk'); b.disabled = true;
      try {
        const r = await api('POST', '/api/users', {email:m.querySelector('#iuEmail').value, name:m.querySelector('#iuName').value, role:m.querySelector('#iuRole').value});
        m.querySelector('#iuRes').innerHTML = r.emailed ? '<div class="note good">E-post med innlogging er sendt.</div>' : `<div class="note warn">E-post er ikke satt opp. Gi brukeren dette midlertidige passordet: <b class="num" style="font-size:18px">${esc(r.tempPassword)}</b> (gjelder i 7 dager).</div>`;
        b.classList.add('hide'); loadUsers();
      } catch(e){ m.querySelector('#iuRes').innerHTML = `<div class="note bad">${esc(e.message || 'Noe gikk galt.')}</div>`; b.disabled = false; }
    };
  });
}
/* ================= FAKTURA ================= */
const INV_STATUS = {kontroll:['Til kontroll','p-tell'], avvik:['Avvik','p-bestill'], matchet:['Matchet','p-ok'], godkjent:['Godkjent','p-ok'], sendt:['Sendt til Tripletex','p-behov'], betalt:['Til betaling','p-behov'], avvist:['Avvist','p-behov']};
const invPill = s => `<span class="pill ${(INV_STATUS[s]||['',''])[1]}">${esc((INV_STATUS[s]||[s])[0])}</span>`;
UI.fStatus = 'aktive';
function vFaktura(){
  const set = SET();
  const list = [...S.invoices].sort((a,b) => (b.invoiceDate||'').localeCompare(a.invoiceDate||'') || (b.createdAt||'').localeCompare(a.createdAt||''));
  const f = UI.fStatus;
  const rows = list.filter(i => f === 'alle' ? true : f === 'aktive' ? ['kontroll','avvik','matchet','godkjent'].includes(i.status) : i.status === f);
  const cnt = s => S.invoices.filter(i => i.status === s).length;
  const sumOpen = S.invoices.filter(i => ['kontroll','avvik','matchet','godkjent'].includes(i.status)).reduce((s,i) => s + (i.amount || i.amountExVat || 0), 0);
  let h = `<div class="row between"><div><h2>Fakturaer og pakksedler</h2><div class="muted">Fakturaen kontrolleres mot bestilling og varemottak før den godkjennes, sendes til Tripletex for bokføring og legges til betaling.</div></div>
    <div class="row"><button class="btn" id="slipNew" ${ro()}>+ Pakkseddel</button><button class="btn primary" id="invNew" ${ro()}>+ Registrer faktura</button>${S.canManage ? '<button class="btn" id="ttxSync">Hent fra Tripletex</button>' : ''}</div></div>`;
  h += `<div class="grid g4"><button class="tile blue" data-fs="kontroll"><span class="lbl">Til kontroll</span><span class="big">${cnt('kontroll')}</span><span class="small muted">mangler bestilling</span></button>
    <button class="tile red" data-fs="avvik"><span class="lbl">Avvik</span><span class="big">${cnt('avvik')}</span><span class="small muted">mengde eller pris stemmer ikke</span></button>
    <button class="tile green" data-fs="matchet"><span class="lbl">Klar til godkjenning</span><span class="big">${cnt('matchet')}</span><span class="small muted">stemmer med varemottak</span></button>
    <div class="tile"><span class="lbl">Åpne fakturaer</span><span class="big">${kr(sumOpen)}</span><span class="small muted">ikke sendt til Tripletex</span></div></div>`;
  h += `<div class="chips">${[['aktive','Aktive'],['kontroll','Til kontroll'],['avvik','Avvik'],['matchet','Matchet'],['godkjent','Godkjent'],['sendt','Sendt til Tripletex'],['betalt','Til betaling'],['avvist','Avvist'],['alle','Alle']].map(([k,l]) => `<button class="chip ${f===k?'on':''}" data-fs="${k}">${l}</button>`).join('')}</div>`;
  h += `<div class="card flush"><div class="tblwrap"><table><thead><tr><th>Leverandør</th><th>Faktura</th><th>Dato</th><th>Forfall</th><th class="n">Beløp</th><th>Bestilling</th><th>Status</th></tr></thead><tbody>${rows.map(i => { const o = S.orders.find(x => x.id === i.orderId); return `<tr class="click" data-inv="${esc(i.id)}"><td translate="no"><b>${esc(i.supplier)}</b> <span class="isub">${esc(set.suppliers[i.supplier]?.name||'')}</span></td><td>${esc(i.invoiceNo)}${i.fileId?' 📎':''}${i.source==='tripletex'?' <span class="isub">fra Tripletex</span>':i.source==='api'?' <span class="isub">via API</span>':''}</td><td>${fmtDL(i.invoiceDate)}</td><td>${i.dueDate?fmtDL(i.dueDate):'–'}</td><td class="n">${i.amount!=null?kr(i.amount):i.amountExVat!=null?kr(i.amountExVat)+' eks.':'–'}</td><td>${o?fmtD(o.deliveryDate)+' · '+o.lines.length+' varer':'<span class="muted">–</span>'}</td><td>${invPill(i.status)}${i.match&&i.match.issues&&i.match.issues.length?` <span class="isub">${i.match.issues.length} avvik</span>`:''}</td></tr>`; }).join('') || '<tr><td colspan="7"><div class="empty">Ingen fakturaer her. Registrer en faktura, eller hent fra Tripletex.</div></td></tr>'}</tbody></table></div></div>`;
  const slips = [...S.slips].sort((a,b) => (b.date||'').localeCompare(a.date||'')).slice(0,15);
  h += `<div class="card flush"><div style="padding:14px 16px 6px"><h3>Siste pakksedler</h3></div>${slips.length ? `<table><thead><tr><th>Dato</th><th>Leverandør</th><th>Pakkseddel</th><th class="n">Linjer</th><th>Bestilling</th></tr></thead><tbody>${slips.map(s => `<tr><td>${fmtDL(s.date)}</td><td>${esc(s.supplier)}</td><td>${esc(s.slipNo)}${s.fileId?` <a href="/api/files/${esc(s.fileId)}" target="_blank" rel="noopener">📎</a>`:''}</td><td class="n">${s.lines.length}</td><td>${s.orderId?(s.received?'<span class="pill p-ok">mottak registrert</span>':'koblet'):'<span class="muted">ikke funnet</span>'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Ingen pakksedler ennå.</div>'}</div>`;
  $('#view').innerHTML = h;
  document.querySelectorAll('[data-fs]').forEach(b => b.onclick = () => { UI.fStatus = b.dataset.fs; render(); });
  document.querySelectorAll('[data-inv]').forEach(r => r.onclick = () => invoiceDrawer(r.dataset.inv));
  $('#invNew').onclick = () => invoiceModal();
  $('#slipNew').onclick = () => slipModal();
  const sy = $('#ttxSync'); if (sy) sy.onclick = async () => { sy.disabled = true; try { const r = await api('POST', '/api/tripletex/sync', {}); toast(`Hentet ${r.fetched} fra Tripletex: ${r.created} nye, ${r.linked} koblet${r.unknown?`, ${r.unknown} med ukjent leverandør`:''}.`); await apiLoad(true); } catch(e){ toast(e.message || 'Kunne ikke hente.'); } sy.disabled = false; };
}
async function uploadFile(input){
  const f = input.files[0]; if (!f) return null;
  if (f.size > 10*1024*1024){ toast('Filen er større enn 10 MB.'); return null; }
  const fd = new FormData(); fd.append('file', f);
  const res = await fetch('/api/files', {method:'POST', body:fd, credentials:'same-origin'}); const j = await res.json().catch(() => ({}));
  if (!res.ok){ toast(j.error || 'Opplasting feilet.'); return null; } return j;
}
function orderOptions(sup, sel){ return `<option value="">Finn automatisk</option>` + S.orders.filter(o => o.sup === sup && o.status !== 'kansellert').sort((a,b) => (b.deliveryDate||'').localeCompare(a.deliveryDate||'')).slice(0,30).map(o => `<option value="${esc(o.id)}" ${o.id===sel?'selected':''}>${fmtDL(o.deliveryDate)} · ${o.lines.length} varer · ${kr(o.total)} · ${o.status}</option>`).join(''); }
function lineEditor(lines){ return `<div class="tblwrap"><table id="lnTbl"><thead><tr><th>Varenr</th><th>Beskrivelse</th><th class="n">Antall</th><th class="n">Pris eks. mva</th><th></th></tr></thead><tbody>${lines.map(l => lineRow(l)).join('')}</tbody></table></div><div class="row"><button class="btn sm" id="lnAdd">+ Linje</button><button class="btn sm" id="lnFromOrder">Kopier linjer fra varemottaket</button></div>`; }
const lineRow = l => `<tr><td><input type="text" class="ln-no" value="${esc(l.itemNo||'')}" style="min-width:90px"></td><td><input type="text" class="ln-desc" value="${esc(l.description||'')}" style="min-width:160px"></td><td><input type="text" inputmode="decimal" class="ln-qty" value="${l.qty!=null?String(l.qty).replace('.',','):''}" style="width:80px;text-align:right"></td><td><input type="text" inputmode="decimal" class="ln-price" value="${l.unitPrice!=null?String(l.unitPrice).replace('.',','):''}" style="width:100px;text-align:right"></td><td><button class="btn sm danger ln-del" aria-label="Fjern linje">×</button></td></tr>`;
function bindLines(m, getSup, getOrder){
  const tb = () => m.querySelector('#lnTbl tbody');
  const bindDel = () => m.querySelectorAll('.ln-del').forEach(b => b.onclick = () => b.closest('tr').remove());
  m.querySelector('#lnAdd').onclick = () => { tb().insertAdjacentHTML('beforeend', lineRow({})); bindDel(); };
  m.querySelector('#lnFromOrder').onclick = () => { const items = Object.fromEntries(getItems().map(i => [i.id, i])); let o = S.orders.find(x => x.id === getOrder()); if (!o) o = S.orders.filter(x => x.sup === getSup() && x.status === 'mottatt').sort((a,b) => (b.deliveryDate||'').localeCompare(a.deliveryDate||''))[0]; if (!o){ toast('Fant ingen mottatt bestilling for leverandøren.'); return; } tb().innerHTML = o.lines.map(l => { const it = items[l.id] || {}; return lineRow({itemNo: it.no || l.id.split('-').slice(1).join('-'), description: it.name, qty: l.recv != null ? l.recv : l.qty, unitPrice: l.price ?? it.price}); }).join(''); bindDel(); };
  bindDel();
  return () => [...m.querySelectorAll('#lnTbl tbody tr')].map(tr => ({itemNo: tr.querySelector('.ln-no').value.trim(), description: tr.querySelector('.ln-desc').value.trim(), qty: num(tr.querySelector('.ln-qty').value) ?? 0, unitPrice: num(tr.querySelector('.ln-price').value)})).filter(l => l.itemNo || l.description);
}
function invoiceModal(){
  const sups = Object.keys(SET().suppliers);
  if (!sups.length){ toast('Legg inn leverandører under Innstillinger først.'); return; }
  modal(`<h3>Registrer faktura</h3>
    <div class="grid g3"><label class="f">Leverandør<select id="ivSup">${sups.map(c => `<option value="${esc(c)}">${esc(c)} – ${esc(SET().suppliers[c].name)}</option>`).join('')}</select></label><label class="f">Fakturanummer<input type="text" id="ivNo"></label><label class="f">KID (valgfritt)<input type="text" id="ivKid" inputmode="numeric"></label></div>
    <div class="grid g3"><label class="f">Fakturadato<input type="date" id="ivDate" value="${C.today}"></label><label class="f">Forfall<input type="date" id="ivDue" value="${addDays(C.today,14)}"></label><label class="f">Bestilling<select id="ivOrder"></select></label></div>
    <div class="grid g3"><label class="f">Beløp eks. mva<input type="text" inputmode="decimal" id="ivEx"></label><label class="f">Mva<input type="text" inputmode="decimal" id="ivVat"></label><label class="f">Å betale inkl. mva<input type="text" inputmode="decimal" id="ivTot"></label></div>
    <div class="row"><label class="btn" style="cursor:pointer">📎 Last opp faktura (PDF/bilde/EHF)<input type="file" id="ivFile" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp,.xml" class="hide"></label><span id="ivFileName" class="small muted">Ingen fil valgt</span></div>
    <details><summary style="cursor:pointer;font-weight:600">Varelinjer (gir kontroll per vare)</summary>${lineEditor([])}</details>
    <div id="ivErr"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Avbryt</button><button class="btn primary" id="ivOk">Registrer og kontroller</button></div>`, m => {
    let file = null;
    const sup = () => m.querySelector('#ivSup').value; const ord = () => m.querySelector('#ivOrder').value;
    const fillOrders = () => m.querySelector('#ivOrder').innerHTML = orderOptions(sup(), '');
    fillOrders(); m.querySelector('#ivSup').onchange = fillOrders;
    const getLines = bindLines(m, sup, ord);
    const ex = m.querySelector('#ivEx'), vat = m.querySelector('#ivVat'), tot = m.querySelector('#ivTot');
    ex.oninput = () => { const v = num(ex.value); if (v != null && !vat.value){ tot.placeholder = nf1.format(v*1.15) + ' (15 % mva)'; } };
    m.querySelector('#ivFile').onchange = async e => { m.querySelector('#ivFileName').textContent = 'Laster opp …'; file = await uploadFile(e.target); m.querySelector('#ivFileName').textContent = file ? file.name : 'Ingen fil valgt'; };
    m.querySelector('#ivOk').onclick = async () => {
      const b = m.querySelector('#ivOk'); b.disabled = true;
      try {
        const r = await api('POST', '/api/invoices', {supplier:sup(), invoiceNo:m.querySelector('#ivNo').value, kid:m.querySelector('#ivKid').value, invoiceDate:m.querySelector('#ivDate').value, dueDate:m.querySelector('#ivDue').value, orderId:ord() || null, amountExVat:num(ex.value), vat:num(vat.value), amount:num(tot.value), fileId:file?.id || null, lines:getLines()});
        closeModal(); await apiLoad(true); invoiceDrawer(r.invoice.id);
      } catch(e){ m.querySelector('#ivErr').innerHTML = `<div class="note bad">${esc(e.message||'Noe gikk galt.')}</div>`; b.disabled = false; }
    };
  });
}
function slipModal(){
  const sups = Object.keys(SET().suppliers);
  if (!sups.length){ toast('Legg inn leverandører under Innstillinger først.'); return; }
  modal(`<h3>Registrer pakkseddel</h3>
    <div class="grid g3"><label class="f">Leverandør<select id="psSup">${sups.map(c => `<option value="${esc(c)}">${esc(c)} – ${esc(SET().suppliers[c].name)}</option>`).join('')}</select></label><label class="f">Pakkseddelnr<input type="text" id="psNo"></label><label class="f">Dato<input type="date" id="psDate" value="${C.today}"></label></div>
    <label class="f">Bestilling<select id="psOrder"></select></label>
    <div class="row"><label class="btn" style="cursor:pointer">📷 Bilde eller PDF av pakkseddelen<input type="file" id="psFile" accept=".pdf,.png,.jpg,.jpeg,.webp" capture="environment" class="hide"></label><span id="psFileName" class="small muted">Ingen fil valgt</span></div>
    <details open><summary style="cursor:pointer;font-weight:600">Varelinjer</summary>${lineEditor([])}</details>
    <label class="row" style="gap:10px;font-weight:600"><input type="checkbox" id="psRecv" checked style="width:22px;height:22px"> Registrer varemottaket på bestillingen med disse antallene</label>
    <div id="psErr"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Avbryt</button><button class="btn primary" id="psOk">Lagre pakkseddel</button></div>`, m => {
    let file = null;
    const sup = () => m.querySelector('#psSup').value; const ord = () => m.querySelector('#psOrder').value;
    const fill = () => m.querySelector('#psOrder').innerHTML = orderOptions(sup(), ''); fill(); m.querySelector('#psSup').onchange = fill;
    const getLines = bindLines(m, sup, ord);
    m.querySelector('#lnFromOrder').textContent = 'Kopier linjer fra bestillingen';
    m.querySelector('#psFile').onchange = async e => { m.querySelector('#psFileName').textContent = 'Laster opp …'; file = await uploadFile(e.target); m.querySelector('#psFileName').textContent = file ? file.name : 'Ingen fil valgt'; };
    m.querySelector('#psOk').onclick = async () => { const b = m.querySelector('#psOk'); b.disabled = true;
      try { const r = await api('POST', '/api/slips', {supplier:sup(), slipNo:m.querySelector('#psNo').value, date:m.querySelector('#psDate').value, orderId:ord() || null, fileId:file?.id || null, lines:getLines(), receive:m.querySelector('#psRecv').checked}); closeModal(); toast(r.slip.received ? 'Pakkseddel lagret og varemottak registrert.' : r.slip.orderId ? 'Pakkseddel lagret og koblet til bestilling.' : 'Pakkseddel lagret. Fant ingen åpen bestilling å koble til.'); await apiLoad(true); }
      catch(e){ m.querySelector('#psErr').innerHTML = `<div class="note bad">${esc(e.message||'Noe gikk galt.')}</div>`; b.disabled = false; } };
  });
}
function invoiceDrawer(id){
  const inv = S.invoices.find(i => i.id === id); if (!inv) return;
  const set = SET(); const m = inv.match || {lines:[], issues:[]};
  const o = S.orders.find(x => x.id === inv.orderId);
  const can = S.canManage; const t = inv.ttx || {};
  const html = `<div class="row between"><div><div class="small muted">${esc(set.suppliers[inv.supplier]?.name || inv.supplier)}</div><h2>Faktura ${esc(inv.invoiceNo)}</h2></div><button class="btn" data-close>Lukk</button></div>
    <div class="row">${invPill(inv.status)}${inv.fileId?`<a class="btn sm" href="/api/files/${esc(inv.fileId)}" target="_blank" rel="noopener">📎 Åpne faktura</a>`:''}${t.supplierInvoiceId?'<span class="pill p-behov">I Tripletex</span>':''}</div>
    <div class="card"><dl class="kv"><dt>Fakturadato</dt><dd>${fmtDL(inv.invoiceDate)}</dd><dt>Forfall</dt><dd>${inv.dueDate?fmtDL(inv.dueDate):'–'}</dd><dt>Beløp eks. mva</dt><dd>${inv.amountExVat!=null?kr(inv.amountExVat):'–'}</dd><dt>Å betale</dt><dd>${inv.amount!=null?kr(inv.amount):'–'}</dd>${inv.kid?`<dt>KID</dt><dd>${esc(inv.kid)}</dd>`:''}<dt>Bestilling</dt><dd>${o?`${fmtDL(o.orderDate)} → levert ${fmtDL(o.deliveryDate)} (${o.status})`:'Ikke funnet'}</dd>${m.expectedExVat!=null?`<dt>Forventet ut fra mottak</dt><dd>${kr(m.expectedExVat)} eks. mva</dd>`:''}</dl></div>
    ${m.issues && m.issues.length ? `<div class="note bad"><div><b>Avvik</b><ul style="margin:6px 0 0;padding-left:18px">${m.issues.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></div>` : m.orderId ? '<div class="note good">Fakturaen stemmer med bestilling og varemottak.</div>' : ''}
    ${m.lines && m.lines.length ? `<div class="card flush"><div class="tblwrap"><table><thead><tr><th>Vare</th><th class="n">Bestilt</th><th class="n">Mottatt</th><th class="n">Fakturert</th><th class="n">Pris</th></tr></thead><tbody>${m.lines.map(l => `<tr style="${l.flags.length?'background:var(--red-bg)':''}"><td><div class="iname">${esc(l.name)}</div><div class="isub">${esc(l.itemNo)}${l.flags.length?' · <b style="color:var(--red)">'+esc(l.flags.join(' · '))+'</b>':''}</div></td><td class="n">${q(l.ordered)}</td><td class="n">${q(l.received)}</td><td class="n">${q(l.invoiced)}</td><td class="n">${l.invoicedPrice!=null?nf1.format(l.invoicedPrice):'–'}${l.agreedPrice!=null&&l.invoicedPrice!=null&&Math.abs(l.invoicedPrice-l.agreedPrice)>0.005?`<div class="isub">avtalt ${nf1.format(l.agreedPrice)}</div>`:''}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
    <div class="card grid" style="gap:10px"><h3>Koble til bestilling</h3><div class="row" style="flex-wrap:nowrap"><select id="dvOrder">${orderOptions(inv.supplier, inv.orderId)}</select><button class="btn" id="dvMatch" ${ro()}>Kontroller på nytt</button></div></div>
    <div class="card grid" style="gap:10px"><h3>Behandling</h3>
      <label class="f">Kommentar${inv.status==='avvik'?' (påkrevd for å godkjenne med avvik)':''}<input type="text" id="dvNote" placeholder="f.eks. kreditnota avtalt for manglende vare"></label>
      <div class="row">
        ${['kontroll','avvik','matchet'].includes(inv.status) ? `<button class="btn primary" data-act="approve" ${can?'':'disabled'}>${inv.status==='avvik'?'Godkjenn med avvik':'Godkjenn'}</button><button class="btn danger" data-act="reject" ${can?'':'disabled'}>Avvis</button>` : ''}
        ${inv.status==='godkjent' && !t.supplierInvoiceId ? `<button class="btn primary" data-act="send" ${can?'':'disabled'}>Send til Tripletex</button>` : ''}
        ${(inv.status==='godkjent' || inv.status==='sendt') && t.supplierInvoiceId && !t.paymentAt ? `<button class="btn primary" data-act="pay" ${can?'':'disabled'}>Send til betaling</button>` : ''}
        ${inv.status==='avvist' ? `<button class="btn" data-act="reopen" ${can?'':'disabled'}>Åpne igjen</button>` : ''}
        ${!['sendt','betalt'].includes(inv.status) ? `<button class="btn danger" data-act="delete" ${can?'':'disabled'}>Slett</button>` : ''}
      </div>
      ${!can ? '<div class="small muted">Bare leder kan godkjenne, sende og betale.</div>' : ''}
      <div class="small muted">Godkjent faktura sendes til bilagsmottaket i Tripletex, der den bokføres. Når bilaget er bokført, trykker du «Hent fra Tripletex», og fakturaen kan sendes til betaling. Selve utbetalingen skjer via banken som er koblet til Tripletex.</div></div>
    <div class="card"><h3 style="margin-bottom:8px">Historikk</h3>${(inv.history||[]).slice().reverse().map(h => `<div class="small"><b>${fmtDL(h.ts.slice(0,10))}</b> ${esc(h.action)} – ${esc(h.by)}${h.note?': '+esc(h.note):''}</div>`).join('')}</div>`;
  drawer(html, d => {
    d.querySelector('#dvMatch').onclick = async () => { try { await api('POST', `/api/invoices/${encodeURIComponent(id)}/match`, {orderId: d.querySelector('#dvOrder').value || null}); await apiLoad(true); invoiceDrawer(id); } catch(e){ toast(e.message || 'Feil.'); } };
    d.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
      const act = b.dataset.act; const note = d.querySelector('#dvNote').value;
      const go2 = async () => { b.disabled = true; try { await api('POST', `/api/invoices/${encodeURIComponent(id)}/${act}`, {note}); await apiLoad(true); if (act === 'delete') closeLayer(); else invoiceDrawer(id); toast({approve:'Fakturaen er godkjent.', send:'Fakturaen er sendt til bilagsmottaket i Tripletex.', pay:'Fakturaen er lagt til betaling i Tripletex.', reject:'Fakturaen er avvist.', reopen:'Fakturaen er åpnet igjen.', delete:'Fakturaen er slettet.'}[act]); } catch(e){ toast(e.message || 'Noe gikk galt.'); b.disabled = false; } };
      if (act === 'pay') confirmBox('Sende til betaling?', `${inv.amount!=null?kr(inv.amount):'Beløpet'} til ${set.suppliers[inv.supplier]?.name||inv.supplier}${inv.dueDate?' med forfall '+fmtDL(inv.dueDate):''} legges til betaling i Tripletex.`, 'Send til betaling', go2);
      else if (act === 'delete') confirmBox('Slette fakturaen?', 'Registreringen fjernes fra Restoq.', 'Slett', go2);
      else go2();
    });
  });
}
async function loadTtx(){
  const box = $('#ttxBody'); if (!box) return;
  try {
    const s = await api('GET', '/api/tripletex');
    if (!s.available){ box.innerHTML = 'Tripletex-koblingen er ikke aktivert på serveren ennå (Restoq må ha godkjent integrasjon hos Tripletex).'; return; }
    box.className = 'grid'; box.style.gap = '10px';
    box.innerHTML = s.connected ? `<div class="note good">Koblet til Tripletex${s.env==='test'?' (testmiljø)':''} siden ${fmtDL(String(s.info?.connectedAt||'').slice(0,10))}.</div><div class="row"><button class="btn danger sm" id="ttxOff">Koble fra</button></div>`
      : `<div class="small">Lag en API-nøkkel i Tripletex: <b>Brukerinnstillinger → API-tilgang → Ny nøkkel</b>, velg applikasjonen <b>Restoq</b> og tilgang til leverandørfaktura og bilag. Lim inn nøkkelen her. (Tilleggsmodulen «Integrasjoner» må være aktiv i Tripletex.)</div><div class="row" style="flex-wrap:nowrap"><input type="text" id="ttxTok" placeholder="Employee token fra Tripletex" autocomplete="off"><button class="btn primary" id="ttxOn">Koble til</button></div>`;
    const on = $('#ttxOn'); if (on) on.onclick = async () => { on.disabled = true; try { await api('POST', '/api/tripletex', {employeeToken: $('#ttxTok').value}); toast('Tripletex er koblet til.'); loadTtx(); } catch(e){ toast(e.message || 'Kunne ikke koble til.'); on.disabled = false; } };
    const off = $('#ttxOff'); if (off) off.onclick = () => confirmBox('Koble fra Tripletex?', 'Restoq kan ikke lenger sende eller hente fakturaer før dere kobler til på nytt.', 'Koble fra', async () => { await api('DELETE', '/api/tripletex'); loadTtx(); });
  } catch(e){ box.textContent = 'Kunne ikke hente status.'; }
}
async function loadKeys(){
  const box = $('#keysList'); if (!box) return;
  try {
    const j = await api('GET', '/api/keys'); box.className = '';
    box.innerHTML = j.keys.length ? `<table><thead><tr><th>Navn</th><th>Nøkkel</th><th>Laget</th><th>Sist brukt</th><th></th></tr></thead><tbody>${j.keys.map(k => `<tr><td translate="no">${esc(k.name)}</td><td class="num" translate="no">${esc(k.prefix)}…</td><td>${fmtDL(String(k.created_at).slice(0,10))}</td><td>${k.last_used_at?fmtDL(String(k.last_used_at).slice(0,10)):'–'}</td><td class="n"><button class="btn sm danger" data-kdel="${k.id}">Slett</button></td></tr>`).join('')}</tbody></table>` : '<div class="muted small">Ingen API-nøkler.</div>';
    box.querySelectorAll('[data-kdel]').forEach(b => b.onclick = () => confirmBox('Slette API-nøkkelen?', 'Systemer som bruker nøkkelen, mister tilgangen med en gang.', 'Slett', async () => { await api('DELETE', '/api/keys/' + b.dataset.kdel); loadKeys(); }));
  } catch(e){ box.textContent = 'Kunne ikke hente nøkler.'; }
  const add = $('#kAdd'); if (add) add.onclick = () => modal(`<h3>Ny API-nøkkel</h3><label class="f">Navn (hvilket system bruker den?)<input type="text" id="kName" placeholder="f.eks. Fakturaskanner"></label><div id="kRes"></div><div class="row" style="justify-content:flex-end"><button class="btn" data-close>Lukk</button><button class="btn primary" id="kOk">Lag nøkkel</button></div>`, m => {
    m.querySelector('#kOk').onclick = async () => { const r = await api('POST', '/api/keys', {name: m.querySelector('#kName').value}); m.querySelector('#kOk').classList.add('hide'); m.querySelector('#kRes').innerHTML = `<div class="note warn"><div>Kopier nøkkelen nå – den vises bare denne ene gangen:<br><code style="word-break:break-all;font-size:15px">${esc(r.key)}</code></div></div>`; loadKeys(); };
  });
}
function isoWeek(d){ const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(),0,1)); return Math.ceil(((t - y0) / DAY + 1) / 7); }

/* ---------- dialoger, filer ---------- */
function modal(html, bind){ $('#layer').innerHTML = `<div class="modal-bg" id="mbg"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`; const m = $('#layer .modal'); m.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal); $('#mbg').onclick = e => { if (e.target.id === 'mbg') closeModal(); }; bind && bind(m); const f = m.querySelector('input,button.primary'); f && f.focus(); }
function closeModal(){ $('#layer').innerHTML = ''; }
function drawer(html, bind){ $('#layer').innerHTML = `<div class="drawer-bg" id="dbg"><div class="drawer" role="dialog" aria-modal="true">${html}</div></div>`; const d = $('#layer .drawer'); d.querySelectorAll('[data-close]').forEach(b => b.onclick = closeLayer); $('#dbg').onclick = e => { if (e.target.id === 'dbg') closeLayer(); }; bind && bind(d); }
const closeLayer = closeModal;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
function confirmBox(title, text, okLabel, fn){ modal(`<h3>${esc(title)}</h3><div>${esc(text)}</div><div class="row" style="justify-content:flex-end"><button class="btn" data-close>Avbryt</button><button class="btn primary" id="cfOk">${esc(okLabel)}</button></div>`, m => { m.querySelector('#cfOk').onclick = async () => { const b = m.querySelector('#cfOk'); b.disabled = true; try { await fn(); } catch(e){} closeModal(); }; }); }
function showText(title, txt){ modal(`<h3>${esc(title)}</h3><textarea rows="12" readonly>${esc(txt)}</textarea><div class="small muted">Marker teksten og kopier.</div><div class="row" style="justify-content:flex-end"><button class="btn" data-close>Lukk</button></div>`); }
const csv = rows => '﻿' + rows.map(r => r.map(v => { const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; }).join(';')).join('\r\n');
async function download(filename, data){
  if (MODE_API){ const blob = new Blob([data], {type: /\.json$/.test(filename) ? 'application/json' : 'text/csv;charset=utf-8'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); return; }
  let dl = null; try { dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch(e){}
  if (dl){ try { await dl.save({filename, data}); return; } catch(e){ if (e && e.code && /declin|cancel|abort/i.test(e.code)) return; } }
  showText('Kopier innholdet', data.replace(/^﻿/,''));
}
window.addEventListener('beforeunload', () => { if (countDirty) flushCount(); });

/* ---------- Feilrapportering og tilbakemelding (restoq.no) ---------- */
const RECENT_ERRORS = [], FAILED_CALLS = [];
if (MODE_API){
  const origFetch = window.fetch.bind(window);
  const remember = (input, init, status) => { try { const u = new URL(typeof input === 'string' ? input : input.url, location.href); if (u.pathname === '/api/errors' || u.pathname === '/api/feedback') return; FAILED_CALLS.push({m:(init && init.method || 'GET').toUpperCase(), u:u.pathname, s:status, t:Date.now()}); if (FAILED_CALLS.length > 6) FAILED_CALLS.shift(); } catch(e){} };
  window.fetch = async (input, init) => { try { const r = await origFetch(input, init); if (!r.ok && r.status >= 500) remember(input, init, 'HTTP ' + r.status); return r; } catch(e){ if (!(e && e.name === 'AbortError')) remember(input, init, navigator.onLine ? 'nettverksfeil' : 'frakoblet'); throw e; } };
  let sent = 0; const seen = new Set();
  const report = (message, stack) => {
    message = String(message || ''); if (!message || /ResizeObserver loop|Script error\.?$|extension:\/\//i.test(message + (stack || ''))) return;
    RECENT_ERRORS.push({t:new Date().toLocaleTimeString('nb-NO'), m:message.slice(0,300)}); if (RECENT_ERRORS.length > 5) RECENT_ERRORS.shift();
    if (sent >= 5 || seen.has(message)) return; seen.add(message); sent++;
    const calls = FAILED_CALLS.filter(f => Date.now() - f.t < 30000).map(f => `${f.m} ${f.u} – ${f.s}`).join('\n');
    origFetch('/api/errors', {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', keepalive:true, body: JSON.stringify({message, stack: (stack || '') + (calls ? '\n\nKall som feilet:\n' + calls : ''), path: '/app#' + view})}).catch(() => {});
  };
  window.addEventListener('error', e => report(e.message, e.error && e.error.stack));
  window.addEventListener('unhandledrejection', e => { const r = e.reason || {}; if (r.code === 'auth' || r.code === 'forbidden' || r.code === 'http') return; report(r.message || String(r), r.stack); });
}
const FB_KINDS = [['feil','Noe virker ikke'],['tall','Feil tall eller forslag'],['forslag','Forslag til forbedring'],['ros','Noe som fungerer bra'],['annet','Annet']];
async function shrinkImage(file){
  const url = URL.createObjectURL(file);
  try { const img = new Image(); img.src = url; await img.decode(); const sc = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)); const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth*sc); c.height = Math.round(img.naturalHeight*sc); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0,0,c.width,c.height); x.drawImage(img,0,0,c.width,c.height); return await new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('Bildet kunne ikke leses.')), 'image/jpeg', 0.85)); }
  finally { URL.revokeObjectURL(url); }
}
function feedbackModal(){
  const shots = [];
  modal(`<h3>Gi tilbakemelding</h3><div class="small muted">Si fra om feil, rare tall eller ideer. Utviklerne får med hvilken side du er på og nettleseren din.</div>
    <div class="chips" id="fbKinds">${FB_KINDS.map(([k,l],i) => `<button class="chip ${i===0?'on':''}" data-k="${k}">${l}</button>`).join('')}</div>
    <label class="f">Hva skjedde?<textarea id="fbMsg" rows="5" maxlength="4000" placeholder="F.eks. «Forslaget for smør er 40, men vi bruker 10 i uka» eller «Lagre-knappen gjør ingenting på iPad»"></textarea></label>
    <div class="row"><label class="btn" style="cursor:pointer">📷 Legg ved skjermbilde<input type="file" id="fbImg" accept="image/png,image/jpeg,image/webp" multiple class="hide"></label><span class="small muted">Høyst 3 bilder</span></div>
    <div class="row" id="fbShots"></div><div id="fbErr"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Avbryt</button><button class="btn primary" id="fbSend">Send</button></div>`, m => {
    let kind = 'feil';
    m.querySelectorAll('#fbKinds .chip').forEach(b => b.onclick = () => { kind = b.dataset.k; m.querySelectorAll('#fbKinds .chip').forEach(x => x.classList.toggle('on', x === b)); });
    const draw = () => { m.querySelector('#fbShots').innerHTML = shots.map((s,i) => `<span style="position:relative"><img src="${s.url}" alt="Skjermbilde ${i+1}" style="height:70px;border-radius:8px;border:1px solid var(--line)"><button class="btn sm danger" data-rm="${i}" style="position:absolute;top:-8px;right:-8px;min-height:26px;padding:0 8px" aria-label="Fjern bilde">×</button></span>`).join(''); m.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { URL.revokeObjectURL(shots[+b.dataset.rm].url); shots.splice(+b.dataset.rm, 1); draw(); }); };
    m.querySelector('#fbImg').onchange = async e => { for (const f of [...e.target.files].slice(0, 3 - shots.length)){ try { const blob = await shrinkImage(f); shots.push({blob, url: URL.createObjectURL(blob)}); } catch(x){ toast('Bildet kunne ikke leses.'); } } e.target.value = ''; draw(); };
    m.querySelector('#fbSend').onclick = async () => {
      const msg = m.querySelector('#fbMsg').value.trim(); if (msg.length < 3){ m.querySelector('#fbErr').innerHTML = '<div class="note bad">Skriv litt om hva du vil si fra om.</div>'; return; }
      const b = m.querySelector('#fbSend'); b.disabled = true; b.textContent = 'Sender …';
      const ctx = [`Kunde: ${S.me?.org || '–'} · rolle: ${S.me?.role || '–'}`, `Visning: ${view} · skjerm ${innerWidth}×${innerHeight}`, `Varer: ${C ? C.items.length : 0} · bestillinger: ${S.orders.length} · siste telling: ${C && C.cur ? C.cur.date : 'ingen'}`];
      if (RECENT_ERRORS.length) ctx.push('Siste feil i nettleseren:\n' + RECENT_ERRORS.map(e => `${e.t} ${e.m}`).join('\n'));
      if (FAILED_CALLS.length) ctx.push('Kall som feilet:\n' + FAILED_CALLS.map(f => `${f.m} ${f.u} – ${f.s}`).join('\n'));
      const fd = new FormData(); fd.append('kind', kind); fd.append('message', msg); fd.append('path', '/app#' + view); fd.append('context', ctx.join('\n'));
      shots.forEach((s,i) => fd.append('image', s.blob, `skjermbilde-${i+1}.jpg`));
      try { const r = await fetch('/api/feedback', {method:'POST', body:fd, credentials:'same-origin'}); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Kunne ikke sende.'); shots.forEach(s => URL.revokeObjectURL(s.url)); closeModal(); toast('Takk! Tilbakemeldingen er sendt.'); }
      catch(e){ m.querySelector('#fbErr').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; b.disabled = false; b.textContent = 'Send'; }
    };
  });
}
if (MODE_API){
  const fb = document.createElement('button'); fb.className = 'fbfloat'; fb.type = 'button'; fb.setAttribute('aria-label', 'Gi tilbakemelding'); fb.innerHTML = '<span aria-hidden="true">💬</span><span class="fbtxt"> Gi tilbakemelding</span>';
  fb.onclick = feedbackModal; document.body.appendChild(fb);
}

render();
connect();
