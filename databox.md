# Databox: cosa serve alla piattaforma e cosa è disponibile

Verifica fatta il 7 ottobre 2026 sul catalogo del gateway `/api/v1`.

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

| Dato | A cosa serve | Stato |
| --- | --- | --- |
| Stato della prenotazione e data di cancellazione | È **tutta** la curva di cancellazione. Senza lo storico delle cancellate non si può stimare quante camere si libereranno, quindi non si può calcolare nessuna soglia di overbooking. | assente |
| Canale / agenzia | Le cancellazioni si comportano in modo molto diverso per canale: è la variabile più forte del modello. Serve anche per le commissioni e quindi per il valore netto. | assente |
| Data di prenotazione | L'anticipo è la seconda variabile del modello. `order_summary.creation_date` esiste ma la tabella non è interrogabile. | non interrogabile |
| Valore della prenotazione | Decide chi si sposta per primo. `curated_order_balances.order_total` è per ordine, non per prenotazione: su un ordine con più camere non si sa come ripartirlo. | parziale |
| Piano tariffario | Riconosce le non rimborsabili, che sono intoccabili. | non interrogabile |
| Tag / segmento | Il tag `NO OVERBOOKING` che la reception scrive in Slope. | assente |
| Gruppo | I gruppi non si spezzano mai. Si può dedurre dall'`order_id` condiviso, da verificare. | da verificare |

**Conseguenza.** Finché mancano cancellazioni, canale e data di prenotazione, dalla databox si
può far funzionare la parte **operativa** — tabellone, conflitti, spostamenti di camera, lista
d'attesa, email, caparre — ma non la parte **predittiva**, cioè la soglia vendibile, che è il
motivo per cui la piattaforma esiste. Quella continua a richiedere l'export di Slope.

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
