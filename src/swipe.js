/* Promemo — in Agenda si va avanti e indietro con lo scorrimento a due dita del touchpad (o la rotellina orizzontale).
   Nella vista Mese anche lo scorrimento verticale cambia mese, quando la pagina non ha niente da scorrere. */
'use strict';
let swAcc = 0, swReset = null, swLocked = false, swIdle = null, swMin = 0, swLast = 0;
const SW_STEP = 80;

function swScrollable(el, dy) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 2) {
      if (dy > 0 && n.scrollTop + n.clientHeight < n.scrollHeight - 1) return true;
      if (dy < 0 && n.scrollTop > 0) return true;
    }
  }
  return false;
}

document.addEventListener('wheel', (e) => {
  if (!data || ui.view !== 'agenda' || ui.search || e.ctrlKey || e.metaKey) return;
  const t = e.target;
  if (!t.closest || !t.closest('#view .agenda') || t.closest('.sheet, .modal, #popover-layer, select, textarea')) return;
  const horiz = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.3 || (e.shiftKey && e.deltaY);
  let d = 0;
  if (horiz) d = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
  else if (calMode() === 'mese' && !swScrollable(t, e.deltaY)) d = e.deltaY;
  if (!d) return;
  e.preventDefault();
  // dopo un cambio aspetto che il gesto (e la sua inerzia) finisca, così un solo gesto = un solo passo
  // (almeno mezzo secondo, e finché arrivano eventi a meno di 220 ms l'uno dall'altro)
  const now = performance.now();
  if (swLocked) { if (now < swMin || now - swLast < 220) { swLast = now; return; } swLocked = false; }
  swLast = now;
  swAcc += e.deltaMode === 1 ? d * 16 : d;
  clearTimeout(swReset); swReset = setTimeout(() => { swAcc = 0; }, 220);
  if (Math.abs(swAcc) < SW_STEP) return;
  const dir = swAcc > 0 ? 1 : -1;
  swAcc = 0; swLocked = true;
  calShift(dir);
  swMin = performance.now() + 500; swLast = performance.now();
  const g = document.querySelector('#view .agenda .tg-row, #view .agenda .agenda-main, #view .agenda .month');
  if (g) { g.classList.remove('swipe-next', 'swipe-prev'); void g.offsetWidth; g.classList.add(dir > 0 ? 'swipe-next' : 'swipe-prev'); }
}, { passive: false });

// anche con le frecce della tastiera (← →) quando non si sta scrivendo
document.addEventListener('keydown', (e) => {
  if (!data || ui.view !== 'agenda' || e.altKey || e.ctrlKey || e.metaKey) return;
  if (document.activeElement && document.activeElement.closest('input, textarea, select, [contenteditable]')) return;
  if (!$('#modal-backdrop').hidden) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); calShift(e.key === 'ArrowRight' ? 1 : -1); }
  if (e.key.toLowerCase() === 't' && !e.shiftKey) { actions['cal-today'](); }
});
