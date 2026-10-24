// Promemo — registro degli errori e dei malfunzionamenti (~/.config/Promemo/logs/promemo.log)
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX = 1024 * 1024, KEEP = 3;
let dir = null, file = null, buffer = [], counts = { error: 0, warn: 0 }, recent = [];
const SECRET = /(ntn_[A-Za-z0-9]+|secret_[A-Za-z0-9]+|sk-[A-Za-z0-9-_]{8,}|cal_(?:live|test)_[A-Za-z0-9]+|gh[pousr]_[A-Za-z0-9]{20,}|sl\.[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+\/=-]+|Basic\s+[A-Za-z0-9+\/=]{8,}|(?:access|refresh)_token=[^&\s]+|secret=[A-Z2-7]{16,}|#k=[A-Za-z0-9_-]{8,}|\bk=[A-Za-z0-9_-]{16,}|"?(?:refresh_token|access_token|password|passwd|pass|token|apiKey|api_key|client_secret|key)"?\s*[:=]\s*"[^"]*")/gi;
const clean = (s) => String(s).replace(SECRET, '[nascosto]');

function init(d) {
  dir = path.join(d, 'logs'); file = path.join(dir, 'promemo.log');
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700); } catch { /* */ }
  for (const l of buffer) write(l); buffer = [];
}
function rotate() {
  try {
    if (fs.statSync(file).size < MAX) return;
    for (let i = KEEP - 1; i >= 1; i--) { const a = `${file}.${i}`, b = `${file}.${i + 1}`; if (fs.existsSync(a)) fs.renameSync(a, b); }
    fs.renameSync(file, `${file}.1`);
  } catch { /* */ }
}
function write(line) {
  if (!file) { buffer.push(line); return; }
  try { rotate(); fs.appendFileSync(file, line + '\n', { mode: 0o600 }); } catch { /* il registro non deve mai bloccare l'app */ }
}
function fmt(level, src, msg, err) {
  let s = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${src}] ${clean(msg)}`;
  if (err && err.stack) s += '\n    ' + clean(err.stack).split('\n').slice(0, 8).join('\n    ');
  else if (err && typeof err === 'object' && !(err instanceof Error)) { try { s += ' ' + clean(JSON.stringify(err)).slice(0, 800); } catch { /* */ } }
  return s;
}
function log(level, src, msg, err) {
  const line = fmt(level, src, typeof msg === 'string' ? msg : (msg && msg.message) || String(msg), err || (msg instanceof Error ? msg : null));
  if (level in counts) counts[level]++;
  if (level !== 'info') { recent.push({ at: new Date().toISOString(), level, src, msg: clean(typeof msg === 'string' ? msg : (msg && msg.message) || String(msg)).slice(0, 400) }); if (recent.length > 200) recent.shift(); }
  write(line);
}
const api = {
  init, clean,
  info: (src, msg) => log('info', src, msg),
  warn: (src, msg, err) => log('warn', src, msg, err),
  error: (src, msg, err) => log('error', src, msg, err),
  file: () => file, dir: () => dir,
  stats: () => ({ ...counts, recent: recent.slice(-50).reverse() }),
  read(maxBytes = 200000) { try { const b = fs.readFileSync(file); return b.subarray(Math.max(0, b.length - maxBytes)).toString('utf8'); } catch { return ''; } },
  clear() { try { fs.writeFileSync(file, ''); for (let i = 1; i <= KEEP; i++) fs.rmSync(`${file}.${i}`, { force: true }); } catch { /* */ } counts = { error: 0, warn: 0 }; recent = []; },
  // un pacchetto leggibile da allegare a una segnalazione: versioni, impostazioni senza segreti, registro
  diagnostics(extra = {}) {
    const lines = [
      '# Promemo · diagnostica', `Data: ${new Date().toISOString()}`, `Sistema: ${os.type()} ${os.release()} ${os.arch()} · ${process.env.XDG_CURRENT_DESKTOP || ''} ${process.env.WAYLAND_DISPLAY ? 'Wayland' : process.env.DISPLAY ? 'X11' : ''}`,
      `Versioni: ${Object.entries(extra.versions || {}).map(([k, v]) => `${k} ${v}`).join(' · ')}`, '',
      '## Stato', clean(JSON.stringify(extra.state || {}, null, 2)), '',
      '## Registro (ultima parte)', api.read(150000),
    ];
    return lines.join('\n');
  },
};
module.exports = api;
