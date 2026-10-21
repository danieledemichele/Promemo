// Promemo — processo principale Electron
const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, dialog, shell, safeStorage } = require('electron');
const { createSync } = require('./sync');
const vaultLib = require('./vault');
const aiLib = require('./ai');
const { createBackup } = require('./backup');
const { createNotionDb } = require('./notiondb');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ICON = path.join(__dirname, 'build', 'icon.png');
app.commandLine.appendSwitch('lang', 'it-IT');
let win = null;
let tray = null;
let quitting = false;

// ---------- Archivio locale (JSON) ----------
const dataDir = () => app.getPath('userData');
const dataFile = () => path.join(dataDir(), 'promemo.json');
const vaultFile = () => path.join(dataDir(), 'promemo.vault.json');
const encFile = () => path.join(dataDir(), 'promemo.enc');

// ---------- Cassaforte (password all'avvio) ----------
let vault = null;     // intestazione della cassaforte, se la protezione è attiva
let dataKey = null;   // chiave dati in memoria finché l'app resta aperta
let recoveredSession = false;
let failures = 0, nextTry = 0;
function readVault() { try { return JSON.parse(fs.readFileSync(vaultFile(), 'utf8')); } catch { return null; } }
function writeVault(h) { const t = vaultFile() + '.tmp'; fs.writeFileSync(t, JSON.stringify(h, null, 2), { mode: 0o600 }); fs.renameSync(t, vaultFile()); }
function writeAtomic(file, buf) { const t = file + '.tmp'; fs.writeFileSync(t, buf, { mode: 0o600 }); fs.renameSync(t, file); }

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

function pad(n) { return String(n).padStart(2, '0'); }
function localISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function seed() {
  const now = new Date();
  const at = (days, h, m) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return localISO(d); };
  const cats = [
    { id: 'c-viaggi', name: 'Viaggi', icon: 'plane', color: 'orange' },
    { id: 'c-casa', name: 'Casa', icon: 'home', color: 'green' },
    { id: 'c-studio', name: 'Studio', icon: 'book', color: 'blue' },
    { id: 'c-lavoro', name: 'Lavoro', icon: 'briefcase', color: 'purple' },
  ];
  const p1 = uid();
  return {
    version: 1,
    categories: cats,
    projects: [{
      id: p1,
      title: 'Benvenuto in Promemo',
      category: 'c-studio',
      description: 'Un progetto di esempio. Ogni progetto raccoglie passi da fare, appuntamenti e una timeline di tracce. Puoi eliminarlo dal menu ⋯.',
      starred: true,
      status: 'attivo',
      createdAt: at(0, 8, 0),
      updatedAt: localISO(now),
      steps: [
        { id: uid(), text: 'Crea il tuo primo progetto con il tasto +', due: at(0, 18, 0), reminder: 0, done: false },
        { id: uid(), text: 'Aggiungi un appuntamento nell\'Agenda', due: at(1, 10, 0), reminder: null, done: false },
      ],
      traces: [
        { id: uid(), title: 'Come funziona', body: 'Le tracce sono note datate: annota decisioni, prenotazioni, idee. Restano in ordine cronologico.', at: localISO(now) },
      ],
    }],
    events: [
      { id: uid(), title: 'Ripasso settimanale', kind: 'appuntamento', projectId: p1, start: at(0, 18, 30), end: at(0, 19, 0), allDay: false, location: '', reminder: 15 },
    ],
    settings: { theme: 'auto', notifications: true, closeToTray: true, autostart: false },
  };
}

function normalize(d) {
  d.accounts = d.accounts || [];
  d.pendingDeletes = d.pendingDeletes || [];
  d.rev = d.rev || 0;
  for (const acc of d.accounts) {
    if (acc.groups) continue;
    acc.groups = acc.provider === 'google' ? acc.calendars.map(c => ({ id: c.id, name: c.name, color: c.color, visible: true }))
      : acc.provider === 'ics' ? [{ id: 'ics', name: acc.calendars[0].name, color: acc.calendars[0].color, visible: true }]
      : [{ id: '', name: acc.name, color: '#8e8e93', visible: true }];
    if (acc.config && acc.config.colorProp === undefined) acc.config.colorProp = '';
  }
  d.settings = Object.assign({ theme: 'auto', notifications: true, closeToTray: true, autostart: false, defaultCalendar: '', syncMinutes: 15 }, d.settings || {});
  return d;
}

function loadData() {
  if (vault) {
    if (!dataKey) throw new Error('bloccato');
    if (!fs.existsSync(encFile())) { const d = normalize(seed()); saveData(d); return d; }
    return normalize(JSON.parse(vaultLib.open(dataKey, fs.readFileSync(encFile())).toString('utf8')));
  }
  try {
    const raw = fs.readFileSync(dataFile(), 'utf8');
    return normalize(JSON.parse(raw));
  } catch (e) {
    if (fs.existsSync(dataFile())) {
      // file corrotto: lo metto da parte invece di sovrascriverlo
      fs.copyFileSync(dataFile(), dataFile() + '.corrotto-' + Date.now());
    }
    const d = normalize(seed());
    saveData(d);
    return d;
  }
}

function saveData(d) {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (vault) {
    if (!dataKey) return; // bloccata: niente da salvare
    writeAtomic(encFile(), vaultLib.seal(dataKey, JSON.stringify(d)));
    return;
  }
  const tmp = dataFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, dataFile());
}

let data = null;

// ---------- Credenziali (cifrate con il portachiavi di sistema se disponibile) ----------
const secretsFile = () => path.join(dataDir(), 'credenziali.bin');
const secretsEnc = () => path.join(dataDir(), 'credenziali.enc');
let secrets = null;
function loadSecrets() {
  if (secrets) return secrets;
  if (vault && dataKey) {
    try { secrets = JSON.parse(vaultLib.open(dataKey, fs.readFileSync(secretsEnc())).toString('utf8')); } catch { secrets = {}; }
    return secrets;
  }
  try {
    const buf = fs.readFileSync(secretsFile());
    const txt = buf.slice(0, 5).toString() === 'PLAIN' ? buf.slice(5).toString() : safeStorage.decryptString(buf);
    secrets = JSON.parse(txt);
  } catch { secrets = {}; }
  return secrets;
}
function saveSecrets() {
  const txt = JSON.stringify(secrets || {});
  if (vault) { if (dataKey) writeAtomic(secretsEnc(), vaultLib.seal(dataKey, txt)); return; }
  let buf;
  try { buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(txt) : null; } catch { buf = null; }
  if (!buf) buf = Buffer.concat([Buffer.from('PLAIN'), Buffer.from(txt)]);
  fs.writeFileSync(secretsFile(), buf, { mode: 0o600 });
}

function commit() {
  data.rev = (data.rev || 0) + 1;
  saveData(data);
  if (win) win.webContents.send('data-changed', data);
}

const sync = createSync({
  data: () => data,
  commit,
  secret: (id) => loadSecrets()[id],
  setSecret: (id, v) => { loadSecrets()[id] = v; saveSecrets(); },
  removeSecret: (id) => { delete loadSecrets()[id]; saveSecrets(); },
  openExternal: (url) => process.env.PROMEMO_TEST_AUTH ? fetch(url).catch(() => {}) : shell.openExternal(url),
  status: (st) => { if (win) win.webContents.send('sync-status', st); },
});
let pushTimer = null;
const schedulePush = () => { clearTimeout(pushTimer); pushTimer = setTimeout(() => sync.syncAll(), 2500); };

// ---------- Promemoria ----------
function remindTime(item, field) {
  if (item.reminder === null || item.reminder === undefined || !item[field]) return null;
  const t = new Date(item[field]).getTime() - item.reminder * 60000;
  return isNaN(t) ? null : t;
}

function fmtTime(s) {
  const d = new Date(s);
  return d.toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function notify(title, body, route) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON, urgency: 'normal' });
  n.on('click', () => { showWindow(); if (route && win) win.webContents.send('navigate', route); });
  n.show();
}

function checkReminders() {
  if (!data || !data.settings.notifications) return;
  const now = Date.now();
  const window6h = 6 * 3600 * 1000; // non notificare promemoria troppo vecchi (es. PC spento)
  let changed = false;
  const projName = (id) => (data.projects.find(p => p.id === id) || {}).title;

  for (const ev of data.events) {
    const t = remindTime(ev, 'start');
    if (t && t <= now && now - t < window6h && ev.notifiedAt !== t) {
      const pn = projName(ev.projectId);
      notify(ev.title, `${fmtTime(ev.start)}${ev.location ? ' · ' + ev.location : ''}${pn ? '\n' + pn : ''}`, { view: 'agenda', date: ev.start.slice(0, 10) });
      ev.notifiedAt = t; changed = true;
    }
  }
  for (const p of data.projects) {
    if (p.status === 'archiviato') continue;
    for (const s of p.steps) {
      if (s.done) continue;
      const t = remindTime(s, 'due');
      if (t && t <= now && now - t < window6h && s.notifiedAt !== t) {
        notify(`Prossimo passo · ${p.title}`, `${s.text}\nScadenza: ${fmtTime(s.due)}`, { view: 'progetti', id: p.id });
        s.notifiedAt = t; changed = true;
      }
    }
  }
  if (changed) commit();
}

// ---------- Avvio automatico ----------
function setAutostart(on) {
  const dir = path.join(os.homedir(), '.config', 'autostart');
  const file = path.join(dir, 'promemo.desktop');
  try {
    if (on) {
      fs.mkdirSync(dir, { recursive: true });
      const exec = process.env.APPIMAGE || process.execPath + (app.isPackaged ? '' : ' ' + JSON.stringify(app.getAppPath()));
      fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Promemo\nExec=${exec} --hidden\nIcon=${ICON}\nX-GNOME-Autostart-enabled=true\n`);
    } else if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (e) { console.error('autostart', e); }
}

// ---------- Finestra e vassoio ----------
function showWindow() {
  if (!win) createWindow();
  win.show(); win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 940, minHeight: 620,
    frame: false,
    backgroundColor: '#f2f1ee',
    icon: ICON,
    show: !process.argv.includes('--hidden'),
    title: 'Promemo',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.on('close', (e) => {
    if (!data) { quitting = true; app.quit(); return; } // bloccata: chiudere significa uscire
    if (!quitting && data.settings.closeToTray && tray) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });
  win.on('maximize', () => win.webContents.send('maximized', true));
  win.on('unmaximize', () => win.webContents.send('maximized', false));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(ICON).resize({ width: 22, height: 22 });
    tray = new Tray(img);
    tray.setToolTip('Promemo');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Apri Promemo', click: showWindow },
      { label: 'Nuovo…', click: () => { showWindow(); if (data) win.webContents.send('navigate', { action: 'new' }); } },
      { type: 'separator' },
      { label: 'Esci', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', showWindow);
  } catch (e) { tray = null; }
}

// ---------- IPC ----------
ipcMain.handle('data:get', () => data);
ipcMain.handle('data:set', (_e, d) => {
  if (!data) return null;
  const prevAuto = data.settings.autostart;
  // viaggi ed eventi dei viaggi li gestisce il processo principale
  d.trips = data.trips; d.events = d.events.filter(e => !e.tripRef).concat(data.events.filter(e => e.tripRef));
  const r = sync.reconcile(data, d);
  data = r.data; saveData(data);
  markDirty();
  if (r.needsPush) schedulePush();
  if (prevAuto !== data.settings.autostart) setAutostart(data.settings.autostart);
  checkReminders();
  return { rev: data.rev, accounts: data.accounts, pendingDeletes: data.pendingDeletes, events: data.events };
});

// ---------- Account collegati ----------
const wrap = (fn) => async (_e, arg) => { if (!data) return { ok: false, error: 'Promemo è bloccata' }; try { return { ok: true, value: await fn(arg) }; } catch (e) { return { ok: false, error: e.cause ? `Rete non raggiungibile: ${e.cause.code || e.message}` : e.message }; } };
ipcMain.handle('acc:google', wrap((a) => sync.googleConnect(a)));
ipcMain.handle('acc:notion-inspect', wrap((a) => sync.notionInspect(a)));
ipcMain.handle('acc:notion', wrap((a) => sync.notionConnect(a)));
ipcMain.handle('acc:ics', wrap((a) => sync.icsConnect(a)));
ipcMain.handle('acc:calendly', wrap((a) => sync.calendlyConnect(a)));
ipcMain.handle('acc:notion-props', wrap((id) => sync.notionProps(id)));
ipcMain.handle('acc:notion-color', wrap(({ id, prop }) => sync.setNotionColorProp(id, prop)));
ipcMain.handle('acc:sync', wrap(async (id) => { await sync.syncAll(id); return true; }));
ipcMain.handle('acc:remove', wrap(({ id, removeEvents }) => sync.disconnect(id, removeEvents)));
ipcMain.handle('acc:update', wrap(({ id, patch }) => {
  const a = data.accounts.find(x => x.id === id);
  if (!a) throw new Error('Account non trovato');
  if (patch.calendars) for (const c of patch.calendars) { const t = a.calendars.find(x => x.id === c.id); if (t) t.enabled = c.enabled; }
  if ('enabled' in patch) a.enabled = patch.enabled;
  if ('defaultReminder' in patch) a.defaultReminder = patch.defaultReminder;
  if ('name' in patch && a.provider === 'ics') { a.name = patch.name; }
  if ('dedupe' in patch && a.config) a.config.dedupe = patch.dedupe;
  if (patch.groups) for (const g of patch.groups) {
    const t = (a.groups || []).find(x => x.id === g.id);
    if (t) { if (g.color) t.color = g.color; if (g.name) t.name = g.name; if ('visible' in g) t.visible = g.visible; }
  }
  if (patch.groups && Object.keys(patch).length === 1) { commit(); return a; } // solo colori: niente sincronizzazione
  commit();
  'dedupe' in patch ? sync.syncAll() : sync.syncAll(id);
  return a;
}));
ipcMain.on('open-url', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:maximize', () => win && (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.on('win:close', () => win && win.close());
ipcMain.on('notify:test', () => notify('Promemo', 'Le notifiche funzionano. Ti avviserò all\'orario dei promemoria.'));
ipcMain.handle('data:export', async () => {
  const { filePath } = await dialog.showSaveDialog(win, { defaultPath: `promemo-backup-${localISO(new Date()).slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (!filePath) return false;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return true;
});
ipcMain.handle('data:import', async () => {
  // gli account collegati restano quelli attuali
  const { filePaths } = await dialog.showOpenDialog(win, { filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
  if (!filePaths || !filePaths[0]) return null;
  const d = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
  if (!Array.isArray(d.projects) || !Array.isArray(d.events)) throw new Error('File non valido');
  if (!vault && fs.existsSync(dataFile())) fs.copyFileSync(dataFile(), dataFile() + '.prima-import-' + Date.now());
  d.accounts = data.accounts; normalize(d); d.rev = data.rev + 1;
  data = d; saveData(data);
  return data;
});
ipcMain.handle('data:folder', () => shell.openPath(dataDir()));

// ---------- Aspetto della schermata di blocco (non riservato: serve prima dello sblocco) ----------
const lsFile = () => path.join(dataDir(), 'promemo.lockscreen.json');
const LS_DEFAULT = { bg: 'aurora', palette: 'tramonto', colors: ['#ff8a4c', '#5ac8fa', '#9775fa'], solid: '#1c1c1e', image: '', blur: 0, dim: 25,
  animate: true, clock: true, clockWeight: 700, clockSize: 86, date: true, welcome: '', subtitle: '', showHint: true, card: 'vetro', text: 'auto', icon: true };
const LS_KEYS = Object.keys(LS_DEFAULT);
function readLs() { try { return { ...LS_DEFAULT, ...JSON.parse(fs.readFileSync(lsFile(), 'utf8')) }; } catch { return { ...LS_DEFAULT }; } }
function lsFull() {
  const c = readLs();
  if (c.image) {
    try {
      const buf = fs.readFileSync(path.join(dataDir(), c.image));
      const ext = path.extname(c.image).slice(1).toLowerCase();
      c.imageData = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buf.toString('base64')}`;
    } catch { c.image = ''; if (c.bg === 'immagine') c.bg = 'aurora'; }
  }
  return c;
}
function writeLs(c) {
  const out = {};
  for (const k of LS_KEYS) out[k] = c[k] ?? LS_DEFAULT[k];
  out.welcome = String(out.welcome || '').slice(0, 60); out.subtitle = String(out.subtitle || '').slice(0, 90);
  out.blur = Math.max(0, Math.min(40, +out.blur || 0)); out.dim = Math.max(0, Math.min(80, +out.dim || 0));
  out.clockSize = Math.max(48, Math.min(140, +out.clockSize || 86));
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(lsFile(), JSON.stringify(out, null, 2));
}
ipcMain.handle('ls:get', () => lsFull());
ipcMain.handle('ls:set', (_e, patch) => { if (!data) return null; writeLs({ ...readLs(), ...patch }); return lsFull(); });
ipcMain.handle('ls:reset', () => { if (!data) return null; const c = readLs(); writeLs({ ...LS_DEFAULT, image: c.image }); return lsFull(); });
ipcMain.handle('ls:image', async () => {
  if (!data) return null;
  const { filePaths } = await dialog.showOpenDialog(win, { title: 'Sfondo della schermata di blocco', filters: [{ name: 'Immagini', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }], properties: ['openFile'] });
  if (!filePaths || !filePaths[0]) return null;
  const st = fs.statSync(filePaths[0]);
  if (st.size > 15 * 1024 * 1024) return { error: 'Immagine troppo grande (massimo 15 MB).' };
  const ext = path.extname(filePaths[0]).toLowerCase().replace('.jpeg', '.jpg');
  const c = readLs();
  if (c.image) { try { fs.unlinkSync(path.join(dataDir(), c.image)); } catch {} }
  const name = 'lockscreen-sfondo-' + Date.now().toString(36) + ext;
  fs.copyFileSync(filePaths[0], path.join(dataDir(), name));
  writeLs({ ...c, image: name, bg: 'immagine' });
  return lsFull();
});
ipcMain.handle('ls:image-clear', () => {
  if (!data) return null;
  const c = readLs();
  if (c.image) { try { fs.unlinkSync(path.join(dataDir(), c.image)); } catch {} }
  writeLs({ ...c, image: '', bg: c.bg === 'immagine' ? 'aurora' : c.bg });
  return lsFull();
});

// ---------- Backup ----------
const backup = createBackup({
  data: () => data,
  commit,
  secret: (k) => loadSecrets()[k],
  setSecret: (k, v) => { loadSecrets()[k] = v; saveSecrets(); },
  lockscreen: () => readLs(),
  status: (st) => { if (win) win.webContents.send('backup-status', st); },
  openExternal: (url) => process.env.PROMEMO_TEST_AUTH ? null : shell.openExternal(url),
});
const bkCfg = () => (data && data.settings.backup) || {};
let bkTimer = null;
function markDirty() {
  const b = bkCfg();
  if (!b.enabled) return;
  b.dirty = true;
  if ((b.auto || 'change') !== 'change') return;
  clearTimeout(bkTimer);
  bkTimer = setTimeout(() => backup.backupNow('automatico').catch(() => {}), (+b.delayMin || 10) * 60000);
}
function backupTick() {
  const b = bkCfg();
  if (!data || !b.enabled || b.auto === 'manual') return;
  const old = !b.lastAt || Date.now() - new Date(b.lastAt).getTime() > 24 * 3600 * 1000;
  if (old && (b.dirty || !b.lastAt)) backup.backupNow('giornaliero').catch(() => {});
}
async function remoteCheck() {
  if (!data) return;
  try { const r = await backup.checkRemote(); if (r && win) win.webContents.send('backup-remote', r); } catch { /* offline */ }
}
const PROTECTED = ['lockDeclined', 'backup', 'ai'];
async function applyRestore(payload, label) {
  // copia di sicurezza dello stato attuale prima di sostituirlo
  try {
    const p = loadSecrets()['backup:pass'];
    if (p) {
      const dir = path.join(dataDir(), 'prima-dei-ripristini'); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `prima-del-ripristino-${Date.now()}.pmbak`), await backup.pack(backup.payload(), p));
      const olds = fs.readdirSync(dir).sort().reverse(); for (const f of olds.slice(5)) fs.unlinkSync(path.join(dir, f));
    }
  } catch (e) { console.error('copia di sicurezza', e); }
  const d = payload.data;
  if (!d || !Array.isArray(d.projects) || !Array.isArray(d.events)) throw new Error('Il backup non contiene dati validi.');
  const keepAcc = data.accounts, keepSet = {}; for (const k of PROTECTED) if (k in data.settings) keepSet[k] = data.settings[k];
  const accIds = new Set(keepAcc.map(a => a.id));
  for (const e of d.events) { if (e.source && !accIds.has(e.source.acc)) delete e.source; if (e.pushTo && !accIds.has(e.pushTo.acc)) delete e.pushTo; }
  d.accounts = keepAcc; d.pendingDeletes = data.pendingDeletes || [];
  d.settings = { ...(d.settings || {}), ...keepSet };
  d.settings.backup = { ...(d.settings.backup || {}), restoredFrom: label, lastRestoreAt: new Date().toISOString() };
  normalize(d); d.rev = (data.rev || 0) + 1;
  data = d;
  if (payload.lockscreen) { try { const ls = readLs(); writeLs({ ...payload.lockscreen, image: ls.image, bg: payload.lockscreen.bg === 'immagine' && !ls.image ? 'aurora' : payload.lockscreen.bg }); } catch {} }
  commit();
  return true;
}
ipcMain.handle('bk:now', wrap(() => backup.backupNow('manuale')));
ipcMain.handle('bk:list', wrap(() => backup.listBackups()));
ipcMain.handle('bk:test', wrap((c) => backup.test(c)));
ipcMain.handle('bk:dbx-start', wrap((k) => backup.dropboxStart(k)));
ipcMain.handle('bk:dbx-finish', wrap((code) => backup.dropboxFinish(code)));
ipcMain.handle('bk:pass', wrap(({ pass, old }) => backup.savePass(pass, old)));
ipcMain.handle('bk:secret', wrap(({ key, value }) => { if (!['backup:webdav'].includes(key)) throw new Error('chiave non ammessa'); const s = loadSecrets(); if (value) s[key] = value; else delete s[key]; saveSecrets(); return true; }));
ipcMain.handle('bk:status', () => { if (!data) return {}; const s = loadSecrets(); return { hasPass: !!s['backup:pass'], hasDropbox: !!(s['backup:dropbox'] && s['backup:dropbox'].refresh_token), hasWebdav: !!s['backup:webdav'] }; });
ipcMain.handle('bk:restore', wrap(async ({ name, file, password }) => {
  const r = file ? await backup.unpack(fs.readFileSync(file), password || loadSecrets()['backup:pass'] || '') : await backup.readBackup(name, password);
  return applyRestore(r.payload, name || path.basename(file));
}));
ipcMain.handle('bk:peek-file', wrap(async () => {
  const { filePaths } = await dialog.showOpenDialog(win, { title: 'Ripristina da file', filters: [{ name: 'Backup di Promemo', extensions: ['pmbak'] }], properties: ['openFile'] });
  if (!filePaths || !filePaths[0]) return null;
  const { header } = backup.readHeader(fs.readFileSync(filePaths[0]));
  return { file: filePaths[0], header };
}));
ipcMain.handle('bk:dismiss', (_e, name) => { if (!data) return; data.settings.backup = { ...bkCfg(), dismissed: name }; commit(); });
ipcMain.handle('bk:choose-folder', async () => {
  const { filePaths } = await dialog.showOpenDialog(win, { title: 'Cartella per i backup', properties: ['openDirectory', 'createDirectory'] });
  return filePaths && filePaths[0] ? filePaths[0] : null;
});
ipcMain.handle('bk:detect', () => {
  const h = os.homedir();
  const c = [['MEGA', 'MEGA'], ['MEGAsync', 'MEGA'], ['Dropbox', 'Dropbox'], ['Nextcloud', 'Nextcloud'], ['ownCloud', 'ownCloud'], ['OneDrive', 'OneDrive'], ['Google Drive', 'Google Drive'], ['GoogleDrive', 'Google Drive'], ['pCloudDrive', 'pCloud'], ['Sync', 'Syncthing'], ['kDrive', 'kDrive']];
  return c.map(([d, n]) => ({ path: path.join(h, d), name: n })).filter(x => { try { return fs.statSync(x.path).isDirectory(); } catch { return false; } });
});

// ---------- Meteo (Open-Meteo, gratuito e senza account) ----------
const WX_API = process.env.PROMEMO_WEATHER_API || 'https://api.open-meteo.com';
const GEO_API = process.env.PROMEMO_GEO_API || 'https://geocoding-api.open-meteo.com';
const WX_DEFAULT = { enabled: true, name: 'Cagliari', region: 'Sardegna, Italia', lat: 39.2238, lon: 9.1217, headers: true };
let wxCache = null;
async function getJson(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.reason || `Errore ${r.status}`);
    return j;
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'Il servizio meteo non risponde.' : e.cause ? 'Meteo non raggiungibile: sei offline?' : e.message); }
  finally { clearTimeout(t); }
}
ipcMain.handle('wx:get', async (_e, { force } = {}) => {
  if (!data) return { ok: false, error: 'bloccata' };
  const w = { ...WX_DEFAULT, ...(data.settings.weather || {}) };
  if (!w.enabled) return { ok: true, value: null };
  const key = `${w.lat},${w.lon}`;
  if (!force && wxCache && wxCache.key === key && Date.now() - wxCache.at < 30 * 60000) return { ok: true, value: wxCache.value };
  const q = new URLSearchParams({
    latitude: w.lat, longitude: w.lon, timezone: 'auto', forecast_days: '7',
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
  });
  try {
    const j = await getJson(`${WX_API}/v1/forecast?${q}`);
    const value = { place: w.name, region: w.region, fetchedAt: new Date().toISOString(), current: j.current, hourly: j.hourly, daily: j.daily };
    wxCache = { key, at: Date.now(), value };
    return { ok: true, value };
  } catch (e) {
    if (wxCache && wxCache.key === key) return { ok: true, value: { ...wxCache.value, stale: true }, error: e.message };
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('wx:search', async (_e, name) => {
  try {
    const j = await getJson(`${GEO_API}/v1/search?` + new URLSearchParams({ name: String(name || '').slice(0, 80), count: '8', language: 'it', format: 'json' }));
    return { ok: true, value: (j.results || []).map(r => ({ name: r.name, region: [r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude })) };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Database Notion e viaggi ----------
const ndb = createNotionDb({ data: () => data, secret: (id) => loadSecrets()[id] });
ipcMain.handle('ndb:accounts', () => (data ? data.accounts.filter(a => a.provider === 'notion').map(a => ({ id: a.id, name: a.name })) : []));
ipcMain.handle('ndb:list', wrap((acc) => ndb.listDatabases(acc)));
ipcMain.handle('ndb:schema', wrap(({ acc, db }) => ndb.schema(acc, db)));
ipcMain.handle('ndb:query', wrap(({ acc, db, cursor, sorts }) => ndb.query(acc, db, { cursor, sorts })));
ipcMain.handle('ndb:update', wrap(({ acc, page, props }) => ndb.update(acc, page, props)));
ipcMain.handle('ndb:create', wrap(({ acc, db, props }) => ndb.create(acc, db, props)));
ipcMain.handle('ndb:archive', wrap(({ acc, page }) => ndb.archive(acc, page)));

const pick = (props, names, type) => { for (const n of names) { const p = props[n]; if (p && (!type || p.type === type)) return p.value; } const any = type ? Object.values(props).find(p => p.type === type) : null; return any ? any.value : null; };
const asList = (v) => Array.isArray(v) ? v.map(x => x.name) : v && v.name ? [v.name] : [];
const pad2 = (n) => String(n).padStart(2, '0');
const toLocal = (s) => { if (!s) return null; if (s.length === 10) return s + 'T00:00'; const d = new Date(s); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

function tripItem(r) {
  const P = r.props;
  const date = pick(P, ['Date', 'Data', 'Quando'], 'date');
  return {
    id: r.id, url: r.url, title: pick(P, ['Activity', 'Attività', 'Name', 'Nome'], 'title') || '(senza titolo)',
    start: date ? toLocal(date.start) : null, end: date && date.end ? toLocal(date.end) : null, allDay: !!(date && date.start && date.start.length === 10),
    time: pick(P, ['Time', 'Ora', 'Orario'], 'rich_text') || '',
    place: pick(P, ['Luogo', 'Place', 'Location', 'Posto'], 'place') || (pick(P, ['Luogo', 'Location', 'Indirizzo'], 'rich_text') ? { name: pick(P, ['Luogo', 'Location', 'Indirizzo'], 'rich_text'), lat: null, lon: null } : null),
    type: (pick(P, ['Type', 'Tipo', 'Categoria'], 'select') || {}).name || '',
    transport: (pick(P, ['Transport', 'Trasporto', 'Mezzo'], 'select') || {}).name || pick(P, ['Transport', 'Trasporto', 'Mezzo'], 'rich_text') || '',
    status: (pick(P, ['Status', 'Stato'], 'status') || pick(P, ['Status', 'Stato'], 'select') || {}).name || '',
    booked: !!pick(P, ['Booked', 'Prenotato'], 'checkbox'),
    cost: pick(P, ['Estimated Cost', 'Costo', 'Cost'], 'number'),
    city: (pick(P, ['City', 'Città'], 'select') || {}).name || '',
    storia: P['Storia']?.value || '', cercare: P['Da cercare']?.value || '', anno: P['Anno storico']?.value || '', notes: P['Notes']?.value || P['Note']?.value || '',
  };
}

let tripSyncing = false;
async function syncTrips() {
  const cfg = data && data.settings.trips;
  if (!cfg || !cfg.destDb) throw new Error('Scegli prima il database delle destinazioni.');
  if (tripSyncing) return false;
  tripSyncing = true;
  try {
    const dests = await ndb.queryAll(cfg.acc, cfg.destDb);
    const old = data.trips || {};
    const trips = {};
    for (const r of dests) {
      if (r.archived) continue;
      const P = r.props, st = pick(P, ['Status', 'Stato'], 'status') || pick(P, ['Status', 'Stato'], 'select');
      const dt = pick(P, ['Date (Planned)', 'Date', 'Data', 'Date planned'], 'date');
      const prev = old[r.id] || {};
      const t = {
        id: r.id, url: r.url, icon: r.icon, name: pick(P, ['Name', 'Nome'], 'title') || 'Viaggio', status: st?.name || '', statusColor: st?.color || '',
        start: dt?.start || null, end: dt?.end || null, nights: pick(P, ['Nights', 'Notti'], 'number'),
        type: asList(P['Type']?.value), transport: asList(P['Transportation']?.value ?? P['Trasporto']?.value), buddy: asList(P['Travel Buddy']?.value), budget: asList(P['Budget']?.value),
        continent: asList(P['Continent']?.value), favorite: !!P['Favorite']?.value, based: !!P['Based']?.value,
        itineraryDb: prev.itineraryDb || null, currency: prev.currency || null, items: prev.items || [], ai: prev.ai || null, syncedAt: prev.syncedAt || null,
      };
      // l'itinerario: database annidato nella pagina della destinazione (solo per viaggi fatti o in programma)
      const wanted = !/want|desider/i.test(t.status) || cfg.allItineraries;
      if (wanted) {
        try {
          if (!t.itineraryDb) { const ch = await ndb.childDatabases(cfg.acc, r.id); const it = ch.find(c => /itiner/i.test(c.title)) || ch[0]; t.itineraryDb = it ? it.id : null; }
          if (t.itineraryDb) {
            if (!t.currency) { try { const sc = await ndb.schema(cfg.acc, t.itineraryDb); const f = (sc.props.find(p => /cost|costo|prezzo|price/i.test(p.name) && p.type === 'number') || {}).format || ''; t.currency = /pound/.test(f) ? '£' : /dollar/.test(f) ? '$' : /yen/.test(f) ? '¥' : /franc/.test(f) ? 'CHF' : '€'; } catch { t.currency = '€'; } }
            let items = (await ndb.queryAll(cfg.acc, t.itineraryDb)).filter(x => !x.archived).map(tripItem);
            const same = items.filter(i => i.city && i.city.toLowerCase() === t.name.toLowerCase());
            if (same.length && same.length < items.length) items = same;
            items.sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999') || (a.time || '').localeCompare(b.time || ''));
            t.items = items; t.syncedAt = new Date().toISOString();
          }
        } catch (e) { t.error = e.message; }
      }
      trips[r.id] = t;
    }
    data.trips = trips;
    tripsToAgenda();
    commit();
    return Object.keys(trips).length;
  } finally { tripSyncing = false; }
}
// le tappe con data e ora diventano eventi dell'agenda (sola lettura) che aprono l'itinerario
function tripsToAgenda() {
  const cfg = data.settings.trips || {};
  data.events = data.events.filter(e => !e.tripRef);
  if (cfg.agenda === false) return;
  let n = 0;
  for (const t of Object.values(data.trips || {})) {
    if (t.based || /want|desider/i.test(t.status)) continue;
    if (t.start) {
      const s = t.start.slice(0, 10), e = (t.end || t.start).slice(0, 10);
      data.events.push({ id: 'trip-' + t.id, title: `${t.icon || '✈️'} Viaggio · ${t.name}`, kind: 'evento', projectId: '', allDay: true, start: s + 'T00:00', end: e + 'T23:59', location: t.name, reminder: null, notes: '', tripRef: { dest: t.id } });
    }
    t.items.forEach((it, i) => {
      if (!it.start || it.allDay) return;
      const next = t.items.slice(i + 1).find(x => x.start && !x.allDay && x.start.slice(0, 10) === it.start.slice(0, 10));
      let end = it.end;
      if (!end) { const d = new Date(it.start); const nx = next ? new Date(next.start) : null; const e = new Date(d.getTime() + 60 * 60000); end = toLocal((nx && nx > d && nx < e ? nx : e).toISOString()); }
      const em = (it.type.match(/^\p{Extended_Pictographic}\uFE0F?/u) || [''])[0];
      data.events.push({ id: 'trip-' + it.id, title: (em ? em + ' ' : '') + it.title, kind: 'appuntamento', projectId: '', allDay: false, start: it.start, end, location: it.place?.name || '', reminder: null, notes: '', tripRef: { dest: t.id, item: it.id } });
      n++;
    });
  }
  return n;
}
ipcMain.handle('trip:sync', wrap(() => syncTrips()));
ipcMain.handle('trip:children', wrap(({ acc, page }) => ndb.childDatabases(acc, page)));
ipcMain.handle('trip:agenda', wrap(() => { tripsToAgenda(); commit(); return true; }));
ipcMain.handle('trip:ai', wrap(({ id, ai }) => { const t = data.trips && data.trips[id]; if (!t) throw new Error('Viaggio non trovato'); t.ai = ai; commit(); return true; }));

// ---------- Assistente IA ----------
ipcMain.handle('ai:chat', async (_e, { system, messages, maxTokens }) => {
  if (!data) return { ok: false, error: 'Promemo è bloccata' };
  const cfg = data.settings.ai || {};
  try { return { ok: true, text: await aiLib.chat(cfg, loadSecrets()['ai:' + cfg.provider], system, messages, { maxTokens }) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('ai:key', (_e, { provider, key }) => {
  if (!data) return false;
  const s = loadSecrets();
  if (key) s['ai:' + provider] = key; else delete s['ai:' + provider];
  saveSecrets();
  return true;
});
ipcMain.handle('ai:has-key', (_e, provider) => !!(data && loadSecrets()['ai:' + provider]));
ipcMain.handle('ai:defaults', () => aiLib.DEFAULTS);

// ---------- IPC della cassaforte ----------
const isStrong = (p) => typeof p === 'string' && p.length >= 8;
function removePlainCopies() {
  const dir = dataDir();
  for (const f of fs.readdirSync(dir)) {
    if (/^promemo\.json(\.tmp|\.corrotto-\d+|\.prima-import-\d+)?$/.test(f) || f === 'credenziali.bin') { try { fs.unlinkSync(path.join(dir, f)); } catch {} }
  }
}

ipcMain.handle('lock:state', () => ({ lockscreen: lsFull(), configured: !!vault, locked: !!vault && !dataKey, hint: vault ? vault.hint || '' : '', wait: Math.max(0, nextTry - Date.now()), recovered: recoveredSession }));

ipcMain.handle('lock:unlock', async (_e, { secret, recovery }) => {
  if (!vault) return { ok: true };
  if (dataKey) return { ok: true };
  const wait = nextTry - Date.now();
  if (wait > 0) return { ok: false, wait, error: 'Troppi tentativi: riprova tra poco.' };
  const key = await vaultLib.unlock(vault, secret || '', !!recovery);
  if (!key) {
    failures++;
    if (failures >= 3) nextTry = Date.now() + Math.min(60, 2 ** (failures - 3)) * 1000;
    return { ok: false, wait: Math.max(0, nextTry - Date.now()), error: recovery ? 'Chiave di recupero non valida.' : 'Password errata.' };
  }
  failures = 0; nextTry = 0;
  dataKey = key;
  recoveredSession = !!recovery;
  try { data = loadData(); } catch (e) { dataKey = null; return { ok: false, error: 'Impossibile leggere i dati: ' + e.message }; }
  secrets = null;
  startServices();
  return { ok: true, recovered: recoveredSession };
});

ipcMain.handle('lock:setup', async (_e, { password, hint }) => {
  if (vault) return { ok: false, error: 'La protezione è già attiva.' };
  if (!data) return { ok: false, error: 'Dati non disponibili.' };
  if (!isStrong(password)) return { ok: false, error: 'Usa almeno 8 caratteri.' };
  const plainSecrets = { ...loadSecrets() };
  delete data.settings.lockDeclined;
  const r = await vaultLib.create(password, hint);
  vault = r.header; dataKey = r.dataKey;
  writeVault(vault);
  saveData(data);
  secrets = plainSecrets; saveSecrets();
  removePlainCopies();
  return { ok: true, recovery: r.recovery };
});

ipcMain.handle('lock:change', async (_e, { current, next, hint }) => {
  if (!vault || !dataKey) return { ok: false, error: 'Protezione non attiva.' };
  if (!isStrong(next)) return { ok: false, error: 'La nuova password deve avere almeno 8 caratteri.' };
  if (!recoveredSession) {
    const k = await vaultLib.unlock(vault, current || '');
    if (!k) return { ok: false, error: 'La password attuale non è corretta.' };
  }
  vault = await vaultLib.setPassword(vault, dataKey, next, hint);
  writeVault(vault);
  recoveredSession = false;
  return { ok: true };
});

ipcMain.handle('lock:remove', async (_e, { current }) => {
  if (!vault || !dataKey) return { ok: false, error: 'Protezione non attiva.' };
  const k = await vaultLib.unlock(vault, current || '');
  if (!k) return { ok: false, error: 'Password non corretta.' };
  const sec = { ...loadSecrets() };
  vault = null; dataKey = null; secrets = sec;
  saveData(data); saveSecrets();
  for (const f of [vaultFile(), encFile(), secretsEnc()]) { try { fs.unlinkSync(f); } catch {} }
  return { ok: true };
});

let servicesStarted = false;
function startServices() {
  if (servicesStarted) return;
  servicesStarted = true;
  checkReminders();
  setInterval(checkReminders, 20 * 1000);
  const tripAuto = () => { if (data && data.settings.trips && data.settings.trips.destDb) syncTrips().catch(e => console.warn('viaggi:', e.message)); };
  setTimeout(() => { sync.syncAll(); tripAuto(); }, 3000);
  setInterval(() => { if (data) { sync.syncAll(); tripAuto(); } }, Math.max(5, data.settings.syncMinutes || 15) * 60000);
  require('electron').powerMonitor.on('resume', () => setTimeout(() => { if (data) sync.syncAll(); remoteCheck(); }, 8000));
  setTimeout(remoteCheck, 6000);
  setInterval(remoteCheck, 30 * 60000);
  setInterval(backupTick, 60 * 60000);
  setTimeout(backupTick, 60000);
}

// ---------- Ciclo di vita ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    app.setAppUserModelId('it.danieledemichele.promemo');
    vault = readVault();
    if (!vault) data = loadData();
    // con la protezione attiva la finestra si apre sempre (serve la password), anche con --hidden
    if (vault && process.argv.includes('--hidden')) process.argv.splice(process.argv.indexOf('--hidden'), 1);
    createWindow();
    createTray();
    if (data) startServices();
  });
  let finalBackupDone = false;
  app.on('before-quit', (e) => {
    quitting = true;
    const b = bkCfg();
    if (finalBackupDone || !data || !b.enabled || !b.dirty || b.auto === 'manual') return;
    e.preventDefault();
    finalBackupDone = true;
    clearTimeout(bkTimer);
    Promise.race([backup.backupNow('chiusura').catch(() => {}), new Promise(r => setTimeout(r, 15000))]).then(() => app.quit());
  });
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
}
