/* Promemo — verifica in due passaggi: impostazioni (QR da inquadrare, codici di emergenza) e codice all'avvio */
'use strict';
const TFA_APPS = 'Google Authenticator, Microsoft Authenticator, Aegis, 2FAS, Authy, Ente Auth, Proton Pass, Bitwarden o 1Password';

// ---------- impostazioni → Password ----------
const _paneHTML_tfa = paneHTML;
paneHTML = function (id, ls) {
  const h = _paneHTML_tfa(id, ls);
  if (id !== 'sicurezza') return h;
  const on = lockInfo.twoFactor;
  return h + `<h4 class="set-h">Verifica in due passaggi</h4>
    <div class="set-group">
      ${srow('Codice dall’app di autenticazione', !lockInfo.configured ? 'Attiva prima la password all’avvio' : on ? `Attiva · all’avvio, dopo la password, serve il codice a 6 cifre · ${lockInfo.backupLeft} codici di emergenza rimasti` : 'Non attiva · basta la password per aprire Promemo',
        !lockInfo.configured ? '' : on ? '<button class="btn small" data-tfa="codes">Nuovi codici di emergenza</button><button class="btn small danger" data-tfa="off">Disattiva</button>' : '<button class="btn-primary small-p" data-tfa="on">Attiva</button>')}
    </div>
    <p class="set-note">Funziona con ${TFA_APPS}. Se perdi il telefono entri con un codice di emergenza, oppure con la chiave di recupero (che salta anche questo passaggio).</p>`;
};
const _drawPane_tfa = drawPane;
drawPane = function (m) {
  _drawPane_tfa(m);
  if (setPane !== 'sicurezza') return;
  m.querySelectorAll('[data-tfa]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.tfa;
    if (k === 'on') modalTfaSetup();
    if (k === 'off') modalTfaOff();
    if (k === 'codes') modalTfaCodes();
  }));
};

async function modalTfaSetup() {
  const r = await api.tfaBegin();
  if (!r.ok) return toast(r.error);
  openModal(`<h2>${icon('i-lock')} Verifica in due passaggi</h2>
    <ol class="howto">
      <li>Apri l’app di autenticazione sul telefono (${TFA_APPS}) e scegli <b>Aggiungi account → Scansiona codice QR</b>.</li>
      <li>Inquadra il codice qui sotto. Se non puoi inquadrarlo, inserisci la chiave a mano.</li>
      <li>Scrivi il codice a 6 cifre che compare nell’app.</li>
    </ol>
    <div class="tfa-setup"><div class="tfa-qr">${r.qr}</div><div class="tfa-key"><span class="tiny">Chiave da inserire a mano</span><code>${esc(r.secret)}</code><button class="btn small" data-tfa-copy>Copia la chiave</button><span class="tiny">Tipo: basato sull’ora (TOTP) · 6 cifre · 30 secondi</span></div></div>
    <form class="form" data-submit="tfa-confirm">
      <label class="field"><span>Codice a 6 cifre</span><input name="code" required inputmode="numeric" autocomplete="one-time-code" maxlength="7" pattern="[0-9 ]{6,7}" placeholder="123 456" class="tfa-code"></label>
      <div class="form-err" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary">Attiva</button></div>
    </form>`, (m) => {
    m.querySelector('[data-tfa-copy]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(r.secret.replace(/\s/g, '')); toast('Chiave copiata'); } catch { toast('Copia non riuscita'); } });
    setTimeout(() => m.querySelector('[name=code]').focus(), 80);
  });
}
function tfaShowCodes(codes, title) {
  openModal(`<h2>${icon('i-lock')} ${esc(title)}</h2>
    <p class="muted" style="margin-top:-6px">Questi codici di emergenza servono se non hai il telefono: ognuno vale <b>una volta sola</b>. Salvali in un posto sicuro (gestore di password, foglio stampato). Non li mostrerò più.</p>
    <div class="tfa-codes">${codes.map(c => `<code>${esc(c)}</code>`).join('')}</div>
    <div class="modal-actions"><button class="btn" data-tfa-copyall>Copia tutti</button><button class="btn-primary" data-action="close-modal">Li ho salvati</button></div>`, (m) => {
    m.querySelector('[data-tfa-copyall]').addEventListener('click', async () => { try { await navigator.clipboard.writeText('Promemo · codici di emergenza\n' + codes.join('\n')); toast('Codici copiati'); } catch { toast('Copia non riuscita'); } });
  });
}
function modalTfaOff() {
  openModal(`<h2>Disattivare la verifica in due passaggi?</h2><p class="muted">Per aprire Promemo tornerà a bastare la password.</p>
    <form class="form" data-submit="tfa-off"><label class="field"><span>Password attuale</span><input name="password" type="password" required autocomplete="current-password"></label><div class="form-err" hidden></div>
    <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary" style="background:#e0352b">Disattiva</button></div></form>`);
}
function modalTfaCodes() {
  openModal(`<h2>Nuovi codici di emergenza</h2><p class="muted">I codici vecchi smetteranno di funzionare.</p>
    <form class="form" data-submit="tfa-codes"><label class="field"><span>Codice attuale dell’app di autenticazione</span><input name="code" required inputmode="numeric" autocomplete="one-time-code" maxlength="7" class="tfa-code" placeholder="123 456"></label><div class="form-err" hidden></div>
    <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary">Genera</button></div></form>`);
}
Object.assign(submits, {
  'tfa-confirm': async (f, fd) => { showErr(f); const r = await api.tfaConfirm({ code: fd.get('code') }); if (!r.ok) return showErr(f, r.error); lockInfo = await api.lockState(); tfaShowCodes(r.codes, 'Verifica in due passaggi attiva'); },
  'tfa-off': async (f, fd) => { showErr(f); const r = await api.tfaDisable({ password: fd.get('password') }); if (!r.ok) return showErr(f, r.error); lockInfo = await api.lockState(); closeModal(); toast('Verifica in due passaggi disattivata'); modalSettings('sicurezza'); },
  'tfa-codes': async (f, fd) => { showErr(f); const r = await api.tfaBackup({ code: fd.get('code') }); if (!r.ok) return showErr(f, r.error); lockInfo = await api.lockState(); tfaShowCodes(r.codes, 'Nuovi codici di emergenza'); },
});

// ---------- schermata di blocco: il secondo passaggio ----------
function showTotpStep(el, look, onBack) {
  let backup = false;
  const draw = () => {
    const card = el.querySelector('.lock-card'); if (card) card.remove();
    el.insertAdjacentHTML('beforeend', `<form class="lock-card" id="tfa-form" autocomplete="off">
      ${look.cfg.icon ? '<img src="../build/icon.png" class="lock-icon" alt="">' : ''}
      <div class="lock-title">Verifica in due passaggi</div>
      <div class="lock-sub">${backup ? 'Inserisci uno dei codici di emergenza (XXXX-XXXX)' : 'Inserisci il codice a 6 cifre dell’app di autenticazione'}</div>
      <div class="lock-field">
        <input id="tfa-in" ${backup ? 'placeholder="XXXX-XXXX" style="text-transform:uppercase;letter-spacing:.08em"' : 'inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123 456" style="letter-spacing:.3em;text-align:center"'} spellcheck="false">
        <button class="lock-go" title="Continua" tabindex="-1">${icon('i-arrow-r')}</button>
      </div>
      <div class="lock-msg" id="tfa-msg"></div>
      <button type="button" class="lock-link" id="tfa-switch">${backup ? 'Usa il codice dell’app' : 'Non hai il telefono? Usa un codice di emergenza'}</button>
      <button type="button" class="lock-link" id="tfa-back">Torna alla password</button>
    </form>`);
    const inp = el.querySelector('#tfa-in');
    setTimeout(() => inp.focus(), 60);
    if (!backup) inp.addEventListener('input', () => { const v = inp.value.replace(/\D/g, ''); if (v.length === 6) el.querySelector('#tfa-form').requestSubmit(); });
    el.querySelector('#tfa-switch').addEventListener('click', () => { backup = !backup; draw(); });
    el.querySelector('#tfa-back').addEventListener('click', onBack);
    el.querySelector('#tfa-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const card = el.querySelector('.lock-card'); card.classList.add('busy');
      const r = await api.unlockTotp({ code: inp.value });
      card.classList.remove('busy');
      if (!r.ok) {
        if (r.restart) return onBack();
        const msg = el.querySelector('#tfa-msg');
        msg.textContent = r.error + (r.wait ? ` Attendi ${Math.ceil(r.wait / 1000)} s.` : '');
        msg.classList.add('err');
        card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
        inp.value = ''; inp.focus();
        return;
      }
      await enterApp();
      if (r.backupUsed) toast(`Hai usato un codice di emergenza: ne restano ${r.backupLeft}${r.backupLeft < 3 ? '. Generane di nuovi in Impostazioni → Password' : ''}`);
    });
  };
  draw();
}
