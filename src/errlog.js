/* Promemo — errori dell'interfaccia nel registro (~/.config/Promemo/logs/promemo.log) */
'use strict';
(function () {
  const where = (location.pathname.split('/').pop() || 'index.html').replace('.html', '');
  const send = (msg, stack) => { try { window.promemo && window.promemo.logError && window.promemo.logError(where, msg, stack); } catch { /* */ } };
  window.addEventListener('error', (e) => send(`${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`, e.error && e.error.stack));
  window.addEventListener('unhandledrejection', (e) => { const r = e.reason; send('promessa rifiutata: ' + (r && r.message || String(r)), r && r.stack); });
})();
