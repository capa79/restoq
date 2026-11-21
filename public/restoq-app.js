"use strict";
const BOOT = (() => { try { const el = document.getElementById('boot'); return el ? JSON.parse(el.textContent) : null; } catch(e){ return null; } })();
const MODE_API = !!BOOT; // restoq.no: data via egen server. Ellers prototype (Claude-artifact eller lokalt).
const SEED = (() => { try { const el = document.getElementById('seed'); return el ? JSON.parse(el.textContent) : null; } catch(e){ return null; } })() || {items:[], weeks:[], suppliers:[]};
const BASE_ITEMS = SEED.items;
/* Anbefalt bestillingsfrekvens per lagertype (dager mellom hver gang varetypen fylles opp) */
const FREQ_DEFAULT = {'Kjøl':3.5, 'Frys':7, 'Tørr':14, 'Romtemp.':14};
const FREQ_TXT = {'Kjøl':'Ferskvare: 2 ganger i uka', 'Frys':'Frysevarer: 1 gang i uka', 'Tørr':'Tørrvare: annenhver uke', 'Romtemp.':'Romtemperatur (drikke, emballasje): annenhver uke'};
const DAY = 864e5;
const WASTE_REASONS = [
  {k:'Brekkasje', t:'kassert', tip:'Se på hyller, håndtering og emballasje – hvor og når skjer det, og ved hvilke oppgaver?'},
  {k:'Utgått på dato', t:'kassert', tip:'Bestill mindre eller oftere, og bruk eldste pakning først (først inn, først ut).'},
  {k:'Bedervet / feil oppbevaring', t:'kassert', tip:'Sjekk temperaturen i kjøl og frys, og at varer pakkes, merkes og dekkes riktig.'},
  {k:'Feil i produksjon', t:'kassert', tip:'Gå gjennom oppskrift, utstyr og opplæring.'},
  {k:'Overproduksjon', t:'kassert', tip:'Juster preppmengdene etter forventet salg og ukedag.'},
  {k:'Returnert av gjest', t:'kassert', tip:'Følg opp kvalitet, porsjoner og bestillinger fra salen.'},
  {k:'Personalmat', t:'uttak'},
  {k:'Representasjon', t:'uttak'},
  {k:'Annet', t:'kassert', tip:'Skriv en kort kommentar ved hver registrering, så blir mønsteret lettere å se.'}];
const REASONS = WASTE_REASONS.map(r => r.k);
const REASON_ALIAS = {'Skadet':'Brekkasje'};
const reasonOf = r => REASON_ALIAS[r] || r || 'Annet';
const reasonInfo = r => WASTE_REASONS.find(x => x.k === reasonOf(r)) || {k:reasonOf(r), t:'kassert'};
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
    applyDocs(j.docs); S.me = j.me; S.features = j.features || {}; S.canManage = !!j.me.canManage; S.mode = 'shared'; S.ready = true;
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
  // Topplinje: logo – firmanavn – powered by Restoq
  const name = (S.brand && S.brand.name) || (S.me && S.me.org) || '';
  if (b.logo){ lg.src = b.logo; lg.alt = name || 'Logo'; lg.setAttribute('translate','no'); lg.classList.remove('hide'); } else lg.classList.add('hide');
  tt.textContent = name || 'Restoq'; tt.classList.remove('hide');
  pw.classList.toggle('hide', !name && !b.logo);
  document.title = name ? name + ' – Restoq' : 'Restoq';
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
  ['svinn','Avskrivning','<path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/>'],
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
  ({oversikt:vOversikt, bestill:vBestill, mottak:vMottak, telling:vTelling, svinn:vSvinn, varer:vVarer, faktura:vFaktura, oppsett:vOppsett, leverandorer:vLeverandorer, komigang:vKomigang}[view] || vOversikt)();
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
    <div class="row"><button class="btn" data-go="svinn">+ Avskrivning</button><button class="btn primary" data-go="bestill">Lag bestilling</button></div></div>`;
  h += roNote();
  if (S.mode === 'local') h += `<div class="note warn"><b>Lagres bare på denne enheten.</b>&nbsp;Åpne appen innlogget via lenken fra eier, så deler alle ansatte samme tall.</div>`;
  if (!getItems().length || (!C.cur && !SET().onboarded)) h += `<div class="note info wzbanner"><div><b>Kom i gang:</b> ${S.canManage ? 'legg inn leverandører og varer fra vareliste (Excel/CSV) og/eller fakturaer. Du velger selv hvilke varer som tas med, og om beholdningen skal legges inn nå.' : 'administrator hos dere må legge inn leverandører og varer før dere kan telle og bestille.'}</div>${S.canManage ? '<button class="btn primary" data-go="komigang">Start veiviseren</button>' : ''}</div>`;
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
      <td><div class="iname click" data-item="${esc(r.id)}" style="cursor:pointer">${esc(r.name)}</div><div class="isub">Varenr ${esc(r.no)} · ${esc(r.unit)}${r.pack!==1?' · pakning '+q(r.pack):''} · ${kr(r.price)}/${esc(r.unit)}${r.wasteRisk?' · <span style="color:var(--amber);font-weight:600">svinnrisiko</span>':''}</div>${altNote(r)}</td>
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
const W_PERIODS = [['30','Siste 30 dager'],['mnd','Denne måneden'],['fmnd','Forrige måned'],['90','Siste 3 måneder'],['aar','I år'],['alle','Alt']];
function wRange(p){
  const t = C.today, m1 = t.slice(0,7) + '-01';
  if (p === '30') return [addDays(t,-29), t];
  if (p === '90') return [addDays(t,-89), t];
  if (p === 'mnd') return [m1, t];
  if (p === 'fmnd'){ const e = addDays(m1,-1); return [e.slice(0,7) + '-01', e]; }
  if (p === 'aar') return [t.slice(0,4) + '-01-01', t];
  return ['0000-01-01', t];
}
const isoMon = d => { const x = new Date(d + 'T12:00:00'); const wd = (x.getDay() + 6) % 7; return addDays(d, -wd); };
const wbar = (label, v, max, right, cls='') => `<div class="wbar ${cls}"><span class="wbar-l">${label}</span><span class="wbar-t"><i style="width:${max > 0 ? Math.max(2, v / max * 100) : 0}%"></i></span><span class="wbar-v">${right}</span></div>`;
const pct = (a, b) => b > 0 ? nf1.format(a / b * 100) + ' %' : '–';

function vSvinn(){
  const items = getItems(); if (!UI.wDate) UI.wDate = C.today;
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  const sel = UI.wItem ? byId[UI.wItem] : null;
  const sq = UI.wSearch.trim().toLowerCase();
  const hits = sq && !sel ? items.filter(i => (i.name+' '+i.no).toLowerCase().includes(sq)).slice(0,8) : [];
  const list = [...S.waste].sort((a,b) => a.date < b.date ? 1 : a.date > b.date ? -1 : (b.ts||0)-(a.ts||0));
  const ri = reasonInfo(UI.wReason);

  let h = `<div><h2>Avskrivning</h2><div class="muted">Registrer alt som kastes eller tas ut av lageret, samme dag: brekkasje, utgått dato, bedervet vare, feil i produksjon, personalmat. Det trekkes fra lageret og viser hva som avskrives mest – og hvorfor.</div></div>` + roNote();
  h += `<div class="card grid" style="gap:14px"><h3>Ny avskrivning</h3>`;
  h += sel ? `<div class="row between note good" style="margin:0"><div><div class="iname">${esc(sel.name)}</div><div class="isub">${sel.sup} ${esc(sel.no)} · ${esc(sel.unit)} · ${kr(sel.price)}/${esc(sel.unit)}</div></div><button class="btn sm" id="wClear">Bytt vare</button></div>`
    : `<label class="f">Hvilken vare?<input type="search" id="wSearch" placeholder="Skriv navn, f.eks. «melk» eller «vinglass»" value="${esc(UI.wSearch)}" autocomplete="off"></label>${hits.length?`<div class="card flush">${hits.map(i=>`<div class="countrow click" data-pick="${esc(i.id)}" style="grid-template-columns:1fr auto;cursor:pointer"><div><div class="iname">${esc(i.name)}</div><div class="isub">${i.sup} ${esc(i.no)} · ${esc(i.stor)}</div></div><span class="muted">${esc(i.unit)}</span></div>`).join('')}</div>`:sq?'<div class="small muted">Ingen treff.</div>':''}`;
  h += `<div class="grid g2"><label class="f">Antall${sel?' ('+esc(sel.unit)+')':''}<input type="text" inputmode="decimal" id="wQty" value="${esc(UI.wQty)}" placeholder="f.eks. 2 eller 0,5"></label><label class="f">Dato<input type="date" id="wDate" value="${UI.wDate}"></label></div>
    <div class="f" style="display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:var(--muted)">Årsak<div class="chips">${WASTE_REASONS.map(r=>`<button class="chip ${reasonOf(UI.wReason)===r.k?'on':''}" data-reason="${esc(r.k)}">${esc(r.k)}</button>`).join('')}</div>${ri.t==='uttak'?'<span class="small" style="font-weight:400">Føres som uttak, ikke svinn (se merknad i oversikten).</span>':''}</div>
    <label class="f">Kommentar${ri.k==='Annet'||ri.k==='Brekkasje'?' (hva skjedde?)':' (valgfritt)'}<input type="text" id="wComment" value="${esc(UI.wComment)}" placeholder="${ri.k==='Brekkasje'?'f.eks. mistet kasse ved varemottak':'f.eks. kjøleskap 2 for varmt'}"></label>
    <div class="row between"><span class="muted">${sel && num(UI.wQty) ? 'Verdi: <b>'+kr(num(UI.wQty)*sel.price)+'</b>' : ''}</span><button class="btn primary lg" id="wSave" ${sel && num(UI.wQty) > 0 && S.canWrite ? '' : 'disabled'}>Registrer avskrivning</button></div></div>`;

  // ---------- oversikt ----------
  const per = UI.wPer || '30'; const [from, to] = wRange(per);
  const inP = S.waste.filter(w => w.date >= from && w.date <= to);
  const val = w => w.value || 0;
  const tot = inP.reduce((s,w) => s + val(w), 0);
  const utt = inP.filter(w => reasonInfo(w.reason).t === 'uttak'); const uttV = utt.reduce((s,w)=>s+val(w),0);
  const kassV = tot - uttV;
  const buy = S.orders.filter(o => o.status === 'mottatt' && o.deliveryDate >= from && o.deliveryDate <= to).reduce((s,o) => s + o.lines.reduce((a,l) => a + (l.recv != null ? l.recv : l.qty) * (l.price ?? byId[l.id]?.price ?? 0), 0), 0);
  const byR = {}; inP.forEach(w => { const k = reasonOf(w.reason); (byR[k] ??= {v:0, n:0}); byR[k].v += val(w); byR[k].n++; });
  const reasons = Object.entries(byR).sort((a,b) => b[1].v - a[1].v);
  const kass = inP.filter(w => reasonInfo(w.reason).t !== 'uttak');
  const byI = {}; kass.forEach(w => { const x = (byI[w.itemId] ??= {v:0, q:0, n:0, r:{}}); x.v += val(w); x.q += w.qty || 0; x.n++; const k = reasonOf(w.reason); x.r[k] = (x.r[k]||0) + val(w); });
  const topI = Object.entries(byI).sort((a,b) => b[1].v - a[1].v).slice(0, 10);
  const byS = {}; kass.forEach(w => { const s = byId[w.itemId]?.cat || 'Ukjent'; byS[s] = (byS[s]||0) + val(w); });
  const cats = Object.entries(byS).sort((a,b) => b[1]-a[1]).slice(0, 8);
  const days = Math.round((new Date(to) - new Date(from === '0000-01-01' ? (S.waste.map(w=>w.date).sort()[0] || to) : from)) / 864e5) + 1;
  const monthly = days > 100;
  const bucket = d => monthly ? d.slice(0,7) : isoMon(d);
  const trend = {}; inP.forEach(w => { const b = bucket(w.date); trend[b] = (trend[b]||0) + val(w); });
  const tKeys = Object.keys(trend).sort().slice(-14); const tMax = Math.max(0, ...tKeys.map(k => trend[k]));
  const mainR = r => Object.entries(r).sort((a,b) => b[1]-a[1])[0]?.[0] || '';

  h += `<div class="row between" style="margin-top:6px"><h2 style="font-size:22px">Hva avskrives mest – og hvorfor</h2><button class="btn sm" id="wCsv" ${inP.length?'':'disabled'}>Last ned (CSV)</button></div>
    <div class="chips">${W_PERIODS.map(([k,l]) => `<button class="chip ${per===k?'on':''}" data-wper="${k}">${l}</button>`).join('')}</div>`;
  if (!inP.length){
    h += `<div class="card"><div class="empty">Ingen avskrivninger i perioden.</div></div>`;
  } else {
    const top = topI[0]; const topItem = top && byId[top[0]];
    const rK = reasons.filter(([k]) => reasonInfo(k).t !== 'uttak');
    h += `<div class="grid g4">
      <div class="tile amber"><span class="lbl">Avskrevet</span><span class="big">${kr(tot)}</span><span class="small muted">${inP.length} registreringer</span></div>
      <div class="tile"><span class="lbl">Av varekjøp</span><span class="big">${pct(kassV, buy)}</span><span class="small muted">kassert ${kr(kassV)} av ${buy ? kr(buy) : 'ingen'} mottatt</span></div>
      <div class="tile"><span class="lbl">Største årsak</span><span class="big" style="font-size:22px">${rK.length ? esc(rK[0][0]) : '–'}</span><span class="small muted">${rK.length ? kr(rK[0][1].v) + ' · ' + pct(rK[0][1].v, kassV) + ' av kassert' : 'bare uttak i perioden'}</span></div>
      <div class="tile"><span class="lbl">Mest avskrevne vare</span><span class="big" style="font-size:18px;line-height:1.2">${esc(topItem?.name || top?.[0] || '–')}</span><span class="small muted">${top ? kr(top[1].v) + ' · ' + esc(mainR(top[1].r)) : ''}</span></div></div>`;
    // tiltak
    const tips = [];
    const topK = reasons.find(([k]) => reasonInfo(k).t === 'kassert');
    if (topK) tips.push(`<b>${esc(topK[0])}</b> <span>står for ${pct(topK[1].v, kassV)} av det som kastes (${kr(topK[1].v)}).</span> <span>${esc(reasonInfo(topK[0]).tip || '')}</span>`);
    if (top && topItem){ const mr = mainR(top[1].r); tips.push(`<b translate="no">${esc(topItem.name)}</b> <span>er avskrevet ${top[1].n} ${top[1].n === 1 ? 'gang' : 'ganger'} (${q(top[1].q)} ${esc(topItem.unit)}). Hovedårsak:</span> <span>${esc(mr)}</span>.${mr === 'Utgått på dato' ? ` <span>Vurder lavere mållager eller mindre pakning.</span>${topItem.pack > 1 ? ` <span>Bestilles nå i pakninger à ${q(topItem.pack)}.</span>` : ''}` : ''}`); }
    if (buy && kassV / buy > 0.04) tips.push(`Kassert vare er ${pct(kassV, buy)} av varekjøpet i perioden. Mange kjøkken jobber mot under 3–4 %.`);
    h += `<div class="card"><h3 style="margin-bottom:8px">Hva kan gjøres</h3><ul class="wtips">${tips.map(t => `<li>${t}</li>`).join('')}</ul></div>`;
    const rMax = reasons[0][1].v;
    h += `<div class="grid g2" style="align-items:start">
      <div class="card"><h3 style="margin-bottom:10px">Etter årsak</h3>${reasons.map(([k,x]) => wbar(`${esc(k)}${reasonInfo(k).t==='uttak'?' <span class="pill p-tell" style="font-size:11px">uttak</span>':''}`, x.v, rMax, `${kr(x.v)} <span class="muted">· ${pct(x.v, tot)} · ${x.n}×</span>`, reasonInfo(k).t)).join('')}</div>
      <div class="card"><h3 style="margin-bottom:10px">Kassert etter kategori</h3>${cats.length ? cats.map(([k,v]) => wbar(esc(k), v, cats[0][1], `${kr(v)} <span class="muted">· ${pct(v, kassV)}</span>`)).join('') : '<div class="empty">Ingenting kassert.</div>'}</div></div>`;
    h += `<div class="card"><h3 style="margin-bottom:10px">Utvikling per ${monthly ? 'måned' : 'uke'}</h3><div class="wtrend">${tKeys.map(k => `<div class="wtcol" title="${kr(trend[k])}"><span class="wtv">${trend[k] >= 1000 ? nf0.format(trend[k]/1000) + 'k' : nf0.format(trend[k])}</span><i style="height:${tMax ? Math.max(3, trend[k]/tMax*100) : 0}%"></i><span class="wtl">${monthly ? k.slice(5,7) + '.' + k.slice(2,4) : 'u. ' + fmtD(k)}</span></div>`).join('')}</div></div>`;
    h += `<div class="card flush"><div style="padding:14px 16px 6px"><h3>Topp 10 kasserte varer</h3><div class="small muted">Sortert etter verdi i perioden. Personalmat og representasjon er holdt utenfor.</div></div><div class="tblwrap"><table><thead><tr><th>Vare</th><th class="n">Ganger</th><th class="n">Antall</th><th>Hovedårsak</th><th class="n">Verdi</th><th class="n">Andel</th></tr></thead><tbody>${topI.map(([id, x]) => { const i = byId[id] || {name:id, unit:''}; const others = Object.entries(x.r).sort((a,b)=>b[1]-a[1]).slice(1,3).map(([k])=>k).join(', '); return `<tr class="click" data-item="${esc(id)}"><td><div class="iname">${esc(i.name)}</div><div class="isub">${esc(i.cat||'')}${i.stor?' · '+esc(i.stor):''}</div></td><td class="n">${x.n}</td><td class="n">${q(x.q)} ${esc(i.unit)}</td><td>${esc(mainR(x.r))}${others?`<div class="isub">også ${esc(others.toLowerCase())}</div>`:''}</td><td class="n"><b>${kr(x.v)}</b></td><td class="n">${pct(x.v, kassV)}</td></tr>`; }).join('') || '<tr><td colspan="6"><div class="empty">Ingenting kassert i perioden.</div></td></tr>'}</tbody></table></div></div>`;
    if (uttV > 0) h += `<div class="note info small"><div><b>Personalmat og representasjon</b> <b>(${kr(uttV)})</b> <span>er uttak, ikke svinn, og er holdt utenfor «av varekjøp». Det er ikke fradrag for inngående mva på kost til ansatte og representasjon (mval. § 8-3 første ledd bokstav d og e), og varer som tas fra lageret til dette kan utløse uttaksmerverdiavgift (mval. § 3-21). Avklar bokføringen med regnskapsfører – CSV-filen skiller kassert og uttak.</span></div></div>`;
  }
  h += `<div class="card flush"><div style="padding:14px 16px 6px"><h3>Siste registreringer</h3></div>${list.length?`<div class="tblwrap"><table><thead><tr><th>Dato</th><th>Vare</th><th class="n">Antall</th><th>Årsak</th><th class="n">Verdi</th><th></th></tr></thead><tbody>${list.slice(0,60).map(w=>{ const i = byId[w.itemId]||{name:w.itemId,unit:''}; return `<tr><td>${fmtDL(w.date)}</td><td><div class="iname">${esc(i.name)}</div>${w.comment||w.by?`<div class="isub">${esc(w.comment||'')}${w.comment&&w.by?' · ':''}${w.by?'<span translate="no">'+esc(w.by)+'</span>':''}</div>`:''}</td><td class="n">${q(w.qty)} ${esc(i.unit)}</td><td>${esc(reasonOf(w.reason))}</td><td class="n">${kr(w.value)}</td><td class="n"><button class="btn sm danger" data-wdel="${w.id}" aria-label="Slett" ${ro()}>Slett</button></td></tr>`; }).join('')}</tbody></table></div>`:'<div class="empty">Ingen avskrivninger registrert ennå.</div>'}</div>`;
  $('#view').innerHTML = h;
  const ws = $('#wSearch'); if (ws) ws.oninput = e => { UI.wSearch = e.target.value; render(); };
  document.querySelectorAll('[data-pick]').forEach(d => d.onclick = () => { UI.wItem = d.dataset.pick; UI.wSearch = ''; render(); setTimeout(()=>{ const x=$('#wQty'); x && x.focus(); },0); });
  const wc = $('#wClear'); if (wc) wc.onclick = () => { UI.wItem = null; render(); };
  $('#wQty').oninput = e => { UI.wQty = e.target.value; render(); };
  $('#wDate').onchange = e => { UI.wDate = e.target.value; };
  $('#wComment').oninput = e => { UI.wComment = e.target.value; };
  document.querySelectorAll('[data-reason]').forEach(b => b.onclick = () => { UI.wReason = b.dataset.reason; render(); });
  document.querySelectorAll('[data-wper]').forEach(b => b.onclick = () => { UI.wPer = b.dataset.wper; render(); });
  $('#wSave').onclick = async () => { const qty = num(UI.wQty); await store.put('waste', uid(), {date:UI.wDate||C.today, itemId:sel.id, qty, reason:reasonOf(UI.wReason), type:reasonInfo(UI.wReason).t, comment:UI.wComment, value:Math.round(qty*sel.price*100)/100, by:S.me?.name||S.me?.email||'', ts:Date.now()}); toast(`Avskrevet: ${nf1.format(qty)} ${sel.unit} ${sel.name}`); UI.wItem=null; UI.wQty=''; UI.wComment=''; render(); };
  const cv = $('#wCsv'); if (cv) cv.onclick = () => download(`avskrivning-${from === '0000-01-01' ? 'alle' : from}-${to}.csv`, csv([['Dato','Leverandør','Varenr','Vare','Kategori','Antall','Enhet','Årsak','Type','Verdi eks. mva','Kommentar','Registrert av'], ...inP.sort((a,b)=>a.date<b.date?-1:1).map(w => { const i = byId[w.itemId]||{}; return [w.date,i.sup,i.no,i.name,i.cat,w.qty,i.unit,reasonOf(w.reason),reasonInfo(w.reason).t==='uttak'?'Uttak':'Kassert',w.value,w.comment||'',w.by||'']; })]));
  document.querySelectorAll('[data-wdel]').forEach(b => b.onclick = () => confirmBox('Slette registreringen?', 'Varen legges tilbake i beregnet beholdning.', 'Slett', () => store.del('waste', b.dataset.wdel)));
  bindItemRows();
}

function vVarer(){
  let rows = C.items;
  const sq = UI.vSearch.trim().toLowerCase();
  if (sq) rows = rows.filter(r => (r.name+' '+r.no+' '+r.cat).toLowerCase().includes(sq));
  if (UI.vSup) rows = rows.filter(r => r.sup === UI.vSup);
  if (UI.vStore) rows = rows.filter(r => r.stor === UI.vStore);
  if (UI.vGroup) rows = rows.filter(r => catOf(r).group === UI.vGroup);
  if (UI.vStatus === 'svinn') rows = rows.filter(r => r.wasteRisk); else if (UI.vStatus) rows = rows.filter(r => r.status === UI.vStatus);
  const key = UI.vSort, dir = UI.vDir;
  const get = r => key==='cover' ? (r.cover ?? 1e9) : key==='name' ? r.name : r[key];
  rows = [...rows].sort((a,b) => { const x = get(a), y = get(b); return (typeof x === 'string' ? x.localeCompare(y,'nb') : x - y) * dir; });
  const th = (k,l,n) => `<th class="sort ${n?'n':''}" data-sort="${k}">${l}${UI.vSort===k?(UI.vDir>0?' ▲':' ▼'):''}</th>`;
  let h = `<div class="row between"><div><h2>Varer og beholdning</h2><div class="muted">${rows.length} av ${C.items.length} varer · trykk på en vare for detaljer og innstillinger</div></div><div class="row"><a class="btn" href="/restoq-varemal.xlsx" download>Last ned Excel-mal</a><button class="btn primary" id="vNew" ${roM()}>+ Legg inn varer</button></div></div>`;
  h += `<div class="card grid" style="gap:10px"><input type="search" id="vSearch" placeholder="Søk navn, varenummer eller kategori" value="${esc(UI.vSearch)}">
    <div class="row"><div class="chips"><button class="chip ${!UI.vStatus?'on':''}" data-vs="">Alle</button>${['bestill','snart','ok','tell','behov'].map(s=>`<button class="chip ${UI.vStatus===s?'on':''}" data-vs="${s}">${STATUS[s][0]}</button>`).join('')}<button class="chip ${UI.vStatus==='svinn'?'on':''}" data-vs="svinn">Svinnrisiko</button></div>
    <select id="vSup" style="width:auto"><option value="">Alle leverandører</option>${Object.keys(SET().suppliers).map(c=>`<option ${UI.vSup===c?'selected':''}>${c}</option>`).join('')}</select>
    <select id="vGroup" style="width:auto"><option value="">Alle kategorier</option>${CATS().map(g => `<option ${UI.vGroup===g.name?'selected':''}>${esc(g.name)}</option>`).join('')}</select>
    <select id="vStore" style="width:auto"><option value="">Alle lager</option>${STORES.map(s=>`<option ${UI.vStore===s?'selected':''}>${s}</option>`).join('')}</select></div></div>`;
  h += `<div class="card flush"><div class="tblwrap" style="max-height:calc(100vh - 330px)"><table><thead><tr>${th('name','Vare')}<th>Status</th>${th('stockNow','Har nå',1)}${th('open','Åpne ordre',1)}${th('usageWeek','Bruk/uke',1)}${th('cover','Holder')}<th>Tom ca.</th>${th('sugg','Forslag',1)}${th('value','Verdi',1)}</tr></thead><tbody>
    ${rows.map(r => `<tr class="click" data-item="${esc(r.id)}"><td><div class="iname">${esc(r.name)}</div><div class="isub">${r.sup} ${esc(r.no)} · ${esc(catLabel(catOf(r).group, catOf(r).cat))} · ${esc(r.stor)} · ${esc(r.unit)}${r.wasteRisk?' · <span style="color:var(--amber);font-weight:600">bruk først</span>':''}${altsFor(r).length?` · <span class="altbadge" title="Kjøpes også hos andre leverandører">${altsFor(r).length+1} leverandører</span>`:''}</div></td><td>${pill(r.status)}</td><td class="n">${r.countDate?q(r.stockNow):'–'}</td><td class="n">${r.open?q(r.open):''}</td><td class="n">${q(r.usageWeek)}</td><td><div class="row" style="gap:8px;flex-wrap:nowrap">${r.countDate?coverBar(r):''}<span class="tab">${r.countDate?coverTxt(r):''}</span></div></td><td>${r.countDate&&r.runsOut?fmtD(r.runsOut):''}</td><td class="n">${r.sugg?'<b>'+q(r.sugg)+'</b>':''}</td><td class="n">${r.countDate?kr(r.value):''}</td></tr>`).join('') || '<tr><td colspan="9"><div class="empty">Ingen varer passer filteret.</div></td></tr>'}
  </tbody></table></div></div>`;
  $('#view').innerHTML = h;
  $('#vSearch').oninput = e => { UI.vSearch = e.target.value; render(); };
  document.querySelectorAll('[data-vs]').forEach(b => b.onclick = () => { UI.vStatus = b.dataset.vs; render(); });
  $('#vSup').onchange = e => { UI.vSup = e.target.value; render(); };
  $('#vStore').onchange = e => { UI.vStore = e.target.value; render(); };
  $('#vGroup').onchange = e => { UI.vGroup = e.target.value; render(); };
  document.querySelectorAll('[data-sort]').forEach(t => t.onclick = () => { const k = t.dataset.sort; if (UI.vSort === k) UI.vDir *= -1; else { UI.vSort = k; UI.vDir = k==='name'||k==='cover' ? 1 : -1; } render(); });
  $('#vNew').onclick = addItemsModal;
  bindItemRows();
}
function bindItemRows(){ document.querySelectorAll('[data-item]').forEach(el => el.onclick = e => { if (e.target.closest('button,input')) return; itemDrawer(el.dataset.item); }); }

function itemDrawer(id){
  const r = C.items.find(x => x.id === id); if (!r) return;
  const set = SET(); const sp = set.suppliers[r.sup] || {};
  const srcTxt = {manuell:'manuelt satt forbruk', telling:'faktisk forbruk fra siste to tellinger', innkjøp:'innkjøp siste 13 uker (Tripletex)'}[r.usageSource];
  const html = `<div class="row between"><div><div class="small muted">${r.sup} · varenr ${esc(r.no)}</div><h2 translate="no">${esc(r.name)}</h2></div><button class="btn" data-close>Lukk</button></div>
    <div class="row">${pill(r.status)}${r.wasteRisk?'<span class="pill p-svinn">Svinnrisiko</span>':''}<span class="muted small">${esc(catLabel(catOf(r).group, catOf(r).cat))} · ${esc(r.stor)} · ${esc(r.area)}</span></div>
    <div class="grid g2"><div class="tile"><span class="lbl">Har nå (beregnet)</span><span class="big">${r.countDate?q(r.stockNow):'–'} <span style="font-size:16px">${esc(r.unit)}</span></span></div><div class="tile"><span class="lbl">Holder</span><span class="big">${r.countDate?coverTxt(r):'–'}</span><span class="small muted">${r.runsOut&&r.countDate?'tom ca. '+fmtDL(r.runsOut):''}</span></div></div>
    <div class="card"><h3 style="margin-bottom:8px">Slik er tallet regnet</h3>${r.countDate ? `<div class="calc">
      <span>Talt ${fmtDL(r.countDate)}</span><span class="num">${q(r.stockAtCount)}</span>
      <span>− Avskrevet siden telling</span><span class="num">${q(r.wasteSince)}</span>
      <span>− Forbruk ${r.daysSince} dager (${q(r.usageWeek)}/uke)</span><span class="num">${q(r.usedSince)}</span>
      <span>+ Mottatt siden telling</span><span class="num">${q(r.rcvSince)}</span>
      <span class="tot">= Har nå</span><span class="tot num">${q(r.stockNow)}</span>
      <span>+ Åpne bestillinger</span><span class="num">${q(r.open)}</span>
      <span class="tot">= Tilgjengelig</span><span class="tot num">${q(r.avail)}</span></div>` : '<div class="muted">Ikke talt ennå. Tell varen for å få beholdning.</div>'}
      <div class="small muted" style="margin-top:10px">Forbruk/uke bygger på ${srcTxt}${r.usageSource!=='manuell'?`, skalert til forventet matsalg ${kr(C.sales)}/uke`:''}. ${esc(r.stor)} fylles opp hver ${q(r.cycle)}. dag (${esc(FREQ_TXT[r.stor]||'')}${r.cycle > r.freq ? ', begrenset av leverandørens leveringsrytme' : ''}). Varen kommer på forslag når tilgjengelig er under ${q(r.reorderPoint)} (forbruk fram til neste levering + sikkerhet). Da bestilles det opp til mållageret: forbruk per dag × ${q(r.horizon)} dager (${q(r.cycle)} syklus + ${sp.lead} ledetid + ${sp.safety} sikkerhet${r.shelf && r.shelf < (r.cycle+sp.lead+sp.safety) ? ', begrenset av holdbarhet '+r.shelf+' d' : ''}) = ${q(r.target)}, rundet opp til pakning ${q(r.pack)}. Forslag nå: <b>${q(r.sugg)}</b>.</div></div>
    <div class="card"><dl class="kv"><dt>Pris</dt><dd>${kr(r.price)} per ${esc(r.unit)} eks. mva</dd><dt>Kjøpt 13 uker</dt><dd>${q(r.b13)} ${esc(r.unit)} · ${r.ndel||0} leveranser</dd><dt>Sist levert</dt><dd>${fmtDL(r.last)}</dd><dt>Tidligste utløp</dt><dd>${r.expiry?fmtDL(r.expiry)+' ('+r.daysToExp+' d)':'–'}</dd></dl></div>
    ${altsFor(r).length ? `<div class="card"><h3 style="margin-bottom:8px">Samme vare hos andre leverandører</h3><table><tbody>${altsFor(r).map(o => { const c = comparePrice(r, r.price, o); const d = c.d; return `<tr><td><div class="iname">${esc(o.name)}</div><div class="isub" translate="no">${esc(set.suppliers[o.sup]?.name||o.sup)} · ${esc(o.no)}</div></td><td class="n"><b>${kr(o.price)}</b>/${esc(o.unit)}${c.note?`<div class="isub">${c.note}</div>`:''}${d!=null&&Math.abs(d)>=0.5?`<div class="isub" style="color:${d<0?'var(--green)':'var(--red)'}">${d>0?'+':''}${nf1.format(d)} %</div>`:''}</td><td class="n"><button class="btn sm" data-notsame="${esc(o.id)}" ${roM()}>Ikke samme vare</button></td></tr>`; }).join('')}</tbody></table><div class="small muted" style="margin-top:6px">Funnet automatisk ut fra varenavn, størrelse og strekkode.</div></div>` : ''}
    <div class="card grid" style="gap:12px"><h3>Innstillinger for varen</h3>
      <div class="grid g2"><label class="f">Pakningsstørrelse (minste bestilling)<input type="text" inputmode="decimal" id="iPack" value="${String(r.pack).replace('.',',')}"></label><label class="f">Holdbarhet (dager)<input type="text" inputmode="numeric" id="iShelf" value="${r.shelf??''}"></label></div>
      <label class="f">Manuelt forbruk per uke (${esc(r.unit)}) – tomt = automatisk<input type="text" inputmode="decimal" id="iMan" value="${r.manual!=null&&r.manual!==''?String(r.manual).replace('.',','):''}" placeholder="Bruk ved ny rett, event o.l."></label>
      <div class="grid g2"><label class="f">Kategori<select id="iCat">${catOptions(catOf(r).group, catOf(r).cat)}</select></label><label class="f">Lager<select id="iStor">${STORES.map(s=>`<option ${r.stor===s?'selected':''}>${s}</option>`).join('')}</select></label></div>
      <label class="row" style="gap:10px;font-weight:600"><input type="checkbox" id="iAct" ${r.active?'checked':''} style="width:22px;height:22px"> Aktiv i planlegging (får bestillingsforslag)</label>
      <div class="row" style="justify-content:flex-end">${r.custom?`<button class="btn danger" id="iDel" ${roM()}>Fjern vare</button>`:''}<button class="btn primary" id="iSave" ${roM()}>Lagre endringer</button></div></div>`;
  drawer(html, d => {
    bindCatStor(d, '#iCat', '#iStor');
    d.querySelector('#iSave').onclick = async () => {
      const cfg = JSON.parse(JSON.stringify(S.itemcfg || {ov:{}})); cfg.ov = cfg.ov || {};
      const o = cfg.ov[id] || (r.custom ? {} : {});
      o.pack = num(d.querySelector('#iPack').value) || 1; o.shelf = num(d.querySelector('#iShelf').value); const m = num(d.querySelector('#iMan').value); o.manual = m == null ? null : m;
      o.active = d.querySelector('#iAct').checked; o.stor = d.querySelector('#iStor').value; Object.assign(o, splitCat(d.querySelector('#iCat').value));
      cfg.ov[id] = {...(cfg.ov[id]||{}), ...o};
      await saveItemCfg(cfg); closeLayer(); toast('Varen er oppdatert.');
    };
    d.querySelectorAll('[data-notsame]').forEach(b => b.onclick = async () => { const cfg = JSON.parse(JSON.stringify(S.itemcfg || {ov:{}})); cfg.ov = cfg.ov || {}; const o = cfg.ov[id] || {}; o.notSame = [...new Set([...(o.notSame||[]), b.dataset.notsame])]; cfg.ov[id] = o; ALT_CACHE = null; await saveItemCfg(cfg); closeLayer(); toast('Koblingen er fjernet.'); });
    const del = d.querySelector('#iDel'); if (del) del.onclick = async () => { const cfg = JSON.parse(JSON.stringify(S.itemcfg)); cfg.ov[id].removed = true; await saveItemCfg(cfg); closeLayer(); };
  });
}
function newItemModal(){
  const set = SET();
  modal(`<h3>Ny vare</h3><div class="small muted">For nye retter eller nye produkter. Siden varen ikke har innkjøpshistorikk, må du anslå forbruk per uke.</div>
    <div class="grid g2"><label class="f">Leverandør<select id="nSup">${Object.keys(set.suppliers).map(c=>`<option translate="no" value="${esc(c)}">${esc(c)} – ${esc(set.suppliers[c].name)}</option>`).join('') || '<option value="">Legg til leverandør først</option>'}</select></label><label class="f">Varenummer<input type="text" id="nNo"></label></div>
    <label class="f">Varenavn (som på fakturaen)<input type="text" id="nName"></label>
    <div class="grid g2"><label class="f">Enhet<input type="text" id="nUnit" value="stk"></label><label class="f">Pris per enhet eks. mva<input type="text" inputmode="decimal" id="nPrice"></label></div>
    <div class="grid g2"><label class="f">Lager<select id="nStor">${STORES.map(s=>`<option>${s}</option>`).join('')}</select></label><label class="f">Kategori<select id="nCat">${catOptions('', '')}</select></label></div>
    <div class="grid g2"><label class="f">Forbruk per uke<input type="text" inputmode="decimal" id="nMan"></label><label class="f">Holdbarhet (dager)<input type="text" inputmode="numeric" id="nShelf" value="14"></label></div>
    <label class="f">Pakningsstørrelse<input type="text" inputmode="decimal" id="nPack" value="1"></label>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Avbryt</button><button class="btn primary" id="nOk">Legg til</button></div>`, m => {
    bindCatStor(m, '#nCat', '#nStor');
    m.querySelector('#nOk').onclick = async () => {
      const g = s => m.querySelector(s).value.trim(); const sup = g('#nSup'), no = g('#nNo'), name = g('#nName');
      if (!no || !name){ toast('Fyll inn varenummer og navn.'); return; }
      const id = sup + '-' + no.replace(/[^A-Za-z0-9]/g,'');
      if (getItems().find(i => i.id === id)){ toast('Varen finnes allerede.'); return; }
      const cfg = JSON.parse(JSON.stringify(S.itemcfg || {ov:{}})); cfg.ov = cfg.ov || {};
      cfg.ov[id] = {id, custom:true, sup, no, name:name.toUpperCase(), unit:g('#nUnit')||'stk', price:num(g('#nPrice'))||0, stor:g('#nStor'), ...splitCat(g('#nCat')), active: catStocked(splitCat(g('#nCat')).group), area:'Kjøkken', manual:num(g('#nMan')), shelf:num(g('#nShelf')), pack:num(g('#nPack'))||1, h100:0, b13:0, b6:0, ndel:0, last:null};
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
  h += `<div class="card grid" style="gap:14px"><div class="row between"><h3>Leverandører</h3><div class="row"><button class="btn sm" data-go="komigang" ${roM()}>Kom i gang-veiviser</button><button class="btn sm" id="catEdit">Kategorier</button><button class="btn sm" data-go="leverandorer">Kontaktinfo, kontonr. og adresser</button><button class="btn sm" id="supAdd" ${roM()}>+ Legg til leverandør</button></div></div>${Object.keys(set.suppliers).length ? '' : '<div class="muted">Ingen leverandører ennå.</div>'}${Object.keys(set.suppliers).map(c => { const s = set.suppliers[c]; return `<div class="grid" style="gap:10px;border-top:1px solid var(--line);padding-top:12px"><div class="row between"><b translate="no">${esc(s.name)} (${esc(c)})</b><span class="row"><span class="small muted">${itemsBySup[c]||0} varer</span>${itemsBySup[c] ? '' : `<button class="btn sm danger" data-supdel="${esc(c)}" ${roM()}>Fjern</button>`}</span></div>
      <div class="chips">${[1,2,3,4,5,6,0].map(d=>`<button class="chip ${s.wd&&s.wd.includes(d)?'on':''}" data-wd="${c}:${d}">${WD[d]}</button>`).join('')}<span class="small muted" style="align-self:center">leveringsdager</span></div>
      <div class="grid g3"><label class="f">Dager mellom leveranser<input type="text" inputmode="decimal" data-sp="${c}:interval" value="${String(s.interval).replace('.',',')}"></label><label class="f">Ledetid (dager)<input type="text" inputmode="decimal" data-sp="${c}:lead" value="${s.lead}"></label><label class="f">Sikkerhetsdager<input type="text" inputmode="decimal" data-sp="${c}:safety" value="${s.safety}"></label></div>
      <div class="grid g3"><label class="f">Leveringsdager (tekst)<input type="text" data-sp="${c}:days" value="${esc(s.days)}"></label><label class="f">Notat til den som bestiller<input type="text" data-sp="${c}:notes" value="${esc(s.notes)}"></label><label class="f">Org.nr (kobler fakturaer fra Tripletex)<input type="text" inputmode="numeric" data-sp="${c}:orgnr" value="${esc(s.orgnr||'')}"></label></div></div>`; }).join('')}</div>`;
  h += `<div class="card grid" style="gap:12px"><h3>Matsalg per uke (Tripletex 3000 + 3005)</h3><div class="small muted">Legg inn ny uke hver mandag. Snittet av de siste 4 ukene blir forventet salg når feltet over står tomt.</div>
    <div class="grid g3" style="align-items:end"><label class="f">Uke starter (mandag)<input type="date" id="wkFrom" value="${addDays(C.today, -((pd(C.today).getDay()+6)%7) - 7)}"></label><label class="f">Matsalg (kr eks. mva)<input type="text" inputmode="numeric" id="wkSales"></label><button class="btn" id="wkAdd">Legg til uke</button></div>
    <div class="tblwrap" style="max-height:300px"><table><thead><tr><th>Uke</th><th>Fra</th><th class="n">Matsalg</th><th></th></tr></thead><tbody>${weeks.map(w=>`<tr><td>${w.wk}</td><td>${fmtDL(w.from)}</td><td class="n">${kr(w.sales)}</td><td class="n"><button class="btn sm danger" data-wkdel="${w.from}">Slett</button></td></tr>`).join('')}</tbody></table></div></div>`;
  h += `<div class="row" style="justify-content:flex-end"><button class="btn primary lg" id="sSave" ${roM()}>Lagre innstillinger</button></div>`;
  if (MODE_API && S.canManage) h += `<div class="card grid" style="gap:12px" id="ttxCard"><h3>Tripletex</h3><div id="ttxBody" class="muted small">Henter status …</div></div>
    <div class="card grid" style="gap:12px" id="keysCard"><div class="row between"><h3>API-nøkler</h3><button class="btn sm" id="kAdd">+ Ny API-nøkkel</button></div><div class="small muted">For skannere, EDI og andre systemer som skal registrere fakturaer og pakksedler i Restoq. Se <a href="/api-dokumentasjon" target="_blank" rel="noopener">API-dokumentasjonen</a>.</div><div id="keysList" class="muted small">Henter …</div></div>`;
  if (MODE_API && S.canManage) h += `<div class="card grid" style="gap:12px" id="usersCard"><div class="row between"><h3>Brukere</h3><button class="btn sm" id="uAdd">+ Legg til ansatt</button></div><div class="small muted">Ansatte kan telle, bestille, ta imot varer og føre avskrivning. Administratorer kan i tillegg legge til og fjerne brukere, endre roller og endre innstillinger, varer, leverandører, logo og fakturaer. Det må alltid være minst én administrator.</div><div id="usersList" class="muted small">Henter brukere …</div></div>`;
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
  $('#supAdd').onclick = () => supplierEditModal(null, {});
  $('#catEdit').onclick = () => categoriesModal();
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
  const cur = () => ({...(S.brand||{}), accent:$('#bAccent').value, head:$('#bHead').value, logo});
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
  $('#bReset').onclick = () => confirmBox('Tilbakestille utseendet?', 'Logoen fjernes og fargene settes tilbake til standard.', 'Tilbakestill', async () => { await store.put('config','brand', {...(S.brand||{}), ...BRAND_DEFAULT}); render(); });
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
  modal(`<h3>Importer varer</h3><div class="small muted">Bruk Excel-malen, eller en Excel- eller CSV-fil med kolonnenavn i første rad. Kolonner: <b>Leverandør, Varenr, Navn</b> (påkrevd), Enhet, Pris, Lager (kjøl/frys/tørr/romtemp), Kategori, Pakning, Holdbarhet, Forbruk per uke. Finnes varen fra før (samme leverandør og varenr), oppdateres den.</div>
    <div class="row"><label class="btn primary" style="cursor:pointer">Velg fil<input type="file" id="impFile" accept=".xlsx,.csv,.txt,text/csv" class="hide"></label><a class="btn" href="/restoq-varemal.xlsx" download>Last ned mal (Excel)</a></div><div id="impRes"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Lukk</button><button class="btn primary hide" id="impOk">Importer</button></div>`, m => {
    let parsed = [];
    m.querySelector('#impFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; let rows; try { const sh = await readSheetFile(f); rows = (sh.find(s => s.name === 'Varer') || sh[0] || {rows:[]}).rows; } catch(err){ m.querySelector('#impRes').innerHTML = `<div class="note bad">${esc(err.message)}</div>`; return; } const g0 = wzGuess(rows); rows = rows.slice(g0.headRow); if (rows.length < 2){ m.querySelector('#impRes').innerHTML = '<div class="note bad">Fant ingen rader.</div>'; return; }
      const head = rows[0].map(h => h.trim().toLowerCase()); const idx = {}; IMPORT_COLS.forEach(([k, names]) => { const i = head.findIndex(h => names.includes(h)); if (i >= 0) idx[k] = i; });
      if (idx.sup == null || idx.no == null || idx.name == null){ m.querySelector('#impRes').innerHTML = '<div class="note bad">Fant ikke kolonnene Leverandør, Varenr og Navn i første rad.</div>'; return; }
      const g = (r,k) => idx[k] != null ? (r[idx[k]]||'').trim() : '';
      parsed = rows.slice(1).map(r => ({sup:g(r,'sup').toUpperCase(), no:g(r,'no'), name:g(r,'name'), unit:g(r,'unit')||'stk', price:num(g(r,'price'))||0, stor:normStore(g(r,'stor')), ...wzCatFrom(g(r,'cat'), g(r,'name'), g(r,'stor')), pack:num(g(r,'pack'))||1, shelf:num(g(r,'shelf')), manual:num(g(r,'manual'))})).filter(x => x.sup && x.no && x.name && !/^EKSEMPEL\b/i.test(x.name));
      const sups = [...new Set(parsed.map(x => x.sup))]; const missing = sups.filter(s => !SET().suppliers[s]);
      m.querySelector('#impRes').innerHTML = `<div class="note good">${parsed.length} varer klare fra ${sups.length} leverandør${sups.length>1?'er':''}.${missing.length ? ' Nye leverandører opprettes: '+esc(missing.join(', '))+' (sjekk leveringsdager under Innstillinger etterpå).' : ''}</div>`;
      m.querySelector('#impOk').classList.toggle('hide', !parsed.length); };
    m.querySelector('#impOk').onclick = async () => {
      const set = JSON.parse(JSON.stringify(SET())); let newSup = false;
      parsed.forEach(x => { if (!set.suppliers[x.sup]){ set.suppliers[x.sup] = {name:x.sup, wd:[], days:'Etter avtale', interval:7, lead:1, safety:2, notes:'', fees:''}; newSup = true; } });
      if (newSup) await saveSettings(set);
      const cfg = JSON.parse(JSON.stringify(S.itemcfg || {ov:{}})); cfg.ov = cfg.ov || {};
      parsed.forEach(x => { const id = x.sup + '-' + x.no.replace(/[^A-Za-z0-9]/g,''); const prev = cfg.ov[id] || {}; cfg.ov[id] = {...prev, id, custom:true, removed:false, sup:x.sup, no:x.no, name:x.name, unit:x.unit, price:x.price, stor:x.stor, group:x.group, cat:x.cat, area:prev.area||'Kjøkken', pack:x.pack, shelf:x.shelf, manual: x.manual ?? prev.manual ?? null, active: prev.active ?? true, h100: prev.h100 || 0, b13: prev.b13 || 0, b6: prev.b6 || 0}; });
      await saveItemCfg(cfg); closeModal(); toast(`${parsed.length} varer er importert.`);
    };
  });
}
let WZ_EDITS = {};
/* ===== Kom i gang-veiviser ===== */
const WZ_COLS = [...IMPORT_COLS, ['qty',['beholdning (antall)','antall','beholdning','på lager','telling','talt','lagerbeholdning','qty','quantity','stock','antall på lager']], ['exp',['utløp','utløpsdato','best før','holdbar til','expiry']]];
const WZ_FIELDS = [['', '– ikke bruk –'], ['sup','Leverandør'], ['no','Varenr.'], ['name','Varenavn'], ['unit','Enhet'], ['price','Pris per enhet'], ['stor','Lager'], ['cat','Kategori'], ['pack','Pakning'], ['shelf','Holdbarhet (dager)'], ['manual','Forbruk per uke'], ['qty','Beholdning (antall)'], ['exp','Utløpsdato']];
let WZ = null;
function wzReset(){ WZ_EDITS = {}; WZ = {step: 1, sheet: null, map: {}, defSup: '', newSups: [], invoices: [], rows: [], countMode: 'sheet', countDate: C.today, regInvoices: false, result: null}; }
async function readSheetFile(f){
  if (/\.xlsx$/i.test(f.name)){
    const fd = new FormData(); fd.append('file', f);
    const res = await fetch('/api/import/sheet', {method:'POST', body:fd, credentials:'same-origin'}); const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'Kunne ikke lese filen.');
    return j.sheets;
  }
  return [{name: f.name, rows: parseCsv(await f.text())}];
}
/** Finn overskriftsraden (første rad med en navnekolonne) og foreslå kolonner. */
function wzGuess(rows){
  for (let r = 0; r < Math.min(rows.length, 15); r++){
    const head = rows[r].map(h => String(h||'').trim().toLowerCase());
    const map = {}; WZ_COLS.forEach(([k, names]) => { const i = head.findIndex(h => names.includes(h)); if (i >= 0 && !Object.values(map).includes(i)) map[k] = i; });
    if (map.name != null) return {headRow: r, map};
  }
  return {headRow: 0, map: {}};
}
const supNorm = s => normName(s).replace(/\b(AS|ASA|AB|DA|ANS|NORGE|NORWAY)\b/g,'').replace(/\s+/g,' ').trim();
const sameSupName = (a, b) => { const x = supNorm(a), y = supNorm(b); return !!x && !!y && (x === y || (Math.min(x.length, y.length) > 3 && (x.includes(y) || y.includes(x)))); };
/** Leverandør i lista: kode (SG) eller navn. Ukjent navn blir ny leverandør. */
function wzSupFor(val){
  const v = String(val || '').trim(); if (!v) return '';
  const set = SET(); if (set.suppliers[v.toUpperCase()]) return v.toUpperCase();
  const nv = normName(v).replace(/\b(AS|ASA|AB|DA|ANS)\b/g,'').trim();
  const c = Object.keys(set.suppliers).find(c => { const s = normName(set.suppliers[c].name).replace(/\b(AS|ASA|AB|DA|ANS)\b/g,'').trim(); return s === nv || (nv.length > 3 && (s.includes(nv) || nv.includes(s))); }); if (c) return c;
  const n = WZ.newSups.find(n => sameSupName(n.sup.name, v)); if (n) return n.code;
  let code = suggestCode(v); while (WZ.newSups.some(n => n.code === code)) code = code.slice(0,3) + (WZ.newSups.length + 1);
  WZ.newSups.push({code, sup: {name: v, orgnr:'', wd:[], days:'Etter avtale', interval:7, lead:1, safety:2, notes:'', fees:'', contacts:[]}, fromSheet: true}); return code;
}
/** Kategori fra lista: «Mat › Fryst», «Mat/Fryst», «Fryst» eller fritekst. */
function wzCatFrom(cat, name, stor){
  const parts = String(cat || '').split(/\s*[›>\/]\s*/).filter(Boolean);
  if (parts.length === 2){ const g = CATS().find(x => x.name.toLowerCase() === parts[0].toLowerCase()); const s = g && g.subs.find(x => x.name.toLowerCase() === parts[1].toLowerCase()); if (s) return {group: g.name, cat: s.name}; }
  return guessCat((cat || '') + ' ' + (name || ''), normStore(stor || cat));
}
function wzSheetRows(){
  const s = WZ.sheet; if (!s) return [];
  const rows = s.sheets[s.idx].rows.slice(s.headRow + 1); const m = WZ.map;
  const g = (r, k) => m[k] != null && m[k] !== '' ? String(r[m[k]] ?? '').trim() : '';
  return rows.map(r => ({src:'liste', sup: wzSupFor(g(r,'sup')) || WZ.defSup || '', no: g(r,'no'), name: g(r,'name'), unit: g(r,'unit') || 'stk', price: num(g(r,'price')) || 0, stor: normStore(g(r,'stor') || g(r,'cat')), ...wzCatFrom(g(r,'cat'), g(r,'name'), g(r,'stor')), pack: num(g(r,'pack')) || 1, shelf: num(g(r,'shelf')), manual: num(g(r,'manual')), qty: num(g(r,'qty')), exp: /^\d{4}-\d{2}-\d{2}$/.test(g(r,'exp')) ? g(r,'exp') : null})).filter(x => x.name && !/^EKSEMPEL\b/i.test(x.name));
}
/** Slår sammen kandidater fra liste og fakturaer, og markerer varer som finnes. */
function wzBuildRows(){
  const items = getItems(); const out = []; const seen = new Map();
  const add = x => {
    const supCode = x.sup;
    const key = supCode + '|' + (x.no ? normNo(x.no) : 'N:' + normName(x.name));
    const ex = items.find(i => i.sup === supCode && ((x.no && normNo(i.no) === normNo(x.no)) || normName(i.name) === normName(x.name)));
    if (seen.has(key)){ const o = seen.get(key); if (x.qty != null) o.qty = (o.qty || 0) + x.qty; if (x.src !== o.src) o.src = 'begge'; if (x.price && x.srcDate >= (o.srcDate || '')) { o.price = x.price; o.srcDate = x.srcDate; } return; }
    const fee = FEE_RE.test(x.name || '') || (x.price || 0) < 0;
    const row = {...x, id: out.length, ex: ex || null, on: !ex && !fee && !!supCode, fee};
    seen.set(key, row); out.push(row);
  };
  wzSheetRows().forEach(add);
  WZ.invoices.filter(v => v.inv).forEach(v => { const sup = v.supCode; v.inv.lines.forEach(l => add({src:'faktura', srcDate: v.inv.invoiceDate || '', srcName: v.inv.invoiceNo, sup, no: l.itemNo || '', name: (l.description || '').toUpperCase(), unit: (l.unit || 'stk').toLowerCase(), price: l.unitPrice ?? (l.qty ? (l.lineTotal || 0) / l.qty : 0), stor: l.storage || normStore(l.category), ...guessCat((l.category || '') + ' ' + (l.description || ''), l.storage), pack: 1, shelf: l.shelfDays ?? null, gtin: l.gtin || '', qty: null})); });
  WZ.rows = out;
}
async function wzReadInvoices(files){
      for (const f of files){
        const v = {name: f.name, busy: true}; WZ.invoices.push(v); render();
        try {
          if (f.size > 10*1024*1024) throw new Error('Større enn 10 MB');
          const fd = new FormData(); fd.append('file', f);
          const up = await fetch('/api/files', {method:'POST', body:fd, credentials:'same-origin'}); const uj = await up.json().catch(() => ({})); if (!up.ok) throw new Error(uj.error || 'Opplasting feilet');
          v.fileId = uj.id; v.inv = await readInvoiceFile(uj.id);
          const m = matchSupplier(SET(), v.inv);
          if (m) v.supCode = m;
          else { const same = WZ.newSups.find(n => (v.inv.supplierOrgNo && n.sup.orgnr === v.inv.supplierOrgNo.replace(/\D/g,'')) || sameSupName(n.sup.name, v.inv.supplierName)); if (same){ v.supCode = same.code; const fi = supFromInvoice(v.inv); Object.keys(fi).forEach(k => { if (!same.sup[k] || (Array.isArray(same.sup[k]) && !same.sup[k].length)) same.sup[k] = fi[k]; }); if (same.fromSheet) same.sup.name = v.inv.supplierName || same.sup.name; } else if (v.inv.supplierName){ const sup = {...supFromInvoice(v.inv), wd:[], days:'Etter avtale', interval:7, lead:1, safety:2, notes:'', fees:''}; let code = suggestCode(sup.name); while (WZ.newSups.some(n => n.code === code)) code = code.slice(0,3) + Math.floor(Math.random()*9+1); WZ.newSups.push({code, sup}); v.supCode = code; } else v.supCode = ''; }
        } catch(err){ v.err = err.message || 'Kunne ikke lese'; }
        v.busy = false; render();
      }
}
function vKomigang(){
  if (!WZ) wzReset();
  if (!S.canManage){ $('#view').innerHTML = `<div class="card"><h2>Kom i gang</h2><div class="muted">Det er administrator hos dere som legger inn leverandører og varer. Når det er gjort, kan du telle og bestille.</div></div>`; return; }
  const set = SET(); const steps = ['Leverandører', 'Varer', 'Beholdning', 'Ferdig'];
  let h = `<div class="row between"><div><h2>Kom i gang</h2><div class="muted">Legg inn leverandører og varer fra vareliste og/eller fakturaer. Du velger selv hvilke varer som tas med, og om beholdningen skal legges inn nå.</div></div><button class="btn" data-go="oversikt">Lukk</button></div>
    <ol class="wzsteps">${steps.map((s, i) => `<li class="${WZ.step === i+1 ? 'on' : WZ.step > i+1 ? 'done' : ''}"><span>${WZ.step > i+1 ? '✓' : i+1}</span>${s}</li>`).join('')}</ol>`;
  if (WZ.step === 1){
    const codes = Object.keys(set.suppliers);
    h += `<div class="card grid" style="gap:12px"><h3>1. Leverandører</h3><div class="small muted">Legg inn leverandørene dere handler fra. Laster du opp fakturaer i neste steg, kan nye leverandører opprettes derfra med kontonummer og kontaktinfo – da kan du hoppe over dette.</div>
      ${codes.length ? `<div class="chips">${codes.map(c => `<button class="chip" data-supedit="${esc(c)}" translate="no">${esc(set.suppliers[c].name)}</button>`).join('')}</div>` : '<div class="empty" style="padding:10px">Ingen leverandører ennå.</div>'}
      <div class="row"><button class="btn" id="wzSupNew">+ Ny leverandør</button>${S.features?.readInvoice ? `<label class="btn" style="cursor:pointer">📎 Les leverandør fra faktura<input type="file" id="wzInv1" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp,.xml" multiple class="hide"></label>` : ''}</div>
      <div class="small muted">${S.features?.readInvoice ? 'Last opp en eller flere fakturaer, så leser Restoq navn, org.nr., adresse, kontonummer og kontaktperson. Varelinjene fra fakturaene følger med til neste steg.' : ''}</div>
      ${(() => { const pend = WZ.newSups.filter(n => !n.fromSheet); const known = WZ.invoices.filter(v => v.inv && SET().suppliers[v.supCode]); return (pend.length || known.length || WZ.invoices.some(v => v.busy || v.err)) ? `<div class="grid" style="gap:8px">${WZ.invoices.filter(v => v.busy || v.err).map(v => `<div class="wzinv small"><b translate="no">${esc(v.name)}</b> – ${v.busy ? '<span class="spin"></span> leser …' : `<span style="color:var(--red)">${esc(v.err)}</span>`}</div>`).join('')}${pend.map(n => `<div class="wzinv"><div class="row between"><div><b translate="no">${esc(n.sup.name)}</b> <span class="pill p-tell">ny</span><div class="small muted" translate="no">${[n.sup.orgnr && 'org.nr. ' + fmtOrg(n.sup.orgnr), n.sup.bank && 'konto ' + fmtKonto(n.sup.bank), [n.sup.address, n.sup.city].filter(Boolean).join(', '), n.sup.email].filter(Boolean).map(esc).join(' · ') || 'Ingen detaljer funnet'}</div></div><button class="btn sm" data-wzsupreview="${esc(n.code)}">Se over og opprett</button></div></div>`).join('')}${known.map(v => `<div class="wzinv small"><b translate="no">${esc(SET().suppliers[v.supCode].name)}</b> – finnes allerede <span class="muted" translate="no">(${esc(v.name)})</span></div>`).join('')}${pend.length > 1 ? '<div><button class="btn sm primary" id="wzSupAll">Opprett alle nye</button></div>' : ''}</div>` : ''; })()}</div>
    <div class="card grid" style="gap:10px"><div class="row between"><h3>Kategorier for innkjøp</h3><button class="btn sm" id="wzCats">Tilpass kategorier</button></div><div class="small muted">Varene sorteres i hovedkategorier og underkategorier. Restoq foreslår kategori for hver vare. Standardoppsettet:</div>
      <div class="catchips">${CATS().map(g => `<div><b>${esc(g.name)}</b>${g.stocked === false ? ' <span class="pill p-behov">telles ikke</span>' : ''}<div class="small muted">${g.subs.map(s => esc(s.name)).join(' · ')}</div></div>`).join('')}</div></div>
      <div class="row" style="justify-content:flex-end"><button class="btn primary lg" id="wzNext">Neste: varer</button></div>`;
  }
  if (WZ.step === 2){
    const s = WZ.sheet;
    h += `<div class="grid g2" style="align-items:start">
      <div class="card grid" style="gap:10px"><h3>Vareliste eller lagerliste</h3><div class="small muted">Excel (.xlsx) eller CSV med én vare per rad. Har lista antall på lager, kan de brukes som første telling i neste steg. <a href="/restoq-varemal.xlsx" download>Last ned Excel-mal</a></div>
        <div class="row"><label class="btn ${s ? '' : 'primary'}" style="cursor:pointer">📄 Velg fil<input type="file" id="wzSheet" accept=".xlsx,.csv,.txt" class="hide"></label><span class="small muted" translate="no">${s ? esc(s.file) : ''}</span>${s ? '<button class="btn sm" id="wzSheetDel">Fjern</button>' : ''}</div>
        ${s ? `${s.sheets.length > 1 ? `<label class="f">Ark<select id="wzSheetIdx">${s.sheets.map((x, i) => `<option value="${i}" ${i === s.idx ? 'selected' : ''} translate="no">${esc(x.name)}</option>`).join('')}</select></label>` : ''}
          <div class="small" style="font-weight:600">Kolonner (sjekk at de stemmer)</div>
          <div class="wzmap">${(s.sheets[s.idx].rows[s.headRow] || []).map((hd, i) => `<label class="f"><span translate="no">${esc(hd || 'Kolonne ' + (i+1))}</span><select data-wzcol="${i}">${WZ_FIELDS.map(([k, l]) => `<option value="${k}" ${String(Object.keys(WZ.map).find(f => WZ.map[f] === i) || '') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`).join('')}</div>
          ${WZ.map.sup == null ? `<label class="f">Leverandør for alle varene i lista<select id="wzDefSup"><option value="">– velg –</option>${Object.keys(set.suppliers).map(c => `<option value="${esc(c)}" translate="no" ${WZ.defSup === c ? 'selected' : ''}>${esc(c)} – ${esc(set.suppliers[c].name)}</option>`).join('')}</select><span class="small" style="font-weight:400">Lista har ingen leverandørkolonne. Mangler leverandøren, oppretter du den i steg 1.</span></label>` : ''}
          <div class="small muted">${wzSheetRows().length} varer funnet${wzSheetRows().some(r => r.qty != null) ? `, ${wzSheetRows().filter(r => r.qty != null).length} med antall` : ''}.</div>` : ''}
      </div>
      <div class="card grid" style="gap:10px"><h3>Leverandørfakturaer</h3><div class="small muted">${S.features?.readInvoice ? 'Last opp én eller flere fakturaer (PDF, bilde eller EHF). Restoq leser varelinjer og priser, og finner leverandøren – eller foreslår å opprette den.' : 'Automatisk lesing av fakturaer er ikke satt opp (ANTHROPIC_API_KEY). Bruk varelista, eller legg inn varer manuelt.'}</div>
        ${S.features?.readInvoice ? `<div class="row"><label class="btn ${WZ.invoices.length ? '' : 'primary'}" style="cursor:pointer">📎 Velg fakturaer<input type="file" id="wzInv" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp,.xml" multiple class="hide"></label></div>` : ''}
        ${WZ.invoices.map((v, i) => `<div class="wzinv"><div class="row between"><b translate="no">${esc(v.name)}</b>${v.busy ? '<span class="small"><span class="spin"></span> Leser …</span>' : v.err ? `<span class="small" style="color:var(--red)">${esc(v.err)}</span>` : `<span class="small muted">${v.inv.lines.length} linjer${v.inv.invoiceDate ? ' · ' + fmtDL(v.inv.invoiceDate) : ''}</span>`}</div>
          ${v.inv ? `<label class="f" style="margin-top:6px">Leverandør${v.inv.supplierName ? ` <span style="font-weight:400">(på fakturaen: <span translate="no">${esc(v.inv.supplierName)}</span>${v.inv.supplierOrgNo ? ' · ' + esc(fmtOrg(v.inv.supplierOrgNo)) : ''})</span>` : ''}<select data-wzsup="${i}">${!matchSupplier(set, v.inv) && v.inv.supplierName ? `<option value="__new" ${v.supCode === '__new' ? 'selected' : ''}>+ Opprett ny: ${esc(v.inv.supplierName)}</option>` : ''}${Object.keys(set.suppliers).map(c => `<option value="${esc(c)}" translate="no" ${v.supCode === c ? 'selected' : ''}>${esc(c)} – ${esc(set.suppliers[c].name)}</option>`).join('')}${WZ.newSups.map(n => `<option value="${esc(n.code)}" translate="no" ${v.supCode === n.code ? 'selected' : ''}>${esc(n.code)} – ${esc(n.sup.name)} (ny)</option>`).join('')}</select></label>` : ''}</div>`).join('')}
      </div></div>`;
    wzBuildRows();
    const R = WZ.rows; const nOn = R.filter(r => r.on).length;
    if (R.length){
      h += `<div class="card flush"><div class="row between" style="padding:14px 16px 6px"><div><h3>Velg varer som skal legges inn</h3><div class="small muted">${R.length} linjer · ${nOn} valgt · ${R.filter(r => r.ex).length} finnes allerede (ikke valgt). Frakt, pant og gebyrer er ikke valgt.</div></div><div class="row"><button class="btn sm" id="wzAll">Velg alle nye</button><button class="btn sm" id="wzNone">Fjern alle</button></div></div>
        <div class="tblwrap" style="max-height:480px"><table class="rvtbl"><thead><tr><th></th><th>Kilde</th><th>Lev.</th><th>Varenr</th><th>Navn</th><th>Enhet</th><th class="n">Pris</th><th>Lager</th><th>Kategori</th><th class="n">Antall</th></tr></thead><tbody>${R.map(r => `<tr data-wzr="${r.id}" class="${r.on ? '' : 'off'}"><td><input type="checkbox" class="wz-on" ${r.on ? 'checked' : ''} ${r.sup ? '' : 'disabled'} style="width:20px;height:20px"></td><td class="small">${r.src === 'liste' ? 'Liste' : r.src === 'begge' ? 'Liste + faktura' : 'Faktura'}</td><td class="small" translate="no">${esc(r.sup || '–')}${WZ.newSups.some(n => n.code === r.sup) ? ' <span class="pill p-tell">ny</span>' : ''}</td><td><input class="wz-no" value="${esc(r.no)}" style="width:86px"></td><td><input class="wz-name" value="${esc(r.name)}" style="min-width:190px">${r.ex ? `<div class="isub">Finnes: <span translate="no">${esc(r.ex.name)}</span>${r.price && Math.abs(r.price - r.ex.price) > Math.max(0.01, r.ex.price * 0.005) ? ` · pris ${kr(r.ex.price)} → <b>${kr(r.price)}</b>` : ''}</div>` : ''}</td><td><input class="wz-unit" value="${esc(r.unit)}" style="width:56px"></td><td><input class="wz-price" inputmode="decimal" value="${r.price ? String(Math.round(r.price*100)/100).replace('.',',') : ''}" style="width:76px;text-align:right"></td><td><select class="wz-stor">${STORES.map(s => `<option ${r.stor === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td><td><select class="wz-cat">${catOptions(r.group, r.cat)}</select></td><td class="n">${r.qty != null ? q(r.qty) : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
    }
    h += `<div class="row between"><button class="btn" id="wzBack">Tilbake</button><div class="row"><span class="small muted">${R.length ? '' : 'Du kan også hoppe over og legge inn varer senere.'}</span><button class="btn primary lg" id="wzNext" ${WZ.invoices.some(v => v.busy) ? 'disabled' : ''}>${R.length ? 'Neste: beholdning' : 'Hopp over'}</button></div></div>`;
  }
  if (WZ.step === 3){
    const sel = WZ.rows.filter(r => r.on || r.ex); const withQty = WZ.rows.filter(r => (r.on || r.ex) && r.qty != null);
    const nNew = WZ.rows.filter(r => r.on && !r.ex).length, nUpd = WZ.rows.filter(r => r.on && r.ex).length;
    h += `<div class="card grid" style="gap:12px"><h3>3. Beholdning</h3>
      <div>${nNew} nye varer${nUpd ? ` og ${nUpd} varer med ny pris` : ''} legges inn${wzNewSupsUsed().length ? `, og ${wzNewSupsUsed().length} nye leverandører opprettes (<span translate="no">${esc(wzNewSupsUsed().map(n => n.sup.name).join(', '))}</span>)` : ''}.</div>
      ${withQty.length ? `<div class="grid" style="gap:8px">
        <label class="wzopt"><input type="radio" name="wzc" value="sheet" ${WZ.countMode === 'sheet' ? 'checked' : ''}><div><b>Bruk antallene fra lista som første varetelling</b><div class="small muted">${withQty.length} varer har antall. Varer uten antall regnes som ikke talt. Appen kan da regne ut beholdning og forslag med en gang.</div><label class="f" style="max-width:220px;margin-top:6px">Tellingsdato<input type="date" id="wzDate" value="${WZ.countDate}"></label></div></label>
        <label class="wzopt"><input type="radio" name="wzc" value="none" ${WZ.countMode === 'none' ? 'checked' : ''}><div><b>Ikke legg inn beholdning nå</b><div class="small muted">Bare varene opprettes. Dere teller varelageret senere under Varetelling.</div></div></label></div>`
        : `<div class="note info small"><div>Ingen av varene har antall, så beholdningen legges ikke inn nå. Dere teller varelageret under Varetelling når varene er på plass.</div></div>`}
      ${WZ.invoices.some(v => v.inv) ? `<label class="row small" style="gap:8px"><input type="checkbox" id="wzReg" ${WZ.regInvoices ? 'checked' : ''} style="width:20px;height:20px"> Registrer også fakturaene under Faktura for kontroll og godkjenning (la stå av hvis de allerede er betalt og bokført)</label>` : ''}
    </div>
    <div class="row between"><button class="btn" id="wzBack">Tilbake</button><button class="btn primary lg" id="wzRun">Legg inn</button></div>`;
  }
  if (WZ.step === 4){
    const r = WZ.result || {};
    h += `<div class="card grid" style="gap:10px"><h3>✓ Ferdig</h3><ul class="wtips">${[r.sups ? `${r.sups} nye leverandører` : '', r.items ? `${r.items} nye varer` : '', r.prices ? `${r.prices} varer fikk ny pris` : '', r.counted ? `Første telling er lagt inn med ${r.counted} varer` : 'Beholdning er ikke lagt inn', r.invs ? `${r.invs} fakturaer registrert for kontroll` : ''].filter(Boolean).map(x => `<li>${x}</li>`).join('')}</ul>
      <h3 style="margin-top:8px">Neste steg</h3><div class="row">${r.counted ? '' : '<button class="btn primary" data-go="telling">Tell varelageret</button>'}<button class="btn" data-go="oppsett">Bestillingsfrekvens, forventet salg og ansatte</button><button class="btn" data-go="leverandorer">Leverandører</button><button class="btn" data-go="oversikt">Til oversikten</button></div></div>`;
  }
  $('#view').innerHTML = h;
  document.querySelectorAll('#view [data-go]').forEach(b => b.onclick = () => { if (WZ.step === 4) wzReset(); go(b.dataset.go); });
  const nx = $('#wzNext'); if (nx) nx.onclick = () => { if (WZ.step === 2) wzReadTable(); WZ.step++; render(); $('#main').scrollTop = 0; };
  const bk = $('#wzBack'); if (bk) bk.onclick = () => { if (WZ.step === 2) wzReadTable(); WZ.step--; render(); };
  if (WZ.step === 1){
    $('#wzSupNew').onclick = () => supplierEditModal(null, {}, () => render());
    $('#wzCats').onclick = () => categoriesModal(() => render());
    const f1 = $('#wzInv1'); if (f1) f1.onchange = e => wzReadInvoices([...e.target.files].slice(0, 20));
    const adopt = (oldCode, newCode) => { WZ.newSups = WZ.newSups.filter(n => n.code !== oldCode); WZ.invoices.forEach(v => { if (v.supCode === oldCode) v.supCode = newCode; }); };
    document.querySelectorAll('[data-wzsupreview]').forEach(b => b.onclick = () => { const n = WZ.newSups.find(x => x.code === b.dataset.wzsupreview); supplierEditModal(null, n.sup, code => { adopt(n.code, code); render(); }); });
    const sa = $('#wzSupAll'); if (sa) sa.onclick = async () => { sa.disabled = true; const set = JSON.parse(JSON.stringify(SET())); const map = []; WZ.newSups.filter(n => !n.fromSheet).forEach(n => { let c = n.code; while (set.suppliers[c]) c = c.slice(0,3) + Math.floor(Math.random()*9+1); set.suppliers[c] = n.sup; map.push([n.code, c]); }); await saveSettings(set); map.forEach(([o, c]) => adopt(o, c)); toast(`${map.length} leverandører er opprettet.`); render(); };
    document.querySelectorAll('[data-supedit]').forEach(b => b.onclick = () => supplierEditModal(b.dataset.supedit, null, () => render()));
  }
  if (WZ.step === 2){
    const sf = $('#wzSheet'); if (sf) sf.onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const sheets = await readSheetFile(f); if (!sheets.length) throw new Error('Fant ingen rader i filen.'); const idx = Math.max(0, sheets.findIndex(s => s.name === 'Varer')); const g = wzGuess(sheets[idx].rows); WZ.sheet = {file: f.name, sheets, idx, headRow: g.headRow}; WZ.map = g.map; if (g.map.name == null) toast('Fant ikke kolonnen for varenavn. Velg kolonnene under.'); } catch(err){ toast(err.message || 'Kunne ikke lese filen.'); } render(); };
    const sd = $('#wzSheetDel'); if (sd) sd.onclick = () => { WZ.sheet = null; WZ.map = {}; render(); };
    const si = $('#wzSheetIdx'); if (si) si.onchange = () => { WZ.sheet.idx = +si.value; const g = wzGuess(WZ.sheet.sheets[WZ.sheet.idx].rows); WZ.sheet.headRow = g.headRow; WZ.map = g.map; render(); };
    document.querySelectorAll('[data-wzcol]').forEach(sel => sel.onchange = () => { const i = +sel.dataset.wzcol; Object.keys(WZ.map).forEach(k => { if (WZ.map[k] === i) delete WZ.map[k]; }); if (sel.value){ WZ.map[sel.value] = i; } wzReadTable(); render(); });
    const ds = $('#wzDefSup'); if (ds) ds.onchange = () => { wzReadTable(); WZ.defSup = ds.value; render(); };
    const fi = $('#wzInv'); if (fi) fi.onchange = e => { wzReadTable(); wzReadInvoices([...e.target.files].slice(0, 20)); };
    document.querySelectorAll('[data-wzsup]').forEach(sel => sel.onchange = () => { wzReadTable(); const v = WZ.invoices[+sel.dataset.wzsup]; if (sel.value === '__new'){ const n = WZ.newSups.find(n => normName(n.sup.name) === normName(v.inv.supplierName)); v.supCode = n ? n.code : ''; } else v.supCode = sel.value; render(); });
    document.querySelectorAll('tr[data-wzr] .wz-on').forEach(cb => cb.onchange = () => { const r = WZ.rows[+cb.closest('tr').dataset.wzr]; r.on = cb.checked; cb.closest('tr').classList.toggle('off', !cb.checked); });
    const all = $('#wzAll'); if (all) all.onclick = () => { wzReadTable(); WZ.rows.forEach(r => { if (!r.ex && !r.fee && r.sup) r.on = true; }); wzKeep(); render(); };
    const none = $('#wzNone'); if (none) none.onclick = () => { wzReadTable(); WZ.rows.forEach(r => r.on = false); wzKeep(); render(); };
  }
  if (WZ.step === 3){
    document.querySelectorAll('input[name=wzc]').forEach(r => r.onchange = () => { WZ.countMode = r.value; });
    const dt = $('#wzDate'); if (dt) dt.onchange = () => { WZ.countDate = dt.value || C.today; };
    const rg = $('#wzReg'); if (rg) rg.onchange = () => { WZ.regInvoices = rg.checked; };
    $('#wzRun').onclick = wzRun;
  }
}
// Rader i tabellen bygges på nytt ved hver visning; brukerens valg og rettelser huskes per nøkkel.

const wzKey = r => r.sup + '|' + (r.no ? normNo(r.no) : 'N:' + normName(r.name));
function wzReadTable(){
  document.querySelectorAll('tr[data-wzr]').forEach(tr => { const r = WZ.rows[+tr.dataset.wzr]; if (!r) return; const g = c => tr.querySelector(c).value.trim();
    WZ_EDITS[r.key0 || wzKey(r)] = {on: tr.querySelector('.wz-on').checked, no: g('.wz-no'), name: g('.wz-name'), unit: g('.wz-unit'), price: num(g('.wz-price')) ?? r.price, stor: g('.wz-stor'), ...splitCat(tr.querySelector('.wz-cat').value)}; });
}
function wzKeep(){ WZ.rows.forEach(r => { WZ_EDITS[r.key0 || wzKey(r)] = {...(WZ_EDITS[r.key0 || wzKey(r)] || {}), on: r.on}; }); }
const _wzBuild = wzBuildRows;
wzBuildRows = function(){ _wzBuild(); WZ.rows.forEach(r => { r.key0 = wzKey(r); const e = WZ_EDITS[r.key0]; if (e) Object.assign(r, e); if (!r.sup) r.on = false; }); };
const wzNewSupsUsed = () => WZ.newSups.filter(n => WZ.invoices.some(v => v.supCode === n.code) || WZ.rows.some(r => r.on && r.sup === n.code));
async function wzRun(){
  const b = $('#wzRun'); b.disabled = true; b.textContent = 'Legger inn …';
  try {
    const set = JSON.parse(JSON.stringify(SET())); let sups = 0;
    const used = new Set([...WZ.invoices.map(v => v.supCode), ...WZ.rows.filter(r => r.on).map(r => r.sup)]);
    WZ.newSups.forEach(n => { if (used.has(n.code) && !set.suppliers[n.code]){ set.suppliers[n.code] = n.sup; sups++; } });
    if (sups) await saveSettings(set);
    const cfg = JSON.parse(JSON.stringify(S.itemcfg || {ov:{}})); cfg.ov = cfg.ov || {};
    let items = 0, prices = 0; const idFor = {};
    WZ.rows.forEach(r => {
      if (r.ex){ idFor[r.id] = r.ex.id; if (r.on && r.price && Math.abs(r.price - r.ex.price) > Math.max(0.01, r.ex.price * 0.005)){ const o = cfg.ov[r.ex.id] || {}; cfg.ov[r.ex.id] = {...o, price: Math.round(r.price*100)/100, priceHist: [...(o.priceHist || [{d:'', p:r.ex.price}]), {d: r.srcDate || C.today, p: Math.round(r.price*100)/100, inv: r.srcName || ''}].slice(-12)}; prices++; } return; }
      if (!r.on || !r.sup || !r.name) return;
      const no = r.no || normName(r.name).replace(/\s/g,'').slice(0,14);
      const id = r.sup + '-' + no.replace(/[^A-Za-z0-9]/g,'');
      const prev = cfg.ov[id] || {};
      cfg.ov[id] = {...prev, id, custom:true, removed:false, sup:r.sup, no, name:r.name, unit:r.unit || 'stk', price: Math.round((r.price || 0)*100)/100, stor:r.stor, group: r.group || '', cat:r.cat || 'Annet', area: prev.area || 'Kjøkken', pack: r.pack || 1, shelf: r.shelf ?? null, manual: r.manual ?? prev.manual ?? null, active: catStocked(r.group), h100:0, b13:0, b6:0, ndel:0, last: r.srcDate || null, gtin: r.gtin || '', source: r.src === 'liste' ? 'import' : 'faktura', priceHist: r.price ? [{d: r.srcDate || C.today, p: Math.round(r.price*100)/100, inv: r.srcName || ''}] : []};
      idFor[r.id] = id; items++;
    });
    if (items || prices) await saveItemCfg(cfg);
    let counted = 0;
    if (WZ.countMode === 'sheet'){
      const lines = {}; WZ.rows.forEach(r => { const id = idFor[r.id]; if (id && r.qty != null && (r.on || r.ex)){ lines[id] = {q: r.qty, ...(r.exp ? {exp: r.exp} : {})}; counted++; } });
      if (counted) await store.put('counts', uid(), {date: WZ.countDate || C.today, status:'fullført', lines, sales:null, ts:Date.now(), doneTs:Date.now(), source:'kom-i-gang'});
    }
    let invs = 0;
    if (WZ.regInvoices) for (const v of WZ.invoices.filter(v => v.inv && v.supCode && SET().suppliers[v.supCode])){
      try { await api('POST', '/api/invoices', {supplier:v.supCode, invoiceNo:v.inv.invoiceNo, kid:v.inv.kid, invoiceDate:v.inv.invoiceDate || C.today, dueDate:v.inv.dueDate || null, orderId:null, amountExVat:v.inv.amountExVat, vat:v.inv.vat, amount:v.inv.amount, fileId:v.fileId, lines:v.inv.lines.map(l => ({itemNo:l.itemNo, description:l.description, qty:l.qty ?? 0, unitPrice:l.unitPrice}))}); invs++; } catch(e){ toast(`${v.name}: ${e.message || 'kunne ikke registreres'}`); }
    }
    const s2 = JSON.parse(JSON.stringify(SET())); s2.onboarded = C.today; await saveSettings(s2);
    if (MODE_API) await apiLoad(true);
    WZ.result = {sups, items, prices, counted, invs}; WZ.step = 4; WZ_EDITS = {}; render();
  } catch(e){ b.disabled = false; b.textContent = 'Legg inn'; toast(e.message || 'Noe gikk galt.'); }
}

async function loadUsers(){
  const box = $('#usersList'); if (!box) return;
  try {
    const j = await api('GET', '/api/users');
    box.className = '';
    box.innerHTML = `<table><thead><tr><th>Navn</th><th>E-post</th><th>Rolle</th><th>Sist innlogget</th><th></th></tr></thead><tbody>${j.users.map(u => `<tr><td><span translate="no">${esc(u.name||'–')}</span>${u.me?' <span class="small muted">(deg)</span>':''}</td><td translate="no">${esc(u.email)}</td><td>${u.me ? (u.role==='owner'?'Administrator':'Ansatt') : `<select data-urole-set="${u.id}" style="width:auto;min-height:36px;padding:4px 8px"><option value="owner" ${u.role==='owner'?'selected':''}>Administrator</option><option value="staff" ${u.role!=='owner'?'selected':''}>Ansatt</option></select>`}${u.must_change_password?' <span class="pill p-tell">invitert</span>':''}</td><td>${u.last_login_at?fmtDL(String(u.last_login_at).slice(0,10)):'–'}</td><td class="n">${u.me?'':`<button class="btn sm" data-ureset="${esc(u.email)}" data-uname="${esc(u.name)}" data-urole="${u.role}">Nytt passord</button> <button class="btn sm danger" data-udel="${u.id}">Fjern</button>`}</td></tr>`).join('')}</tbody></table>`;
    box.querySelectorAll('[data-udel]').forEach(b => b.onclick = () => confirmBox('Fjerne brukeren?', 'Brukeren mister tilgangen med en gang.', 'Fjern', async () => { try { await api('DELETE', '/api/users/' + b.dataset.udel); } catch(e){ toast(e.message || 'Kunne ikke fjerne.'); } loadUsers(); }));
    box.querySelectorAll('[data-ureset]').forEach(b => b.onclick = () => inviteUser({email:b.dataset.ureset, name:b.dataset.uname, role:b.dataset.urole}));
    box.querySelectorAll('[data-urole-set]').forEach(s => s.onchange = async () => { try { await api('PATCH', '/api/users/' + s.dataset.uroleSet, {role: s.value}); toast(s.value === 'owner' ? 'Brukeren er nå administrator.' : 'Brukeren er nå ansatt.'); } catch(e){ toast(e.message || 'Kunne ikke endre rollen.'); } loadUsers(); });
  } catch(e){ box.textContent = 'Kunne ikke hente brukerne.'; }
  const add = $('#uAdd'); if (add) add.onclick = () => inviteUser(null);
}
function inviteUser(pre){
  modal(`<h3>${pre ? 'Nytt passord' : 'Legg til ansatt'}</h3>
    <div class="grid g2"><label class="f">Navn<input type="text" id="iuName" value="${esc(pre?.name||'')}"></label><label class="f">E-post<input type="text" id="iuEmail" inputmode="email" value="${esc(pre?.email||'')}" ${pre?'readonly':''}></label></div>
    <label class="f">Rolle<select id="iuRole"><option value="staff" ${pre?.role!=='owner'?'selected':''}>Ansatt – teller, bestiller, varemottak og avskrivning</option><option value="owner" ${pre?.role==='owner'?'selected':''}>Administrator – kan også legge til og fjerne brukere og endre alt i systemet</option></select></label>
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
const INV_STATUS = {kontroll:['Til kontroll','p-tell'], avvik:['Avvik','p-bestill'], matchet:['Matchet','p-ok'], godkjent:['Godkjent','p-ok'], sendt:['Sendt til regnskap','p-behov'], betalt:['Til betaling','p-behov'], avvist:['Avvist','p-behov']};
const invPill = s => `<span class="pill ${(INV_STATUS[s]||['',''])[1]}">${esc((INV_STATUS[s]||[s])[0])}</span>`;
UI.fStatus = 'aktive';
function vFaktura(){
  const set = SET();
  const list = [...S.invoices].sort((a,b) => (b.invoiceDate||'').localeCompare(a.invoiceDate||'') || (b.createdAt||'').localeCompare(a.createdAt||''));
  const f = UI.fStatus;
  const rows = list.filter(i => f === 'alle' ? true : f === 'aktive' ? ['kontroll','avvik','matchet','godkjent'].includes(i.status) : i.status === f);
  const cnt = s => S.invoices.filter(i => i.status === s).length;
  const sumOpen = S.invoices.filter(i => ['kontroll','avvik','matchet','godkjent'].includes(i.status)).reduce((s,i) => s + (i.amount || i.amountExVat || 0), 0);
  let h = `<div class="row between"><div><h2>Fakturaer og pakksedler</h2><div class="muted">Fakturaen kontrolleres mot bestilling og varemottak før den godkjennes, sendes til regnskap for bokføring og legges til betaling.</div></div>
    <div class="row"><button class="btn" id="slipNew" ${ro()}>+ Pakkseddel</button><button class="btn primary" id="invNew" ${ro()}>+ Registrer faktura</button>${S.canManage ? '<button class="btn" id="ttxSync">Hent fra Tripletex</button>' : ''}</div></div>`;
  h += `<div class="grid g4"><button class="tile blue" data-fs="kontroll"><span class="lbl">Til kontroll</span><span class="big">${cnt('kontroll')}</span><span class="small muted">mangler bestilling</span></button>
    <button class="tile red" data-fs="avvik"><span class="lbl">Avvik</span><span class="big">${cnt('avvik')}</span><span class="small muted">mengde eller pris stemmer ikke</span></button>
    <button class="tile green" data-fs="matchet"><span class="lbl">Klar til godkjenning</span><span class="big">${cnt('matchet')}</span><span class="small muted">stemmer med varemottak</span></button>
    <div class="tile"><span class="lbl">Åpne fakturaer</span><span class="big">${kr(sumOpen)}</span><span class="small muted">ikke sendt til regnskap</span></div></div>`;
  h += `<div class="chips">${[['aktive','Aktive'],['kontroll','Til kontroll'],['avvik','Avvik'],['matchet','Matchet'],['godkjent','Godkjent'],['sendt','Sendt til regnskap'],['betalt','Til betaling'],['avvist','Avvist'],['alle','Alle']].map(([k,l]) => `<button class="chip ${f===k?'on':''}" data-fs="${k}">${l}</button>`).join('')}</div>`;
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
  if (!sups.length && !S.features?.readInvoice){ toast('Legg inn leverandører under Innstillinger først.'); return; }
  modal(`<h3>Registrer faktura</h3>
    <div class="grid g3"><label class="f">Leverandør<select id="ivSup">${sups.map(c => `<option translate="no" value="${esc(c)}">${esc(c)} – ${esc(SET().suppliers[c].name)}</option>`).join('')}</select></label><label class="f">Fakturanummer<input type="text" id="ivNo"></label><label class="f">KID (valgfritt)<input type="text" id="ivKid" inputmode="numeric"></label></div>
    <div class="grid g3"><label class="f">Fakturadato<input type="date" id="ivDate" value="${C.today}"></label><label class="f">Forfall<input type="date" id="ivDue" value="${addDays(C.today,14)}"></label><label class="f">Bestilling<select id="ivOrder"></select></label></div>
    <div class="grid g3"><label class="f">Beløp eks. mva<input type="text" inputmode="decimal" id="ivEx"></label><label class="f">Mva<input type="text" inputmode="decimal" id="ivVat"></label><label class="f">Å betale inkl. mva<input type="text" inputmode="decimal" id="ivTot"></label></div>
    <div class="row"><label class="btn" style="cursor:pointer">📎 Last opp faktura (PDF/bilde/EHF)<input type="file" id="ivFile" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp,.xml" class="hide"></label><span id="ivFileName" class="small muted">Ingen fil valgt</span>${S.features?.readInvoice ? '<button class="btn hide" id="ivRead">✨ Les fakturaen</button>' : ''}</div><div id="ivReadRes"></div>
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
    let parsed = null, applySup = null;
    const rd = m.querySelector('#ivRead');
    const doRead = async () => {
      if (!file || !rd) return; rd.disabled = true; const res = m.querySelector('#ivReadRes'); res.innerHTML = '<div class="note info small"><span class="spin"></span> Leser fakturaen – det tar 10–30 sekunder …</div>';
      try {
        const inv = await readInvoiceFile(file.id); parsed = inv;
        const set = SET(); const found = matchSupplier(set, inv);
        if (found){ m.querySelector('#ivSup').value = found; fillOrders(); }
        const put = (s, v) => { if (v != null && v !== '') m.querySelector(s).value = typeof v === 'number' ? String(v).replace('.',',') : v; };
        put('#ivNo', inv.invoiceNo); put('#ivKid', inv.kid); put('#ivDate', inv.invoiceDate); put('#ivDue', inv.dueDate); put('#ivEx', inv.amountExVat); put('#ivVat', inv.vat); put('#ivTot', inv.amount);
        if (inv.lines.length){ m.querySelector('#lnTbl tbody').innerHTML = inv.lines.map(l => lineRow({itemNo:l.itemNo, description:l.description, qty:l.qty, unitPrice:l.unitPrice})).join(''); m.querySelectorAll('.ln-del').forEach(b => b.onclick = () => b.closest('tr').remove()); m.querySelector('details').open = true; }
        res.innerHTML = `<div class="note good small">Lest: ${inv.lines.length} linjer. Sjekk feltene før du registrerer.</div>${inv.warnings?.length ? `<div class="note warn small">${inv.warnings.map(esc).join('<br>')}</div>` : ''}<div class="supcheck">${supplierCheckHtml(inv, found)}</div>`;
        applySup = bindSupplierCheck(res.querySelector('.supcheck'), inv, c => { const sel = m.querySelector('#ivSup'); sel.insertAdjacentHTML('beforeend', `<option translate="no" value="${esc(c)}">${esc(c)} – ${esc(SET().suppliers[c].name)}</option>`); sel.value = c; fillOrders(); }, () => m.querySelector('#ivSup').focus());
      } catch(err){ res.innerHTML = `<div class="note bad small">${esc(err.message || 'Kunne ikke lese fakturaen.')}</div>`; }
      rd.disabled = false;
    };
    if (rd) rd.onclick = doRead;
    m.querySelector('#ivFile').onchange = async e => { m.querySelector('#ivFileName').textContent = 'Laster opp …'; file = await uploadFile(e.target); const fnEl = m.querySelector('#ivFileName'); fnEl.textContent = file ? file.name : 'Ingen fil valgt'; fnEl.toggleAttribute('translate', !!file); if (file) fnEl.setAttribute('translate','no'); if (file && rd){ rd.classList.remove('hide'); doRead(); } };
    m.querySelector('#ivOk').onclick = async () => {
      const b = m.querySelector('#ivOk'); b.disabled = true;
      try {
        if (applySup) await applySup(sup());
        const r = await api('POST', '/api/invoices', {supplier:sup(), invoiceNo:m.querySelector('#ivNo').value, kid:m.querySelector('#ivKid').value, invoiceDate:m.querySelector('#ivDate').value, dueDate:m.querySelector('#ivDue').value, orderId:ord() || null, amountExVat:num(ex.value), vat:num(vat.value), amount:num(tot.value), fileId:file?.id || null, lines:getLines()});
        closeModal(); await apiLoad(true);
        if (parsed && parsed.lines.length) reviewItemsModal(sup(), {...parsed, invoiceNo:m.querySelector('#ivNo').value, invoiceDate:m.querySelector('#ivDate').value}, () => invoiceDrawer(r.invoice.id)); else invoiceDrawer(r.invoice.id);
      } catch(e){ m.querySelector('#ivErr').innerHTML = `<div class="note bad">${esc(e.message||'Noe gikk galt.')}</div>`; b.disabled = false; }
    };
  });
}
function slipModal(){
  const sups = Object.keys(SET().suppliers);
  if (!sups.length){ toast('Legg inn leverandører under Innstillinger først.'); return; }
  modal(`<h3>Registrer pakkseddel</h3>
    <div class="grid g3"><label class="f">Leverandør<select id="psSup">${sups.map(c => `<option translate="no" value="${esc(c)}">${esc(c)} – ${esc(SET().suppliers[c].name)}</option>`).join('')}</select></label><label class="f">Pakkseddelnr<input type="text" id="psNo"></label><label class="f">Dato<input type="date" id="psDate" value="${C.today}"></label></div>
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
  const html = `<div class="row between"><div><div class="small muted"><a href="#leverandorer" class="invsup" translate="no">${esc(set.suppliers[inv.supplier]?.name || inv.supplier)}</a></div><h2>Faktura <span translate="no">${esc(inv.invoiceNo)}</span></h2></div><button class="btn" data-close>Lukk</button></div>
    <div class="row">${invPill(inv.status)}${inv.fileId?`<a class="btn sm" href="/api/files/${esc(inv.fileId)}" target="_blank" rel="noopener">📎 Åpne faktura</a>`:''}${t.supplierInvoiceId?'<span class="pill p-behov">I Tripletex</span>':''}</div>
    <div class="card"><dl class="kv"><dt>Fakturadato</dt><dd>${fmtDL(inv.invoiceDate)}</dd><dt>Forfall</dt><dd>${inv.dueDate?fmtDL(inv.dueDate):'–'}</dd><dt>Beløp eks. mva</dt><dd>${inv.amountExVat!=null?kr(inv.amountExVat):'–'}</dd><dt>Å betale</dt><dd>${inv.amount!=null?kr(inv.amount):'–'}</dd>${inv.kid?`<dt>KID</dt><dd>${esc(inv.kid)}</dd>`:''}<dt>Bestilling</dt><dd>${o?`${fmtDL(o.orderDate)} → levert ${fmtDL(o.deliveryDate)} (${o.status})`:'Ikke funnet'}</dd>${m.expectedExVat!=null?`<dt>Forventet ut fra mottak</dt><dd>${kr(m.expectedExVat)} eks. mva</dd>`:''}</dl></div>
    ${m.issues && m.issues.length ? `<div class="note bad"><div><b>Avvik</b><ul style="margin:6px 0 0;padding-left:18px">${m.issues.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></div>` : m.orderId ? '<div class="note good">Fakturaen stemmer med bestilling og varemottak.</div>' : ''}
    ${m.lines && m.lines.length ? `<div class="card flush"><div class="tblwrap"><table><thead><tr><th>Vare</th><th class="n">Bestilt</th><th class="n">Mottatt</th><th class="n">Fakturert</th><th class="n">Pris</th></tr></thead><tbody>${m.lines.map(l => `<tr style="${l.flags.length?'background:var(--red-bg)':''}"><td><div class="iname">${esc(l.name)}</div><div class="isub">${esc(l.itemNo)}${l.flags.length?' · <b style="color:var(--red)">'+esc(l.flags.join(' · '))+'</b>':''}</div></td><td class="n">${q(l.ordered)}</td><td class="n">${q(l.received)}</td><td class="n">${q(l.invoiced)}</td><td class="n">${l.invoicedPrice!=null?nf1.format(l.invoicedPrice):'–'}${l.agreedPrice!=null&&l.invoicedPrice!=null&&Math.abs(l.invoicedPrice-l.agreedPrice)>0.005?`<div class="isub">avtalt ${nf1.format(l.agreedPrice)}</div>`:''}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
    <div class="card grid" style="gap:10px"><h3>Koble til bestilling</h3><div class="row" style="flex-wrap:nowrap"><select id="dvOrder">${orderOptions(inv.supplier, inv.orderId)}</select><button class="btn" id="dvMatch" ${ro()}>Kontroller på nytt</button></div></div>
    <div class="card grid" style="gap:10px"><h3>Behandling</h3>
      <label class="f">Kommentar${inv.status==='avvik'?' (påkrevd for å godkjenne med avvik)':''}<input type="text" id="dvNote" placeholder="f.eks. kreditnota avtalt for manglende vare"></label>
      <div class="row">
        ${['kontroll','avvik','matchet'].includes(inv.status) ? `<button class="btn primary" data-act="approve" ${can?'':'disabled'}>${inv.status==='avvik'?'Godkjenn med avvik':'Godkjenn'}</button><button class="btn danger" data-act="reject" ${can?'':'disabled'}>Avvis</button>` : ''}
        ${inv.status==='godkjent' && !t.supplierInvoiceId ? `<button class="btn primary" data-act="send" ${can?'':'disabled'}>Send til regnskap</button>` : ''}
        ${(inv.status==='godkjent' || inv.status==='sendt') && t.supplierInvoiceId && !t.paymentAt ? `<button class="btn primary" data-act="pay" ${can?'':'disabled'}>Send til betaling</button>` : ''}
        ${inv.status==='avvist' ? `<button class="btn" data-act="reopen" ${can?'':'disabled'}>Åpne igjen</button>` : ''}
        ${!['sendt','betalt'].includes(inv.status) ? `<button class="btn danger" data-act="delete" ${can?'':'disabled'}>Slett</button>` : ''}
      </div>
      ${!can ? '<div class="small muted">Bare leder kan godkjenne, sende og betale.</div>' : ''}
      <div class="small muted">Godkjent faktura sendes til bilagsmottaket i Tripletex, der den bokføres. Når bilaget er bokført, trykker du «Hent fra Tripletex», og fakturaen kan sendes til betaling. Selve utbetalingen skjer via banken som er koblet til Tripletex.</div></div>
    <div class="card"><h3 style="margin-bottom:8px">Historikk</h3>${(inv.history||[]).slice().reverse().map(h => `<div class="small"><b>${fmtDL(h.ts.slice(0,10))}</b> ${esc(h.action)} – ${esc(h.by)}${h.note?': '+esc(h.note):''}</div>`).join('')}</div>`;
  drawer(html, d => {
    const isl = d.querySelector('.invsup'); if (isl) isl.onclick = e => { e.preventDefault(); closeLayer(); supplierEditModal(inv.supplier); };
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
/* ===== Innkjøpskategorier (hovedkategori › underkategori) ===== */
const CAT_DEFAULT = [
  {name:'Mat', stocked:true, account:'', subs:[{name:'Ferskt', stor:'Kjøl'},{name:'Meieri', stor:'Kjøl'},{name:'Kjøtt og fisk', stor:'Kjøl'},{name:'Grønt', stor:'Kjøl'},{name:'Fryst', stor:'Frys'},{name:'Tørrvarer', stor:'Tørr'},{name:'Brød og bakst', stor:'Romtemp.'}]},
  {name:'Drikke', stocked:true, account:'', subs:[{name:'Alkoholfritt', stor:'Romtemp.'},{name:'Øl og cider', stor:'Kjøl'},{name:'Vin', stor:'Romtemp.'},{name:'Brennevin', stor:'Romtemp.'},{name:'Kaffe og te', stor:'Tørr'}]},
  {name:'Emballasje', stocked:true, account:'', subs:[{name:'Take-away', stor:'Tørr'},{name:'Folie og film', stor:'Tørr'}]},
  {name:'Rengjøring og hygiene', stocked:true, account:'', subs:[{name:'Vask og rengjøring', stor:'Tørr'},{name:'Papir og hygiene', stor:'Tørr'}]},
  {name:'Driftsmateriell', stocked:true, account:'', subs:[{name:'Engangsutstyr', stor:'Tørr'},{name:'Småutstyr kjøkken og bar', stor:'Tørr'},{name:'Kontor', stor:'Tørr'}]},
  {name:'Inventar', stocked:false, account:'', subs:[{name:'Maskiner og utstyr', stor:'Romtemp.'},{name:'Møbler', stor:'Romtemp.'},{name:'Servise og glass', stor:'Romtemp.'}]},
  {name:'Annet', stocked:true, account:'', subs:[{name:'Annet', stor:'Tørr'}]},
];
const CATS = () => { const c = SET().categories; return Array.isArray(c) && c.length ? c : CAT_DEFAULT; };
const catLabel = (g, c) => g && c && g !== c ? `${g} › ${c}` : (c || g || 'Annet');
const catOf = it => ({group: it.group || (CATS().find(g => g.subs.some(s => s.name === it.cat)) || {}).name || '', cat: it.cat || 'Annet'});
const catStocked = g => (CATS().find(x => x.name === g) || {stocked:true}).stocked !== false;
const subStor = (g, c) => ((CATS().find(x => x.name === g) || {subs:[]}).subs.find(s => s.name === c) || {}).stor || '';
/** <option>er gruppert per hovedkategori. Verdi «Hoved|Under». */
function catOptions(group, cat){
  const cur = catOf({group, cat}); let found = false;
  const html = CATS().map(g => `<optgroup label="${esc(g.name)}">${g.subs.map(s => { const on = g.name === cur.group && s.name === cur.cat; if (on) found = true; return `<option value="${esc(g.name + '|' + s.name)}" ${on ? 'selected' : ''}>${esc(s.name)}</option>`; }).join('')}</optgroup>`).join('');
  return (found || !cat ? '' : `<option value="${esc((group || '') + '|' + cat)}" selected>${esc(catLabel(group, cat))}</option>`) + html;
}
const splitCat = v => { const [group, cat] = String(v || '').split('|'); return {group: group || '', cat: cat || group || 'Annet'}; };
const CAT_WORDS = [
  [/meieri|ost\b|melk|fløte|smør|yoghurt|rømme|egg/i, 'Mat', 'Meieri'], [/kjøtt|kylling|svin|storfe|lam|bacon|pølse|fisk|laks|reke|sjømat|torsk/i, 'Mat', 'Kjøtt og fisk'],
  [/grønt|grønnsak|frukt|salat|urter|tomat|løk|agurk|potet|sopp|bær/i, 'Mat', 'Grønt'], [/frys|fryst|frossen|frozen|is\b|iskrem/i, 'Mat', 'Fryst'],
  [/brød|bakst|bolle|brioche|bakeri|kake|baguette|surdeig/i, 'Mat', 'Brød og bakst'], [/tørr|mel\b|ris\b|pasta|sukker|krydder|olje|eddik|hermetikk|saus|nøtter|tørrvare/i, 'Mat', 'Tørrvarer'],
  [/øl\b|pils|ipa|cider|lager\b/i, 'Drikke', 'Øl og cider'], [/vin\b|rødvin|hvitvin|musserende|prosecco|champagne/i, 'Drikke', 'Vin'], [/vodka|gin\b|rom\b|whisk|likør|brennevin|tequila|akevitt/i, 'Drikke', 'Brennevin'],
  [/kaffe|espresso|\bte\b|kakao/i, 'Drikke', 'Kaffe og te'], [/drikke|brus|cola|juice|vann\b|mineralvann|energi|red bull|tonic|saft/i, 'Drikke', 'Alkoholfritt'],
  [/emballasje|take.?away|boks|beger|lokk|pose|kartong/i, 'Emballasje', 'Take-away'], [/folie|film|plastfolie|bakepapir/i, 'Emballasje', 'Folie og film'],
  [/rengjør|vask|såpe|oppvask|desinfek|klut|svamp/i, 'Rengjøring og hygiene', 'Vask og rengjøring'], [/papir|serviett|tørkerull|toalett|håndkle/i, 'Rengjøring og hygiene', 'Papir og hygiene'],
  [/engangs|sugerør|hansker|pinner|bestikk.*engangs/i, 'Driftsmateriell', 'Engangsutstyr'], [/kontor|blekk|printer/i, 'Driftsmateriell', 'Kontor'],
  [/maskin|ovn|kjøleskap|fryser|oppvaskmaskin|blender|kaffemaskin|utstyr/i, 'Inventar', 'Maskiner og utstyr'], [/møbel|stol|bord\b|sofa/i, 'Inventar', 'Møbler'], [/glass|servise|tallerken|kopp|bestikk/i, 'Inventar', 'Servise og glass'],
];
/** Foreslår kategori fra tekst (navn, Claude-kategori) og lagertype. Finnes kategorien i oppsettet, brukes den. */
function guessCat(text, stor){
  const t = String(text || ''); const cats = CATS();
  for (const g of cats) for (const s of g.subs) if (s.name.length > 2 && new RegExp('\\b' + s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(t)) return {group: g.name, cat: s.name};
  for (const [re, g, c] of CAT_WORDS) if (re.test(t)){ const gg = cats.find(x => x.name === g); if (gg && gg.subs.some(s => s.name === c)) return {group: g, cat: c}; }
  const byStor = {Kjøl:['Mat','Ferskt'], Frys:['Mat','Fryst'], Tørr:['Mat','Tørrvarer']}[stor];
  if (byStor){ const gg = cats.find(x => x.name === byStor[0]); if (gg && gg.subs.some(s => s.name === byStor[1])) return {group: byStor[0], cat: byStor[1]}; }
  const last = cats[cats.length - 1]; return {group: last.name, cat: last.subs[0]?.name || last.name};
}
/** Når underkategori velges, settes lagertype i samme rad/skjema. */
function bindCatStor(scope, catSel, storSel){ scope.querySelectorAll(catSel).forEach(sel => sel.addEventListener('change', () => { const {group, cat} = splitCat(sel.value); const st = subStor(group, cat); const box = sel.closest('tr') || scope; const ss = box.querySelector(storSel); if (st && ss) ss.value = st; })); }
function categoriesModal(onSaved){
  let cats = JSON.parse(JSON.stringify(CATS()));
  const draw = m => {
    m.querySelector('#ctList').innerHTML = cats.map((g, gi) => `<div class="card catcard" data-g="${gi}"><div class="row" style="gap:8px;align-items:end"><label class="f" style="flex:2">Hovedkategori<input class="ct-g" value="${esc(g.name)}"></label><label class="f" style="flex:1">Konto i regnskap (valgfritt)<input class="ct-acc" value="${esc(g.account||'')}" placeholder="f.eks. 4300"></label><label class="row small" style="gap:6px;font-weight:600"><input type="checkbox" class="ct-st" ${g.stocked !== false ? 'checked' : ''} style="width:20px;height:20px"> Telles og bestilles</label><button class="btn sm danger ct-gdel" aria-label="Fjern hovedkategori">×</button></div>
      <div class="grid" style="gap:6px;margin-top:8px">${g.subs.map((s, si) => `<div class="row ct-sub" data-s="${si}" style="gap:6px;flex-wrap:nowrap"><span class="muted">›</span><input class="ct-s" value="${esc(s.name)}" style="flex:2"><select class="ct-stor" style="width:auto">${['', ...STORES].map(x => `<option value="${x}" ${s.stor === x ? 'selected' : ''}>${x || '– lager –'}</option>`).join('')}</select><button class="btn sm danger ct-sdel" aria-label="Fjern underkategori">×</button></div>`).join('')}<div><button class="btn sm ct-sadd">+ Underkategori</button></div></div></div>`).join('');
    const read = () => { cats = [...m.querySelectorAll('.catcard')].map(c => ({name: c.querySelector('.ct-g').value.trim(), account: c.querySelector('.ct-acc').value.trim(), stocked: c.querySelector('.ct-st').checked, subs: [...c.querySelectorAll('.ct-sub')].map(r => ({name: r.querySelector('.ct-s').value.trim(), stor: r.querySelector('.ct-stor').value})).filter(s => s.name)})).filter(g => g.name); };
    m._read = read;
    m.querySelectorAll('.ct-gdel').forEach(b => b.onclick = () => { read(); cats.splice(+b.closest('.catcard').dataset.g, 1); draw(m); });
    m.querySelectorAll('.ct-sdel').forEach(b => b.onclick = () => { read(); cats[+b.closest('.catcard').dataset.g].subs.splice(+b.closest('.ct-sub').dataset.s, 1); draw(m); });
    m.querySelectorAll('.ct-sadd').forEach(b => b.onclick = () => { read(); cats[+b.closest('.catcard').dataset.g].subs.push({name:'', stor:''}); draw(m); });
  };
  modal(`<h3>Kategorier for innkjøp</h3><div class="small muted">Hovedkategorier (f.eks. mat, drikke, inventar, driftsmateriell) med underkategorier (f.eks. ferskt, fryst, tørr). Underkategorien kan ha en lagertype som settes automatisk på varen. Kategorier som ikke «telles og bestilles» (f.eks. inventar) får ikke bestillingsforslag.</div>${S.canManage ? '' : '<div class="note warn small">Bare administrator kan endre kategoriene.</div>'}
    <div id="ctList" class="grid" style="gap:10px"></div>
    <div class="row between"><div class="row"><button class="btn sm" id="ctAdd">+ Hovedkategori</button><button class="btn sm" id="ctDef">Tilbakestill til standard</button></div><div class="row"><button class="btn" data-close>Avbryt</button><button class="btn primary" id="ctOk" ${roM()}>Lagre kategorier</button></div></div>`, m => {
    draw(m);
    m.querySelector('#ctAdd').onclick = () => { m._read(); cats.push({name:'', stocked:true, account:'', subs:[{name:'', stor:''}]}); draw(m); };
    m.querySelector('#ctDef').onclick = () => { cats = JSON.parse(JSON.stringify(CAT_DEFAULT)); draw(m); };
    m.querySelector('#ctOk').onclick = async () => { m._read(); if (!cats.length){ toast('Legg inn minst én kategori.'); return; } cats.forEach(g => { if (!g.subs.length) g.subs = [{name: g.name, stor:''}]; }); const s = JSON.parse(JSON.stringify(SET())); s.categories = cats; await saveSettings(s); closeModal(); toast('Kategoriene er lagret.'); onSaved ? onSaved() : render(); };
  });
}

/* ===== Leverandørregister ===== */
// Kontrollsiffer (modulus 11): org.nr (9 siffer) og norsk kontonummer (11 siffer)
function mod11ok(digits, weights){ if (digits.length !== weights.length + 1) return false; const s = weights.reduce((a, w, i) => a + w * +digits[i], 0); let k = 11 - (s % 11); if (k === 11) k = 0; if (k === 10) return false; return k === +digits[digits.length - 1]; }
const orgnrOk = v => { const d = String(v||'').replace(/\D/g,''); return d.length === 9 && mod11ok(d, [3,2,7,6,5,4,3,2]); };
const kontoOk = v => { const d = String(v||'').replace(/\D/g,''); return d.length === 11 && mod11ok(d, [5,4,3,2,7,6,5,4,3,2]); };
const fmtKonto = v => { const d = String(v||'').replace(/\D/g,''); return d.length === 11 ? `${d.slice(0,4)}.${d.slice(4,6)}.${d.slice(6)}` : String(v||''); };
const fmtOrg = v => { const d = String(v||'').replace(/\D/g,''); return d.length === 9 ? `${d.slice(0,3)} ${d.slice(3,6)} ${d.slice(6)}` : String(v||''); };
const SUP_FIELDS = [['orgnr','Org.nr.'],['address','Adresse'],['zip','Postnr.'],['city','Sted'],['bank','Kontonummer'],['iban','IBAN'],['bic','BIC/SWIFT'],['email','E-post (bestilling)'],['phone','Telefon'],['web','Nettside'],['customerNo','Vårt kundenummer']];
/** Felter som kan hentes fra en lest faktura. */
const supFromInvoice = inv => ({name: inv.supplierName || '', orgnr: inv.supplierOrgNo || '', address: inv.supplierAddress || '', zip: inv.supplierPostalCode || '', city: inv.supplierCity || '', bank: (inv.supplierBankAccount||'').replace(/\D/g,''), iban: inv.supplierIban || '', bic: inv.supplierBic || '', email: inv.supplierEmail || '', phone: inv.supplierPhone || '', web: inv.supplierWebsite || '', customerNo: inv.customerNo || '', contacts: inv.supplierContact ? [{name: inv.supplierContact, role:'', phone:'', email:''}] : []});

/** Skjema for leverandør (brukes alene og inne i fakturalesingen). Returnerer {html, bind(m) -> read()}. */
function supplierForm(s, opts = {}){
  s = {wd:[], interval:7, lead:1, safety:2, notes:'', contacts:[], ...s};
  const isNew = !opts.code;
  const contactRow = c => `<div class="grid g4 sf-contact"><input class="sf-cn" placeholder="Navn" value="${esc(c.name||'')}"><input class="sf-cr" placeholder="Rolle, f.eks. selger" value="${esc(c.role||'')}"><input class="sf-cp" placeholder="Telefon" inputmode="tel" value="${esc(c.phone||'')}"><div class="row" style="flex-wrap:nowrap;gap:6px"><input class="sf-ce" placeholder="E-post" inputmode="email" value="${esc(c.email||'')}"><button type="button" class="btn sm danger sf-cdel" aria-label="Fjern kontaktperson">×</button></div></div>`;
  const html = `<div class="supform grid" style="gap:12px">
    <div class="grid g3">${isNew ? `<label class="f">Kode (2–4 tegn)<input class="sf-code" maxlength="4" value="${esc(opts.suggestCode||'')}" placeholder="f.eks. ASKO"></label>` : ''}<label class="f" style="${isNew?'':'grid-column:span 2'}">Navn<input class="sf-name" value="${esc(s.name||'')}"></label><label class="f">Org.nr.<input class="sf-orgnr" inputmode="numeric" value="${esc(fmtOrg(s.orgnr))}"><span class="small sf-orgchk"></span></label></div>
    <div class="grid g3"><label class="f" style="grid-column:span 1">Adresse<input class="sf-address" value="${esc(s.address||'')}"></label><label class="f">Postnr.<input class="sf-zip" inputmode="numeric" value="${esc(s.zip||'')}"></label><label class="f">Sted<input class="sf-city" value="${esc(s.city||'')}"></label></div>
    <div class="grid g3"><label class="f">Kontonummer<input class="sf-bank" inputmode="numeric" value="${esc(fmtKonto(s.bank))}" placeholder="1234.56.78901"><span class="small sf-bankchk"></span></label><label class="f">IBAN (utenlandsk)<input class="sf-iban" value="${esc(s.iban||'')}"></label><label class="f">BIC/SWIFT<input class="sf-bic" value="${esc(s.bic||'')}"></label></div>
    <div class="grid g4"><label class="f">E-post (bestilling)<input class="sf-email" inputmode="email" value="${esc(s.email||'')}"></label><label class="f">Telefon<input class="sf-phone" inputmode="tel" value="${esc(s.phone||'')}"></label><label class="f">Nettside<input class="sf-web" value="${esc(s.web||'')}"></label><label class="f">Vårt kundenummer<input class="sf-cust" value="${esc(s.customerNo||'')}"></label></div>
    <div class="f" style="display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:var(--muted)">Kontaktpersoner<div class="sf-contacts grid" style="gap:8px">${(s.contacts||[]).map(contactRow).join('')}</div><div><button type="button" class="btn sm sf-cadd">+ Kontaktperson</button></div></div>
    <details ${isNew?'open':''}><summary style="cursor:pointer;font-weight:600">Levering og bestilling</summary>
      <div class="grid" style="gap:12px;margin-top:10px"><div class="f" style="display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:var(--muted)">Leveringsdager<div class="chips sf-wd">${[1,2,3,4,5,6,0].map(d=>`<button type="button" class="chip ${(s.wd||[]).includes(d)?'on':''}" data-d="${d}">${WD[d]}</button>`).join('')}</div></div>
      <div class="grid g3"><label class="f">Ledetid (dager)<input class="sf-lead" inputmode="decimal" value="${String(s.lead??1).replace('.',',')}"></label><label class="f">Sikkerhetsdager<input class="sf-safety" inputmode="decimal" value="${String(s.safety??2).replace('.',',')}"></label><label class="f">Minste ordre / gebyr (notat)<input class="sf-notes" value="${esc(s.notes||'')}"></label></div></div></details>
  </div>`;
  const bind = m => {
    const f = c => m.querySelector(c);
    const chk = (inp, out, ok, label) => { const v = inp.value.replace(/\D/g,''); out.textContent = !v ? '' : ok(v) ? '✓ gyldig' : `✗ ugyldig ${label} (kontrollsiffer stemmer ikke)`; out.style.color = ok(v) ? 'var(--green)' : 'var(--red)'; out.style.fontWeight = '600'; };
    const oc = () => chk(f('.sf-orgnr'), f('.sf-orgchk'), orgnrOk, 'org.nr.'), bc = () => chk(f('.sf-bank'), f('.sf-bankchk'), kontoOk, 'kontonummer');
    f('.sf-orgnr').oninput = oc; f('.sf-bank').oninput = bc; oc(); bc();
    const bindDel = () => m.querySelectorAll('.sf-cdel').forEach(b => b.onclick = () => b.closest('.sf-contact').remove());
    f('.sf-cadd').onclick = () => { f('.sf-contacts').insertAdjacentHTML('beforeend', contactRow({})); bindDel(); }; bindDel();
    const wd = new Set(s.wd || []); m.querySelectorAll('.sf-wd .chip').forEach(b => b.onclick = () => { const d = +b.dataset.d; wd.has(d) ? wd.delete(d) : wd.add(d); b.classList.toggle('on'); });
    return () => {
      const g = c => (f(c)?.value || '').trim();
      const days = [...wd].sort((a,b)=>((a+6)%7)-((b+6)%7));
      const out = {...s, name: g('.sf-name'), orgnr: g('.sf-orgnr').replace(/\D/g,''), address: g('.sf-address'), zip: g('.sf-zip'), city: g('.sf-city'), bank: g('.sf-bank').replace(/\D/g,''), iban: g('.sf-iban').replace(/\s/g,'').toUpperCase(), bic: g('.sf-bic').toUpperCase(), email: g('.sf-email'), phone: g('.sf-phone'), web: g('.sf-web'), customerNo: g('.sf-cust'),
        contacts: [...m.querySelectorAll('.sf-contact')].map(r => ({name: r.querySelector('.sf-cn').value.trim(), role: r.querySelector('.sf-cr').value.trim(), phone: r.querySelector('.sf-cp').value.trim(), email: r.querySelector('.sf-ce').value.trim()})).filter(c => c.name || c.phone || c.email),
        wd: days, days: days.length ? days.map(d => WDL[d]).join(', ') : (s.days || 'Etter avtale'), interval: days.length ? Math.round(7 / days.length * 10) / 10 : (s.interval || 7), lead: num(g('.sf-lead')) ?? 1, safety: num(g('.sf-safety')) ?? 2, notes: g('.sf-notes'), fees: s.fees || ''};
      const code = isNew ? g('.sf-code').toUpperCase().replace(/[^A-ZÆØÅ0-9]/g,'') : opts.code;
      const errs = [];
      if (!out.name) errs.push('Fyll inn navn.');
      if (isNew && (code.length < 2 || SET().suppliers[code])) errs.push(code.length < 2 ? 'Koden må ha 2–4 tegn.' : 'Koden er allerede i bruk.');
      if (out.orgnr && !orgnrOk(out.orgnr)) errs.push('Org.nr. er ugyldig.');
      if (out.bank && !kontoOk(out.bank)) errs.push('Kontonummeret er ugyldig.');
      return {code, sup: out, errs};
    };
  };
  return {html, bind};
}
function suggestCode(name){
  const set = SET(); const words = normName(name).replace(/\b(AS|ASA|AB|DA|ANS|NORGE)\b/g,'').split(/\s+/).filter(Boolean);
  let base = (words.length > 1 ? words.map(w => w[0]).join('') : (words[0] || 'LEV')).slice(0,4); if (base.length < 2) base = (words[0] || 'LEV').slice(0,3);
  let code = base, i = 2; while (set.suppliers[code]) code = base.slice(0,3) + i++; return code;
}
async function saveSupplier(code, sup){ const set = JSON.parse(JSON.stringify(SET())); const old = set.suppliers[code]; if (old && old.bank && sup.bank && old.bank !== sup.bank) sup.bankChanged = {from: old.bank, at: C.today, by: S.me?.name || S.me?.email || ''}; set.suppliers[code] = sup; await saveSettings(set); }
function supplierEditModal(code, prefill, onSaved){
  const s = code ? SET().suppliers[code] : prefill || {};
  const form = supplierForm(s, {code, suggestCode: code ? '' : suggestCode(s.name || '')});
  modal(`<h3>${code ? 'Leverandør: <span translate="no">' + esc(s.name) + '</span>' : 'Ny leverandør'}</h3>${S.canManage ? '' : '<div class="note warn small">Bare leder kan endre leverandører.</div>'}${form.html}<div class="sf-err"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Avbryt</button><button class="btn primary" id="sfOk" ${roM()}>${code ? 'Lagre' : 'Opprett leverandør'}</button></div>`, m => {
    const read = form.bind(m);
    m.querySelector('#sfOk').onclick = async () => {
      const r = read(); if (r.errs.length){ m.querySelector('.sf-err').innerHTML = `<div class="note bad small">${r.errs.map(esc).join('<br>')}</div>`; return; }
      if (code && SET().suppliers[code]?.bank && r.sup.bank && SET().suppliers[code].bank !== r.sup.bank && !confirm(`Kontonummeret endres fra ${fmtKonto(SET().suppliers[code].bank)} til ${fmtKonto(r.sup.bank)}. Har du bekreftet endringen direkte med leverandøren (ikke bare via e-post eller faktura)?`)) return;
      await saveSupplier(r.code, r.sup); closeModal(); toast(code ? 'Leverandøren er lagret.' : 'Leverandøren er opprettet.'); onSaved ? onSaved(r.code) : render();
    };
  });
}
function vLeverandorer(){
  const set = SET(); const items = getItems();
  const nItems = {}; items.forEach(i => nItems[i.sup] = (nItems[i.sup]||0) + 1);
  const lastInv = {}; S.invoices.forEach(i => { if (!lastInv[i.supplier] || (i.invoiceDate||'') > lastInv[i.supplier].invoiceDate) lastInv[i.supplier] = i; });
  const codes = Object.keys(set.suppliers).sort((a,b) => set.suppliers[a].name.localeCompare(set.suppliers[b].name, 'nb'));
  let h = `<div class="row between"><div><h2>Leverandører</h2><div class="muted">Kontaktinfo, kontonummer, adresser og leveringsdager. Kontonummeret brukes til å oppdage fakturaer med endret konto.</div></div><div class="row"><button class="btn" data-go="oppsett">Tilbake</button><button class="btn primary" id="supNew" ${roM()}>+ Ny leverandør</button></div></div>`;
  h += codes.length ? `<div class="grid g2">${codes.map(c => { const s = set.suppliers[c]; const warn = [!s.orgnr && 'mangler org.nr.', s.orgnr && !orgnrOk(s.orgnr) && 'ugyldig org.nr.', !s.bank && !s.iban && 'mangler kontonummer', s.bank && !kontoOk(s.bank) && 'ugyldig kontonummer'].filter(Boolean); const li = lastInv[c];
    return `<div class="card grid" style="gap:8px"><div class="row between"><div><h3 translate="no">${esc(s.name)}</h3><div class="small muted">${esc(c)}${s.orgnr?' · org.nr. '+esc(fmtOrg(s.orgnr)):''}</div></div><button class="btn sm" data-supedit="${esc(c)}">${S.canManage?'Rediger':'Vis'}</button></div>
      <dl class="kv">${s.address||s.city?`<dt>Adresse</dt><dd translate="no">${esc([s.address, [s.zip, s.city].filter(Boolean).join(' ')].filter(Boolean).join(', '))}</dd>`:''}${s.bank||s.iban?`<dt>Konto</dt><dd>${esc(s.bank?fmtKonto(s.bank):s.iban)}${s.bankChanged?` <span class="pill p-tell">endret ${fmtD(s.bankChanged.at)}</span>`:''}</dd>`:''}${s.email||s.phone?`<dt>Bestilling</dt><dd translate="no">${[s.email&&`<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>`, s.phone&&`<a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>`].filter(Boolean).join(' · ')}</dd>`:''}${(s.contacts||[]).length?`<dt>Kontakt</dt><dd translate="no">${s.contacts.map(k => `${esc(k.name)}${k.role?' ('+esc(k.role)+')':''}${k.phone?' · <a href="tel:'+esc(k.phone)+'">'+esc(k.phone)+'</a>':''}${k.email?' · <a href="mailto:'+esc(k.email)+'">'+esc(k.email)+'</a>':''}`).join('<br>')}</dd>`:''}<dt>Levering</dt><dd>${esc(s.days||'Etter avtale')} · ledetid ${q(s.lead??1)} d</dd>${s.customerNo?`<dt>Kundenr.</dt><dd>${esc(s.customerNo)}</dd>`:''}</dl>
      <div class="row small"><a href="#varer" data-supitems="${esc(c)}">${nItems[c]||0} varer</a><span class="muted">·</span><span class="muted">${li?'siste faktura '+fmtDL(li.invoiceDate):'ingen fakturaer'}</span>${warn.map(w => `<span class="pill p-tell">${esc(w)}</span>`).join('')}</div></div>`; }).join('')}</div>` : '<div class="card"><div class="empty">Ingen leverandører ennå. Opprett en, eller last opp en faktura under Varer → Legg inn varer.</div></div>';
  $('#view').innerHTML = h;
  $('#supNew').onclick = () => supplierEditModal(null, {});
  document.querySelectorAll('[data-supedit]').forEach(b => b.onclick = () => supplierEditModal(b.dataset.supedit));
  document.querySelectorAll('[data-supitems]').forEach(a => a.onclick = e => { e.preventDefault(); UI.vSup = a.dataset.supitems; go('varer'); });
}

/** Etter lesing: ny leverandør (spør om opprettelse) eller kjent leverandør (oppdater detaljer, varsle om endret kontonummer). */
function supplierCheckHtml(inv, found){
  if (!found){
    if (!S.canManage) return `<div class="note warn small">Leverandøren <b translate="no">${esc(inv.supplierName||'')}</b> finnes ikke i Restoq. Be en leder opprette den, eller velg en eksisterende.</div>`;
    return `<div class="note info small sc-ask"><div><b>Ny leverandør: <span translate="no">${esc(inv.supplierName || 'ukjent')}</span>${inv.supplierOrgNo?' ('+esc(fmtOrg(inv.supplierOrgNo))+')':''}</b><br>Finnes ikke i Restoq. Vil du opprette den? Opplysningene fra fakturaen fylles inn.<div class="row" style="margin-top:8px"><button type="button" class="btn sm primary sc-yes">Ja, opprett leverandør</button><button type="button" class="btn sm sc-no">Nei, velg en eksisterende</button></div></div></div><div class="sc-form"></div>`;
  }
  const s = SET().suppliers[found]; const fromInv = supFromInvoice(inv);
  const bankInv = fromInv.bank, ibanInv = fromInv.iban.replace(/\s/g,'').toUpperCase();
  let h = '';
  if ((bankInv && s.bank && bankInv !== s.bank) || (ibanInv && s.iban && ibanInv !== s.iban.replace(/\s/g,'').toUpperCase()))
    h += `<div class="note bad small"><div><b>⚠ Kontonummeret på fakturaen (${esc(bankInv ? fmtKonto(bankInv) : ibanInv)}) er ikke det samme som registrert for <span translate="no">${esc(s.name)}</span> (${esc(s.bank ? fmtKonto(s.bank) : s.iban)}).</b> Dette er et vanlig tegn på fakturasvindel. Bekreft kontonummeret med leverandøren på et kjent telefonnummer før fakturaen betales.</div></div>`;
  const missing = SUP_FIELDS.filter(([k]) => !s[k] && fromInv[k]).map(([k, l]) => [k, l]);
  if (missing.length && S.canManage) h += `<label class="row small" style="gap:8px"><input type="checkbox" class="sc-fill" checked style="width:20px;height:20px"> Legg til fra fakturaen hos <span translate="no">${esc(s.name)}</span>: ${missing.map(([k,l]) => esc(l.toLowerCase()) + ' ' + esc(k==='bank'?fmtKonto(fromInv[k]):k==='orgnr'?fmtOrg(fromInv[k]):fromInv[k])).join(', ')}</label>`;
  return h + `<div class="small"><a href="#leverandorer" class="sc-link">Åpne leverandøren <span translate="no">${esc(s.name)}</span></a></div>`;
}
/** Binder spørsmålet. onCreated(code) kalles når ny leverandør er lagret. Returnerer async apply(code) som lagrer valgte tillegg. */
function bindSupplierCheck(box, inv, onCreated, onDecline){
  const yes = box.querySelector('.sc-yes'), no = box.querySelector('.sc-no');
  if (yes) yes.onclick = () => {
    const pre = supFromInvoice(inv); const form = supplierForm(pre, {suggestCode: suggestCode(pre.name)});
    box.querySelector('.sc-ask').remove();
    const fb = box.querySelector('.sc-form'); fb.innerHTML = `<div class="card" style="background:var(--surface2)"><h3 style="margin-bottom:8px">Ny leverandør</h3>${form.html}<div class="sf-err"></div><div class="row" style="justify-content:flex-end;margin-top:8px"><button type="button" class="btn primary sc-save">Opprett leverandør</button></div></div>`;
    const read = form.bind(fb);
    fb.querySelector('.sc-save').onclick = async () => { const r = read(); if (r.errs.length){ fb.querySelector('.sf-err').innerHTML = `<div class="note bad small">${r.errs.map(esc).join('<br>')}</div>`; return; } await saveSupplier(r.code, r.sup); fb.innerHTML = `<div class="note good small">Leverandøren <b translate="no">${esc(r.sup.name)}</b> (${esc(r.code)}) er opprettet.</div>`; onCreated && onCreated(r.code); };
  };
  if (no) no.onclick = () => { box.querySelector('.sc-ask').remove(); onDecline && onDecline(); };
  const link = box.querySelector('.sc-link'); if (link) link.onclick = e => { e.preventDefault(); closeModal(); go('leverandorer'); };
  return async code => {
    const fill = box.querySelector('.sc-fill'); if (!fill || !fill.checked || !code) return;
    const s = {...SET().suppliers[code]}; const fromInv = supFromInvoice(inv);
    SUP_FIELDS.forEach(([k]) => { if (!s[k] && fromInv[k]) s[k] = fromInv[k]; });
    if (!(s.contacts||[]).length && fromInv.contacts.length) s.contacts = fromInv.contacts;
    await saveSupplier(code, s);
  };
}

/* ===== Samme vare hos flere leverandører ===== */
const SIZE_RE = /(\d+(?:[.,]\d+)?)\s*(ML|CL|DL|L|LTR|G|GR|KG)\b/g;
function sizeKey(name){ const out = []; String(name||'').toUpperCase().replace(/(\d),(\d)/g,'$1.$2').replace(SIZE_RE, (m, n, u) => { const v = parseFloat(n); const ml = {ML:1, CL:10, DL:100, L:1000, LTR:1000}[u]; const g = {G:1, GR:1, KG:1000}[u]; out.push(ml ? Math.round(v*ml)+'ml' : Math.round(v*g)+'g'); return m; }); return out.sort().join('+'); }
const STOP = new Set(['STK','PK','PAK','PAKKE','KRT','KARTONG','BOKS','BX','FL','FLASKE','X','KG','G','L','ML','CL','DL','LTR','GR','STYKK','STK.','ENERGY','DRINK','ORIGINAL','NORSK','IMPORT','FERSK','FRYST','SKIVET','PRESSET','AV','OG','MED','I','TIL','DS','BOX']);
const nameTokens = n => new Set(String(n||'').toUpperCase().replace(/(\d),(\d)/g,'$1.$2').replace(SIZE_RE,' ').replace(/[^A-ZÆØÅ]+/g,' ').split(' ').filter(w => w.length >= 2 && !STOP.has(w)));
function sameProduct(a, b){
  if (a.sup === b.sup) return false;
  const na = a.notSame || [], nb = b.notSame || []; if (na.includes(b.id) || nb.includes(a.id)) return false;
  if ((a.same || []).includes(b.id) || (b.same || []).includes(a.id)) return true;
  if (a.gtin && b.gtin) return String(a.gtin) === String(b.gtin);
  const ta = nameTokens(a.name), tb = nameTokens(b.name); if (!ta.size || !tb.size) return false;
  let inter = 0; ta.forEach(t => { if (tb.has(t)) inter++; });
  const jac = inter / (ta.size + tb.size - inter);
  const sa = sizeKey(a.name), sb = sizeKey(b.name);
  if (sa && sb && sa !== sb) return false;
  return jac >= 0.6 || (inter >= 2 && Math.min(ta.size, tb.size) === inter);
}
let ALT_CACHE = null, ALT_KEY = '';
function altIndex(){
  const items = getItems().filter(i => i.active !== false);
  const key = items.length + ':' + JSON.stringify(S.itemcfg?.ov ? Object.keys(S.itemcfg.ov).length : 0) + ':' + items.reduce((s,i)=>s+(i.price||0),0).toFixed(2);
  if (ALT_CACHE && ALT_KEY === key) return ALT_CACHE;
  const idx = {}; const byTok = {};
  items.forEach(i => nameTokens(i.name).forEach(t => (byTok[t] ??= []).push(i)));
  items.forEach(i => { const cand = new Set(); nameTokens(i.name).forEach(t => (byTok[t]||[]).forEach(o => cand.add(o))); (i.same||[]).forEach(id => { const o = items.find(x => x.id === id); o && cand.add(o); }); const alts = [...cand].filter(o => o.id !== i.id && sameProduct(i, o)); if (alts.length) idx[i.id] = alts; });
  ALT_CACHE = idx; ALT_KEY = key; return idx;
}
const altsFor = item => altIndex()[item.id] || (getItems().some(i => i.id === item.id) ? [] : getItems().filter(o => o.active !== false && sameProduct(item, o)));
/** Innhold per enhet fra varenavnet: «24X250ML» = 6000 ml, «0,25L» = 250 ml, «5KG» = 5000 g. */
function contentOf(name){
  const n = String(name||'').toUpperCase().replace(/(\d),(\d)/g,'$1.$2');
  const conv = (v, u) => { const ml = {ML:1, CL:10, DL:100, L:1000, LTR:1000}[u]; return ml ? {dim:'ml', amt:v*ml} : {dim:'g', amt:v*({G:1, GR:1, KG:1000}[u])}; };
  let m = n.match(/(\d+)\s*[X×]\s*(\d+(?:\.\d+)?)\s*(ML|CL|DL|L|LTR|G|GR|KG)\b/);
  if (m){ const c = conv(parseFloat(m[2]), m[3]); return {dim:c.dim, amt:c.amt*parseInt(m[1]), each:c.amt, n:parseInt(m[1])}; }
  m = n.match(/(\d+(?:\.\d+)?)\s*(ML|CL|DL|L|LTR|G|GR|KG)\b/);
  if (m){ const c = conv(parseFloat(m[1]), m[2]); return {dim:c.dim, amt:c.amt, each:c.amt, n:1}; }
  return null;
}
const fmtAmt = (dim, a) => dim === 'ml' ? (a >= 1000 ? nf1.format(a/1000) + ' l' : nf0.format(a) + ' ml') : (a >= 1000 ? nf1.format(a/1000) + ' kg' : nf0.format(a) + ' g');
/** Sammenlignbar pris: andre varens pris omregnet til samme mengde som denne varen. */
function comparePrice(item, price, o){
  const a = contentOf(item.name), b = contentOf(o.name);
  if (a && b && a.dim === b.dim && a.amt > 0 && b.amt > 0 && (item.unit||'').toLowerCase() === (o.unit||'').toLowerCase()){
    const eq = o.price / b.amt * a.amt; return {eq, d: price ? (eq - price) / price * 100 : null, note: a.amt !== b.amt ? `<span translate="no">${fmtAmt(b.dim, b.amt)}${b.n > 1 ? ' (' + b.n + '×' + fmtAmt(b.dim, b.each) + ')' : ''}</span> <span>– tilsvarer</span> ${kr(eq)} <span>per</span> <span translate="no">${fmtAmt(a.dim, a.amt)}</span>` : ''};
  }
  const same = (o.unit||'').toLowerCase() === (item.unit||'').toLowerCase() && (o.pack||1) === (item.pack||1) && (!a || !b || a.amt === b.amt);
  return same ? {eq:o.price, d: price ? (o.price - price) / price * 100 : null, note:''} : {eq:null, d:null, note:'<span>annen enhet/pakning</span>'};
}
/** Kort varsel om samme vare hos andre leverandører, med pris og forskjell. */
function altNote(item, price){
  const alts = altsFor(item); if (!alts.length) return '';
  const p = price ?? item.price; const set = SET();
  return alts.map(o => { const c = comparePrice(item, p, o);
    return `<span class="altnote ${c.d != null && c.d < -2 ? 'cheaper' : ''}"><span>Kjøpes også hos</span> <b translate="no">${esc(set.suppliers[o.sup]?.name || o.sup)}</b> <span>til</span> ${kr(o.price)}<span translate="no">/${esc(o.unit)}</span>${c.note ? ' · ' + c.note : ''}${c.d != null && Math.abs(c.d) >= 0.5 ? ` (${c.d > 0 ? '+' : ''}${nf1.format(c.d)} %)` : ''}</span>`; }).join(' ');
}
/* ===== Fakturalesing med Claude og varer fra faktura ===== */
const normNo = s => String(s||'').replace(/[^A-Za-z0-9]/g,'').replace(/^0+/,'').toUpperCase();
const normName = s => String(s||'').toUpperCase().replace(/[^A-ZÆØÅ0-9]+/g,' ').trim();
const FEE_RE = /frakt|gebyr|pant|levering|transport|rabatt|miljøavgift|emballasjeavgift|småordre|drivstoff/i;
function matchSupplier(set, inv){
  const org = String(inv.supplierOrgNo||'').replace(/\D/g,'');
  const codes = Object.keys(set.suppliers);
  if (org.length === 9){ const c = codes.find(c => String(set.suppliers[c].orgnr||'').replace(/\D/g,'') === org); if (c) return c; }
  const n = normName(inv.supplierName).replace(/\b(AS|ASA|AB|NORGE|NORWAY|DA|ANS)\b/g,'').trim();
  if (!n) return null;
  return codes.find(c => { const s = normName(set.suppliers[c].name).replace(/\b(AS|ASA|AB|NORGE|NORWAY|DA|ANS)\b/g,'').trim(); return s && (s === n || s.includes(n) || n.includes(s)); }) || null;
}
async function createSupplierFrom(inv){
  const set = JSON.parse(JSON.stringify(SET()));
  const words = normName(inv.supplierName).replace(/\b(AS|ASA|AB|DA|ANS)\b/g,'').split(/\s+/).filter(Boolean);
  let base = (words.length > 1 ? words.map(w => w[0]).join('') : (words[0] || 'LEV')).slice(0,4);
  if (base.length < 2) base = (words[0] || 'LEV').slice(0,3);
  let code = base, i = 2; while (set.suppliers[code]) code = base.slice(0,3) + i++;
  set.suppliers[code] = {name: inv.supplierName || code, orgnr: inv.supplierOrgNo || '', wd:[], days:'Etter avtale', interval:7, lead:1, safety:2, notes:'', fees:''};
  await saveSettings(set);
  return code;
}
async function readInvoiceFile(fileId){
  const r = await api('POST', '/api/invoices/read', {fileId});
  return r.invoice;
}
function supplierPicker(inv, id){
  const set = SET(); const found = matchSupplier(set, inv);
  const opts = Object.keys(set.suppliers).map(c => `<option translate="no" value="${esc(c)}" ${c===found?'selected':''}>${esc(c)} – ${esc(set.suppliers[c].name)}</option>`).join('');
  return `<label class="f">Leverandør${inv.supplierName?` <span style="font-weight:400">(på fakturaen: <span translate="no">${esc(inv.supplierName)}</span>${inv.supplierOrgNo?' · '+esc(inv.supplierOrgNo):''})</span>`:''}<select id="${id}">${S.canManage && inv.supplierName ? `<option value="__new" ${found?'':'selected'}>+ Ny leverandør: ${esc(inv.supplierName)}</option>` : ''}${opts}</select></label>`;
}
async function resolveSupplier(value, inv){ return value === '__new' ? await createSupplierFrom(inv) : value; }

/** Gjennomgang av fakturalinjer: opprett nye varer og oppdater priser. */
function reviewItemsModal(sup, inv, onDone){
  const items = getItems().filter(i => i.sup === sup);
  const rows = (inv.lines || []).filter(l => l.description || l.itemNo).map((l, i) => {
    const ex = items.find(it => l.itemNo && normNo(it.no) === normNo(l.itemNo)) || items.find(it => normName(it.name) === normName(l.description));
    const price = l.unitPrice ?? (l.qty ? (l.lineTotal ?? 0) / l.qty : null);
    const changed = ex && price != null && price > 0 && Math.abs(price - (ex.price || 0)) > Math.max(0.01, (ex.price || 0) * 0.005);
    return {i, l, ex, price, changed, fee: FEE_RE.test(l.description || '') || (l.qty ?? 0) < 0};
  });
  const nNew = rows.filter(r => !r.ex), nChg = rows.filter(r => r.changed), nSame = rows.filter(r => r.ex && !r.changed);
  if (!nNew.length && !nChg.length){ toast(`Alle ${rows.length} varene finnes allerede med riktig pris.`); onDone && onDone(); return; }
  if (!S.canManage){ toast(`Fakturaen har ${nNew.length} nye varer og ${nChg.length} prisendringer. Be en leder opprette dem under Varer.`); onDone && onDone(); return; }
  const set = SET();
  modal(`<h3>Varer fra fakturaen</h3><div class="small muted">${esc(set.suppliers[sup]?.name || sup)}${inv.invoiceNo?' · faktura '+esc(inv.invoiceNo):''}. ${nNew.length} nye varer, ${nChg.length} prisendringer${nSame.length?`, ${nSame.length} uendret`:''}. Sjekk og juster før du lagrer – lager, kategori og holdbarhet er forslag.</div>
    ${nNew.length ? `<div class="tblwrap"><table class="rvtbl"><thead><tr><th></th><th>Varenr</th><th>Navn</th><th>Enhet</th><th class="n">Pris</th><th>Lager</th><th>Kategori</th><th class="n">Holdbarhet</th><th class="n">Pakning</th></tr></thead><tbody>${nNew.map(r => `<tr data-rv="${r.i}"><td><input type="checkbox" class="rv-on" ${r.fee?'':'checked'} style="width:20px;height:20px"></td><td><input class="rv-no" value="${esc(r.l.itemNo||'')}" style="width:90px"></td><td><input class="rv-name" value="${esc((r.l.description||'').toUpperCase())}" style="min-width:200px">${altNote({id:'_new', sup, name:r.l.description, unit:(r.l.unit||'stk').toLowerCase(), pack:1, gtin:r.l.gtin, price:r.price}, r.price) || ''}</td><td><input class="rv-unit" value="${esc((r.l.unit||'stk').toLowerCase())}" style="width:60px"></td><td><input class="rv-price" inputmode="decimal" value="${r.price!=null?String(Math.round(r.price*100)/100).replace('.',','):''}" style="width:80px;text-align:right"></td><td><select class="rv-stor">${STORES.map(s => `<option ${(r.l.storage||normStore(r.l.category))===s?'selected':''}>${s}</option>`).join('')}</select></td><td><select class="rv-cat">${(() => { const gc = guessCat((r.l.category||'') + ' ' + (r.l.description||''), r.l.storage); return catOptions(gc.group, gc.cat); })()}</select></td><td><input class="rv-shelf" inputmode="numeric" value="${r.l.shelfDays??''}" style="width:60px;text-align:right"></td><td><input class="rv-pack" inputmode="decimal" value="1" style="width:55px;text-align:right"></td></tr>`).join('')}</tbody></table></div>${rows.some(r => !r.ex && r.fee) ? '<div class="small muted">Frakt, pant, gebyrer og kreditlinjer er ikke krysset av.</div>' : ''}` : ''}
    ${nChg.length ? `<h3 style="margin-top:6px">Nye priser</h3><div class="tblwrap"><table><thead><tr><th></th><th>Vare</th><th class="n">Nå</th><th class="n">På fakturaen</th><th class="n">Endring</th></tr></thead><tbody>${nChg.map(r => { const d = (r.price - r.ex.price) / (r.ex.price || 1) * 100; return `<tr data-rc="${r.i}"><td><input type="checkbox" class="rc-on" checked style="width:20px;height:20px"></td><td><div class="iname">${esc(r.ex.name)}</div>${altNote(r.ex, r.price)}<div class="isub">${esc(r.ex.no)} · ${esc(r.ex.unit)}${r.l.unit && normName(r.l.unit) !== normName(r.ex.unit) ? ` · <b style="color:var(--amber)">fakturert i ${esc(r.l.unit)}</b>` : ''}</div></td><td class="n">${kr(r.ex.price)}</td><td class="n"><b>${kr(r.price)}</b></td><td class="n" style="color:${d>0?'var(--red)':'var(--green)'}">${d>0?'+':''}${nf1.format(d)} %</td></tr>`; }).join('')}</tbody></table></div>` : ''}
    <div class="row" style="justify-content:flex-end"><button class="btn" id="rvSkip">Hopp over</button><button class="btn primary" id="rvOk">Lagre varer og priser</button></div>`, m => {
    bindCatStor(m, '.rv-cat', '.rv-stor');
    m.querySelector('#rvSkip').onclick = () => { closeModal(); onDone && onDone(); };
    m.querySelector('#rvOk').onclick = async () => {
      const b = m.querySelector('#rvOk'); b.disabled = true;
      const cfg = JSON.parse(JSON.stringify(S.itemcfg || {ov:{}})); cfg.ov = cfg.ov || {};
      const all = getItems(); let created = 0, updated = 0;
      m.querySelectorAll('tr[data-rv]').forEach(tr => {
        if (!tr.querySelector('.rv-on').checked) return;
        const g = c => tr.querySelector(c).value.trim();
        const name = g('.rv-name'); if (!name) return;
        const no = g('.rv-no') || normName(name).replace(/\s/g,'').slice(0,14);
        const id = sup + '-' + no.replace(/[^A-Za-z0-9]/g,'');
        if (all.find(i => i.id === id && !cfg.ov[id]?.removed) && !cfg.ov[id]?.custom) return;
        const prev = cfg.ov[id] || {};
        cfg.ov[id] = {...prev, id, custom:true, removed:false, sup, no, name, unit:g('.rv-unit')||'stk', price:num(g('.rv-price'))||0, stor:g('.rv-stor'), ...splitCat(tr.querySelector('.rv-cat').value), area:prev.area||'Kjøkken', shelf:num(g('.rv-shelf')), pack:num(g('.rv-pack'))||1, manual:prev.manual??null, active: prev.active ?? catStocked(splitCat(tr.querySelector('.rv-cat').value).group), h100:prev.h100||0, b13:prev.b13||0, b6:prev.b6||0, ndel:prev.ndel||0, last:inv.invoiceDate||C.today, gtin: (rows.find(x => x.i === +tr.dataset.rv)?.l.gtin) || prev.gtin || '', source:'faktura', priceHist:[{d:inv.invoiceDate||C.today, p:num(g('.rv-price'))||0, inv:inv.invoiceNo||''}]};
        created++;
      });
      m.querySelectorAll('tr[data-rc]').forEach(tr => {
        if (!tr.querySelector('.rc-on').checked) return;
        const r = rows.find(x => x.i === +tr.dataset.rc); const id = r.ex.id; const o = cfg.ov[id] || {};
        const hist = [...(o.priceHist || [{d:'', p:r.ex.price}]), {d:inv.invoiceDate||C.today, p:Math.round(r.price*100)/100, inv:inv.invoiceNo||''}].slice(-12);
        cfg.ov[id] = {...o, price: Math.round(r.price*100)/100, priceHist: hist, last: inv.invoiceDate || o.last};
        updated++;
      });
      try { await saveItemCfg(cfg); closeModal(); toast(`${created} nye varer${updated?` og ${updated} nye priser`:''} er lagret.`); onDone && onDone(); }
      catch(e){ b.disabled = false; toast(e.message || 'Kunne ikke lagre.'); }
    };
  });
}

/** Legg inn varer: manuelt eller fra faktura. */
function addItemsModal(){
  modal(`<h3>Legg inn varer</h3>
    <div class="grid g2">
      <button class="pickcard" id="aiManual"><b>Skriv inn manuelt</b><span class="small muted">Én vare om gangen, med navn, pris, lager og forbruk.</span></button>
      <button class="pickcard" id="aiInvoice"><b>Fra faktura</b><span class="small muted">${S.features?.readInvoice ? 'Last opp PDF, bilde eller EHF. Restoq leser varelinjene, og du godkjenner før de lagres.' : 'Automatisk lesing er ikke satt opp ennå (ANTHROPIC_API_KEY). Du kan registrere fakturaen og linjene manuelt.'}</span></button>
    </div>
    <div class="row between"><button class="btn sm" id="aiCsv">Importer vareliste (Excel/CSV)</button><button class="btn" data-close>Lukk</button></div>`, m => {
    m.querySelector('#aiManual').onclick = () => { closeModal(); newItemModal(); };
    m.querySelector('#aiCsv').onclick = () => { closeModal(); importItemsModal(); };
    m.querySelector('#aiInvoice').onclick = () => { closeModal(); S.features?.readInvoice ? itemsFromInvoiceModal() : invoiceModal(); };
  });
}
function itemsFromInvoiceModal(){
  modal(`<h3>Varer fra faktura</h3><div class="small muted">Last opp fakturaen. Restoq leser leverandør, varelinjer og priser – det tar 10–30 sekunder.</div>
    <div class="row"><label class="btn primary" style="cursor:pointer">📎 Velg faktura (PDF, bilde eller EHF)<input type="file" id="ifFile" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp,.xml" class="hide"></label><span id="ifStatus" class="small muted" translate="no"></span></div>
    <div id="ifRes"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Avbryt</button><button class="btn primary hide" id="ifOk">Gå videre til varene</button></div>`, m => {
    let file = null, inv = null, applySup = null;
    m.querySelector('#ifFile').onchange = async e => {
      const st = m.querySelector('#ifStatus'); st.textContent = 'Laster opp …';
      file = await uploadFile(e.target); if (!file){ st.textContent = ''; return; }
      st.innerHTML = '<span class="spin"></span> Leser fakturaen …';
      try { inv = await readInvoiceFile(file.id); } catch(err){ st.textContent = ''; m.querySelector('#ifRes').innerHTML = `<div class="note bad">${esc(err.message || 'Kunne ikke lese fakturaen.')}</div>`; return; }
      st.textContent = file.name;
      m.querySelector('#ifRes').innerHTML = `<div class="note good">Fant ${inv.lines.length} linjer${inv.invoiceNo?' på faktura '+esc(inv.invoiceNo):''}${inv.invoiceDate?' datert '+fmtDL(inv.invoiceDate):''}${inv.amount!=null?' · '+kr(inv.amount)+' inkl. mva':''}.</div>
        ${inv.warnings?.length ? `<div class="note warn small">${inv.warnings.map(esc).join('<br>')}</div>` : ''}
        <label class="f">Leverandør<select id="ifSup"><option value="">– velg –</option>${Object.keys(SET().suppliers).map(c => `<option translate="no" value="${esc(c)}" ${c===matchSupplier(SET(), inv)?'selected':''}>${esc(c)} – ${esc(SET().suppliers[c].name)}</option>`).join('')}</select></label>
        <div class="supcheck">${supplierCheckHtml(inv, matchSupplier(SET(), inv))}</div>
        <label class="row small" style="gap:8px"><input type="checkbox" id="ifReg" checked style="width:20px;height:20px"> Registrer også fakturaen for kontroll mot bestilling og varemottak</label>`;
      applySup = bindSupplierCheck(m.querySelector('#ifRes .supcheck'), inv, c => { const sel = m.querySelector('#ifSup'); sel.insertAdjacentHTML('beforeend', `<option translate="no" value="${esc(c)}">${esc(c)} – ${esc(SET().suppliers[c].name)}</option>`); sel.value = c; }, () => m.querySelector('#ifSup').focus());
      m.querySelector('#ifOk').classList.remove('hide');
    };
    m.querySelector('#ifOk').onclick = async () => {
      const b = m.querySelector('#ifOk'); b.disabled = true;
      try {
        const sup = m.querySelector('#ifSup').value;
        if (!sup){ b.disabled = false; m.querySelector('#ifRes').insertAdjacentHTML('beforeend', '<div class="note bad small">Velg leverandør, eller opprett den nye først.</div>'); return; }
        if (applySup) await applySup(sup);
        let invId = null;
        if (m.querySelector('#ifReg').checked){
          const r = await api('POST', '/api/invoices', {supplier:sup, invoiceNo:inv.invoiceNo, kid:inv.kid, invoiceDate:inv.invoiceDate||C.today, dueDate:inv.dueDate||null, orderId:null, amountExVat:inv.amountExVat, vat:inv.vat, amount:inv.amount, fileId:file.id, lines:inv.lines.map(l => ({itemNo:l.itemNo, description:l.description, qty:l.qty??0, unitPrice:l.unitPrice}))});
          invId = r.invoice.id;
        }
        closeModal(); await apiLoad(true);
        reviewItemsModal(sup, inv, async () => { if (invId){ await apiLoad(true); go('faktura'); invoiceDrawer(invId); } else render(); });
      } catch(err){ b.disabled = false; m.querySelector('#ifRes').insertAdjacentHTML('beforeend', `<div class="note bad">${esc(err.message || 'Noe gikk galt.')}</div>`); }
    };
  });
}

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
