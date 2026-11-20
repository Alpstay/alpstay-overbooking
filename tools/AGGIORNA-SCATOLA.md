# Aggiornamento giornaliero dello scatto (La Scatola → piattaforma Overbooking)

Procedura per l'attività pianificata che ogni mattina riscrive `scatola.json` e lo pubblica.
Stessa impostazione del counter colazioni: **la pagina pubblicata non parla con La Scatola**,
perché il gateway accetta solo client registrati e una chiave dentro una pagina pubblica non è
un accesso. Interroga La Scatola questa attività, via MCP, e lascia il risultato nel
repository.

La **password della reception** per cifrare i nomi non sta qui: questo repository è pubblico.
Viene data nel testo dell'attività pianificata. Senza password si pubblica lo stesso, ma lo
scatto mostra le camere invece dei nomi e il controllo delle doppie prenotazioni resta spento.

## Regole

- Gli ID ricevuti da Slope / La Scatola non si modificano mai: si copiano identici.
- Nomi, email, telefoni e documenti degli ospiti non si stampano, non si riassumono e non si
  scrivono in nessun file del repository. Vivono solo nei file privati dello scratchpad e, i
  soli cognomi in forma breve, dentro `ospitiEnc`. **Email e telefoni non si pubblicano
  affatto**, nemmeno cifrati: l'indirizzo si prende da Slope quando si scrive all'ospite.
- Quello che La Scatola non dà resta vuoto e sta in `mancanti`. Non si inventa un canale
  plausibile, non si stima un piano tariffario, non si deduce un tag.
- Se La Scatola non risponde, dà zero righe, o `verifica_scatola.py` fallisce: **non
  pubblicare**. Online resta lo scatto di ieri, che è utilizzabile; uno scatto sbagliato no.
- Se `git push` viene rifiutato, non insistere: riportalo nel riepilogo.
- **`scatola.json` non si cancella mai dal repository.** È il file che tiene in piedi la pagina
  online: senza, la piattaforma torna ai dati dimostrativi. In particolare non usare
  `git add -A` dopo aver rimosso file in locale — si aggiungono i file per nome. Gli scatti di
  prova vanno chiamati `scatola.prova.json`, che è ignorato da git.

## Dati

- Tre case, `property_id` di Slope:
  - `11111111-1111-4111-8111-111111111111` Hotel Acadia (21 camere, 3 tipologie)
  - `22222222-2222-4222-8222-222222222222` Chalet Hartmann (9 unità, 3 tipologie)
  - `33333333-3333-4333-8333-333333333333` Smart Hotel Saslong (56 camere su 4 tipologie in
    Slope, ma **nello scatto sono 49 su 3**: vedi sotto)
- `G` = oggi nel fuso Europe/Rome. La finestra dello scatto è `G` → `G+190`: copre la stagione
  invernale, che è l'unico periodo in cui l'overbooking è un problema.
- **Una riga assente in `curated_availability_daily` vuol dire tipologia completamente libera**
  (nessuna prenotazione e nessuna chiusura), non tipologia inesistente. Per questo le camere
  fisiche si prendono dalla tabella delle tipologie e non dalla somma delle righe del giorno:
  sommare le righe inventerebbe deficit che non esistono. Verificato il 23 ottobre 2026 su una
  notte in cui il Saslong sembrava in deficit di 5 camere ed era in avanzo di 4.
- **La quarta tipologia del Saslong non entra nello scatto, ed è giusto così.** È
  `50ff0784-3226-4bdc-b6f4-47808c364f25`, 7 camere fisiche (49 + 7 = le 56 di Slope). In
  `curated_availability_daily` ha 545 righe, tutte **fino al 2026-10-27** e quasi tutte
  chiusure con `confirmed_occupied` a zero; in `curated_reservations` ha **zero prenotazioni,
  da sempre**. Sono camere che esistono ma non si vendono. Nella finestra dello scatto non ha
  nessuna riga, quindi non compare, e lo scatto dichiara 3 tipologie e 49 camere al Saslong.
  Tenerle fuori è la scelta prudente: dichiararle libere gonfierebbe la capienza e farebbe
  sparire conflitti veri. Accertato il 19 novembre 2026. Se la reception inizia a venderle, la
  tipologia ricomparirà da sola appena avrà una prenotazione o una chiusura nella finestra.

## Passi

1. **Freschezza**: `get_freshness`. Qualunque sia l'esito si prosegue — il valore finisce nello
   scatto e la pagina lo mostra — ma se `lodging_reservation` non si aggiorna da più di 6 ore
   dillo nel riepilogo.
   Come si scaricano le quattro viste dei passi 2-5, imparato il 19 novembre 2026 — sono
   circa 24.000 righe in 240 pagine, e farlo male costa un'ora:
   - **Il gateway taglia la risposta a ~64 KB**, cioè 50-65 righe per pagina, qualunque
     `limit` chiedi. `limit` alto non riduce le pagine.
   - **Su `curated_reservation_contacts` `limit: 500` viene rifiutato** con `Invalid input:
     correct the named field and use the allowed value or bound`, che non c'entra niente con i
     filtri. Usa `limit: 50`.
   - Quello stesso `Invalid input` capita **a intermittenza** anche con un `limit` buono e un
     cursore valido: ritenta la stessa chiamata, passa. Non è un cursore scaduto e non sono i
     filtri sbagliati.
   - Ma attenzione: se scarichi le tre case in parallelo, su `curated_reservation_contacts`
     l'errore diventa **frequente e ostinato** — fino a 10 fallimenti di fila con cursore e
     limit validi. I ritentativi a raffica non servono: è throttling travestito da errore di
     validazione. Quello che funziona è **una pausa di 30-60 secondi** prima di ritentare.
     Su questa vista conviene mettere una pausa breve tra le pagine dall'inizio, invece di
     scoprirlo a metà paginazione. Accertato il 20 novembre 2026 su tutte e tre le case.
   - Gli agenti paralleli **condividono lo scratchpad e la cartella `tool-results`**: i nomi
     dei file di supporto vanno resi unici per casa, e il file grezzo si copia **dal percorso
     esatto indicato nell'errore**, mai «il file più recente», che può essere di un'altra casa.
     Il 20 novembre 2026 due agenti su tre ci sono inciampati; entrambi se ne sono accorti.
   - I cursori scadono in circa un'ora: non interrompere una paginazione a metà.
   - Quando il risultato è troppo grande per il contesto, l'errore dice dove è stato salvato il
     file grezzo: **copia quel file** nello scratchpad invece di ricopiare il JSON a mano. È
     più fedele e, sugli intestatari, evita che i dati personali ti passino davanti.
   - Conviene **spezzare per `property_id`** e scaricare le tre case in parallelo con tre
     agenti: i cursori sono sequenziali, le case no.
2. **Capienza e occupazione**: `query_curated_view` su `curated_availability_daily` con filtri
   `day gte G`, `day lte G+190`. Segui `next_cursor` finché non è nullo e controlla che
   `page.returned` sommi a `page.total`. Salva ogni pagina in un file dello scratchpad così
   come arriva.
3. **Prenotazioni**: `query_curated_view` su `curated_reservations` con filtri
   `departure gt G`, `arrival lt G+190`. È la vista completa: contiene canale, agenzia,
   importo della singola prenotazione (`room_amount`), data di prenotazione (`creation_date`),
   stato, e **anche le cancellate**. Non usare `curated_operational_stays`: è un sottoinsieme
   senza canale né importo.
4. **Saldi**: `query_curated_view` su `curated_order_balances`, per il saldo aperto per ordine.
5. **Intestatari**: `query_curated_view` su `curated_reservation_contacts` con filtri
   `departure gt G`, `arrival lt G+190`. Dà nome, cognome o ragione sociale e lingua di chi ha
   prenotato. **Contiene dati personali**: non mostrarli, non riassumerli, non scriverli nel
   riepilogo; usa i file così come sono. Non usare `curated_guest_stays`: contiene solo gli
   ospiti già registrati al check-in e sulle prenotazioni future è quasi sempre vuota.
   Questa vista dà molto più di un nome: email, telefono, data e luogo di nascita,
   cittadinanza, genere, documento d'identità, residenza, partita IVA, e un `checkin_url` che
   la vista stessa definisce credenziale. Lo scatto ne usa solo il cognome in forma breve.
   Quindi **a scatto costruito e verificato, cancella le pagine degli intestatari dallo
   scratchpad**: servono per il passo 6 e il passo 7, non dopo.
6. **Costruisci**, dalla cartella del repository:
   ```
   python3 tools/costruisci_scatola.py \
       --disponibilita d1.json,d2.json --prenotazioni p1.json,p2.json \
       --saldi saldi.json --contatti c1.json,c2.json \
       --password "<PASSWORD RECEPTION>" \
       --da G --a G+190 > scatola.json
   ```
   Leggi il resoconto su stderr: le prenotazioni per casa devono essere centinaia, le
   tipologie 3, 3 e 3 (Acadia 21 camere, Hartmann 9, Saslong 49 — la quarta tipologia del
   Saslong non entra, vedi «Dati»), e i nomi cifrati devono coprire almeno l'80% delle
   prenotazioni. Una riga `ATTENZIONE` va capita prima di andare avanti.
7. **Verifica**: `python3 tools/verifica_scatola.py scatola.json c1.json,c2.json "<PASSWORD>"`
   deve finire con `verifica OK`. Passa i file degli intestatari e la password: è il controllo
   che nessun nome, email o telefono sia finito in chiaro e che il blocco cifrato si riapra.
   Il controllo dei nomi in chiaro cerca ogni parola di almeno 5 lettere degli intestatari
   dentro tutto il testo dello scatto, quindi **i nomi delle tre case sono esclusi**: un ospite
   può chiamarsi come una casa, e `hotelId` sta su ogni prenotazione. Il 19 novembre 2026 un
   cognome identico a un `hotelId` ha bloccato la pubblicazione per 2312 occorrenze che erano
   tutte l'identificativo della casa. Se la verifica segnala una parola, **non pubblicare**
   sulla fiducia: guarda in quali campi dello scatto compare. Se sta solo in campi che non
   vengono dall'ospite è un falso positivo da correggere nel controllo; in ogni altro caso è
   una fuga di dati e lo scatto non si pubblica.
8. **Radar prezzi**: leggi il database dell'artifact Radar prezzi
   (`https://claude.ai/artifact/T5zW9i3ege9onzFs3VrNxB`) con ArtifactData, azione `list`,
   collezioni `rilevazioni` e `barometro`, `query.limit` 1000 e `out_dir` una cartella dello
   scratchpad (segui `next_cursor` se c'è). Poi, dalla cartella del repository:
   ```
   python3 tools/costruisci_radar.py <out_dir> -o radar.json
   ```
   Gli ID dei documenti diventano il campo `id` così come sono, e i campi si copiano identici.
   Il resoconto su stderr dice quante rilevazioni ci sono: devono essere almeno quante ieri,
   salvo eliminazioni fatte dallo staff. Se l'artifact non risponde o lo script si ferma,
   **non toccare `radar.json`**: resta quello di ieri, e lo scatto si pubblica lo stesso.
9. **Controllo dei tipi e costruzione**: `npm install && npm run check && npm run build`.
   **Se il controllo dei tipi non passa, non pubblicare.** Quello è il cancello.
   Il container dell'attività pianificata però può non raggiungere `registry.npmjs.org`
   (il 19 novembre 2026: `ENOTFOUND`, perché il registro è in `noProxy` e npm tenta la
   connessione diretta; forzare il proxy è bloccato dal classificatore dei permessi). Senza
   `npm install` manca `esbuild` e `npm run build` si ferma. In quel caso: se `npm run check`
   passa — `tsc` è installato a livello globale e non serve il registro — **si pubblica
   comunque**, perché `dist/` non entra nel repository e la costruzione che conta è quella
   della CI. Dillo nel riepilogo e controlla che il workflow `pages.yml` finisca verde, con
   `actions_list` su `pages.yml` e poi `actions_get` sul run: lì `npm install`, `npm run check`
   e `npm run build` girano per davvero. Un run rosso va riportato subito.
10. **Pubblica**: `git add scatola.json radar.json`, commit `Scatola G`, `git push origin HEAD:main`.
11. **Riepilogo** in italiano, senza nomi: periodo coperto, prenotazioni per casa, notti in
    conflitto per casa, freschezza di La Scatola, rilevazioni del Radar e ultima data
    rilevata, e qualunque cosa sia andata storta.

## Cosa fa la piattaforma con lo scatto

Lo legge a ogni apertura e **non lo salva**: il giorno dopo è sostituito. Impostazioni, lista
d'attesa, registro e corrispondenza restano in Firestore, perché sono lavoro della reception e
non dati di Slope. Così non esistono due verità da tenere allineate.

Le tipologie dello scatto sono quelle vere di Slope, con le camere vere. La tabella delle
tipologie compilata a mano nelle impostazioni serviva solo finché non c'era questo file:
quando le etichette saranno assegnate (`--etichette`), si può togliere.
