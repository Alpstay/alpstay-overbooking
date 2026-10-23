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

## Dati

- Tre case, `property_id` di Slope:
  - `11111111-1111-4111-8111-111111111111` Hotel Acadia (21 camere, 3 tipologie)
  - `22222222-2222-4222-8222-222222222222` Chalet Hartmann (9 unità, 3 tipologie)
  - `33333333-3333-4333-8333-333333333333` Smart Hotel Saslong (56 camere, 4 tipologie)
- `G` = oggi nel fuso Europe/Rome. La finestra dello scatto è `G` → `G+190`: copre la stagione
  invernale, che è l'unico periodo in cui l'overbooking è un problema.
- **Una riga assente in `curated_availability_daily` vuol dire tipologia completamente libera**
  (nessuna prenotazione e nessuna chiusura), non tipologia inesistente. Per questo le camere
  fisiche si prendono dalla tabella delle tipologie e non dalla somma delle righe del giorno:
  sommare le righe inventerebbe deficit che non esistono. Verificato il 23 ottobre 2026 su una
  notte in cui il Saslong sembrava in deficit di 5 camere ed era in avanzo di 4.

## Passi

1. **Freschezza**: `get_freshness`. Qualunque sia l'esito si prosegue — il valore finisce nello
   scatto e la pagina lo mostra — ma se `lodging_reservation` non si aggiorna da più di 6 ore
   dillo nel riepilogo.
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
6. **Costruisci**, dalla cartella del repository:
   ```
   python3 tools/costruisci_scatola.py \
       --disponibilita d1.json,d2.json --prenotazioni p1.json,p2.json \
       --saldi saldi.json --contatti c1.json,c2.json \
       --password "<PASSWORD RECEPTION>" \
       --da G --a G+190 > scatola.json
   ```
   Leggi il resoconto su stderr: le prenotazioni per casa devono essere centinaia, le
   tipologie 3, 3 e 4, e i nomi cifrati devono coprire almeno l'80% delle prenotazioni. Una
   riga `ATTENZIONE` va capita prima di andare avanti.
7. **Verifica**: `python3 tools/verifica_scatola.py scatola.json c1.json,c2.json "<PASSWORD>"`
   deve finire con `verifica OK`. Passa i file degli intestatari e la password: è il controllo
   che nessun nome, email o telefono sia finito in chiaro e che il blocco cifrato si riapra.
8. **Controllo dei tipi e costruzione**: `npm install && npm run check && npm run build`.
   Se il controllo dei tipi non passa, non pubblicare.
9. **Pubblica**: `git add scatola.json`, commit `Scatola G`, `git push origin HEAD:main`.
10. **Riepilogo** in italiano, senza nomi: periodo coperto, prenotazioni per casa, notti in
    conflitto per casa, freschezza di La Scatola, e qualunque cosa sia andata storta.

## Cosa fa la piattaforma con lo scatto

Lo legge a ogni apertura e **non lo salva**: il giorno dopo è sostituito. Impostazioni, lista
d'attesa, registro e corrispondenza restano in Firestore, perché sono lavoro della reception e
non dati di Slope. Così non esistono due verità da tenere allineate.

Le tipologie dello scatto sono quelle vere di Slope, con le camere vere. La tabella delle
tipologie compilata a mano nelle impostazioni serviva solo finché non c'era questo file:
quando le etichette saranno assegnate (`--etichette`), si può togliere.
