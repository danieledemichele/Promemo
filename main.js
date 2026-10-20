// Promemo — processo principale Electron
const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, dialog, shell, safeStorage } = require('electron');
const { createSync } = require('./sync');
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
// se l'app è stata rinominata, recupera i dati dalla cartella del nome precedente
const LEGACY_NAMES = ['Tr' + 'ama', "Trama"];
function migrateLegacy() {
  try {
    const cur = dataDir();
    if (fs.existsSync(path.join(cur, 'promemo.json'))) return;
    for (const n of LEGACY_NAMES) {
      const old = path.join(app.getPath('appData'), n);
      if (old !== cur && fs.existsSync(path.join(old, 'tr' + 'ama.json'))) {
        fs.mkdirSync(cur, { recursive: true });
        for (const f of fs.readdirSync(old)) if (/\.(json|bin)$/.test(f)) fs.copyFileSync(path.join(old, f), path.join(cur, f.replace(/^tr\x61ma/, 'promemo')));
        return;
      }
    }
  } catch (e) { console.error('migrazione', e); }
}
const dataFile = () => path.join(dataDir(), 'promemo.json');

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
  const tmp = dataFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, dataFile());
}

let data = null;

// ---------- Credenziali (cifrate con il portachiavi di sistema se disponibile) ----------
const secretsFile = () => path.join(dataDir(), 'credenziali.bin');
let secrets = null;
function loadSecrets() {
  if (secrets) return secrets;
  try {
    const buf = fs.readFileSync(secretsFile());
    const txt = buf.slice(0, 5).toString() === 'PLAIN' ? buf.slice(5).toString() : safeStorage.decryptString(buf);
    secrets = JSON.parse(txt);
  } catch { secrets = {}; }
  return secrets;
}
function saveSecrets() {
  const txt = JSON.stringify(secrets || {});
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
  openExternal: (url) => process.env.TRAMA_TEST_AUTH ? fetch(url).catch(() => {}) : shell.openExternal(url),
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
      { label: 'Nuovo…', click: () => { showWindow(); win.webContents.send('navigate', { action: 'new' }); } },
      { type: 'separator' },
      { label: 'Esci', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', showWindow);
  } catch (e) { tray = null; }
}

// ---------- IPC ----------
ipcMain.handle('data:get', () => data);
ipcMain.handle('data:set', (_e, d) => {
  const prevAuto = data.settings.autostart;
  const r = sync.reconcile(data, d);
  data = r.data; saveData(data);
  if (r.needsPush) schedulePush();
  if (prevAuto !== data.settings.autostart) setAutostart(data.settings.autostart);
  checkReminders();
  return { rev: data.rev, accounts: data.accounts, pendingDeletes: data.pendingDeletes, events: data.events };
});

// ---------- Account collegati ----------
const wrap = (fn) => async (_e, arg) => { try { return { ok: true, value: await fn(arg) }; } catch (e) { return { ok: false, error: e.cause ? `Rete non raggiungibile: ${e.cause.code || e.message}` : e.message }; } };
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
  fs.copyFileSync(dataFile(), dataFile() + '.prima-import-' + Date.now());
  d.accounts = data.accounts; normalize(d); d.rev = data.rev + 1;
  data = d; saveData(data);
  return data;
});
ipcMain.handle('data:folder', () => shell.openPath(dataDir()));

// ---------- Ciclo di vita ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    app.setAppUserModelId('it.danieledemichele.promemo');
    migrateLegacy();
    data = loadData();
    createWindow();
    createTray();
    checkReminders();
    setInterval(checkReminders, 20 * 1000);
    setTimeout(() => sync.syncAll(), 3000);
    setInterval(() => sync.syncAll(), Math.max(5, data.settings.syncMinutes || 15) * 60000);
    require('electron').powerMonitor.on('resume', () => setTimeout(() => sync.syncAll(), 8000));
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
}
