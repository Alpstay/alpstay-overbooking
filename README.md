# AlpStay Overbooking

Piattaforma di gestione dell'overbooking per le tre case AlpStay in Val Gardena —
Smart Hotel Saslong, Hotel Acadia, Chalet Hartmann.

Dice **quanto si può vendere oltre la capienza** notte per notte contando sulle cancellazioni
attese, e **cosa fare** quando una notte ha più prenotazioni che camere: chi spostare, dove, in
che ordine, con quale email. Ogni casa è valutata per conto suo.

## Com'è fatta

Una pagina sola, senza framework. Il TypeScript viene compilato in un bundle e
iniettato dentro `shell.html`, che contiene tutto il CSS. Il risultato è `dist/index.html`:
un file unico che funziona aperto da qualsiasi parte, anche senza rete.

L'unica dipendenza a runtime è SheetJS, caricata da CDN, usata per leggere e scrivere i file
Excel dell'import e degli export.

```
main.ts          avvio, instradamento, gestione degli eventi
types.ts         i tipi del dominio
defaults.ts      impostazioni iniziali delle tre case
scatola.ts       lettura dello scatto giornaliero di La Scatola, nomi cifrati
importer.ts      lettura dell'export Slope, riconoscimento colonne, normalizzazione
forecast.ts      curva di cancellazione, soglia vendibile, azione per notte
solver.ts        piano: upgrade, riprotezione, cancellazioni motivate, overbooking, tetris
protect.ts       cosa rende intoccabile una prenotazione
cancellable.ts   cancellazione per motivo documentato
speculative.ts   doppie prenotazioni
emails.ts        dieci modelli di email in italiano, tedesco, inglese
views.ts         pagine principali
board.ts         tabellone stile planning Slope
dayplan.ts       pannello della singola notte
waitlist.ts      lista d'attesa e pannello email
register.ts      registro degli esiti, statistiche, corrispondenza
manual.ts        pagina "Come funziona"
info.ts          schede informative delle tabelle
storage.ts       persistenza
demo.ts          dati dimostrativi
scenario.ts      scenario di prova con conflitti costruiti apposta
```

## Sviluppo

```bash
npm install
npm run check     # controllo dei tipi, deve passare pulito
npm run build     # produce dist/index.html
npm run dev       # costruisce e serve su http://localhost:5500
```

## Pubblicazione

Ogni push su `main` fa partire `.github/workflows/pages.yml`: controlla i tipi, costruisce la
pagina e la pubblica su GitHub Pages. Se il controllo dei tipi fallisce, non pubblica nulla.

Per attivarlo la prima volta: **Settings → Pages → Source: GitHub Actions**.

## Dove stanno i dati

| Cosa | Dove sta oggi | Nota |
| --- | --- | --- |
| Prenotazioni, capienza, chiusure, saldi | `scatola.json`, scatto giornaliero di La Scatola | vedi sotto |
| Impostazioni, lista d'attesa, registro, corrispondenza | Firestore, se configurato; altrimenti archivio del browser | vedi più sotto |

## Il collegamento con La Scatola

La pagina pubblicata non chiama il gateway `/api/v1`: per chiamarlo servirebbe un client
registrato, e la sua chiave dentro una pagina pubblica sarebbe leggibile da chiunque apra il
codice sorgente. Si fa come per il counter colazioni: un'**attività pianificata** interroga La
Scatola via MCP una volta al giorno, scrive `scatola.json` qui dentro e pubblica; la pagina
legge quel file, che GitHub Pages serve accanto a lei.

```
tools/costruisci_scatola.py   dai risultati grezzi di La Scatola a scatola.json
tools/verifica_scatola.py     controlli prima di pubblicare: se falliscono, non si pubblica
tools/AGGIORNA-SCATOLA.md     la procedura dell'attività pianificata, passo per passo
scatola.ts                    lettura, validazione e nomi cifrati, dal lato della pagina
```

Lo scatto **non viene salvato** nell'archivio: viene riletto a ogni apertura e il giorno dopo è
sostituito. Così non ci sono due verità da tenere allineate. In testa a ogni pagina stanno la
data dello scatto e lo stato di freschezza di La Scatola, e quando lo scatto è vecchio o è
stato preso mentre La Scatola era ferma la piattaforma lo dice **sopra** i numeri, non in fondo.

I cognomi degli ospiti viaggiano cifrati (AES-GCM, PBKDF2-SHA256) e si aprono con la password
della reception; senza password la piattaforma mostra la camera e lavora lo stesso. Email e
telefoni non vengono pubblicati affatto, nemmeno cifrati: su un repository pubblico una rubrica
protetta da una password condivisa non è un rischio che valga la comodità. L'indirizzo si prende
da Slope al momento di scrivere all'ospite.

La piattaforma sceglie l'archivio da sola, in quest'ordine: database condiviso dell'artifact
Claude, se è dentro un artifact; **Firestore**, se `firebase-config.ts` è compilato e c'è
un utente collegato; altrimenti il `localStorage` del browser, che resta su quella postazione.

## Accesso con Firebase

Con `firebase-config.ts` vuoto la piattaforma non chiede nessun accesso: utile per provarla,
ma i dati non si condividono. Per accenderlo:

1. Nella console Firebase crea il progetto, attiva **Authentication → Email/Password** e crea
   **Firestore Database** in `europe-west3` o `eur3`, in modalità produzione.
2. Incolla le regole di [`firestore.rules`](firestore.rules) in **Firestore → Regole** e pubblica.
   Senza utente collegato non si legge e non si scrive niente.
3. Copia il blocco `firebaseConfig` dell'app Web dentro `FIREBASE_CONFIG` in
   `firebase-config.ts` e fai push: la pubblicazione riparte da sola.
4. Crea un account per ogni collaboratore in **Authentication → Utenti → Aggiungi utente**.
   Non esiste registrazione libera: entra solo chi ha un account creato a mano.

I sei valori della configurazione non sono segreti — nelle applicazioni web Firebase li espone
per costruzione. La sicurezza la fanno il login e le regole del database.

Se la rete non raggiunge l'SDK di Firebase, la piattaforma lo dice e offre di continuare in
locale su quel computer, invece di restare bloccata.

## Regole che il codice non viola

Sono scelte di merito, non dettagli tecnici: chi mette mano al codice le tenga.

- **Gli ID di Slope non si modificano mai.** Si usano così come arrivano.
- **Una prenotazione confermata non si annulla per fare spazio.** Se manca la camera, l'ospite
  si ricolloca a nostro carico.
- **Si cancella solo con un motivo documentato** — garanzia non valida, caparra scaduta, camera
  dichiarata inagibile — e sempre con un sollecito prima. Nessun motivo viene inventato: ogni
  proposta porta con sé la prova, presa dai dati o dichiarata dalla direzione.
- **La nazionalità non è e non sarà un criterio di selezione.** Scegliere chi spostare in base
  alla provenienza è discriminazione vietata dall'art. 43 del D.Lgs. 286/1998. Contano il valore
  netto e l'affidabilità del canale.
- **Non si spezzano le prenotazioni con più camere**, e gruppi, abituali, Expedia Collect, non
  rimborsabili, tag di blocco e ospiti già in casa non vanno mai in overbooking.

## Passi successivi

1. **Assegnare un'etichetta alle tipologie** di La Scatola (`--etichette`): oggi compaiono con
   le prime cifre del loro ID, perché il gateway non espone il nome della tipologia. Fatto
   questo, la tabella delle tipologie compilata a mano nelle impostazioni si può togliere: le
   camere vere le dice La Scatola.
2. **Decidere la password della reception** per i nomi, se si vuole vedere chi è l'ospite e non
   solo la camera. Va nel testo dell'attività pianificata, non nel repository.
3. **Tarare la previsione dopo questo inverno.** Lo storico delle cancellazioni in La Scatola
   parte dal 23 settembre 2026: un mese non basta per una curva, una stagione sì. Fino allora
   la soglia vendibile resta spenta e si lavora contando le camere che esistono davvero.
4. **Chiedere il canale per prenotazione.** È l'ultimo dato che manca davvero: senza, non si
   calcolano commissioni e valore netto, e non si riconosce Expedia Collect. Il mix aggregato
   di `report_channel_mix` non basta.

## Licenza

Uso interno AlpStay Hotels. © MP-Alpstay.
