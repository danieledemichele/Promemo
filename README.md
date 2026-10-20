# Promemo

App desktop per Linux (Electron) per ricordare impegni e ciò che hai pianificato.
Stile ispirato a macOS, dati salvati sul tuo computer, sincronizzazione con Google Calendar, Notion e calendari .ics.

![Home](docs/home.png)

| Agenda | Popup del giorno | Colori |
|---|---|---|
| ![Agenda](docs/agenda.png) | ![Popup](docs/popup-giorno.png) | ![Colori](docs/colori.png) |

## Sezioni
- **Home**: riepilogo a riquadri (prossimo impegno con conto alla rovescia, oggi, in ritardo, settimana), linea del tempo di oggi con l'indicatore “adesso”, in arrivo e progetti da riprendere.
- **Palette comandi** (Ctrl+K): cerca eventi e progetti, crea, naviga.
- **Progetti**: prossimo passo, passi con scadenza, appuntamenti collegati, timeline di tracce.
- **Agenda**: viste **Giorno**, **Settimana** (come Notion Calendar: griglia oraria, riga “tutto il giorno”, impegni affiancati quando si sovrappongono, linea rossa dell'ora attuale, numero della settimana) e **Mese**. Trascina su una fascia vuota per creare un evento, trascina un evento per spostarlo (anche su un altro giorno), tira il bordo inferiore per cambiarne la durata. Mini calendario nella barra laterale. **Un clic su un giorno apre il popup animato** con gli impegni del giorno e il modulo completo per un nuovo evento (titolo, tipo, giornata intera, inizio/fine, luogo, promemoria, progetto, calendario di destinazione, note).
- **Promemoria**: tutto ciò che ha un avviso, con notifiche desktop.
- **Account collegati**: Google Calendar, Notion, calendari da link.

## Password all'avvio
Promemo può chiedere una password a ogni apertura (*Impostazioni → Password all'avvio*, proposta anche al primo avvio).
- I dati (`promemo.enc`) e le credenziali degli account (`credenziali.enc`) vengono cifrati con **AES-256-GCM**; la chiave è derivata dalla password con **scrypt**. Le copie non cifrate vengono eliminate.
- All'attivazione viene mostrata una **chiave di recupero** (24 caratteri): sblocca i dati se dimentichi la password e chiede subito di sceglierne una nuova.
- Dopo 3 tentativi sbagliati l'attesa tra un tentativo e l'altro cresce fino a 60 secondi.
- Finché Promemo è bloccata non può inviare notifiche né sincronizzare: dopo lo sblocco resta attiva (anche nell'area di notifica) fino all'uscita.
- I backup esportati in JSON non sono cifrati.

## Scheda del compito (Agenda)
Un clic su un compito o su un evento, nelle viste Giorno, Settimana o Mese, apre a destra una scheda con:
- **compito**: titolo modificabile, fatto/da fare, progetto e raccolta, scadenza, durata stimata (determina l'altezza del blocco nella settimana), promemoria, priorità, **sotto-attività** con barra di avanzamento, **note** con salvataggio automatico (si possono copiare nella timeline del progetto) e gli altri passi del progetto;
- **evento**: orario, luogo (con link se è online), calendario, progetto, promemoria, partecipanti (da Calendly), descrizione e **appunti personali** che restano solo sul computer e non vengono inviati a Google/Notion.

## Backup e sincronizzazione tra computer
*Impostazioni → Dati e backup*. I backup sono file `.pmbak` **cifrati** (AES-256-GCM, chiave derivata con scrypt da una password dei backup) e non contengono mai token o password degli account.

| Destinazione | Servizi |
|---|---|
| Cartella sincronizzata | MEGA (MEGA Desktop), Dropbox, Nextcloud, ownCloud, Google Drive, OneDrive, pCloud, Syncthing… (cartelle rilevate in automatico) |
| Dropbox diretto | API Dropbox con una tua *App key* (accesso “App folder”, collegamento con codice PKCE) |
| WebDAV | Nextcloud, ownCloud, Koofr, kDrive, Box, NAS |
| rclone | MEGA, Google Drive, OneDrive, pCloud, Proton Drive, S3 e altri ~70 servizi |

- Frequenza: dopo le modifiche (con attesa regolabile e sempre alla chiusura), una volta al giorno o solo a mano; versioni conservate a scelta.
- **Ripristino** da elenco delle versioni o da file; prima di sostituire i dati viene salvata una copia di sicurezza locale. Account collegati, password e impostazioni dei backup restano quelli del computer.
- **Sincronizza tra computer**: se un altro PC ha salvato una versione più recente nella stessa destinazione, compare un avviso con *Aggiorna*/*Ignora*.

## Assistente (IA)
Nella Home e con il pulsante **Assistente** (Ctrl+J) si apre una conversazione che organizza la giornata di oggi o di domani:
1. l'assistente legge impegni del giorno, passi in ritardo e scadenze vicine;
2. fa fino a 4 domande una alla volta (priorità, quando ti concentri meglio, vincoli, quanto riempire la giornata), con risposte rapide da cliccare;
3. propone un piano a blocchi (impegni fissi, lavoro/studio, passi, pause, pasti, spostamenti) che puoi correggere scrivendo (“più pause”, “finisci alle 18”);
4. **Aggiungi all'agenda** crea i blocchi come eventi (con promemoria a scelta); si possono sostituire o rimuovere.

Motori supportati (*Impostazioni → Assistente*):
| Motore | Costo | Privacy |
|---|---|---|
| Claude (API Anthropic) — `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-opus-5-5` | a consumo, qualche centesimo a pianificazione | impegni del giorno inviati ad Anthropic |
| Ollama sul computer (es. `llama3.1`) | gratis | tutto resta in locale |
| Compatibile OpenAI (OpenAI, LM Studio, Groq, OpenRouter…) | dipende dal servizio | dipende dal servizio |

La chiave API è salvata cifrata insieme alle altre credenziali.

## Barra laterale
Il pulsante in alto a sinistra (o Ctrl+B) riduce la barra a sole icone: Home, Progetti, Agenda, Promemoria, Account collegati e Impostazioni, con i contatori come pallini. Sotto i 1060 px di larghezza si riduce da sola.

## Impostazioni
Finestra a sezioni: **Generale**, **Aspetto** (tema e colore principale), **Calendario** (vista predefinita, inizio giornata, fine settimana), **Notifiche**, **Password**, **Schermata di blocco**, **Dati e backup**.

### Schermata di blocco su misura
Anteprima dal vivo e a schermo intero. Si possono scegliere:
- sfondo *Aurora* (6 tavolozze o 3 colori a scelta, con movimento lento), *Tinta unita* o *Immagine* (con sfocatura e oscuramento);
- orologio (sì/no, 4 spessori, dimensione), data;
- titolo e sottotitolo (es. “Bentornato, Daniele”), icona, suggerimento della password;
- riquadro *Vetro*, *Pieno* o *Minimale* e colore del testo.

Queste preferenze sono salvate in chiaro in `promemo.lockscreen.json`, perché servono prima dello sblocco.

## Calendari e colori
Nella barra laterale, sotto **Calendari**, ogni account mostra i suoi gruppi con un colore:
- **Su questo computer**: *Personale* e una voce per ogni raccolta (Viaggi, Casa, Studio…).
- **Google**: un gruppo per ogni calendario sincronizzato.
- **Notion**: un gruppo per ogni valore di una colonna *Seleziona*, *Selezione multipla* o *Stato* (es. `Area`: Personale, Lavoro, Università…). I colori di partenza sono quelli di Notion.
- **Calendari .ics**: un gruppo per calendario, più uno per ogni `CATEGORIES` presente.

Clic sul quadratino = mostra/nascondi. Icona tavolozza = scegli il colore: 9 famiglie con 4–5 sfumature (es. Personale in rosso, tutto il lavoro in varianti di azzurro) o un colore personalizzato. Schede, punti del calendario e popup usano il colore del gruppo.

## Sincronizzazione
| Servizio | Direzione | Cosa serve |
|---|---|---|
| Google Calendar (Gmail) | lettura e scrittura | un ID client OAuth di tipo *App desktop* (istruzioni nell'app) |
| Notion | lettura e scrittura | token di un'integrazione interna + database con una proprietà Data condiviso con l'integrazione |
| Calendly | sola lettura | un token di accesso personale (funziona anche con il piano gratuito) |
| Link .ics / webcal (iCloud, Outlook, Nextcloud, Proton, orari corsi…) | sola lettura | l'indirizzo iCal pubblico o segreto |

- **Calendly**: ogni prenotazione arriva con nome ed email di chi prenota, risposte al modulo, luogo o link della videochiamata e link per spostare/annullare. I tipi di appuntamento (es. *Ripetizione 60 min*) diventano gruppi colore. Le copie che Calendly scrive nel calendario Google collegato vengono nascoste per evitare doppioni (disattivabile).
- Avviene all'avvio, ogni 15 minuti, al risveglio del PC e con il pulsante ⟳ in alto.
- Gli eventi creati in Promemo possono andare su Google o Notion (campo *Calendario*); modifiche ed eliminazioni vengono inviate al servizio.
- Gli eventi importati restano collegabili a un progetto e possono avere un promemoria di Promemo.
- Finestra sincronizzata: da 60 giorni fa a circa 13 mesi avanti.
- Token e credenziali sono in `~/.config/Promemo/credenziali.bin`, cifrati con il portachiavi di sistema (GNOME Keyring/KWallet) quando disponibile.

## Avvio (sviluppo)
```bash
npm install
npm start
```

## Pacchetti
```bash
npm run dist        # dist/Promemo-1.7.0.AppImage e dist/promemo_1.7.0_amd64.deb
sudo apt install ./dist/promemo_1.7.0_amd64.deb
```

## Scorciatoie
Ctrl+K palette comandi · Ctrl+J assistente · Ctrl+B barra laterale · Ctrl+N nuovo · Ctrl+F cerca · Ctrl+1…5 sezioni · Esc chiude popup e finestre.

## Dati
`~/.config/Promemo/promemo.json` (scrittura atomica). Backup da *Impostazioni → Esporta*.


## Struttura
```
main.js        processo principale: archivio, promemoria, vassoio, IPC
backup.js      backup cifrati e destinazioni (cartella, Dropbox, WebDAV, rclone)
ai.js          motori IA (Anthropic, Ollama, compatibili OpenAI)
vault.js       cifratura locale (scrypt + AES-256-GCM, chiave di recupero)
sync.js        Google Calendar (OAuth PKCE), Notion API, feed .ics; unione e invio modifiche
ics.js         parser iCalendar con fusi orari e ricorrenze
preload.js     ponte sicuro verso l'interfaccia
src/           interfaccia (HTML, CSS, JS senza framework)
```

## Licenza
MIT
