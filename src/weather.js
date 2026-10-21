/* Promemo — meteo: icona nella barra in alto, pannello con previsioni, giorni della settimana */
'use strict';

let wx = null, wxErr = '';
const WX_DEF = { enabled: true, name: 'Cagliari', region: 'Sardegna, Italia', lat: 39.2238, lon: 9.1217, headers: true };
const wxCfg = () => ({ ...WX_DEF, ...(data.settings.weather || {}) });

// codici meteo WMO → descrizione e tipo di icona
function wxInfo(code) {
  const c = +code;
  if (c === 0) return ['Sereno', 'clear'];
  if (c === 1) return ['Poco nuvoloso', 'mostly'];
  if (c === 2) return ['Parzialmente nuvoloso', 'partly'];
  if (c === 3) return ['Coperto', 'cloud'];
  if (c === 45 || c === 48) return ['Nebbia', 'fog'];
  if (c >= 51 && c <= 55) return ['Pioviggine', 'drizzle'];
  if (c === 56 || c === 57) return ['Pioviggine gelata', 'drizzle'];
  if (c === 61) return ['Pioggia debole', 'rain'];
  if (c === 63) return ['Pioggia', 'rain'];
  if (c === 65) return ['Pioggia forte', 'heavy'];
  if (c === 66 || c === 67) return ['Pioggia gelata', 'rain'];
  if (c === 71 || c === 73 || c === 75 || c === 77) return ['Neve', 'snow'];
  if (c >= 80 && c <= 82) return ['Rovesci', 'heavy'];
  if (c === 85 || c === 86) return ['Rovesci di neve', 'snow'];
  if (c === 95) return ['Temporale', 'thunder'];
  if (c === 96 || c === 99) return ['Temporale con grandine', 'thunder'];
  return ['—', 'cloud'];
}

// icone a colori (disegnate qui, nessuna risorsa esterna)
function wxIcon(code, day = true, size = 22) {
  const k = wxInfo(code)[1];
  const sun = (cx, cy, r) => `<g stroke="#FFB020" stroke-width="1.6" stroke-linecap="round">${[0, 45, 90, 135, 180, 225, 270, 315].map(a => { const t = a * Math.PI / 180; return `<line x1="${cx + Math.cos(t) * (r + 2)}" y1="${cy + Math.sin(t) * (r + 2)}" x2="${cx + Math.cos(t) * (r + 3.6)}" y2="${cy + Math.sin(t) * (r + 3.6)}"/>`; }).join('')}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFC83D" stroke="none"/>`;
  const moon = (cx, cy, r) => `<path d="M${cx + r * 0.35} ${cy - r} a${r} ${r} 0 1 0 ${r * 0.65} ${r * 1.55} a${r * 0.8} ${r * 0.8} 0 0 1 ${-r * 0.65} ${-r * 1.55}z" fill="#A9B4E0" stroke="none"/>`;
  const cloud = (fill = '#D5DCE5', dy = 0) => `<path d="M7 ${18 + dy}h10.5a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6-1.3A3.9 3.9 0 0 0 7 ${18 + dy}z" fill="${fill}" stroke="${fill === '#D5DCE5' ? '#B8C2CE' : 'none'}" stroke-width=".8"/>`;
  const drops = (n, color = '#4DABF7', len = 3) => `<g stroke="${color}" stroke-width="1.6" stroke-linecap="round">${[...Array(n)].map((_, i) => `<line x1="${8.5 + i * 3.4}" y1="19.6" x2="${7.6 + i * 3.4}" y2="${19.6 + len}"/>`).join('')}</g>`;
  let body;
  if (k === 'clear') body = day ? sun(12, 12, 4.6) : moon(11, 12, 6);
  else if (k === 'mostly') body = (day ? sun(9.5, 9, 3.6) : moon(8.5, 8.5, 4.4)) + `<path d="M11 18.5h7a2.6 2.6 0 0 0 .3-5.2 3.6 3.6 0 0 0-6.9-.8A2.9 2.9 0 0 0 11 18.5z" fill="#E3E8EF" stroke="#B8C2CE" stroke-width=".8"/>`;
  else if (k === 'partly') body = (day ? sun(8.5, 8.5, 3.4) : moon(8, 8, 4)) + cloud();
  else if (k === 'cloud') body = `<path d="M9 13.5h8a3 3 0 0 0 .3-6 4.2 4.2 0 0 0-8-1A3.3 3.3 0 0 0 9 13.5z" fill="#AEB8C4" stroke="none" transform="translate(-1 -1)"/>` + cloud();
  else if (k === 'fog') body = cloud('#D5DCE5', -3) + `<g stroke="#9AA5B1" stroke-width="1.6" stroke-linecap="round"><line x1="5" y1="18.5" x2="19" y2="18.5"/><line x1="7" y1="21.3" x2="17" y2="21.3"/></g>`;
  else if (k === 'drizzle') body = cloud('#C5CED9', -2) + `<g fill="#4DABF7" stroke="none"><circle cx="9" cy="19.5" r="1"/><circle cx="12.5" cy="21" r="1"/><circle cx="16" cy="19.5" r="1"/></g>`;
  else if (k === 'rain') body = cloud('#B9C3CF', -2) + drops(3);
  else if (k === 'heavy') body = cloud('#97A3B2', -2) + drops(4, '#228BE6', 3.4);
  else if (k === 'snow') body = cloud('#C5CED9', -2) + `<g fill="#74C0FC" stroke="none"><circle cx="8.5" cy="19.6" r="1.2"/><circle cx="12.5" cy="21.6" r="1.2"/><circle cx="16.5" cy="19.6" r="1.2"/></g>`;
  else body = cloud('#8D99A8', -2) + `<path d="M12.6 16.5l-2.4 4h2.2l-1 3.5 3.6-5h-2.3l1.3-2.5z" fill="#FFC83D" stroke="none"/>`;
  return `<svg class="wx-svg" viewBox="0 0 24 24" width="${size}" height="${size}" style="width:${size}px;height:${size}px">${body}</svg>`;
}

const t0 = (v) => `${Math.round(v)}°`;
const WD = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

// previsione giornaliera per una data (YYYY-MM-DD), se disponibile
function wxDay(dk) {
  if (!wx || !wx.daily) return null;
  const i = wx.daily.time.indexOf(dk);
  if (i < 0) return null;
  return { code: wx.daily.weather_code[i], max: wx.daily.temperature_2m_max[i], min: wx.daily.temperature_2m_min[i], rain: wx.daily.precipitation_probability_max?.[i] };
}

function renderWxButton() {
  const b = $('#btn-wx'); if (!b) return;
  const c = wxCfg();
  if (!c.enabled) { b.hidden = true; return; }
  b.hidden = false;
  if (!wx || !wx.current) { b.innerHTML = `<span class="wx-ph">${wxErr ? '!' : '…'}</span>`; b.title = wxErr || 'Carico il meteo…'; return; }
  const cur = wx.current;
  b.innerHTML = `${wxIcon(cur.weather_code, cur.is_day, 20)}<b>${t0(cur.temperature_2m)}</b>`;
  b.title = `${wx.place}: ${wxInfo(cur.weather_code)[0].toLowerCase()}, ${t0(cur.temperature_2m)}`;
}

async function loadWx(force) {
  if (!data || !wxCfg().enabled) { renderWxButton(); return; }
  const r = await api.wxGet({ force });
  if (r.ok) { wx = r.value; wxErr = r.error || ''; } else wxErr = r.error;
  renderWxButton();
  if (ui.view === 'home' || (ui.view === 'agenda' && calMode() !== 'mese')) { if (!tgDrag && !popState && $('#modal-backdrop').hidden && !document.activeElement?.closest('#sheet textarea, input, textarea, [contenteditable]')) render(); }
  if ($('#popover-layer .wx-pop')) openWx(true);
}

function openWx(refreshOnly) {
  const layer = $('#popover-layer');
  if (!refreshOnly && layer.querySelector('.wx-pop')) { layer.innerHTML = ''; return; }
  if (!wx || !wx.current) { if (!refreshOnly) { toast(wxErr || 'Meteo non ancora disponibile'); loadWx(true); } return; }
  const cur = wx.current, d0 = wxDay(wx.daily.time[0]);
  const now = new Date();
  const hi = wx.hourly.time.findIndex(t => new Date(t) >= new Date(now.getTime() - 3600000));
  const hours = wx.hourly.time.slice(hi, hi + 24).map((t, j) => ({ t: new Date(t), temp: wx.hourly.temperature_2m[hi + j], code: wx.hourly.weather_code[hi + j], p: wx.hourly.precipitation_probability?.[hi + j], day: wx.hourly.is_day?.[hi + j] ?? 1 }));
  const allMin = Math.min(...wx.daily.temperature_2m_min), allMax = Math.max(...wx.daily.temperature_2m_max);
  const span = Math.max(1, allMax - allMin);
  const sr = wx.daily.sunrise?.[0] ? new Date(wx.daily.sunrise[0]) : null, ss = wx.daily.sunset?.[0] ? new Date(wx.daily.sunset[0]) : null;
  const html = `<div class="menu wx-pop">
    <div class="wx-head">
      <div class="grow"><b>${esc(wx.place)}</b><small>${esc(wx.region || '')}</small></div>
      <button class="icon-btn" data-wx="refresh" title="Aggiorna">${icon('i-refresh')}</button>
      <button class="icon-btn" data-wx="settings" title="Cambia località">${icon('i-gear')}</button>
    </div>
    <div class="wx-now">
      ${wxIcon(cur.weather_code, cur.is_day, 64)}
      <div class="wx-temp">${t0(cur.temperature_2m)}</div>
      <div class="wx-desc"><b>${wxInfo(cur.weather_code)[0]}</b><small>Percepita ${t0(cur.apparent_temperature)}${d0 ? ` · max ${t0(d0.max)} min ${t0(d0.min)}` : ''}</small></div>
    </div>
    <div class="wx-chips">
      <span>${icon('i-drop')} Umidità ${Math.round(cur.relative_humidity_2m)}%</span>
      <span>${icon('i-wind')} Vento ${Math.round(cur.wind_speed_10m)} km/h</span>
      ${d0 && d0.rain != null ? `<span>${icon('i-umbrella')} Pioggia ${d0.rain}%</span>` : ''}
      ${sr && ss ? `<span>${icon('i-sunrise')} ${fmtHM(sr)} – ${fmtHM(ss)}</span>` : ''}
    </div>
    <div class="wx-sec">Prossime ore</div>
    <div class="wx-hours">${hours.map((h, i) => `<div class="wx-h"><small>${i === 0 ? 'Ora' : pad(h.t.getHours())}</small>${wxIcon(h.code, h.day, 24)}<b>${t0(h.temp)}</b>${h.p ? `<em>${h.p}%</em>` : '<em>&nbsp;</em>'}</div>`).join('')}</div>
    <div class="wx-sec">7 giorni</div>
    <div class="wx-days">${wx.daily.time.map((t, i) => {
      const d = parse(t), mn = wx.daily.temperature_2m_min[i], mx = wx.daily.temperature_2m_max[i], p = wx.daily.precipitation_probability_max?.[i];
      return `<div class="wx-d"><span class="wx-dn">${i === 0 ? 'Oggi' : WD[d.getDay()]}</span>${wxIcon(wx.daily.weather_code[i], true, 22)}<span class="wx-p">${p ? p + '%' : ''}</span><span class="wx-mn">${t0(mn)}</span><span class="wx-bar"><i style="left:${(mn - allMin) / span * 100}%;right:${100 - (mx - allMin) / span * 100}%"></i></span><span class="wx-mx">${t0(mx)}</span></div>`;
    }).join('')}</div>
    <div class="wx-foot">${wx.stale ? '<span style="color:#e0352b">Offline: dati delle ' + fmtHM(new Date(wx.fetchedAt)) + '</span>' : 'Aggiornato alle ' + fmtHM(new Date(wx.fetchedAt))} · Open-Meteo</div>
  </div>`;
  layer.innerHTML = html;
  const m = layer.firstChild, r = $('#btn-wx').getBoundingClientRect();
  m.style.top = (r.bottom + 8) + 'px';
  m.style.left = Math.max(12, Math.min(r.right - m.offsetWidth, window.innerWidth - m.offsetWidth - 12)) + 'px';
  m.addEventListener('click', (e) => {
    const b = e.target.closest('[data-wx]'); if (!b) return;
    if (b.dataset.wx === 'refresh') { b.classList.add('spin'); loadWx(true); }
    if (b.dataset.wx === 'settings') { layer.innerHTML = ''; modalSettings('meteo'); }
  });
  if (!refreshOnly) {
    const outside = (e) => { if (!m.isConnected) return document.removeEventListener('mousedown', outside, true); if (!m.contains(e.target) && !e.target.closest('#btn-wx')) { layer.innerHTML = ''; document.removeEventListener('mousedown', outside, true); } };
    setTimeout(() => document.addEventListener('mousedown', outside, true));
  }
}

$('#btn-wx').addEventListener('click', () => openWx(false));

// ---------- sezione delle impostazioni ----------
SET_PANES.splice(SET_PANES.findIndex(p => p[0] === 'calendario') + 1, 0, ['meteo', 'i-sun', 'Meteo']);
const _paneHTML_wx = paneHTML;
paneHTML = function (id, ls) {
  if (id !== 'meteo') return _paneHTML_wx(id, ls);
  const c = wxCfg();
  return `<h3>Meteo</h3>
    <div class="set-group">
      ${srow('Mostra il meteo', 'Icona in alto a destra con previsioni a 7 giorni', `<input type="checkbox" class="switch" id="wx-on" ${c.enabled ? 'checked' : ''}>`)}
      ${srow('Località', `${esc(c.name)}${c.region ? ' · ' + esc(c.region) : ''}`, `<form id="wx-form" class="row" style="gap:6px"><input class="set-input" id="wx-q" placeholder="Cerca una città" autocomplete="off"><button class="btn small">Cerca</button></form>`)}
      <div class="set-sub" id="wx-res" hidden></div>
      ${srow('Previsioni nei giorni dell\'agenda', 'Icona e temperatura massima nelle viste Giorno e Settimana', `<input type="checkbox" class="switch" id="wx-head" ${c.headers !== false ? 'checked' : ''}>`)}
    </div>
    <p class="set-note">Dati di Open-Meteo: gratuiti, senza account. Viene inviata solo la posizione della località scelta.</p>`;
};
const _drawPane_wx = drawPane;
drawPane = function (m) {
  _drawPane_wx(m);
  if (setPane !== 'meteo') return;
  const box = m.querySelector('#set-pane');
  const set = (patch, redraw) => { data.settings.weather = { ...wxCfg(), ...patch }; save(); wx = null; renderWxButton(); loadWx(true); if (redraw) drawPane(m); };
  box.querySelector('#wx-on').addEventListener('change', (e) => set({ enabled: e.target.checked }));
  box.querySelector('#wx-head').addEventListener('change', (e) => { data.settings.weather = { ...wxCfg(), headers: e.target.checked }; save(); render(); });
  box.querySelector('#wx-form').addEventListener('submit', async (e) => {
    e.preventDefault(); e.stopPropagation();
    const q = box.querySelector('#wx-q').value.trim(); if (!q) return;
    const res = box.querySelector('#wx-res'); res.hidden = false; res.innerHTML = '<span class="set-note">Cerco…</span>';
    const r = await api.wxSearch(q);
    if (!r.ok) { res.innerHTML = `<span class="set-note" style="color:#e0352b">${esc(r.error)}</span>`; return; }
    if (!r.value.length) { res.innerHTML = '<span class="set-note">Nessuna località trovata.</span>'; return; }
    res.innerHTML = r.value.map((x, i) => `<button class="wx-place" data-i="${i}">${icon('i-pin')}<b>${esc(x.name)}</b><small>${esc(x.region)}</small></button>`).join('');
    res.querySelectorAll('.wx-place').forEach(b => b.addEventListener('click', () => { const x = r.value[+b.dataset.i]; set({ ...x, enabled: true }, true); toast(`Meteo: ${x.name}`); }));
  }, true);
};

// aggiornamento: all'avvio e ogni 30 minuti
setInterval(() => loadWx(false), 30 * 60000);
const _wxWait = setInterval(() => { if (data) { clearInterval(_wxWait); loadWx(false); } }, 500);

// riquadro meteo nella Home (in alto a destra)
function wxHeroHTML() {
  if (!wxCfg().enabled || !wx || !wx.current) return '';
  const c = wx.current, d0 = wxDay(wx.daily.time[0]);
  return `<button class="wx-hero" data-action="wx-open" title="Previsioni">${wxIcon(c.weather_code, c.is_day, 46)}<span><b>${t0(c.temperature_2m)}</b><small>${esc(wxInfo(c.weather_code)[0])}${d0 ? ` · ${t0(d0.max)}/${t0(d0.min)}` : ''}</small><small>${esc(wx.place)}</small></span></button>`;
}
Object.assign(actions, { 'wx-open': () => openWx(false) });
