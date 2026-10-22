// Promemo — backup cifrati verso cartelle sincronizzate, Dropbox, WebDAV e rclone
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const vault = require('./vault');

const DBX_AUTH = process.env.PROMEMO_DROPBOX_AUTH || 'https://www.dropbox.com/oauth2/authorize';
const DBX_API = process.env.PROMEMO_DROPBOX_API || 'https://api.dropboxapi.com';
const DBX_CONTENT = process.env.PROMEMO_DROPBOX_CONTENT || 'https://content.dropboxapi.com';
const RCLONE = process.env.PROMEMO_RCLONE || 'rclone';
const MAGIC = Buffer.from('PMBK1');
const EXT = '.pmbak';

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const safeHost = () => os.hostname().replace(/[^A-Za-z0-9-]/g, '').slice(0, 24) || 'pc';

// ---------- formato del file ----------
// PMBK1 | lunghezza intestazione (4 byte) | intestazione JSON in chiaro | contenuto cifrato (AES-256-GCM)
async function pack(payload, pass) {
  const salt = crypto.randomBytes(16);
  const key = await vault.kdf(pass, salt);
  const body = vault.seal(key, JSON.stringify(payload));
  const header = Buffer.from(JSON.stringify({ format: 'promemo-backup', v: 1, createdAt: payload.createdAt, device: payload.device, deviceId: payload.deviceId, rev: payload.rev, salt: salt.toString('base64') }));
  const len = Buffer.alloc(4); len.writeUInt32BE(header.length);
  return Buffer.concat([MAGIC, len, header, body]);
}
function readHeader(buf) {
  if (!buf || !buf.subarray(0, 5).equals(MAGIC)) throw new Error('Non è un backup di Promemo');
  const n = buf.readUInt32BE(5);
  return { header: JSON.parse(buf.subarray(9, 9 + n).toString('utf8')), body: buf.subarray(9 + n) };
}
async function unpack(buf, pass) {
  const { header, body } = readHeader(buf);
  const key = await vault.kdf(pass, Buffer.from(header.salt, 'base64'));
  let plain;
  try { plain = vault.open(key, body); } catch { throw new Error('Password del backup errata.'); }
  return { header, payload: JSON.parse(plain.toString('utf8')) };
}

// ---------- utilità di rete ----------
async function req(url, opts = {}, timeout = 60000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    return res;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Tempo scaduto.');
    throw new Error(`Servizio non raggiungibile (${e.cause?.code || e.message}).`);
  } finally { clearTimeout(t); }
}
const bodyText = async (res) => { try { return await res.text(); } catch { return ''; } };

function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    p.stdout.on('data', d => out.push(d)); p.stderr.on('data', d => err.push(d));
    p.on('error', (e) => reject(new Error(e.code === 'ENOENT' ? 'rclone non è installato: installalo con "sudo apt install rclone" e configura il servizio con "rclone config".' : e.message)));
    p.on('close', (code) => code === 0 ? resolve(Buffer.concat(out)) : reject(new Error((Buffer.concat(err).toString().trim().split('\n').pop() || `rclone: codice ${code}`).slice(0, 300))));
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

function createBackup(ctx) {
  // ctx: data(), commit(), secret(k), setSecret(k, v), dataDir(), lockscreen(), status(st), openExternal(url)
  const cfg = () => ctx.data().settings.backup || {};

  // ---------- destinazioni ----------
  const folder = (c) => {
    const dir = path.join(c.path.replace(/^~(?=$|\/)/, os.homedir()), 'Promemo-backup');
    return {
      label: 'Cartella',
      async put(name, buf) { fs.mkdirSync(dir, { recursive: true }); const t = path.join(dir, name + '.tmp'); fs.writeFileSync(t, buf); fs.renameSync(t, path.join(dir, name)); },
      async list(ext = EXT) { if (!fs.existsSync(dir)) return []; return fs.readdirSync(dir).filter(f => f.endsWith(ext)).map(f => { const st = fs.statSync(path.join(dir, f)); return { name: f, size: st.size, mtime: st.mtime.toISOString() }; }); },
      async get(name) { return fs.readFileSync(path.join(dir, path.basename(name))); },
      async del(name) { fs.unlinkSync(path.join(dir, path.basename(name))); },
      async test() { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); return `Scrivo in ${dir}`; },
    };
  };

  const webdav = (c) => {
    const base = c.url.replace(/\/+$/, '') + '/';
    const auth = 'Basic ' + Buffer.from(`${c.user || ''}:${ctx.secret('backup:webdav') || ''}`).toString('base64');
    const H = (extra = {}) => ({ authorization: auth, ...extra });
    const check = async (res, what) => {
      if (res.status === 401) throw new Error('WebDAV: nome utente o password errati.');
      if (!res.ok && res.status !== 207) throw new Error(`WebDAV: ${what} non riuscito (${res.status}).`);
      return res;
    };
    return {
      label: 'WebDAV',
      async ensure() { const r = await req(base, { method: 'MKCOL', headers: H() }); if (![201, 405, 301, 200].includes(r.status) && r.status !== 409) await check(r, 'creazione cartella'); },
      async put(name, buf) { await this.ensure(); await check(await req(base + encodeURIComponent(name), { method: 'PUT', headers: H({ 'content-type': 'application/octet-stream' }), body: buf }, 120000), 'caricamento'); },
      async list(ext = EXT) {
        const r = await check(await req(base, { method: 'PROPFIND', headers: H({ depth: '1', 'content-type': 'application/xml' }), body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/><d:getcontentlength/></d:prop></d:propfind>' }), 'elenco');
        const xml = await bodyText(r);
        const out = [];
        for (const m of xml.matchAll(/<(?:\w+:)?response\b[\s\S]*?<\/(?:\w+:)?response>/gi)) {
          const blk = m[0];
          const href = decodeURIComponent((blk.match(/<(?:\w+:)?href>([^<]+)</i) || [])[1] || '');
          const name = href.replace(/\/+$/, '').split('/').pop();
          if (!name.endsWith(ext)) continue;
          const size = +((blk.match(/getcontentlength>(\d+)</i) || [])[1] || 0);
          const lm = (blk.match(/getlastmodified>([^<]+)</i) || [])[1];
          out.push({ name, size, mtime: lm ? new Date(lm).toISOString() : '' });
        }
        return out;
      },
      async get(name) { const r = await check(await req(base + encodeURIComponent(name), { headers: H() }, 120000), 'scaricamento'); return Buffer.from(await r.arrayBuffer()); },
      async del(name) { await check(await req(base + encodeURIComponent(name), { method: 'DELETE', headers: H() }), 'eliminazione'); },
      async test() { await this.ensure(); await this.list(); return 'Connessione WebDAV riuscita'; },
    };
  };

  async function dbxToken() {
    const s = ctx.secret('backup:dropbox');
    if (!s || !s.refresh_token) throw new Error('Dropbox non collegato.');
    if (s.access_token && s.expiry > Date.now() + 60000) return s.access_token;
    const r = await req(`${DBX_API}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: s.refresh_token, client_id: s.app_key }) });
    const j = JSON.parse(await bodyText(r) || '{}');
    if (!r.ok) throw new Error('Dropbox: accesso scaduto, ricollega l\'account.');
    ctx.setSecret('backup:dropbox', { ...s, access_token: j.access_token, expiry: Date.now() + (j.expires_in || 14400) * 1000 });
    return j.access_token;
  }
  const dropbox = () => {
    const call = async (url, opts, what) => {
      const tok = await dbxToken();
      const r = await req(url, { ...opts, headers: { authorization: `Bearer ${tok}`, ...(opts.headers || {}) } }, 120000);
      if (!r.ok) { const t = await bodyText(r); if (r.status === 409 && /not_found/.test(t)) { const e = new Error('non trovato'); e.notFound = true; throw e; } throw new Error(`Dropbox: ${what} non riuscito (${r.status}) ${t.slice(0, 120)}`); }
      return r;
    };
    return {
      label: 'Dropbox',
      async put(name, buf) { await call(`${DBX_CONTENT}/2/files/upload`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'dropbox-api-arg': JSON.stringify({ path: '/' + name, mode: 'overwrite', mute: true }) }, body: buf }, 'caricamento'); },
      async list(ext = EXT) {
        let r;
        try { r = await call(`${DBX_API}/2/files/list_folder`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: '' }) }, 'elenco'); }
        catch (e) { if (e.notFound) return []; throw e; }
        const j = await r.json();
        return (j.entries || []).filter(e => e['.tag'] === 'file' && e.name.endsWith(ext)).map(e => ({ name: e.name, size: e.size, mtime: e.server_modified }));
      },
      async get(name) { const r = await call(`${DBX_CONTENT}/2/files/download`, { method: 'POST', headers: { 'dropbox-api-arg': JSON.stringify({ path: '/' + name }) } }, 'scaricamento'); return Buffer.from(await r.arrayBuffer()); },
      async del(name) { await call(`${DBX_API}/2/files/delete_v2`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: '/' + name }) }, 'eliminazione'); },
      async test() { await this.list(); return 'Dropbox collegato'; },
    };
  };

  const rclone = (c) => {
    const remote = c.remote.replace(/\/+$/, '');
    return {
      label: 'rclone',
      async put(name, buf) { await run(RCLONE, ['rcat', `${remote}/${name}`], buf); },
      async list(ext = EXT) {
        let out;
        try { out = await run(RCLONE, ['lsjson', remote]); } catch (e) { if (/not found|directory not found/i.test(e.message)) return []; throw e; }
        return JSON.parse(out.toString() || '[]').filter(e => !e.IsDir && e.Name.endsWith(ext)).map(e => ({ name: e.Name, size: e.Size, mtime: e.ModTime }));
      },
      async get(name) { return run(RCLONE, ['cat', `${remote}/${name}`]); },
      async del(name) { await run(RCLONE, ['deletefile', `${remote}/${name}`]); },
      async test() { await run(RCLONE, ['mkdir', remote]); await this.list(); return `rclone raggiunge ${remote}`; },
    };
  };

  function dest(c = cfg().dest) {
    if (!c || !c.type) throw new Error('Scegli dove salvare i backup.');
    if (c.type === 'folder') { if (!c.path) throw new Error('Scegli una cartella.'); return folder(c); }
    if (c.type === 'webdav') { if (!c.url) throw new Error('Inserisci l\'indirizzo WebDAV.'); return webdav(c); }
    if (c.type === 'dropbox') return dropbox(c);
    if (c.type === 'rclone') { if (!c.remote) throw new Error('Inserisci il percorso rclone (es. mega:Promemo).'); return rclone(c); }
    throw new Error('Destinazione sconosciuta.');
  }

  // ---------- Dropbox: collegamento con codice (PKCE, senza segreto) ----------
  let dbxPending = null;
  function dropboxStart(appKey) {
    if (!appKey) throw new Error('Inserisci la App key di Dropbox.');
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    dbxPending = { appKey, verifier };
    const url = `${DBX_AUTH}?` + new URLSearchParams({ client_id: appKey, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline' });
    ctx.openExternal(url);
    return url;
  }
  async function dropboxFinish(code) {
    if (!dbxPending) throw new Error('Premi prima “Apri Dropbox”.');
    const r = await req(`${DBX_API}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: code.trim(), grant_type: 'authorization_code', client_id: dbxPending.appKey, code_verifier: dbxPending.verifier }) });
    const j = JSON.parse(await bodyText(r) || '{}');
    if (!r.ok) throw new Error('Dropbox: codice non valido o scaduto. Riprova.');
    ctx.setSecret('backup:dropbox', { app_key: dbxPending.appKey, refresh_token: j.refresh_token, access_token: j.access_token, expiry: Date.now() + (j.expires_in || 14400) * 1000 });
    dbxPending = null;
    return true;
  }

  // ---------- backup e ripristino ----------
  function deviceId() {
    const d = ctx.data();
    d.settings.backup = d.settings.backup || {};
    if (!d.settings.backup.deviceId) d.settings.backup.deviceId = crypto.randomBytes(8).toString('hex');
    return d.settings.backup.deviceId;
  }
  function payload() {
    const d = JSON.parse(JSON.stringify(ctx.data()));
    // niente stati di sincronizzazione transitori; le credenziali non entrano mai nel backup
    delete d.pendingDeletes;
    return { format: 'promemo-backup', v: 1, createdAt: new Date().toISOString(), device: os.hostname(), deviceId: deviceId(), rev: d.rev || 0, data: d, lockscreen: ctx.lockscreen() };
  }
  const pass = () => { const p = ctx.secret('backup:pass'); if (!p) throw new Error('Imposta la password dei backup.'); return p; };

  let running = false;
  async function backupNow(reason = 'manuale') {
    if (running) return { skipped: true };
    running = true; ctx.status({ backup: 'running' });
    const d = ctx.data(); const b = d.settings.backup = d.settings.backup || {};
    try {
      const target = dest();
      const p = payload();
      const name = `promemo-${stamp(new Date())}-${safeHost()}${EXT}`;
      const buf = await pack(p, pass());
      await target.put(name, buf);
      // conserva solo le ultime N versioni
      const keep = +b.keep || 0;
      if (keep > 0) {
        const all = (await target.list()).sort((a, z) => z.name.localeCompare(a.name));
        for (const old of all.slice(keep)) { try { await target.del(old.name); } catch { /* non bloccante */ } }
      }
      const cur = ctx.data().settings.backup;
      Object.assign(cur, { lastAt: p.createdAt, lastName: name, lastSize: buf.length, lastError: '', lastRev: p.rev, dirty: false, lastReason: reason });
      ctx.commit();
      return { ok: true, name };
    } catch (e) {
      const cur = ctx.data().settings.backup || {};
      cur.lastError = e.message; cur.lastErrorAt = new Date().toISOString();
      ctx.commit();
      throw e;
    } finally { running = false; ctx.status({ backup: 'idle' }); }
  }

  async function listBackups() {
    const items = (await dest().list()).sort((a, z) => z.name.localeCompare(a.name));
    // ricava data e computer dal nome, senza scaricare i file
    return items.map(i => {
      const m = i.name.match(/^promemo-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(.+)\.pmbak$/);
      return { ...i, createdAt: m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString() : i.mtime, device: m ? m[7] : '?' };
    });
  }

  async function readBackup(name, password) {
    const buf = await dest().get(name);
    return unpack(buf, password || pass());
  }

  // controlla se su un altro computer è stato salvato un backup più recente
  async function checkRemote() {
    const b = cfg();
    if (!b.enabled || b.checkRemote === false || !b.dest) return null;
    const list = await listBackups();
    const latest = list[0];
    if (!latest || latest.name === b.lastName || latest.name === b.dismissed || latest.name === b.restoredFrom) return null;
    if (latest.device === safeHost()) return null;
    if (b.lastAt && latest.createdAt <= b.lastAt) return null;
    return latest;
  }

  async function savePass(p, old) {
    const cur = ctx.secret('backup:pass');
    if (cur && old !== undefined && old !== cur) throw new Error('La password attuale dei backup non è corretta.');
    if (!p || p.length < 8) throw new Error('Usa almeno 8 caratteri.');
    ctx.setSecret('backup:pass', p);
    return true;
  }

  return { backupNow, listBackups, readBackup, checkRemote, test: async (c) => dest(c).test(), dropboxStart, dropboxFinish, savePass, pack, unpack, readHeader, payload, dest, dbxToken, pass: () => ctx.secret('backup:pass') };
}

module.exports = { createBackup, EXT };
