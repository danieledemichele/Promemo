# Sicurezza di Promemo

Ultimo controllo: versione 1.18.0. I test automatici sono in `test/security.test.js` e girano a ogni modifica (`npm test`, workflow *Test*).

## Cosa protegge e come
| Area | Protezione |
|---|---|
| Dati sul computer | Con la password all'avvio: AES-256-GCM, chiave derivata con scrypt (N = 32768), chiave di recupero da 120 bit. Senza password: file leggibili solo dal tuo utente (permessi 600, cartella 700) |
| Accesso | Password, verifica in due passaggi TOTP (RFC 6238) con codici di emergenza monouso conservati come impronta SHA-256, attese crescenti dopo 3 errori |
| Credenziali degli account | Cifrate con la cassaforte o con il portachiavi del sistema (safeStorage) |
| Interfaccia (Electron 44) | Isolamento del contesto, sandbox, niente Node nelle pagine, CSP senza script esterni né `eval`, niente gestori inline, nessuna navigazione fuori dall'app, nessuna webview, nessun permesso a parte le notifiche, link esterni solo `https` |
| Telefono in rete | Chiave da 144 bit confrontata in tempo costante, blocco di 10 minuti dopo 10 chiavi sbagliate dallo stesso indirizzo, limite di dimensione delle richieste, CORS solo per l'app Android, nessun file servito fuori da quelli dell'app |
| Sincronizzazione nel cloud | File cifrati con la password dei backup (scrypt + AES-256-GCM) |
| Aggiornamenti | Scaricati da GitHub in una cartella privata, impronta SHA-256 confrontata con quella pubblicata (prima e subito prima dell'installazione), installazione con argomenti separati (niente stringhe costruite con il percorso) |
| Registro degli errori | Token, chiavi, password, intestazioni di autorizzazione e chiavi TOTP sostituiti da `[nascosto]` |

## Correzioni di questo controllo
1. **Electron 33 → 44**: la 33 non riceveva più aggiornamenti di sicurezza di Chromium.
2. **Permessi dei file**: senza password `promemo.json` era leggibile da altri utenti del computer; ora 600, cartella 700 (anche per i file già esistenti).
3. **Navigazione**: la finestra poteva aprire qualsiasi pagina `file://`; ora solo le pagine dell'app. Bloccate webview e richieste di permessi.
4. **Aggiornamento .deb**: il pacchetto passava da `/tmp` (condivisa) prima di essere installato con i privilegi di amministratore; ora cartella privata e impronta verificata.
5. **Server del telefono**: aggiunto il blocco dopo troppe chiavi sbagliate e la risposta 413 alle richieste troppo grandi; la chiave non si può più impostare dall'interfaccia.
6. **Registro**: nascosti anche token JWT (Calendly), chiavi Cal.com, GitHub, Dropbox, autenticazione Basic e chiavi TOTP.

## Limiti noti
- Senza password all'avvio i dati sono in chiaro sul disco (solo per il tuo utente): attivala se il computer è condiviso o portatile.
- Se il sistema non ha un portachiavi (safeStorage) e la password non è attiva, le credenziali sono salvate in chiaro con permessi 600.
- L'impronta degli aggiornamenti protegge da file corrotti o sostituiti per strada, non da un account GitHub compromesso.

## Eseguire i test
```
npm test
```
