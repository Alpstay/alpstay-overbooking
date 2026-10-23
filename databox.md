# Databox: cosa serve alla piattaforma e cosa è disponibile

Prima verifica il 7 ottobre 2026, rifatta il **23 ottobre 2026** sul catalogo del gateway
`/api/v1`. Tre cose sono cambiate, e vanno lette insieme perché due sono buone e una no.

**1. La data di prenotazione c'è.** `curated_order_balances.creation_date` è interrogabile: il
7 ottobre risultava disponibile solo come `order_summary.creation_date`, su una tabella chiusa.
È la data dell'**ordine**, non della singola camera, ma per l'anticipo basta.

**2. Sono comparsi cinque report nuovi**: `report_cancellations`, `report_channel_mix`,
`report_booking_window`, `report_revenue_adr`, `report_deposits`.

**3. Lo storico però parte dal 23 settembre 2026.** `report_cancellations` su novembre
2025 – aprile 2026 risponde `coverage.start: 2026-09-23` e zero righe: un mese di dati, nessun
inverno dentro. E i report sono **aggregati** — cancellazioni per giorno e canale, mix per
struttura — non per prenotazione: non dicono quale prenotazione è stata cancellata, quando era
l'arrivo e quanto prima è stata fatta. Una curva di cancellazione ha bisogno proprio di quelle
tre date insieme, per ogni prenotazione.

**Conseguenza.** La soglia vendibile continua a non essere calcolabile, ma per un motivo
diverso da prima: non perché il dato non esista, perché non è ancora abbastanza lungo. Se la
registrazione continua, il primo modello si potrà tarare **dopo questo inverno**, su una
stagione intera. Nel frattempo si lavora sulla parte operativa, e il conteggio delle camere che
esistono davvero resta la via alternativa che non richiede previsioni.

La databox espone le tre case con aggiornamento ogni dieci minuti circa. Non tutto quello che
serve all'overbooking però c'è: questa pagina dice cosa si può collegare subito e cosa manca,
così la decisione è presa sui fatti e non a sensazione.

## Relazioni interrogabili

Attraverso `POST /api/v1/query` si possono interrogare solo le viste curate. Le tabelle di base
(`lodging_reservation`, `order_summary`, `payment`, `rate_plan`…) compaiono nel catalogo ma
hanno `queryable: false`.

| Vista | Cosa dà |
| --- | --- |
| `curated_availability_daily` | per casa × tipologia × giorno: camere fisiche, chiusure, confermate, opzioni, libere dopo le opzioni, overbooking |
| `curated_operational_stays` | soggiorni attivi: arrivo, partenza, camera, tipologia, adulti, bambini, opzione, overbooking |
| `curated_departures` | partenze attive |
| `curated_order_balances` | totale ordine, riscosso, rimborsato, saldo aperto |
| `curated_deposits` | caparre nette per pagamento |
| `curated_guest_stays` | anagrafica completa dell'ospite: nome, email, telefono, lingua, documento |
| `curated_meal_counts_daily` | conteggi pasti |

## Cosa si può collegare subito

- **Capienza e occupazione per notte.** `curated_availability_daily` dà esattamente i numeri su
  cui si regge la Guida strategica — e li dà già calcolati, chiusure comprese. Oggi la
  piattaforma li ricava contando le prenotazione riga per riga: prenderli da qui è più solido.
- **Tabellone e piano camere.** `curated_operational_stays` ha camera assegnata e tipologia:
  basta per il tetris, i cambi camera e il rilevamento dei conflitti.
- **Camere fuori servizio.** `lodging_closure` (via `curated_availability_daily.closure_count`)
  sostituisce la tabella compilata a mano nelle impostazioni.
- **Caparra non pagata.** `curated_order_balances.open_balance` e `curated_deposits` sono una
  prova migliore della parola cercata nel campo pagamento: niente più parole chiave da indovinare.
- **Email agli ospiti.** `curated_guest_stays` dà indirizzo, telefono e **lingua**: i modelli
  sono già in italiano, tedesco e inglese e potrebbero scegliere la lingua da soli.

## Cosa manca, e perché blocca la previsione

| Dato | A cosa serve | Stato al 23 ottobre 2026 |
| --- | --- | --- |
| Stato della prenotazione e data di cancellazione | È **tutta** la curva di cancellazione. Senza lo storico delle cancellate non si può stimare quante camere si libereranno, quindi non si può calcolare nessuna soglia di overbooking. | **parziale**: `report_cancellations` esiste ma parte dal 23/09/2026 ed è aggregato per giorno di cancellazione e canale, non per prenotazione. Manca il legame fra cancellazione, arrivo e data di prenotazione. |
| Canale / agenzia | Le cancellazioni si comportano in modo molto diverso per canale: è la variabile più forte del modello. Serve anche per le commissioni e quindi per il valore netto. | **solo aggregato**: `report_channel_mix` dà il mix per struttura, non il canale della singola prenotazione. |
| Data di prenotazione | L'anticipo è la seconda variabile del modello. | **disponibile**: `curated_order_balances.creation_date`, per ordine. |
| Valore della prenotazione | Decide chi si sposta per primo. `curated_order_balances.order_total` è per ordine, non per prenotazione: su un ordine con più camere non si sa come ripartirlo. | parziale |
| Piano tariffario | Riconosce le non rimborsabili, che sono intoccabili. | non interrogabile |
| Tag / segmento | Il tag `NO OVERBOOKING` che la reception scrive in Slope. | assente |
| Gruppo | I gruppi non si spezzano mai. Si può dedurre dall'`order_id` condiviso, da verificare. | da verificare |

**Conseguenza.** Dalla databox si fa funzionare la parte **operativa** — tabellone, conflitti,
spostamenti di camera, lista d'attesa, email, caparre — e non la parte **predittiva**, cioè la
soglia vendibile. Ma la via alternativa non richiede previsioni: si contano le camere che
esistono davvero (fisiche − chiusure − confermate), si somma per casa e per gruppo, e il
livello a cui il saldo torna positivo dice quale strumento serve. In sette mesi di dati reali
il terzo strumento — l'albergo partner — non è mai stato necessario.

## Richiesta da fare a chi gestisce la databox

Per chiudere il cerchio servono, su una vista interrogabile delle prenotazioni:

1. stato (confermata / cancellata / no-show / opzione) e **data di cancellazione**;
2. canale e agenzia;
3. data di creazione della prenotazione;
4. piano tariffario e segmento o tag;
5. importo imputabile alla singola prenotazione;
6. lo **storico**, non solo le prenotazioni attive: almeno 24 mesi indietro, cancellate comprese.

Il punto 6 è quello che conta di più: una vista che contiene solo i soggiorni attivi non
permette di imparare niente sul passato.

## Accesso

Il gateway usa OAuth 2.1 Authorization Code + PKCE contro il client registrato della mini-app,
e l'utente è un utente Supabase con permessi per casa. Lo scope effettivo è l'intersezione fra
i permessi dell'utente e quelli registrati per l'applicazione: nessuno dei due può allargare
l'altro. Una nuova applicazione va registrata a parte.

Questo significa che **l'identità esiste già**: aggiungere un secondo sistema di login per la
piattaforma creerebbe due anagrafiche di utenti da tenere allineate.

## Come è stato collegato, e perché così

La piattaforma pubblicata **non chiama** il gateway. Non è una scelta di comodo: per chiamarlo
servirebbe un client registrato, e la chiave di un client registrato dentro una pagina pubblica
su GitHub Pages è leggibile da chiunque apra il codice sorgente. Un accesso che si può copiare
non è un accesso.

Si fa quindi come per il counter colazioni, che risolve lo stesso problema da mesi:
un'**attività pianificata** interroga La Scatola via MCP una volta al giorno, scrive
`scatola.json` nel repository e pubblica. La pagina legge quel file, che sta accanto a lei.
La procedura è in [`tools/AGGIORNA-SCATOLA.md`](tools/AGGIORNA-SCATOLA.md).

Cosa si guadagna: nessun client da registrare, nessun segreto nella pagina, nessun utente in
più da gestire, e la pagina funziona anche senza rete verso La Scatola.

Cosa si perde, detto chiaramente: i numeri valgono il momento dello scatto, non adesso. Per
questo `generato` e lo stato di freschezza di La Scatola stanno in testa a ogni pagina, e
quando lo scatto è vecchio o è stato preso mentre La Scatola non si aggiornava la piattaforma
lo dice sopra i numeri invece di mostrarli come se fossero di oggi. Per l'overbooking, che si
decide su prenotazioni dei mesi successivi, uno scatto giornaliero è abbastanza; per il
check-in di stasera no, e quello si fa in Slope.
