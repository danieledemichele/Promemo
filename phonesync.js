// Promemo — sincronizzazione con il telefono: in rete (diretta) e attraverso il cloud dei backup (file cifrati)
'use strict';
const crypto = require('crypto');
const vault = require('./vault');
const SM = require('./src/syncmodel.js');

const EXT = '.pmsync';
const MAGIC = Buffer.from('PMSY1');
const keyCache = new Map();
async function keyFor(pass, salt) {
  const k = pass + '|' + salt.toString('base64');
  if (!keyCache.has(k)) keyCache.set(k, await vault.kdf(pass, salt));
  return keyCache.get(k);
}
// PMSY1 | sale (16 byte) | contenuto cifrato (come la cassaforte: PMV1 | iv | tag | dati)
async function seal(obj, pass, salt) { return Buffer.concat([MAGIC, salt, vault.seal(await keyFor(pass, salt), JSON.stringify(obj))]); }
async function open(buf, pass) {
  if (!buf || !buf.subarray(0, 5).equals(MAGIC)) throw new Error('File di sincronizzazione non riconosciuto');
  const salt = buf.subarray(5, 21);
  let plain; try { plain = vault.open(await keyFor(pass, salt), buf.subarray(21)); } catch { throw new Error('Password della sincronizzazione errata'); }
  return JSON.parse(plain.toString('utf8'));
}

function createPhoneSync(ctx) {
  // ctx: data(), commit(), backup, log, snapshot(reason), notify()
  const cfg = () => ({ enabled: false, cloud: true, ...(ctx.data().settings.phoneSync || {}) });
  const set = (patch) => { const d = ctx.data(); d.settings.phoneSync = { ...cfg(), ...patch }; };
  function dev() {
    const d = ctx.data(); d.settings.phoneSync = d.settings.phoneSync || {};
    if (!d.settings.phoneSync.dev) d.settings.phoneSync.dev = 'pc-' + crypto.randomBytes(5).toString('hex');
    if (!d.settings.phoneSync.salt) d.settings.phoneSync.salt = crypto.randomBytes(16).toString('base64');
    return d.settings.phoneSync.dev;
  }
  // ciò che il telefono riceve in sola lettura: calendari collegati, viaggi, tempi di viaggio, colori
  function ext() {
    const d = ctx.data(), now = Date.now();
    const keep = (e) => { const en = new Date(e.end || e.start).getTime(); return en > now - 30 * 864e5 && new Date(e.start).getTime() < now + 120 * 864e5; };
    return {
      at: new Date().toISOString(),
      events: d.events.filter(e => (e.source || e.tripRef) && keep(e)).map(e => ({ id: e.id, title: e.title, kind: e.kind, allDay: e.allDay, start: e.start, end: e.end, location: e.location || '', notes: (e.notes || '').slice(0, 1500), reminder: e.reminder ?? null, projectId: e.projectId || '', tripRef: e.tripRef || null, source: e.source ? { acc: e.source.acc, group: e.source.group, cal: e.source.cal, url: e.source.url || '' } : null })),
      accounts: (d.accounts || []).map(a => ({ id: a.id, name: a.name, provider: a.provider, enabled: a.enabled, groups: (a.groups || []).map(g => ({ id: g.id, name: g.name, color: g.color, visible: g.visible !== false })) })),
      trips: Object.values(d.trips || {}).filter(t => !t.end || new Date(t.end) > new Date(now - 60 * 864e5)).map(t => ({ id: t.id, name: t.name, icon: t.icon, status: t.status, start: t.start, end: t.end, nights: t.nights, items: t.items.map(i => ({ id: i.id, title: i.title, start: i.start, type: i.type, place: i.place, cost: i.cost, booked: i.booked })), intro: t.ai ? t.ai.intro : '' })),
      travel: d.travel || {},
      settings: { userName: d.settings.userName || '', accent: d.settings.accent || '', localColor: d.settings.localColor || '', hiddenLocal: d.settings.hiddenLocal || [], tripsColor: (d.settings.trips || {}).color || '', travel: !!(d.settings.travel && d.settings.travel.enabled) },
    };
  }
  function state() { dev(); SM.track(ctx.data(), dev()); return SM.build(ctx.data(), dev(), ext()); }
  // unisce lo stato arrivato dal telefono; prima di grandi cambiamenti salva una copia locale
  function mergeIn(st, via) {
    if (!st || !st.recs) throw new Error('Stato non valido');
    const d = ctx.data();
    SM.track(d, dev());
    const incoming = Object.keys(st.recs).filter(k => { const m = (d.syncMeta || {})[k], r = st.recs[k]; return !m || r.mod > m.mod; }).length;
    if (incoming > 25) ctx.snapshot('prima-della-sincronizzazione');
    const n = SM.merge(d, st);
    const ph = { ...(cfg().phones || {}) }; ph[st.dev] = { at: new Date().toISOString(), via, name: st.name || ph[st.dev]?.name || 'Telefono' };
    set({ phones: ph, lastAt: new Date().toISOString(), lastError: '' });
    if (n) ctx.log.info('sync-telefono', `${n} modifiche dal telefono (${via})`);
    ctx.commit();
    return n;
  }
  let busy = false, lastRun = 0;
  async function cloudRun(reason = '') {
    const c = cfg();
    if (!c.enabled || c.cloud === false || busy) return null;
    const b = (ctx.data().settings.backup || {});
    if (!b.dest || !b.dest.type) return null;
    const pass = ctx.backup.pass(); if (!pass) return null;
    busy = true; lastRun = Date.now();
    try {
      const target = ctx.backup.dest();
      const me = dev();
      // 1. leggo le modifiche degli altri dispositivi
      const files = (await target.list(EXT)).filter(f => f.name !== `promemo-sync-${me}${EXT}`);
      const seen = { ...(c.seen || {}) }; let total = 0;
      for (const f of files) {
        const tag = `${f.mtime || ''}|${f.size || ''}`;
        if (seen[f.name] === tag) continue;
        const st = await open(await target.get(f.name), pass);
        if (st.dev === me) { seen[f.name] = tag; continue; }
        total += mergeIn(st, 'cloud');
        seen[f.name] = tag;
      }
      set({ seen });
      // 2. scrivo il mio stato (con ciò che ho appena unito)
      const salt = Buffer.from(ctx.data().settings.phoneSync.salt, 'base64');
      await target.put(`promemo-sync-${me}${EXT}`, await seal(state(), pass, salt));
      set({ lastCloudAt: new Date().toISOString(), lastError: '' });
      ctx.commit();
      return total;
    } catch (e) {
      set({ lastError: e.message, lastErrorAt: new Date().toISOString() });
      ctx.log.warn('sync-telefono', `cloud: ${e.message}`);
      ctx.commit();
      throw e;
    } finally { busy = false; }
  }
  // configurazione da passare al telefono durante l'abbinamento (solo in rete locale, con la chiave)
  async function cloudConfigForPhone() {
    const b = (ctx.data().settings.backup || {}); const pass = ctx.backup.pass();
    if (!b.dest || !pass) return null;
    const t = b.dest.type || b.dest;
    if (t === 'webdav') return { type: 'webdav', url: b.dest.url, user: b.dest.user || '', password: ctx.secret('backup:webdav') || '', pass };
    if (t === 'dropbox') { const s = ctx.secret('backup:dropbox') || {}; return { type: 'dropbox', appKey: s.app_key, refreshToken: s.refresh_token, pass }; }
    return { type: t, unsupported: true };
  }
  return { state, mergeIn, cloudRun, cloudConfigForPhone, dev, cfg, lastRun: () => lastRun, EXT, seal, open };
}

module.exports = { createPhoneSync, seal, open, EXT };
