/* Promemo Android — dati locali, registro, cifratura, sincronizzazione, notifiche */
(function () {
'use strict';
const Cap = window.Capacitor;
const native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
const P = (name) => native ? (Cap.Plugins[name] || Cap.registerPlugin(name)) : null;
const FS = P('Filesystem'), PREF = P('Preferences'), LN = P('LocalNotifications'), APP = P('App');
const pad = (n) => String(n).padStart(2, '0');
const isoL = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// ---------- registro degli errori (ultime 400 righe, consultabile da Altro) ----------
const LOG = [];
function plog(level, msg) {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${String(msg).replace(/(k=|key"?:\s*"?)[A-Za-z0-9_-]{8,}/g, '$1[nascosto]')}`;
  LOG.push(line); if (LOG.length > 400) LOG.shift();
  clearTimeout(plog.t); plog.t = setTimeout(() => kv.set('log', LOG.join('\n')), 800);
  if (level === 'error') console.error(msg); else if (level === 'warn') console.warn(msg);
}
window.addEventListener('error', (e) => plog('error', `${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => plog('error', 'promessa rifiutata: ' + (e.reason && e.reason.message || e.reason)));

// ---------- archivio: preferenze piccole e file dei dati ----------
const kv = {
  async get(k) { try { if (PREF) { const r = await PREF.get({ key: k }); return r.value; } return localStorage.getItem('pm.' + k); } catch { return null; } },
  async set(k, v) { try { if (PREF) await PREF.set({ key: k, value: v }); else localStorage.setItem('pm.' + k, v); } catch (e) { console.warn(e); } },
  async del(k) { try { if (PREF) await PREF.remove({ key: k }); else localStorage.removeItem('pm.' + k); } catch { /* */ } },
};
const store = {
  async load() {
    try {
      if (FS) { const r = await FS.readFile({ path: 'promemo.json', directory: 'DATA', encoding: 'utf8' }); return JSON.parse(r.data); }
      const s = localStorage.getItem('pm.data'); return s ? JSON.parse(s) : null;
    } catch (e) { if (!/not exist|non esiste|File does not exist/i.test(e.message || '')) plog('warn', 'lettura dati: ' + e.message); return null; }
  },
  async save(d) {
    const s = JSON.stringify(d);
    try {
      if (FS) { await FS.writeFile({ path: 'promemo.tmp.json', directory: 'DATA', data: s, encoding: 'utf8' }); await FS.rename({ from: 'promemo.tmp.json', to: 'promemo.json', directory: 'DATA', toDirectory: 'DATA' }); }
      else localStorage.setItem('pm.data', s);
    } catch (e) { plog('error', 'salvataggio dati: ' + e.message); throw e; }
  },
};

// ---------- cifratura compatibile con il computer (scrypt + AES-256-GCM) ----------
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = { to: (u8) => btoa(String.fromCharCode(...u8)), from: (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0)) };
const keyCache = new Map();
async function kdf(pass, salt) {
  const ck = pass + '|' + b64.to(salt);
  if (keyCache.has(ck)) return keyCache.get(ck);
  const raw = await window.scrypt.scrypt(enc.encode(String(pass).normalize('NFKC')), salt, 1 << 15, 8, 1, 32);
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  keyCache.set(ck, key); return key;
}
const MAGIC_SY = enc.encode('PMSY1'), MAGIC_V = enc.encode('PMV1');
async function sealState(obj, pass, salt) {
  const key = await kdf(pass, salt), iv = crypto.getRandomValues(new Uint8Array(12));
  const ctTag = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  const ct = ctTag.subarray(0, ctTag.length - 16), tag = ctTag.subarray(ctTag.length - 16);
  const out = new Uint8Array(5 + 16 + 4 + 12 + 16 + ct.length);
  let o = 0; for (const part of [MAGIC_SY, salt, MAGIC_V, iv, tag, ct]) { out.set(part, o); o += part.length; }
  let bin = ''; for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
  return btoa(bin); // testo base64: passa intatto dal client HTTP nativo
}
async function openState(buf, pass) {
  if (typeof buf === 'string') buf = b64.from(buf.trim()); else buf = new Uint8Array(buf);
  if (dec.decode(buf.subarray(0, 5)) !== 'PMSY1') { try { buf = b64.from(dec.decode(buf).trim()); } catch { /* */ } }
  if (dec.decode(buf.subarray(0, 5)) !== 'PMSY1') throw new Error('File di sincronizzazione non riconosciuto');
  const salt = buf.subarray(5, 21), body = buf.subarray(21);
  const iv = body.subarray(4, 16), tag = body.subarray(16, 32), ct = body.subarray(32);
  const both = new Uint8Array(ct.length + 16); both.set(ct); both.set(tag, ct.length);
  try { return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await kdf(pass, salt), both))); }
  catch { throw new Error('Password della sincronizzazione errata'); }
}

// ---------- rete con limite di tempo ----------
async function req(url, opts = {}, ms = 15000) {
  const ctl = new AbortController(); let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => { ctl.abort(); rej(new Error('tempo scaduto')); }, ms); });
  try { return await Promise.race([fetch(url, { ...opts, signal: ctl.signal }), timeout]); }
  catch (e) { throw new Error(e.message === 'tempo scaduto' || e.name === 'AbortError' ? 'tempo scaduto' : 'non raggiungibile'); }
  finally { clearTimeout(t); }
}

// ---------- destinazioni cloud (le stesse dei backup del computer) ----------
function cloudDest(c) {
  if (c.type === 'webdav') {
    const base = c.url.replace(/\/+$/, '') + '/';
    const H = { authorization: 'Basic ' + btoa(unescape(encodeURIComponent(`${c.user || ''}:${c.password || ''}`))) };
    return {
      async list() {
        // sul telefono PROPFIND non è sempre disponibile: il nome del file del computer è noto dall'abbinamento
        if (c.desktopFile) return [{ name: c.desktopFile, tag: null }];
        const r = await req(base, { method: 'PROPFIND', headers: { ...H, depth: '1', 'content-type': 'application/xml' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/><d:getcontentlength/></d:prop></d:propfind>' });
        if (r.status === 401) throw new Error('WebDAV: credenziali non valide');
        if (!r.ok && r.status !== 207) throw new Error('WebDAV: elenco non riuscito (' + r.status + ')');
        const xml = await r.text(), out = [];
        for (const m of xml.matchAll(/<(?:\w+:)?response\b[\s\S]*?<\/(?:\w+:)?response>/gi)) {
          const blk = m[0]; const href = decodeURIComponent((blk.match(/<(?:\w+:)?href>([^<]+)</i) || [])[1] || ''); const name = href.replace(/\/+$/, '').split('/').pop();
          if (!name.endsWith('.pmsync')) continue;
          out.push({ name, tag: ((blk.match(/getlastmodified>([^<]+)</i) || [])[1] || '') + '|' + ((blk.match(/getcontentlength>(\d+)</i) || [])[1] || '') });
        }
        return out;
      },
      async get(name) { const r = await req(base + encodeURIComponent(name), { headers: H }, 60000); if (r.status === 404) return null; if (!r.ok) throw new Error('WebDAV: lettura non riuscita (' + r.status + ')'); return await r.text(); },
      async put(name, text) { const r = await req(base + encodeURIComponent(name), { method: 'PUT', headers: { ...H, 'content-type': 'text/plain' }, body: text }, 60000); if (!r.ok) throw new Error('WebDAV: scrittura non riuscita (' + r.status + ')'); },
    };
  }
  if (c.type === 'dropbox') {
    let tok = null, exp = 0;
    const token = async () => {
      if (tok && exp > Date.now() + 60000) return tok;
      const r = await req('https://api.dropboxapi.com/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: c.appKey }).toString() });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error('Dropbox: accesso scaduto, abbina di nuovo il telefono');
      tok = j.access_token; exp = Date.now() + (j.expires_in || 14400) * 1000; return tok;
    };
    const call = async (url, opts) => { const r = await req(url, { ...opts, headers: { authorization: 'Bearer ' + await token(), ...(opts.headers || {}) } }, 60000); return r; };
    return {
      async list() { const r = await call('https://api.dropboxapi.com/2/files/list_folder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: '' }) }); if (!r.ok) { if (r.status === 409) return []; throw new Error('Dropbox: elenco non riuscito'); } const j = await r.json(); return (j.entries || []).filter(e => e['.tag'] === 'file' && e.name.endsWith('.pmsync')).map(e => ({ name: e.name, tag: e.rev || e.server_modified })); },
      async get(name) { const r = await call('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { 'dropbox-api-arg': JSON.stringify({ path: '/' + name }) } }); if (r.status === 409) return null; if (!r.ok) throw new Error('Dropbox: lettura non riuscita'); return await r.text(); },
      async put(name, text) { const r = await call('https://content.dropboxapi.com/2/files/upload', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'dropbox-api-arg': JSON.stringify({ path: '/' + name, mode: 'overwrite', mute: true }) }, body: text }); if (!r.ok) throw new Error('Dropbox: scrittura non riuscita (' + r.status + ')'); },
    };
  }
  throw new Error('Questa destinazione non è raggiungibile dal telefono');
}

// ---------- stato dell'app ----------
const S = { data: null, cfg: null, syncing: false, lastSync: null, lastVia: '', lastError: '' };
const emptyData = () => ({ events: [], projects: [], categories: [], syncMeta: {}, ext: null, settings: {} });
async function loadAll() {
  S.data = (await store.load()) || emptyData();
  let c = null; try { c = JSON.parse(await kv.get('cfg') || 'null'); } catch { c = null; }
  S.cfg = c || {};
  if (!S.cfg.dev) { S.cfg.dev = 'tel-' + uid(); S.cfg.salt = b64.to(crypto.getRandomValues(new Uint8Array(16))); await saveCfg(); }
  const l = await kv.get('log'); if (l) LOG.push(...l.split('\n').slice(-300));
  plog('info', 'avvio app');
}
const saveCfg = () => kv.set('cfg', JSON.stringify(S.cfg));
let saveT = null;
function persist() { PromemoSync.track(S.data, S.cfg.dev); clearTimeout(saveT); saveT = setTimeout(() => store.save(S.data).catch(() => {}), 200); scheduleSync(4000); scheduleNotifs(); }

// ---------- abbinamento: promemo://abbina?h=IP:PORTA&k=CHIAVE ----------
async function pairFromUrl(url) {
  const u = new URL(url.replace(/^promemo:\/\//, 'http://x/'));
  const h = u.searchParams.get('h'), k = u.searchParams.get('k');
  if (!h || !k) throw new Error('Link di abbinamento non valido');
  S.cfg.host = h; S.cfg.key = k; await saveCfg();
  plog('info', 'abbinato a ' + h);
  try {
    const r = await req(`http://${h}/api/sync/config`, { headers: { 'X-Promemo-Key': k } }, 6000);
    const j = await r.json(); if (!r.ok) throw new Error(j.error || 'errore ' + r.status);
    if (j.cloud && !j.cloud.unsupported) { S.cfg.cloud = j.cloud; S.cfg.desktop = j.desktop; await saveCfg(); plog('info', 'accesso al cloud ricevuto (' + j.cloud.type + ')'); }
    else if (j.cloud && j.cloud.unsupported) { S.cfg.cloud = null; await saveCfg(); plog('warn', 'cloud del computer non raggiungibile dal telefono: ' + j.cloud.type); }
  } catch (e) { plog('warn', 'configurazione cloud: ' + e.message); }
  return syncNow('abbinamento');
}

// ---------- sincronizzazione: prima in rete (diretta), altrimenti attraverso il cloud ----------
const myState = () => ({ ...PromemoSync.build(S.data, S.cfg.dev), name: 'Telefono Android' });
async function syncLan() {
  if (!S.cfg.host || !S.cfg.key) return null;
  const r = await req(`http://${S.cfg.host}/api/sync`, { method: 'POST', headers: { 'X-Promemo-Key': S.cfg.key, 'content-type': 'application/json' }, body: JSON.stringify({ state: myState() }) }, 5000);
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('chiave non più valida: abbina di nuovo il telefono');
  if (!r.ok) throw new Error(j.error || 'errore ' + r.status);
  const n = PromemoSync.merge(S.data, j.state); if (j.state.ext) S.data.ext = j.state.ext;
  return n;
}
async function syncCloud() {
  const c = S.cfg.cloud; if (!c || !c.pass) return null;
  const dst = cloudDest({ ...c, desktopFile: S.cfg.desktop ? `promemo-sync-${S.cfg.desktop}.pmsync` : null });
  const files = await dst.list(); const seen = S.cfg.seen || {}; let n = 0;
  for (const f of files) {
    if (f.name === `promemo-sync-${S.cfg.dev}.pmsync` || (f.tag && seen[f.name] === f.tag)) continue;
    const raw = await dst.get(f.name); if (raw == null) continue;
    const st = await openState(raw, c.pass);
    if (st.dev !== S.cfg.dev) { n += PromemoSync.merge(S.data, st); if (st.ext && (!S.data.ext || st.ext.at > S.data.ext.at)) S.data.ext = st.ext; }
    seen[f.name] = f.tag;
  }
  S.cfg.seen = seen; await saveCfg();
  PromemoSync.track(S.data, S.cfg.dev);
  await dst.put(`promemo-sync-${S.cfg.dev}.pmsync`, await sealState(myState(), c.pass, b64.from(S.cfg.salt)));
  return n;
}
let syncT = null;
function scheduleSync(ms) { clearTimeout(syncT); syncT = setTimeout(() => syncNow('modifiche'), ms); }
async function syncNow(reason) {
  if (S.syncing) return; S.syncing = true; window.onSyncState && window.onSyncState();
  PromemoSync.track(S.data, S.cfg.dev);
  let n = null, via = '', errs = [];
  try {
    try { n = await syncLan(); if (n !== null) via = 'rete'; } catch (e) { errs.push('rete: ' + e.message); }
    if (n === null) { try { n = await syncCloud(); if (n !== null) via = 'cloud'; } catch (e) { errs.push('cloud: ' + e.message); } }
    if (n !== null) { S.lastSync = new Date().toISOString(); S.lastVia = via; S.lastError = ''; S.cfg.lastSync = S.lastSync; S.cfg.lastVia = via; await saveCfg(); PromemoSync.track(S.data, S.cfg.dev); await store.save(S.data); if (n) plog('info', `${n} modifiche ricevute (${via}, ${reason})`); scheduleNotifs(); }
    else if (errs.length) { S.lastError = errs.join(' · '); plog('warn', 'sincronizzazione: ' + S.lastError); }
    else S.lastError = S.cfg.host || S.cfg.cloud ? '' : 'Telefono non abbinato';
  } finally { S.syncing = false; window.onSyncState && window.onSyncState(n); }
  return n;
}

// ---------- notifiche locali per promemoria e "esci alle" (prossimi 14 giorni) ----------
let notifT = null;
function scheduleNotifs() { clearTimeout(notifT); notifT = setTimeout(doNotifs, 1500); }
async function doNotifs() {
  if (!LN) return;
  try {
    const perm = await LN.checkPermissions(); if (perm.display !== 'granted') return;
    const pend = await LN.getPending(); if (pend.notifications.length) await LN.cancel({ notifications: pend.notifications.map(n => ({ id: n.id })) });
    const now = Date.now(), until = now + 14 * 864e5, list = [];
    const hash = (s) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) % 2000000000; };
    const evs = PromemoRecur.expand(allEvents(), new Date(now), new Date(until));
    for (const e of evs) {
      if (e.reminder == null || e.allDay || !e.start) continue;
      const at = new Date(e.start).getTime() - e.reminder * 60000;
      if (at > now && at < until) list.push({ id: hash('e' + e.id + e.start), title: e.title, body: `${e.start.slice(11, 16)}${e.location ? ' · ' + e.location : ''}`, schedule: { at: new Date(at), allowWhileIdle: true } });
      const tr = S.data.ext && S.data.ext.settings && S.data.ext.settings.travel && S.data.ext.travel && S.data.ext.travel[e._occ ? `${e.id}@${e._occ}` : e.id];
      if (tr && tr.leaveAt && !tr.same) { const la = new Date(tr.leaveAt).getTime() - 5 * 60000; if (la > now && la < until) list.push({ id: hash('l' + e.id + e.start), title: `Esci alle ${tr.leaveAt.slice(11, 16)} · ${e.title}`, body: `${tr.min} min da ${tr.from}`, schedule: { at: new Date(la), allowWhileIdle: true } }); }
    }
    for (const p of S.data.projects) for (const st of p.steps) {
      if (st.done || !st.due || st.reminder == null) continue;
      const at = new Date(st.due).getTime() - st.reminder * 60000;
      if (at > now && at < until) list.push({ id: hash('s' + st.id + st.due), title: st.text, body: `${p.title} · ${st.due.slice(11, 16)}`, schedule: { at: new Date(at), allowWhileIdle: true } });
    }
    if (list.length) await LN.schedule({ notifications: list.slice(0, 60) });
  } catch (e) { plog('warn', 'notifiche: ' + e.message); }
}

// tutti gli eventi visibili: i miei e quelli in sola lettura arrivati dal computer
// domanda libera all'IA del computer (solo in rete locale)
async function askDesktop(text, history) {
  if (!S.cfg.host || !S.cfg.key) throw new Error('Telefono non abbinato al computer');
  const r = await req(`http://${S.cfg.host}/api/agent/chat`, { method: 'POST', headers: { 'X-Promemo-Key': S.cfg.key, 'content-type': 'application/json' }, body: JSON.stringify({ text, history }) }, 60000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Il computer non ha risposto');
  return j.text;
}
const speech = () => P('SpeechRecognition');
function allEvents() {
  const ext = (S.data.ext && S.data.ext.events) || [];
  const hidden = new Set((S.data.ext && S.data.ext.settings && S.data.ext.settings.hiddenLocal) || []);
  const accs = new Map(((S.data.ext && S.data.ext.accounts) || []).map(a => [a.id, a]));
  const visible = (e) => { if (e.tripRef) return !hidden.has('__trips'); if (!e.source) return true; const a = accs.get(e.source.acc); if (!a || !a.enabled) return false; const g = (a.groups || []).find(x => x.id === e.source.group); return !g || g.visible; };
  return S.data.events.concat(ext.map(e => ({ ...e, _ro: true }))).filter(visible);
}
function colorOf(e) {
  const x = S.data.ext || {};
  if (e.tripRef) return (x.settings && x.settings.tripsColor) || '#0a84ff';
  if (e.source) { const a = (x.accounts || []).find(y => y.id === e.source.acc); const g = a && (a.groups || []).find(y => y.id === e.source.group); return g ? g.color : '#8e8e93'; }
  const p = S.data.projects.find(q => q.id === e.projectId); const c = p && S.data.categories.find(k => k.id === p.category);
  const NAMED = { orange: '#e5562a', green: '#2f9e5b', blue: '#2f7ae5', purple: '#8e5bd9', pink: '#d9467a', teal: '#1f9aa5', yellow: '#c9930a', gray: '#8e8e93' };
  return c ? (NAMED[c.color] || c.color) : ((x.settings && x.settings.localColor) || '#e5562a');
}
function groupName(e) {
  const x = S.data.ext || {};
  if (e.tripRef) return 'Viaggi';
  if (e.source) { const a = (x.accounts || []).find(y => y.id === e.source.acc); const g = a && (a.groups || []).find(y => y.id === e.source.group); return g ? g.name : a ? a.name : ''; }
  const p = S.data.projects.find(q => q.id === e.projectId); return p ? p.title : 'Personale';
}

// i compiti ripetuti: completato uno, nasce il successivo (come sul computer)
function spawnRepeats() {
  for (const p of S.data.projects) for (const st of [...p.steps]) {
    if (!st.repeat || !st.done || st.repeatNext) continue;
    const base = st.due || st.doneAt || isoL(new Date());
    let nx = PromemoRecur.next(st.repeat, base, base);
    while (nx && nx < isoL(new Date()).slice(0, 10) + 'T00:00') nx = PromemoRecur.next(st.repeat, base, nx);
    if (!nx) { st.repeatNext = 'fine'; continue; }
    const id = 's-' + uid(); st.repeatNext = id;
    const c = { ...st, id, due: nx, done: false, doneAt: null }; delete c.repeatNext; delete c.notifiedAt;
    p.steps.push(c);
  }
}

window.PM = { askDesktop, speech, S, native, kv, store, plog, LOG, loadAll, persist, syncNow, scheduleSync, pairFromUrl, allEvents, colorOf, groupName, spawnRepeats, uid, isoL, APP, LN, sealState, openState, b64 };
})();
