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
        // il pacchetto scaricato resta lì: se l'installazione non va, si riprova senza riscaricarlo
        let file = state.file && state.file.version === u.version && fs.existsSync(state.file.path) && fs.statSync(state.file.path).size === (u.deb.size || fs.statSync(state.file.path).size) ? state.file.path : null;
        if (!file) {
          const dir = path.join(os.tmpdir(), 'promemo-aggiornamenti'); fs.mkdirSync(dir, { recursive: true });
          file = path.join(dir, u.deb.name.replace(/[^\w.-]/g, '_'));
          await download(u.deb, file);
          state.file = { path: file, version: u.version };
        }
        state.progress = null; state.phase = 'install'; state.detail = ''; emit();
        // una sola richiesta di password: sistemo un'eventuale installazione rimasta a metà, poi installo
        const script = 'export DEBIAN_FRONTEND=noninteractive; dpkg --configure -a >/dev/null 2>&1; apt-get install -y --allow-downgrades "$1" 2>&1 || { dpkg -i "$1" 2>&1; apt-get install -f -y 2>&1; dpkg -s promemo 2>/dev/null | grep -q "install ok installed"; }';
        await new Promise((res, rej) => execFile('pkexec', ['/bin/sh', '-c', script, 'promemo-agg', file], { timeout: 10 * 60000, maxBuffer: 4 * 1024 * 1024 }, (err, so, se) => {
          const out = `${so || ''}\n${se || ''}`.trim();
          if (!err) return res();
          state.detail = out.split('\n').slice(-30).join('\n');
          onLog(`installazione .deb non riuscita (codice ${err.code}):\n${out.slice(-4000)}`, true);
          if (err.code === 126 || err.code === 127) return rej(new Error('Password non corretta o finestra della password chiusa: premi Riprova.'));
          if (/lock|bloccat|risorsa temporaneamente non disponibile/i.test(out)) return rej(new Error('Un altro programma sta installando pacchetti (es. Aggiornamenti software): attendi che finisca e premi Riprova.'));
          const line = out.split('\n').find(l => /^dpkg: (error|errore)|errore nell'elaborazione|error processing|unmet dependencies|dipendenze non soddisfatte/i.test(l));
          rej(new Error(line ? `Installazione non riuscita: ${line.replace(/^dpkg:\s*/, '')}` : 'Installazione non riuscita: apri i dettagli o installa dal terminale con il comando qui sotto.'));
        }));
        state.file = null;
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

  // dopo un errore: si torna allo stato normale (il pacchetto scaricato resta per riprovare)
  function reset() { if (!state.installing) { state.error = ''; state.detail = ''; state.progress = null; state.phase = null; emit(); } return pub(); }
  function reveal() { if (state.file && fs.existsSync(state.file.path)) require('electron').shell.showItemInFolder(state.file.path); return pub(); }
  return { check, install, reset, reveal, state: pub };
}

module.exports = { createUpdater, newer };
