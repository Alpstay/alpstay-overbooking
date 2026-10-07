// Pagina "Come funziona": il manuale della piattaforma, scritto per chi sta in reception.
import type { Ctx } from "./views";
import { IMPORT_ATTIVO, hotelName } from "./views";
import { esc, eur, tagList } from "./util";

interface Capitolo { id: string; titolo: string; corpo: (c: Ctx) => string; }

const go = (tab: string, label: string): string =>
  `<button class="linkbtn" data-act="tab" data-v="${tab}">${label}</button>`;

const CAPITOLI: Capitolo[] = [
  {
    id: "scopo",
    titolo: "A cosa serve",
    corpo: (c) => {
      const case_ = c.app.settings.hotels;
      const tot = case_.reduce((a, h) => a + h.roomTypes.reduce((b, t) => b + t.count, 0), 0);
      return `
      <p class="lead-sm">Serve a <b>riempire le tre case al massimo senza doverci ricredere</b>: vendere qualche camera in più di quelle che esistono, contando sulle cancellazioni che arriveranno, e sapere in anticipo cosa fare le poche volte in cui non bastano.</p>
      <p>Ogni casa viene valutata per conto suo — ${case_.map((h) => `<b>${esc(h.name)}</b> (${h.roomTypes.reduce((b, t) => b + t.count, 0)} camere)`).join(", ")}, ${tot} camere in tutto — perché lo spazio libero di una non autorizza a vendere di più in un'altra.</p>
      <p>La piattaforma fa tre cose, in quest'ordine:</p>
      <ol class="info-ol">
        <li><b>Dice quanto puoi vendere</b>, notte per notte, e quando fermarti. È la ${go("guida", "Guida strategica")}.</li>
        <li><b>Dice cosa fare</b> quando una notte ha più prenotazioni che camere: chi spostare, dove, in che ordine, con quale email. È il ${go("solve", "Problem solving")}.</li>
        <li><b>Tiene traccia</b> di com'è finita ogni posizione e di cosa è stato detto agli ospiti, così il lavoro non dipende da chi era di turno. Sono ${go("registro", "Registro")} e ${go("attesa", "Lista d'attesa")}.</li>
      </ol>`;
    },
  },
  {
    id: "routine",
    titolo: "La routine di ogni mattina",
    corpo: (c) => `
      <p>Dieci minuti, sempre gli stessi passi.</p>
      <ol class="info-ol">
        ${IMPORT_ATTIVO ? `<li><b>Importa l'export di Slope</b> del giorno, cancellate comprese. Senza dati nuovi la piattaforma ragiona su ieri.</li>` : `<li><b>Import sospeso.</b> In attesa della databox di Slope si lavora sui dati dimostrativi: le funzioni sono tutte attive, i numeri sono inventati.</li>`}
        <li>Apri la <b>${go("guida", "Guida strategica")}</b> e guarda le tre schede in alto. «Oltre soglia» sono le notti da sistemare oggi, «Vendibili oltre capienza» quelle su cui puoi ancora vendere, «Soglia raggiunta» quelle da chiudere sul channel manager.</li>
        <li>Per ogni notte oltre soglia premi <b>Risolvi</b>: si apre il Problem solving già posizionato su quella data, con il piano pronto.</li>
        <li>Esegui il piano <b>in ordine di sequenza</b> e segna in Slope i cambi che fai.</li>
        <li>Controlla la <b>${go("attesa", "Lista d'attesa")}</b>: se si è liberata una camera per qualcuno che aspetta, l'email è già pronta.</li>
        <li>Chiudi nel <b>${go("registro", "Registro")}</b> le posizioni risolte, con l'esito e il costo.</li>
      </ol>
      <p class="muted">Nei periodi pieni conviene ripetere il primo passo anche nel pomeriggio: le cancellazioni arrivano tutto il giorno e la soglia si muove con loro.</p>`,
  },
  {
    id: "pagine",
    titolo: "Le pagine, una per una",
    corpo: () => `
      <ul class="info-cols">
        <li><b>Guida strategica</b><p>Il quadro per casa sui prossimi mesi: quante camere tenere in portafoglio per ogni notte, quanto puoi ancora vendere, quando chiudere. Il grafico in alto mostra a colpo d'occhio le notti critiche. La tabella in fondo le elenca tutte, filtrabile ed esportabile.</p></li>
        <li><b>Problem solving</b><p>Il piano vero e proprio, su un intervallo di date che scegli tu. Mostra il tabellone camera per camera come in Slope, la sequenza numerata delle azioni da fare, le cancellazioni con motivo valido e gli spostamenti di camera («da camera 214 a camera 231»).</p></li>
        <li><b>Lista d'attesa</b><p>Chi aspetta una camera: le richieste non impegnative di quando eravate pieni e gli ospiti ricollocati fuori, che hanno la precedenza. La disponibilità si ricalcola da sola a ogni import.</p></li>
        <li><b>Registro</b><p>Com'è finita ogni posizione di overbooking, con costi e motivi, e le statistiche che ne nascono. In fondo, tutta la corrispondenza mandata agli ospiti.</p></li>
        <li><b>Prenotazioni</b><p>L'elenco completo con tutti i filtri: serve per cercare un ospite, controllare una prenotazione, verificare perché risulta protetta.</p></li>
        <li><b>Storico</b><p>Da dove nascono le previsioni: come si cancella per canale e per anticipo, quali canali portano valore affidabile e quali portano camere che poi spariscono.</p></li>
        <li><b>Impostazioni</b><p>Camere e tipologie di ogni casa, soglie di rischio, cosa rende una prenotazione intoccabile, i pesi che decidono chi si sposta per primo, i periodi di alta stagione, le commissioni per canale, la firma delle email.</p></li>
      </ul>
      <p class="muted">Quasi ogni tabella ha accanto al titolo un pulsante <span class="info-btn" aria-hidden="true">i</span>: apre la spiegazione dettagliata di quella tabella, con i criteri che la piattaforma applica e la strategia da adottare.</p>`,
  },
  {
    id: "concetti",
    titolo: "I cinque concetti da capire",
    corpo: (c) => {
      const s = c.app.settings;
      const h = s.hotels[0];
      return `
      <ul class="info-cols">
        <li><b>Cancellazioni attese</b><p>Per ogni prenotazione la piattaforma stima la probabilità che non arrivi, guardando come si è comportato quel <b>canale</b> in quella <b>casa</b> a quel numero di <b>giorni dall'arrivo</b>, e correggendo per alta stagione ed eventi. Non è una media generica: una Booking.com a 60 giorni e una diretta a 3 giorni sono due mondi diversi.</p></li>
        <li><b>Soglia vendibile</b><p>Il massimo di camere da tenere in portafoglio per quella notte. Nasce dal confronto fra quanto rende una camera venduta in più e quanto costa un ospite da ricollocare (${eur(h?.walkCost ?? 0)} al ${esc(h?.name ?? "")}), e non supera mai tre limiti: rischio oltre il ${s.riskMaxPct}%, il tetto percentuale della casa, e nessun overbooking nuovo entro ${s.freezeDays} giorni dall'arrivo.</p></li>
        <li><b>Punteggio di permanenza</b><p>Quando una notte ha più prenotazioni che camere, qualcuno deve spostarsi. Il punteggio decide chi resta: valore netto della prenotazione, data in cui ha prenotato, prepagata o no, quante delle sue notti cadono nel problema, e se l'ospite tiene aperte più prenotazioni che non può usare tutte. I pesi li regoli tu nelle Impostazioni.</p></li>
        <li><b>Principio tetris</b><p>Spostare la prenotazione giusta non basta: bisogna anche non lasciare buchi. Una camera libera una notte sola tra due soggiorni è quasi invendibile. La piattaforma riassegna le camere per ridurre queste notti isolate, e ti dice quante ne ha recuperate.</p></li>
        <li><b>Protezioni</b><p>Alcune prenotazioni non si toccano mai, qualunque sia il punteggio: gruppi, ospiti abituali, Expedia Collect, non rimborsabili, chi ha il tag ${esc(tagList(s.rules.fixedTag))} in Slope, chi è già in casa, e le prenotazioni bloccate a mano. Le prenotazioni con più camere non vengono mai spezzate.</p></li>
      </ul>`;
    },
  },
  {
    id: "regole",
    titolo: "Le regole che non vengono mai violate",
    corpo: () => `
      <ul class="info-tips">
        <li><b>Una prenotazione confermata non si annulla per fare spazio.</b> Se non c'è camera, l'ospite si ricolloca in un hotel di pari o superiore categoria, con trasferimento e differenza a nostro carico. L'overbooking è l'ultima risorsa, non la prima.</li>
        <li><b>Si cancella solo con un motivo documentato.</b> Garanzia non valida, caparra scaduta, camera dichiarata inagibile: fatti che risultano dai dati o li dichiara la direzione. E sempre con un sollecito prima, con una scadenza. Nessun guasto inventato, nessun rifiuto della carta non vero: una dichiarazione falsa rende la cancellazione illegittima e la responsabilità è nostra.</li>
        <li><b>La nazionalità non è un criterio.</b> Scegliere chi spostare in base alla provenienza è una discriminazione vietata dall'articolo 43 del D.Lgs. 286/1998. Contano il valore netto e l'affidabilità del canale, che misurano direttamente quello che interessa.</li>
        <li><b>Prima si chiede, poi si sposta.</b> Quando c'è tempo, la proposta volontaria — cambio casa o date in cambio di un vantaggio — evita l'overbooking senza che nessuno subisca niente.</li>
      </ul>`,
  },
  {
    id: "limiti",
    titolo: "Cosa non fa, e va saputo",
    corpo: () => `
      <ul class="info-tips">
        <li><b>Non scrive in Slope.</b> Legge un export e propone; i cambi li fai tu nel gestionale. Finché non li fai e non reimporti, per la piattaforma non sono avvenuti.</li>
        <li><b>Non vende e non chiude le vendite.</b> Dice quanto aprire o chiudere sul channel manager: l'operazione è tua.</li>
        <li><b>Non manda le email.</b> Le scrive, già compilate e nella lingua giusta; tu le copi o le apri nel programma di posta. Non legge le risposte: il registro dice cosa è uscito, non cosa è tornato.</li>
        <li><b>Non sa cosa è successo dopo l'ultimo import.</b> Ogni numero è fotografato a quel momento.</li>
        <li><b>Non decide al posto tuo.</b> Su una prenotazione protetta, o quando restano solo prenotazioni che non si possono spostare, si ferma e lo dice: quella è una decisione da persona.</li>
      </ul>`,
  },
  {
    id: "glossario",
    titolo: "Glossario",
    corpo: () => `
      <ul class="info-cols">
        <li><b>Overbooking</b><p>Vendere più camere di quelle che esistono. Controllato quando è calcolato sulle cancellazioni attese; subìto quando ti accorgi la sera prima che manca una camera.</p></li>
        <li><b>In portafoglio</b><p>Le camere già prenotate per quella notte, cancellate escluse.</p></li>
        <li><b>Margine</b><p>Soglia vendibile meno camere in portafoglio. Positivo: puoi vendere. Zero: fermati. Negativo: sei oltre soglia.</p></li>
        <li><b>Riprotezione</b><p>Spostare l'ospite in un'altra casa AlpStay alle stesse condizioni. Prima scelta quando l'upgrade interno non basta.</p></li>
        <li><b>Ricollocamento</b><p>Portare l'ospite in un hotel di colleghi, a nostro carico. Ultima risorsa.</p></li>
        <li><b>Notte isolata</b><p>Una camera libera una o due notti fra due soggiorni: quasi invendibile. Il tetris serve a evitarle.</p></li>
        <li><b>Doppia prenotazione</b><p>Lo stesso ospite tiene aperte più prenotazioni che non può usare tutte, e ne cancellerà alcune. Quelle camere si libereranno quasi certamente: sono le prime da usare.</p></li>
        <li><b>Valore netto</b><p>L'importo della prenotazione meno la commissione del canale: quello che resta davvero alla casa.</p></li>
      </ul>`,
  },
];

export function viewManual(c: Ctx): string {
  const indice = CAPITOLI.map((k) => `<button class="chipbtn" data-act="scroll" data-v="${k.id}">${esc(k.titolo)}</button>`).join("");
  const corpo = CAPITOLI.map((k) => `<h3 class="sec" id="${k.id}">${esc(k.titolo)}</h3>
    <article class="card">${k.corpo(c)}</article>`).join("");
  return `<section class="page manual">
    <h2 class="lead">Come funziona la piattaforma</h2>
    <p class="muted narrow">Scritto per chi ci lavora ogni giorno: cosa fa, cosa chiede a te, e su quali regole non transige. Si legge una volta; poi bastano i pulsanti <span class="info-btn" aria-hidden="true">i</span> accanto alle tabelle.</p>
    <div class="presets manual-idx"><span>Vai a</span>${indice}</div>
    ${corpo}
    <p class="muted narrow"><small>Serve una casa in più, una regola diversa, un'email che manca? La piattaforma è fatta per essere cambiata: le impostazioni coprono quasi tutto, il resto si aggiunge.</small></p>
  </section>`;
}
