// Pannelli informativi "i" delle tabelle.
import type { Ctx } from "./views";
import { esc, eur, tagList } from "./util";
import { GROUND_LABEL } from "./cancellable";

export type InfoKey = "legend" | "moves" | "nights" | "channels" | "rooms" | "waitlist" | "spec" | "registro" | "pesi" | "cancellazioni" | "azioni";

export function infoButton(key: InfoKey, label: string): string {
  return `<button class="info-btn" data-act="info" data-v="${key}" aria-label="${esc(label)}" title="${esc(label)}">i</button>`;
}

export function movesInfoSheet(c: Ctx): string {
  const s = c.app.settings;
  const w = s.weights;
  const col = (name: string, text: string): string => `<li><b>${name}</b><p>${text}</p></li>`;
  return `<div class="sheet-bg" data-act="info-close"></div>
  <aside class="sheet wide" role="dialog" aria-label="Cosa mostra la sequenza delle azioni">
    <header><div><h3>Sequenza delle azioni</h3><small class="muted">Cosa mostra la tabella e come usarla</small></div><button class="btn ghost sm" data-act="info-close">Chiudi</button></header>

    <p>È la lista di <b>tutto quello che va fatto</b> per eliminare i conflitti di camere nel periodo scelto sopra («Dal» e «Al»), nell'ordine in cui conviene farlo. Ogni riga è una prenotazione che il piano propone di spostare. Le prenotazioni che non compaiono restano dove sono.</p>

    <h4 class="lg-h">L'ordine dei passi</h4>
    <ol class="info-ol">
      <li><b>Cambi in casa.</b> Prima si prova a risolvere senza disturbare nessuno: upgrade gratuito a una tipologia superiore, o cambio a una tipologia adatta allo stesso numero di ospiti. Per gli upgrade si scelgono gli ospiti con il punteggio più alto, anche se fissi: il posto migliore va a chi lo merita.</li>
      <li><b>Riprotezioni nelle altre case AlpStay.</b> Chi deve lasciare la casa viene spostato in un'altra delle tre, per tutto il soggiorno, prima nelle case di categoria pari o superiore. Il posto disponibile va prima agli ospiti con il punteggio più alto.</li>
      <li><b>Overbooking.</b> Chi non trova posto in nessuna delle tre case va ricollocato in un hotel partner. Qui l'ordine è l'ordine di chiamata: si parte dal punteggio più basso.</li>
    </ol>
    <p>Le prenotazioni fisse (gruppi, abituali, Expedia Collect) non vengono mai spostate fuori dalla casa: possono comparire solo come upgrade. Quelle <b>intoccabili</b> — tag ${esc(tagList(s.rules.fixedTag))} in Slope, blocco manuale, ospiti già in casa${s.rules.protectNonRefundable ? ", prenotazioni non rimborsabili" : ""} — non compaiono affatto: non cambiano casa, né tipologia, né camera.</p>

    <h4 class="lg-h">Le colonne</h4>
    <ul class="info-cols">
      ${col("#", "Numero del passo. È lo stesso numero bianco che compare sulla barra nel tabellone e nel pannello della notte, così ritrovi subito la prenotazione.")}
      ${col("Azione", "Upgrade / cambio interno, Riprotezione in altra casa oppure Overbooking.")}
      ${col("Casa", "La casa in cui la prenotazione si trova oggi in Slope.")}
      ${col("ID Slope", "L'identificativo della prenotazione, identico a Slope: usalo per cercarla nel gestionale.")}
      ${col("Ospite, Arrivo, Notti, Cam., Canale", "I dati del soggiorno come arrivano dall'export di Slope.")}
      ${col("Valore netto", "Totale del soggiorno meno la commissione del canale impostata nelle Impostazioni. È il criterio principale per decidere chi spostare.")}
      ${col("Destinazione", "Dove va la prenotazione: la nuova tipologia nella stessa casa, la casa e la tipologia di arrivo, oppure l'indicazione di ricollocarla fuori. Se la casa di arrivo ha categoria inferiore, lo segnala: serve il consenso dell'ospite.")}
      ${col("Perché", `Il motivo della scelta. Per chi viene spostato riporta gli elementi del punteggio di permanenza: valore netto rispetto alle altre prenotazioni del periodo (peso ${w.value}), quota di notti in conflitto per il principio tetris (peso ${w.fit}), data di prenotazione (peso ${w.early}), prepagata (peso ${w.prepaid}). Chi ha il punteggio più basso si sposta per primo.`)}
    </ul>

    <h4 class="lg-h">Come usarla in turno</h4>
    <ul class="info-tips">
      <li>Filtra «Azione» su <b>Overbooking</b> per avere la lista delle telefonate da fare, già in ordine.</li>
      <li>Filtra «Casa» per lavorare una struttura alla volta.</li>
      <li>«Excel» o «CSV» esporta esattamente le righe filtrate, da stampare o condividere.</li>
      <li>Per spuntare i passi fatti, clicca la data nel tabellone: il pannello della notte ha il pulsante «Segna fatto», condiviso con tutto lo staff.</li>
      <li>Se un ospite rifiuta lo spostamento, bloccalo come fisso dalla sua scheda (clic sulla barra): il piano si ricalcola e la sequenza cambia.</li>
    </ul>
    <p class="muted"><small>Il piano si calcola quando premi «Calcola il piano» o «Risolvi». Dopo ogni import da Slope va ricalcolato, così la sequenza riflette i dati più recenti.</small></p>
  </aside>`;
}

function sheetWrap(title: string, sub: string, body: string): string {
  return `<div class="sheet-bg" data-act="info-close"></div>
  <aside class="sheet wide" role="dialog" aria-label="${esc(title)}">
    <header><div><h3>${esc(title)}</h3><small class="muted">${esc(sub)}</small></div><button class="btn ghost sm" data-act="info-close">Chiudi</button></header>
    ${body}
  </aside>`;
}

const colLi = (name: string, text: string): string => `<li><b>${name}</b><p>${text}</p></li>`;

/** Tabella "Dettaglio per notte" della Guida strategica. */
export function nightsInfoSheet(c: Ctx): string {
  const s = c.app.settings;
  const h = c.ui.hotel === "gruppo" ? null : s.hotels.find((x) => x.id === c.ui.hotel) ?? null;
  const tetto = h ? `${h.maxOverbookPct}% delle camere di ${esc(h.name)}` : "il tetto percentuale di ciascuna casa";
  const body = `
    <p>È la <b>guida operativa notte per notte</b> per i prossimi ${s.horizonDays} giorni. Per ogni notte dice quante camere puoi tenere in portafoglio in sicurezza e quindi se devi <b>vendere di più, fermarti o intervenire</b>. Serve a riempire la casa al 100% sfruttando le cancellazioni che arriveranno, senza spostare ospiti più del necessario.</p>

    <h4 class="lg-h">Come viene calcolata la soglia</h4>
    <p>Per ogni prenotazione in portafoglio la piattaforma stima la probabilità che non arrivi (cancellazione o no-show). La stima usa lo storico di questa casa per <b>canale</b> e per <b>giorni mancanti all'arrivo</b>, ed è corretta per alta stagione e manifestazioni. Poi confronta il guadagno di una camera venduta in più (ADR netto) con il costo di un ospite da ricollocare fuori, e sceglie il numero di camere che rende di più. Ci sono tre limiti che la soglia non supera mai:</p>
    <ul class="info-tips">
      <li>probabilità di dover ricollocare qualcuno oltre il ${s.riskMaxPct}%;</li>
      <li>overbooking oltre ${tetto}, o il tetto specifico del periodo di alta stagione;</li>
      <li>nuovo overbooking entro ${s.freezeDays} giorni dall'arrivo: a quel punto le cancellazioni sono troppo poche per contarci.</li>
    </ul>

    <h4 class="lg-h">Le colonne</h4>
    <ul class="info-cols">
      ${colLi("Notte", "La notte di pernottamento (non la data di arrivo).")}
      ${colLi("Periodo", "L'alta stagione o la manifestazione impostata. In questi periodi di solito si cancella meno, quindi la soglia è più prudente.")}
      ${colLi("Capienza", "Camere vendibili della casa, dalle Impostazioni.")}
      ${colLi("In portafoglio", "Camere già prenotate per quella notte, cancellate escluse, secondo l'ultimo import da Slope.")}
      ${colLi("Fisse", "Camere che non si possono spostare: gruppi, abituali, Expedia Collect, tag fisso, già in casa. Più sono alte, meno spazio di manovra hai in caso di problemi.")}
      ${colLi("Cancellaz. attese", "Quante camere ci si aspetta che cancellino o non si presentino da oggi all'arrivo. La fascia oro è il margine di incertezza, la tacca nera le camere in eccesso: verde se le cancellazioni le coprono, rosso se non bastano.")}
      ${colLi("Occupaz. attesa", "Occupazione finale prevista se da oggi non vendi più nulla. Sotto il 100% hai camere da vendere.")}
      ${colLi("Vendibili totali", "La soglia: il massimo di camere da tenere in portafoglio. Il numero oro (+N) è l'overbooking consentito oltre la capienza.")}
      ${colLi("Margine", "Vendibili totali meno In portafoglio. Positivo: puoi ancora vendere. Zero: fermati. Negativo: sei oltre la soglia.")}
      ${colLi("Rischio overbooking", "Probabilità di dover ricollocare almeno un ospite con le prenotazioni attuali.")}
      ${colLi("Azione", "La strategia da adottare per quella notte, spiegata sotto.")}
    </ul>

    <h4 class="lg-h">La strategia per ogni azione</h4>
    <ul class="lg-list strat">
      <li><span class="tag vendi">Vendi in overbooking</span><div><p>La casa è piena ma le cancellazioni attese lasciano spazio. <b>Strategia:</b> sul channel manager apri un overbooking pari al valore oro (+N) e continua a vendere finché il margine arriva a zero. Vendi prima sui canali migliori (vedi Storico → Canali) e, se puoi, a tariffa piena o non rimborsabile: stai vendendo camere che non hai ancora, meglio che rendano il massimo.</p></div></li>
      <li><span class="tag stop">Chiudi le vendite</span><div><p>Hai raggiunto la soglia. <b>Strategia:</b> stop sell su tutti i canali, sito compreso, per quella notte. Riapri solo quando il margine torna positivo, cioè dopo un import con nuove cancellazioni. Non abbassare le tariffe per riempire: la notte è già al massimo sicuro.</p></div></li>
      <li><span class="tag rischio">Oltre soglia</span><div><p>Hai più camere in portafoglio di quelle sicure. <b>Strategia:</b> chiudi subito le vendite. Se l'arrivo è lontano e le cancellazioni attese coprono l'eccesso (barra verde), fai solo i cambi interni e ricontrolla dopo i prossimi import. Se la barra è rossa o l'arrivo è vicino, apri «Risolvi» e segui il piano: cambi in casa, riprotezione nelle altre case, overbooking per ultimo.</p></div></li>
      <li><span class="tag pieno">Quasi pieno</span><div><p>Sopra l'85% ma ancora sotto capienza. <b>Strategia:</b> sostieni il prezzo, niente sconti last minute. Se la colonna «Vendibili totali» mostra +N, sai che quando ti riempi potrai continuare a vendere. Controlla le notti isolate nel tabellone: sono le camere più difficili da vendere.</p></div></li>
      <li><span class="tag libero">Vendita normale</span><div><p>Nessun problema di overbooking. <b>Strategia:</b> lavora sulla domanda (tariffe, promozioni, canali). L'overbooking qui non serve: prima bisogna riempire le camere reali.</p></div></li>
    </ul>

    <h4 class="lg-h">Routine consigliata ogni mattina</h4>
    <ol class="info-ol">
      <li>Importa l'export di Slope del giorno (Importa da Slope).</li>
      <li>Filtra «Azione» su <b>Oltre soglia</b>: per ogni notte chiudi le vendite e, se serve, apri «Risolvi».</li>
      <li>Filtra su <b>Chiudi le vendite</b> e verifica che sul channel manager quelle notti siano chiuse.</li>
      <li>Filtra su <b>Vendi in overbooking</b> e allinea l'overbooking del channel manager al valore +N.</li>
      <li>Ripeti per le altre due case, oppure guarda «Gruppo» per il quadro complessivo.</li>
    </ol>
    <p class="muted"><small>La vista «Gruppo» somma le tre case ma non tiene conto dello spazio che una casa può offrire all'altra: le decisioni di vendita vanno prese casa per casa. «Excel» esporta le righe filtrate.</small></p>`;
  return sheetWrap("Dettaglio per notte", "A cosa serve la tabella e quale strategia adottare", body);
}

/** Tabella "Canali: migliori e peggiori" dello Storico. */
export function channelsInfoSheet(c: Ctx): string {
  const body = `
    <p>Mette a confronto i canali di vendita sullo <b>storico reale</b> delle prenotazioni già arrivate (o cancellate), per capire quali portano valore affidabile e quali portano camere che poi spariscono. Serve a decidere <b>dove vendere quando la casa si riempie</b> e quanto fidarsi delle prenotazioni di ogni canale.</p>

    <h4 class="lg-h">Le colonne</h4>
    <ul class="info-cols">
      ${colLi("Canale", "Il canale come arriva da Slope, normalizzato (per esempio tutte le varianti Booking.com diventano «booking.com»).")}
      ${colLi("Giudizio", "I tre canali migliori e i tre peggiori per «Resa affidabile». Con pochi canali ne vengono segnati meno.")}
      ${colLi("Camere", "Camere prenotate dal canale nello storico. Sotto 5 camere il canale non compare: dati troppo scarsi.")}
      ${colLi("Cancellazioni", "Quota di camere cancellate. È il dato che pesa di più sull'overbooking: più è alta, più il canale «libera» camere.")}
      ${colLi("No-show", "Quota di ospiti confermati che non si sono presentati.")}
      ${colLi("Anticipo medio", "Giorni medi tra prenotazione e arrivo. Anticipi lunghi significano più tempo per cancellare.")}
      ${colLi("Netto per notte", "Ricavo medio per camera-notte al netto della commissione del canale impostata.")}
      ${colLi("Resa affidabile", "Netto per notte moltiplicato per la probabilità che la prenotazione arrivi davvero. È l'indicatore da usare per confrontare i canali.")}
    </ul>

    <h4 class="lg-h">Strategia da adottare</h4>
    <ul class="info-tips">
      <li><b>Quando una notte si avvicina al pieno</b>, lascia aperti più a lungo i canali <b>migliori</b> e chiudi per primi i <b>peggiori</b>: le ultime camere vanno a chi rende di più e cancella meno.</li>
      <li><b>In overbooking vendi sui canali affidabili</b>: una camera venduta oltre capienza su un canale che cancella poco rischia di diventare un ospite da ricollocare.</li>
      <li><b>Sui canali peggiori in alta stagione</b> valuta tariffe non rimborsabili, soggiorno minimo o prepagamento: riducono le cancellazioni tardive.</li>
      <li><b>Un canale con molte cancellazioni ma anticipo lungo</b> non è necessariamente un problema: le cancellazioni arrivano presto e la camera si rivende. Il rischio vero sono le cancellazioni tardive, che la curva «Probabilità che una camera non arrivi» mostra per giorni mancanti.</li>
      <li><b>Spingi il diretto</b> (sito, telefono, email) dove la resa affidabile è alta: nessuna commissione e ospiti che cancellano meno.</li>
    </ul>

    <h4 class="lg-h">Come entra nel calcolo dell'overbooking</h4>
    <p>La soglia della Guida strategica usa la probabilità di cancellazione di ogni canale: una notte piena di prenotazioni dal canale che cancella di più permette più overbooking di una notte piena di prenotazioni dirette. Nella scelta di <b>chi spostare</b>, invece, conta il valore netto della singola prenotazione, non il giudizio sul canale.</p>
    <p class="muted"><small>La classifica si aggiorna a ogni import. Le percentuali di commissione si modificano in Impostazioni → Commissioni per canale.</small></p>`;
  return sheetWrap("Canali: migliori e peggiori", "A cosa serve la tabella e quale strategia adottare", body);
}

/** Tabelle "Spostamenti di camera" e "Notti isolate rimaste". */
export function roomsInfoSheet(c: Ctx): string {
  const body = `
    <p>Traduce il piano in <b>istruzioni camera per camera</b> da eseguire nel planning di Slope: «sposta l'ospite dalla camera X alla camera Y». Il punto di partenza è sempre la camera che la prenotazione ha oggi in Slope.</p>
    <h4 class="lg-h">Come vengono decise le camere</h4>
    <ol class="info-ol">
      <li><b>Ognuno resta nella sua camera di Slope</b> se è libera per tutto il soggiorno. Gli ospiti già in casa non cambiano mai camera.</li>
      <li><b>Chi non ha camera</b> (riprotetti da un'altra casa, cambi di tipologia, prenotazioni non ancora assegnate) va nella camera dove crea meno notti isolate e il soggiorno si attacca a quelli vicini.</li>
      <li><b>Se una tipologia è piena e frammentata</b>, si libera una camera spostando chi la occupa in un'altra camera libera per tutte le sue notti. Solo se non basta si ridistribuisce la tipologia, sempre lasciando nella propria camera chi può restarci.</li>
      <li><b>Miglioramento finale:</b> una prenotazione viene spostata solo se il totale delle notti isolate diminuisce. Ogni spostamento ha il suo motivo.</li>
    </ol>
    <h4 class="lg-h">Tipi di spostamento</h4>
    <ul class="info-cols">
      <li><b>Cambio camera</b><p>Stessa tipologia, altra camera: per eliminare notti isolate o per fare posto a qualcuno. In Slope trascina la prenotazione nella nuova camera, stesse date e stesso prezzo.</p></li>
      <li><b>Cambio tipologia</b><p>Upgrade o cambio tipologia deciso dal piano, con la camera di destinazione precisa.</p></li>
      <li><b>Da altra casa</b><p>Riprotezione: «Da camera» è la camera nella casa di origine, «A camera» quella nella casa di destinazione, dove va creata la nuova prenotazione.</p></li>
      <li><b>Assegna camera</b><p>La prenotazione non ha ancora una camera in Slope: questa è la camera consigliata per non lasciare buchi.</p></li>
    </ul>
    <h4 class="lg-h">Notti isolate rimaste</h4>
    <p>Sono i vuoti di 1 o 2 notti tra due soggiorni nella stessa camera che non si possono eliminare spostando le camere. La colonna «Come recuperarle» indica chi contattare: l'ospite che parte (prolungamento) o quello che arriva (anticipo); in alternativa la camera va venduta per quelle notti come soggiorno breve.</p>
    <p class="muted"><small>Il confronto «con l'assegnazione attuale di Slope» compare solo se nell'export c'è la colonna Camera per almeno il 60% delle prenotazioni. Il conteggio vale per il periodo del piano: i vuoti ai bordi del periodo non vengono contati.</small></p>`;
  return sheetWrap("Spostamenti di camera", "Da camera X a camera Y: come nascono le istruzioni", body);
}

/** Controllo delle doppie prenotazioni ("furbetti"). */
export function specInfoSheet(c: Ctx): string {
  const s = c.app.settings;
  const body = `
    <p>Segnala gli ospiti che tengono aperte <b>più prenotazioni che non possono usare tutte</b>: le terranno finché non decidono, poi ne cancelleranno una. Sono le camere che si libereranno quasi certamente, quindi sono le prime da rivendere in overbooking.</p>
    <h4 class="lg-h">Come vengono trovate</h4>
    <p>A ogni import la piattaforma confronta tutte le prenotazioni future delle tre case e raggruppa quelle dello stesso ospite, usando l'<b>ID cliente di Slope</b>; se manca, usa nome e cognome. Poi guarda le date.</p>
    <ul class="info-cols">
      <li><b>Stesse notti in case diverse — rischio alto</b><p>L'ospite ha prenotato le stesse notti in due case AlpStay: può dormire in una sola, quindi una cancellazione è quasi certa.</p></li>
      <li><b>Notti sovrapposte nella stessa casa — rischio medio</b><p>Due prenotazioni separate che si accavallano con date diverse. Se le date sono identiche non viene segnalata, perché di solito è una comitiva con due camere.</p></li>
      <li><b>Più periodi tenuti aperti — rischio medio</b><p>Due soggiorni in periodi diversi a meno di ${s.rules.speculativeWindowDays} giorni l'uno dall'altro: sta ancora scegliendo quando venire.</p></li>
      <li><b>Cancellazioni già fatte — alza il livello</b><p>Se lo stesso ospite ha già cancellato almeno due volte in passato, il rischio medio diventa alto.</p></li>
    </ul>
    <h4 class="lg-h">Cosa cambia nel piano</h4>
    <p>Una prenotazione segnalata perde punti nel punteggio di permanenza (peso «Doppie prenotazioni», oggi ${s.weights.speculative}): nel Problem solving finisce in cima alla lista di chi va spostato o messo in overbooking, e il motivo compare per esteso nella colonna «Perché».</p>
    <p>Le protezioni vincono comunque: un gruppo, un ospite abituale, una Expedia Collect, una non rimborsabile o una prenotazione con il tag restano protette anche se segnalate. Una prenotazione prepagata non viene mai penalizzata, perché cancellandola l'ospite perderebbe i soldi.</p>
    <h4 class="lg-h">Cosa fare</h4>
    <ul class="info-tips">
      <li>Prima di vendere quelle camere in overbooking, contatta l'ospite e chiedi quale periodo conferma: spesso rinuncia subito all'altro.</li>
      <li>Per i rischi alti valuta di chiedere una caparra o di proporre una tariffa non rimborsabile scontata: chi sta speculando rinuncia, chi verrà davvero accetta.</li>
      <li>Controlla i falsi allarmi: due familiari con lo stesso cognome, o un'agenzia che prenota per clienti diversi con lo stesso ID cliente. In quel caso blocca la prenotazione dalla sua scheda.</li>
    </ul>
    <p class="muted"><small>Il controllo guarda solo gli arrivi futuri. Gli ospiti già in casa non vengono mai segnalati.</small></p>`;
  return sheetWrap("Doppie prenotazioni", "Come vengono trovate e cosa cambia nel piano", body);
}

/** Come si leggono e si tarano i pesi di «Chi si sposta per primo». */
export function weightsInfoSheet(c: Ctx): string {
  const s = c.ui.draft ?? c.app.settings;
  const w = s.weights;
  const ex = (vn: number, early: number, prep: boolean, spec: number): number =>
    (w.value * vn + w.early * early + w.prepaid * (prep ? 1 : 0) - w.speculative * spec) / 100;
  const n2 = (x: number): string => x.toFixed(2).replace(".", ",");
  const a = ex(0.20, 0.10, false, 0), b = ex(0.80, 0.90, false, 0), d = ex(0.90, 0.50, false, 1);

  const body = `
    <p>Ogni prenotazione riceve un <b>punteggio di permanenza</b>: più è alto, più resta dov'è. Quando una notte ha più prenotazioni che camere, esce per prima quella con il punteggio più basso. I cursori decidono quanto pesa ciascun criterio.</p>

    <h4 class="lg-h">Come si legge un punteggio</h4>
    <p>Il punteggio va da circa 0 a 1. Non ha un significato assoluto: conta solo il confronto fra le prenotazioni <b>dello stesso periodo</b>. Lo trovi nella colonna «Perché» del piano, spiegato a parole.</p>
    <p>Il calcolo è questo:</p>
    <p class="formula">punteggio = ( <b>${w.value}</b> × valore + <b>${w.early}</b> × anticipo + <b>${w.prepaid}</b> × prepagata − <b>${w.speculative}</b> × doppia ) ÷ 100</p>
    <p>Poi, solo al momento di scegliere chi togliere da una notte in conflitto, si sottrae il tetris:</p>
    <p class="formula">scelta = punteggio − <b>${w.fit}</b> ÷ 100 × quota di notti in conflitto</p>

    <h4 class="lg-h">Cosa significa ogni criterio</h4>
    <ul class="info-cols">
      <li><b>Valore netto — peso ${w.value}</b><p>Non è l'importo in euro, ma la <b>posizione in classifica</b> fra le prenotazioni del periodo: 0 è la più economica, 1 la più cara. Per questo la stessa prenotazione può risultare «bassa» a Natale e «alta» a novembre. È al netto della commissione del canale. Se l'importo manca nell'export (0 €), viene considerata di valore medio.</p></li>
      <li><b>Principio tetris — peso ${w.fit}</b><p>Quota delle sue notti che cadono nella notte in conflitto: 1 vuol dire che tutto il soggiorno è nel problema, 0,25 che lo è solo un quarto. Spostare chi ha quota alta risolve senza lasciare buchi. Alzalo se ti ritrovi con molte notti isolate; abbassalo se ti spiace spostare soggiorni brevi.</p></li>
      <li><b>Data di prenotazione — peso ${w.early}</b><p>1 a chi ha prenotato per primo, 0 all'ultimo arrivato. È il criterio di equità: chi si è mosso prima ha più diritto alla camera.</p></li>
      <li><b>Prepagata — peso ${w.prepaid}</b><p>Vale 1 se non rimborsabile o già pagata.${s.rules.protectNonRefundable ? " Oggi queste prenotazioni sono comunque intoccabili, quindi questo peso incide solo se togli quella protezione." : ""}</p></li>
      <li><b>Doppie prenotazioni — peso ${w.speculative}</b><p>Si <b>sottrae</b>, non si somma: 1 per un rischio alto, 0,55 per un rischio medio, 0 per una prepagata. È l'unico criterio che può far uscire una prenotazione di valore alto.</p></li>
      <li><b>Due periodi entro quanti giorni</b><p>Non è un peso: è il parametro con cui si riconoscono le doppie prenotazioni. Oggi ${s.rules.speculativeWindowDays} giorni. Più è largo, più ospiti vengono segnalati.</p></li>
    </ul>

    <h4 class="lg-h">Un esempio con i tuoi pesi</h4>
    ${(() => {
      const righe = [
        { t: "A — economica, prenotata all'ultimo, tutto il soggiorno in conflitto", vn: "0,20", an: "0,10", dp: "no", k: a, f: 1 },
        { t: "B — cara, prenotata per prima, metà soggiorno in conflitto", vn: "0,80", an: "0,90", dp: "no", k: b, f: 0.5 },
        { t: "D — molto cara, ma tiene aperte più prenotazioni", vn: "0,90", an: "0,50", dp: "rischio alto", k: d, f: 0.5 },
      ].map((r) => ({ ...r, finale: r.k - (w.fit / 100) * r.f }));
      const min = Math.min(...righe.map((r) => r.finale));
      return `<ul class="exlist">${righe.map((r) => `<li class="${r.finale === min ? "first" : ""}">
        <span class="ex-t">${esc(r.t)}</span>
        <span class="ex-n"><span>valore <b>${r.vn}</b></span><span>anticipo <b>${r.an}</b></span><span>doppia <b>${esc(r.dp)}</b></span><span>punteggio <b>${n2(r.k)}</b></span><span class="out">con tetris <b>${n2(r.finale)}</b>${r.finale === min ? " — esce per prima" : ""}</span></span>
      </li>`).join("")}</ul>`;
    })()}
    <p class="muted"><small>Esce per prima quella con il valore più basso dopo il tetris.${d < a ? " Con i pesi attuali la doppia prenotazione esce prima della più economica: è il comportamento voluto." : " Con i pesi attuali la doppia prenotazione resta davanti alla più economica: se vuoi che esca per prima, alza il peso «Doppie prenotazioni»."}</small></p>

    <h4 class="lg-h">Come tararli</h4>
    <ul class="info-tips">
      <li><b>Contano solo i rapporti</b>, non la somma: raddoppiare tutti i cursori non cambia nulla. Muovine uno alla volta e ricalcola il piano per vedere l'effetto.</li>
      <li><b>Priorità al fatturato</b>: valore 70, tetris 15, data 5, prepagata 10. Difendi le prenotazioni che rendono, accettando qualche notte isolata.</li>
      <li><b>Priorità al planning</b>: valore 40, tetris 40. Meno buchi in camera, ma a volte sposti ospiti che rendono di più.</li>
      <li><b>Caccia ai furbetti</b>: doppie 60 o più. Escono per prime anche se valgono molto.</li>
      <li><b>Equità verso il cliente</b>: data di prenotazione 25 o più, utile se ricevi lamentele da chi aveva prenotato con largo anticipo.</li>
    </ul>

    <h4 class="lg-h">Quello che i pesi non possono fare</h4>
    <p>Le protezioni vengono prima di tutto: un gruppo, un ospite abituale, una Expedia Collect, una non rimborsabile, una prenotazione con il tag o un ospite già in casa non escono mai, qualunque sia il punteggio. I pesi decidono solo fra le prenotazioni che si possono spostare.</p>
    <p>La nazionalità non è e non sarà un criterio: sceglierebbe le persone in base a un'appartenenza, cosa vietata dall'art. 43 del D.Lgs. 286/1998. Il valore netto e l'affidabilità del canale misurano direttamente quello che interessa davvero.</p>
    <p class="muted"><small>Dopo aver cambiato i pesi salva le impostazioni e ricalcola il piano nel Problem solving: la sequenza cambia subito.</small></p>`;
  return sheetWrap("Chi si sposta per primo", "Come si leggono e si tarano i pesi", body);
}

/** Le tre schede azione della Guida strategica: con quale criterio la piattaforma decide. */
export function azioniInfoSheet(c: Ctx): string {
  const s = c.app.settings;
  const h = c.ui.hotel === "gruppo" ? null : s.hotels.find((x) => x.id === c.ui.hotel) ?? null;
  const cap = h ? h.roomTypes.reduce((a, t) => a + t.count, 0) : 0;
  const tetto = h ? `${h.maxOverbookPct}% delle ${cap} camere di ${esc(h.name)} (${Math.floor(cap * h.maxOverbookPct / 100)} camere)` : "il tetto percentuale impostato per ciascuna casa";
  const costo = h ? eur(h.walkCost) : "il costo impostato per ciascuna casa";

  const body = `
    <p>Le tre schede non sono un riassunto: sono la <b>ripartizione delle notti dei prossimi ${s.horizonDays} giorni</b> secondo l'azione che la piattaforma ha calcolato per ciascuna. Ogni notte finisce in una sola scheda, o in nessuna se non richiede niente. Il criterio è sempre il confronto fra due numeri: <b>In portafoglio</b> (le camere già prenotate) e <b>Vendibili totali</b> (la soglia calcolata).</p>

    <h4 class="lg-h">Da dove esce la soglia «Vendibili totali»</h4>
    <p>Per ogni prenotazione la piattaforma stima la probabilità che non arrivi, usando lo storico di <b>questa casa</b> per canale e per giorni mancanti all'arrivo, corretto per alta stagione e manifestazioni. La somma di quelle probabilità sono le cancellazioni attese. Poi confronta quanto rende una camera venduta in più (ADR netto della notte) con quanto costa un ospite da ricollocare fuori (${costo}) e si ferma al numero di camere che conviene di più. Su quel numero agiscono tre limiti, e vince il più basso:</p>
    <ul class="info-tips">
      <li>rischio di dover ricollocare almeno un ospite non oltre il <b>${s.riskMaxPct}%</b>;</li>
      <li>overbooking non oltre <b>${tetto}</b>, o il tetto specifico del periodo di alta stagione se ne hai impostato uno;</li>
      <li>nessun overbooking nuovo entro <b>${s.freezeDays} giorni</b> dall'arrivo: a quel punto le cancellazioni sono troppo poche per contarci, e la soglia torna alla capienza.</li>
    </ul>

    <h4 class="lg-h">Il criterio di ciascuna scheda</h4>
    <ul class="lg-list strat">
      <li><span class="tag rischio">Oltre soglia</span><div>
        <p><b>Ci finisce una notte quando</b> In portafoglio è <b>maggiore</b> di Vendibili totali. Non conta se sei sopra la capienza: puoi essere oltre soglia anche sotto capienza, se il blocco dei ${s.freezeDays} giorni ha riportato la soglia alla capienza o se il tetto di rischio si è abbassato.</p>
        <p><b>Cosa fa la piattaforma:</b> mostra di quante camere sei oltre e con quale probabilità qualcuno andrà davvero spostato, e accende il pulsante «Risolvi», che apre il Problem solving già posizionato su quella data e calcola il piano: prima i cambi di camera in casa, poi gli upgrade, poi la riprotezione nelle altre case, poi le cancellazioni con motivo valido documentato, e l'overbooking verso fuori soltanto per ultimo.</p>
        <p><b>Cosa devi fare tu:</b> chiudi subito le vendite di quella notte. Se l'arrivo è lontano e la barra delle cancellazioni attese è verde (le cancellazioni coprono l'eccesso), fai solo i cambi interni e ricontrolla al prossimo import. Se è rossa o l'arrivo è vicino, esegui il piano.</p>
      </div></li>
      <li><span class="tag vendi">Vendibili oltre capienza</span><div>
        <p><b>Ci finisce una notte quando</b> In portafoglio ha <b>raggiunto o superato la capienza</b> e il Margine (soglia meno portafoglio) è ancora <b>positivo</b>. Le due condizioni servono entrambe: una notte al 70% non compare qui, perché prima vanno vendute le camere reali, non quelle che non hai.</p>
        <p><b>Cosa fa la piattaforma:</b> indica il margine residuo (<b>+N</b>) e il tetto calcolato per quella notte. Non vende nulla da sola e non tocca il channel manager: il numero è la tua istruzione operativa. Man mano che arrivano nuove prenotazioni il margine scende; man mano che l'arrivo si avvicina la soglia stessa scende, e la notte passa da sola a «Soglia raggiunta».</p>
        <p><b>Cosa devi fare tu:</b> apri sul channel manager un overbooking pari a +N per quella notte e chiudi quando arriva a zero. Vendi prima sui canali che lo Storico dà come migliori, e a tariffa piena o non rimborsabile: stai vendendo camere che non hai ancora, quindi devono rendere il massimo. Ogni camera venduta qui è margine puro, perché copre il costo dell'unico overbooking che statisticamente ne deriva.</p>
      </div></li>
      <li><span class="tag stop">Soglia raggiunta</span><div>
        <p><b>Ci finisce una notte quando</b> In portafoglio ha raggiunto la capienza e il Margine è <b>zero o negativo ma il portafoglio non supera la soglia</b>: sei esattamente al massimo sicuro. Capita anche con la casa piena senza overbooking, quando il blocco dei ${s.freezeDays} giorni o il tetto di rischio non lasciano spazio.</p>
        <p><b>Cosa fa la piattaforma:</b> segnala la notte e, se il blocco è la ragione, lo scrive accanto all'azione. Nessun intervento sugli ospiti: non c'è niente da risolvere, c'è solo da non peggiorare.</p>
        <p><b>Cosa devi fare tu:</b> stop sell su tutti i canali, sito compreso. Non abbassare le tariffe per riempire: la notte è già al massimo. Riapri solo quando il margine torna positivo dopo un import con nuove cancellazioni.</p>
      </div></li>
    </ul>

    <h4 class="lg-h">Le notti che non compaiono in nessuna scheda</h4>
    <p>Sono quelle sotto capienza: <span class="tag pieno">Quasi pieno</span> sopra l'85% e <span class="tag libero">Vendita normale</span> sotto. Lì l'overbooking non è ancora un tema e la piattaforma non chiede niente: le trovi tutte nella tabella «Dettaglio per notte», filtrabile per azione.</p>

    <h4 class="lg-h">Perché una notte cambia scheda da un giorno all'altro</h4>
    <ul class="info-tips">
      <li><b>Nuove cancellazioni</b> nell'import: il portafoglio scende, la notte può passare da «Oltre soglia» a «Vendibili oltre capienza».</li>
      <li><b>Arrivo più vicino</b>: restano meno giorni in cui si può cancellare, la soglia scende, e una notte tranquilla può diventare «Soglia raggiunta» o «Oltre soglia» senza che sia arrivata nessuna prenotazione nuova.</li>
      <li><b>Periodo impostato</b>: dentro un'alta stagione o una manifestazione si cancella meno, quindi la soglia è più prudente da subito.</li>
      <li><b>Impostazioni cambiate</b>: se alzi o abbassi rischio massimo, tetto per casa o giorni di blocco, la ripartizione si rifà al volo.</li>
    </ul>
    <p class="muted"><small>La vista «Gruppo» somma le tre case, ma la soglia si calcola e si applica casa per casa: lo spazio libero dell'Acadia non autorizza overbooking al Saslong. Le decisioni di vendita si prendono sulla singola casa.</small></p>`;
  return sheetWrap("Le tre azioni della notte", "Con quale criterio la piattaforma assegna ogni notte", body);
}

/** Cancellazione per motivo valido: quando la piattaforma la propone. */
export function cancelInfoSheet(c: Ctx): string {
  const s = c.app.settings;
  const r = s.rules.cancellation;
  const oo = s.rules.outOfOrder.length;
  const ws = (t: string): string => (t.trim() ? t.split(",").map((x) => `<code>${esc(x.trim())}</code>`).filter((x) => x !== "<code></code>").join(" ") : "<em>nessuna parola impostata</em>");

  const body = `
    <p>La cancellazione è la <b>terza modalità</b> accanto all'upgrade e alla riprotezione, e la sola che libera una camera senza costi per noi. Per questo la piattaforma la propone <b>soltanto quando i dati la giustificano</b>: ogni riga della lista porta con sé la prova che la sostiene, presa dall'export di Slope o dichiarata dalla direzione. Nessun motivo viene inventato, e una prenotazione regolare e pagata non finisce mai in questa lista, nemmeno se è quella che rovina il piano camere.</p>

    <h4 class="lg-h">I tre motivi riconosciuti, in ordine di precedenza</h4>
    <ul class="lg-list strat">
      <li><span class="tag cancellazione">Camera inagibile</span><div>
        <p><b>Criterio:</b> la camera assegnata è dichiarata fuori servizio nelle notti del soggiorno, nella tabella «Camere fuori servizio» delle Impostazioni. Oggi ne risultano <b>${oo}</b>. Lo dichiara la direzione, non il calcolo: la piattaforma non deduce da sé che una camera è rotta.</p>
        <p><b>Come reagisce:</b> viene prima di tutto, anche su una prenotazione già pagata, perché la camera fisicamente non c'è. L'email offre <b>un'alternativa o il rimborso integrale</b>, senza preavviso da attendere: la decisione è dell'ospite. Non è una scusa da usare per liberare camere.</p>
      </div></li>
      <li><span class="tag cancellazione">Garanzia non valida</span><div>
        <p><b>Criterio:</b> lo stato del pagamento in Slope contiene una di queste parole: ${ws(r.noGuaranteeWords)}. Sono le diciture con cui Slope o il canale segnalano una carta rifiutata, scaduta o mai fornita.</p>
        <p><b>Come reagisce:</b> due email in sequenza. Prima il <b>sollecito</b>, che chiede una carta valida entro <b>${r.preavvisoGiorni} giorni</b> (o entro il giorno prima dell'arrivo, se è più vicino). Solo se la scadenza passa senza risposta si manda l'annullamento. La prenotazione non esce dal piano prima del sollecito.</p>
      </div></li>
      <li><span class="tag cancellazione">Caparra non pagata</span><div>
        <p><b>Criterio:</b> la scadenza della caparra è passata e il pagamento non risulta. La scadenza è quella letta da Slope, oppure, se manca, la data di prenotazione più <b>${r.depositDays} giorni</b>. Contano come non pagata le diciture ${ws(r.unpaidWords)}.</p>
        <p><b>Come reagisce:</b> stesse due email della garanzia, con lo stesso preavviso di ${r.preavvisoGiorni} giorni. La prova scritta nella pratica include la data di scadenza e quanti giorni sono passati.</p>
      </div></li>
    </ul>

    <h4 class="lg-h">Cosa esclude una prenotazione da questa lista</h4>
    <ul class="info-tips">
      <li><b>Risulta pagata</b>: se lo stato contiene ${ws(r.paidWords)} la prenotazione viene saltata, qualunque altra parola ci sia scritta.</li>
      <li><b>È già arrivata</b> o ha l'arrivo nel passato: sul presente non si interviene dal piano.</li>
      <li><b>È protetta</b> (gruppo, abituale, Expedia Collect, non rimborsabile, tag NO OVERBOOKING): compare in lista con la colonna «Protetta» segnata, ma <b>la piattaforma non la cancella</b>. Decide una persona, e l'email non viene preparata da sola.</li>
      <li><b>È solo scomoda</b>: valore basso, notte isolata, ospite con doppie prenotazioni. Nessuno di questi è un motivo di cancellazione: quelle prenotazioni escono dalla camera con gli altri strumenti, non dal contratto.</li>
    </ul>

    <h4 class="lg-h">Effetto sul piano</h4>
    <p>Una prenotazione con motivo valido riceve una penalità nel punteggio di permanenza (peso «Annullabile» ${s.weights.cancellabile}), quindi <b>libera la camera prima delle altre</b>. Non viene mai riprotetta in un'altra casa né mandata in overbooking: sarebbe assurdo pagare un ricollocamento per una prenotazione che non ha una garanzia valida. Le sue camere vengono contate come recuperate solo dopo la scadenza del preavviso; fino a quel momento restano nel piano come possibili.</p>

    <h4 class="lg-h">Cosa fai tu, in ordine</h4>
    <ol class="info-ol">
      <li>Leggi la colonna «La prova» e <b>verifica in Slope</b> che corrisponda: la piattaforma legge un export, non il gestionale in tempo reale.</li>
      <li>Manda l'<b>email 1</b> (sollecito) e annota la data di scadenza mostrata in «Rispondere entro».</li>
      <li>Se l'ospite paga o dà una carta valida, la riga sparisce al prossimo import: fine.</li>
      <li>Se la scadenza passa, manda l'<b>email 2</b> (annullamento), annulla in Slope e apri la pratica nel Registro con motivo «${GROUND_LABEL["carta-non-valida"]}» o «${GROUND_LABEL["mancato-pagamento"]}», così la statistica resta corretta.</li>
    </ol>
    <p class="muted"><small>Il campo «motivo» delle email va scritto con quello che risulta davvero dai dati o dalla direzione. Un guasto inventato o un rifiuto della carta non vero è una dichiarazione falsa verso il cliente: se contestata, la cancellazione è illegittima e la responsabilità è nostra.</small></p>`;
  return sheetWrap("Cancellazione per motivo valido", "Quando la piattaforma la propone e cosa succede dopo", body);
}
