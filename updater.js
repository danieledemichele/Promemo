// Promemo — aggiornamenti dalle release di GitHub
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const REPO = 'danieledemichele/Promemo';
const API = process.env.PROMEMO_UPDATE_API || 'https://api.github.com';

// confronto di versioni "1.10.2" > "1.9.9"
function newer(a, b) {
  const p = (v) => String(v || '').replace(/^v/, '').split(/[.-]/).map(x => parseInt(x, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}

function createUpdater({ app, send, onLog = () => {} }) {
  let state = { checking: false, available: null, checkedAt: null, error: '', progress: null, installing: false };
  const current = app.getVersion();
  const mode = process.env.APPIMAGE ? 'appimage' : (app.isPackaged && /^\/(opt|usr)\//.test(process.execPath) ? 'deb' : 'manual');
  const pub = () => ({ ...state, current, mode });
  const emit = () => send('update-state', pub());

  async function check() {
    if (state.checking || state.installing) return pub();
    state.checking = true; state.error = ''; emit();
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
      const r = await fetch(`${API}/repos/${REPO}/releases/latest`, { signal: ctl.signal, headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Promemo/${current}` } }).finally(() => clearTimeout(t));
      if (r.status === 404) { state.available = null; return pub(); } // nessuna release pubblicata
      if (!r.ok) throw new Error(r.status === 403 ? 'GitHub ha limitato le richieste, riprovo più tardi.' : `GitHub: errore ${r.status}`);
      const j = await r.json();
      const version = String(j.tag_name || j.name || '').replace(/^v/, '');
      if (j.draft || j.prerelease || !newer(version, current)) { state.available = null; return pub(); }
      const asset = (re) => (j.assets || []).find(a => re.test(a.name));
      const ai = asset(/\.AppImage$/i), deb = asset(/amd64\.deb$|\.deb$/i);
      state.available = { version, name: j.name || 'Promemo ' + version, notes: String(j.body || '').slice(0, 6000), url: j.html_url, date: j.published_at,
        appimage: ai ? { url: ai.browser_download_url, size: ai.size, name: ai.name } : null,
        deb: deb ? { url: deb.browser_download_url, size: deb.size, name: deb.name } : null };
      onLog(`aggiornamento disponibile: ${version}`);
      return pub();
    } catch (e) {
      state.error = e.name === 'AbortError' ? 'GitHub non risponde.' : e.cause ? 'Non riesco a raggiungere GitHub: sei offline?' : e.message;
      onLog(`controllo aggiornamenti: ${state.error}`, true);
      return pub();
    } finally { state.checking = false; state.checkedAt = new Date().toISOString(); emit(); }
  }

  async function download(asset, dest) {
    const r = await fetch(asset.url, { headers: { 'User-Agent': `Promemo/${current}`, Accept: 'application/octet-stream' } });
    if (!r.ok || !r.body) throw new Error(`Download non riuscito (${r.status})`);
    const total = Number(r.headers.get('content-length')) || asset.size || 0;
    let got = 0, last = 0;
    const body = Readable.fromWeb(r.body);
    body.on('data', (c) => { got += c.length; const now = Date.now(); if (now - last > 200) { last = now; state.progress = total ? got / total : null; emit(); } });
    await pipeline(body, fs.createWriteStream(dest, { mode: 0o755 }));
    if (total && got < total) throw new Error('Download incompleto');
    state.progress = 1; emit();
  }

  // AppImage: sostituisce il file e riavvia · .deb: installazione con la finestra di password del sistema
  async function install() {
    const u = state.available;
    if (!u) throw new Error('Nessun aggiornamento disponibile');
    if (state.installing) return pub();
    state.installing = true; state.progress = 0; state.error = ''; emit();
    try {
      if (mode === 'appimage' && u.appimage) {
        const target = process.env.APPIMAGE;
        const tmp = path.join(path.dirname(target), `.${path.basename(target)}.nuovo`);
        try { fs.accessSync(path.dirname(target), fs.constants.W_OK); } catch { throw new Error('Non posso scrivere nella cartella dell’AppImage: scarica la nuova versione dalla pagina della release.'); }
        await download(u.appimage, tmp);
        fs.chmodSync(tmp, 0o755);
        fs.renameSync(tmp, target);
        app.relaunch({ execPath: target, args: process.argv.slice(1).filter(a => a !== '--hidden') });
        setTimeout(() => app.exit(0), 300);
        return { ...pub(), restarting: true };
      }
      if (mode === 'deb' && u.deb) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promemo-agg-'));
        const file = path.join(dir, u.deb.name.replace(/[^\w.-]/g, '_'));
        await download(u.deb, file);
        state.progress = null; state.phase = 'install'; emit();
        await new Promise((res, rej) => execFile('pkexec', ['/usr/bin/apt-get', 'install', '-y', '--allow-downgrades', file], { timeout: 10 * 60000 }, (err, _o, se) => {
          if (!err) return res();
          if (err.code === 126 || err.code === 127) return rej(new Error('Installazione annullata.'));
          rej(new Error((se || err.message).toString().trim().split('\n').pop() || 'Installazione non riuscita'));
        }));
        app.relaunch(); setTimeout(() => app.exit(0), 300);
        return { ...pub(), restarting: true };
      }
      throw new Error('manual');
    } catch (e) {
      state.error = e.message === 'manual' ? '' : e.message;
      if (state.error) onLog(`installazione aggiornamento: ${state.error}`, true);
      if (e.message === 'manual') { require('electron').shell.openExternal(u.url); }
      return pub();
    } finally { state.installing = false; state.phase = null; if (!state.error) state.progress = null; emit(); }
  }

  return { check, install, state: pub };
}

module.exports = { createUpdater, newer };
