# Aggiornamento giornaliero dello scatto (La Scatola → piattaforma Overbooking)

Procedura per l'attività pianificata che ogni mattina riscrive `scatola.json` e lo pubblica.
Stessa impostazione del counter colazioni: **la pagina pubblicata non parla con La Scatola**,
perché il gateway accetta solo client registrati e una chiave dentro una pagina pubblica non è
un accesso. Interroga La Scatola questa attività, via MCP, e lascia il risultato nel
repository.

La **password della reception** per cifrare i nomi non sta qui: questo repository è pubblico.
Viene data nel testo dell'attività pianificata. Se non c'è, si pubblica lo stesso: lo scatto
senza nomi funziona, mostra le camere invece delle persone.

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
3. **Soggiorni**: `query_curated_view` su `curated_operational_stays` con filtri
   `departure gt G`, `arrival lt G+190`. Stessa cosa con i cursori e i file.
4. **Saldi e date di prenotazione**: `query_curated_view` su `curated_order_balances`. Da qui
   vengono `creation_date` (la data di prenotazione, che prima non era interrogabile),
   `order_total` e `open_balance`.
5. **Chi è già in casa**: `list_in_house` con `date = G`, una chiamata per casa.
6. **Ospiti**, solo se nel testo dell'attività c'è la password: `query_curated_view` su
   `curated_guest_stays` con `stay_end gte G`. Contiene dati personali: non mostrarli, non
   riassumerli, usa i file così come sono.
7. **Costruisci**, dalla cartella del repository:
   ```
   python3 tools/costruisci_scatola.py \
       --disponibilita d1.json,d2.json --soggiorni s1.json,s2.json \
       --saldi saldi.json --inhouse ih1.json,ih2.json,ih3.json \
       [--ospiti o1.json --password "<PASSWORD RECEPTION>"] \
       --da G --a G+190 > scatola.json
   ```
   Leggi il resoconto su stderr: le prenotazioni per casa devono essere dell'ordine di
   grandezza atteso (centinaia, non decine né migliaia) e le tipologie devono essere 3, 3 e 4.
   Una riga `ATTENZIONE` va capita prima di andare avanti.
8. **Verifica**: `python3 tools/verifica_scatola.py scatola.json [o1.json ["<PASSWORD>"]]`
   deve finire con `verifica OK`. Passa i file degli ospiti e la password: è il controllo che
   nessun nome sia finito in chiaro e che il blocco cifrato si riapra davvero.
9. **Controllo dei tipi e costruzione**: `npm install && npm run check && npm run build`.
   Se il controllo dei tipi non passa, non pubblicare: la pubblicazione su Pages si fermerebbe
   comunque lì.
10. **Pubblica**: `git add scatola.json`, commit `Scatola G`, `git push origin HEAD:main`.
    GitHub Actions ricostruisce la pagina e copia lo scatto accanto a lei.
11. **Riepilogo** in italiano, senza nomi: periodo coperto, prenotazioni per casa, notti in
    conflitto trovate (le righe con `confirmed_occupied > physical_rooms - closure_count`,
    sommate per casa), freschezza di La Scatola, e qualunque cosa sia andata storta.

## Cosa fa la piattaforma con lo scatto

Lo legge a ogni apertura e **non lo salva**: il giorno dopo è sostituito. Impostazioni, lista
d'attesa, registro e corrispondenza restano in Firestore, perché sono lavoro della reception e
non dati di Slope. Così non esistono due verità da tenere allineate.

Le tipologie dello scatto sono quelle vere di Slope, con le camere vere. La tabella delle
tipologie compilata a mano nelle impostazioni serviva solo finché non c'era questo file:
quando le etichette saranno assegnate (`--etichette`), si può togliere.
