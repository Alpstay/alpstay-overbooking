/**
 * Radar prezzi — prezzi delle case AlpStay contro i concorrenti su Booking, e barometro della
 * domanda.
 *
 * Il Radar nasce come artifact su claude.ai, ed è lì che resta il caricamento: lo staff carica
 * gli screenshot di Booking e Claude li legge. Questa pagina non può chiamare Claude né leggere
 * il database dell'artifact, quindi si fa come per La Scatola: ogni mattina l'attività
 * pianificata scarica le rilevazioni, scrive `radar.json` accanto alla pagina e pubblica.
 * Qui si legge soltanto.
 *
 * L'occupazione delle case non viene dal Radar: si calcola da `scatola.json`, che ha già
 * capienza, chiusure e camere vendute per notte. Così c'è un solo dato di occupazione.
 *
 * Gli ID delle rilevazioni sono quelli del database dell'artifact e non si modificano.
 *
 * La scheda è un elemento che resta vivo fra un disegno e l'altro della piattaforma: la
 * piattaforma ridisegna tutto a ogni azione, il Radar no, così non perde il periodo scelto né
 * la sotto-scheda aperta. I suoi eventi si fermano al suo contenitore e non arrivano ai
 * gestori della piattaforma.
 */
import type { HotelId } from "./types";
import type { ScatolaSnapshot } from "./scatola";
import { capienzaPerNotte } from "./scatola";

// ------------------------------------------------------------ dati

/** Una riga di prezzo letta da uno screenshot Booking. I campi sono quelli dell'artifact. */
export interface Rilevazione {
  id: string;
  casa: string;
  localita?: string;
  struttura: string;
  tipo: string;
  stelle?: string;
  voto?: number | null;
  camera?: string;
  checkIn: string;
  checkOut: string;
  notti: number;
  totale: number;
  confrontabile?: boolean;
  rilevatoIl: string;
  creatoIl?: string;
  fonte?: string;
  nota?: string;
  autore?: string | null;
}

/** Il «XX% di strutture non disponibili» di Booking per una località e un periodo. */
export interface DatoMercato {
  id: string;
  localita: string;
  casa?: string;
  checkIn: string;
  checkOut: string;
  rilevatoIl: string;
  nonDisponibiliPct: number;
  filtriStandard?: boolean;
  creatoIl?: string;
  nota?: string;
}

export interface RadarDati {
  generatedAt: string | null;
  rilevazioni: Rilevazione[];
  barometro: DatoMercato[];
  /** Documenti scartati perché incompleti: si dice quanti, non si nascondono. */
  scartati: number;
}

export interface EsitoRadar {
  dati: RadarDati | null;
  /** Perché non ci sono, in italiano, da mostrare così com'è. */
  errore: string | null;
}

const PERCORSO = "./radar.json";
const ARTIFACT_RADAR = "https://claude.ai/artifact/T5zW9i3ege9onzFs3VrNxB";
const JSPDF = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const AUTOTABLE = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";

const isStr = (v: unknown): v is string => typeof v === "string" && v !== "";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Controlla la forma del file. Un documento incompleto si salta e si conta; un file senza
 * l'elenco delle rilevazioni non si usa affatto.
 */
export function validaRadar(j: unknown): EsitoRadar {
  if (!j || typeof j !== "object") return { dati: null, errore: "radar.json non è un oggetto JSON." };
  const o = j as Record<string, unknown>;
  if (!Array.isArray(o.rilevazioni)) return { dati: null, errore: "radar.json non contiene l'elenco delle rilevazioni." };
  let scartati = 0;
  const ril: Rilevazione[] = [];
  for (const x of o.rilevazioni as Record<string, unknown>[]) {
    if (!x || typeof x !== "object" || !isStr(x.id) || !isStr(x.casa) || !isStr(x.struttura) || !isDay(x.checkIn) ||
        !isDay(x.checkOut) || !isNum(x.notti) || !isNum(x.totale) || !isDay(x.rilevatoIl)) { scartati++; continue; }
    ril.push(x as unknown as Rilevazione);
  }
  const bar: DatoMercato[] = [];
  for (const x of (Array.isArray(o.barometro) ? o.barometro : []) as Record<string, unknown>[]) {
    if (!x || typeof x !== "object" || !isStr(x.id) || !isStr(x.localita) || !isDay(x.checkIn) || !isDay(x.checkOut) ||
        !isDay(x.rilevatoIl) || !isNum(x.nonDisponibiliPct)) { scartati++; continue; }
    bar.push(x as unknown as DatoMercato);
  }
  return { dati: { generatedAt: isStr(o.generatedAt) ? o.generatedAt : null, rilevazioni: ril, barometro: bar, scartati }, errore: null };
}

/** Legge `radar.json` accanto alla pagina. Se manca, la scheda lo dice e il resto lavora. */
export async function caricaRadar(percorso = PERCORSO): Promise<EsitoRadar> {
  let r: Response;
  try {
    r = await fetch(`${percorso}?t=${Date.now()}`, { cache: "no-store" });
  } catch {
    return { dati: null, errore: "Non sono riuscito a leggere radar.json: la rete non risponde." };
  }
  if (r.status === 404) return { dati: null, errore: "radar.json non è ancora stato pubblicato: le rilevazioni arrivano con l'aggiornamento di domattina." };
  if (!r.ok) return { dati: null, errore: `radar.json non è leggibile (errore ${r.status}).` };
  try {
    return validaRadar(await r.json());
  } catch {
    return { dati: null, errore: "radar.json non è un JSON valido: non lo uso." };
  }
}

// ------------------------------------------------------------ occupazione da La Scatola

/** Le tre case del Radar, con la casa corrispondente nello scatto. */
const CASE: Record<string, { loc: string; hotelId: HotelId }> = {
  Saslong: { loc: "S. Cristina", hotelId: "saslong" },
  Hartmann: { loc: "Ortisei", hotelId: "hartmann" },
  Acadia: { loc: "Selva", hotelId: "acadia" },
};
const ORDINE = ["Saslong", "Hartmann", "Acadia"];

export interface OccPeriodo {
  /** Notti camera vendute (confermate) nel periodo, secondo la capienza di La Scatola. */
  vendute: number;
  /** Notti camera vendibili: camere fisiche meno chiusure. */
  disponibili: number;
  opzioni: number;
  occPct: number | null;
  adr: number | null;
  /** Notti del periodo coperte dallo scatto, su quelle richieste. */
  coperte: number;
  notti: number;
  /** Punti di occupazione guadagnati negli ultimi 7 giorni prima dello scatto. */
  delta7: number | null;
  /** Occupazione a 28, 21, 14, 7 e 0 giorni dallo scatto, dalle date di prenotazione. */
  storia: number[];
}

const DAY = 864e5;
const t0 = (d: string): number => Date.parse(d + "T00:00:00Z");
const piuGiorni = (d: string, n: number): string => new Date(t0(d) + n * DAY).toISOString().slice(0, 10);
const nottiFra = (a: string, b: string): number => Math.max(0, Math.round((t0(b) - t0(a)) / DAY));

/**
 * Occupazione di una casa in un periodo, calcolata dallo scatto.
 *
 * Il venduto viene dalla capienza per notte di La Scatola. Una notte senza righe vuol dire
 * casa del tutto libera, non casa inesistente: le camere fisiche vengono dalla tabella delle
 * tipologie, come nel resto della piattaforma. L'ADR e l'andamento vengono dalle prenotazioni.
 */
export function occupazione(s: ScatolaSnapshot, perNotte: ReturnType<typeof capienzaPerNotte>, hotelId: HotelId, ci: string, co: string): OccPeriodo | null {
  const casa = s.case.find((c) => c.hotelId === hotelId);
  if (!casa) return null;
  const fisiche = casa.tipologie.reduce((n, t) => n + t.camere, 0);
  const notti = nottiFra(ci, co);
  const giorni: string[] = [];
  for (let i = 0; i < notti; i++) {
    const g = piuGiorni(ci, i);
    if (g >= s.finestra.da && g <= s.finestra.a) giorni.push(g);
  }
  if (!giorni.length) return null;
  const mappa = perNotte.get(hotelId);
  let vendute = 0, disponibili = 0, opzioni = 0;
  for (const g of giorni) {
    const v = mappa?.get(g) ?? { camere: fisiche, chiusure: 0, confermate: 0, opzioni: 0 };
    vendute += v.confermate;
    opzioni += v.opzioni;
    disponibili += Math.max(0, v.camere - v.chiusure);
  }
  const primo = giorni[0], fine = piuGiorni(giorni[giorni.length - 1], 1);

  // ADR e andamento: dalle prenotazioni dello scatto, una riga per camera.
  let ricavo = 0, nottiRicavo = 0;
  const generato = s.generato.slice(0, 10);
  const passi = [28, 21, 14, 7, 0].map((n) => piuGiorni(generato, -n) + "T23:59:59Z");
  const serie = passi.map(() => 0);
  for (const p of s.prenotazioni) {
    if (p.hotelId !== hotelId || p.stato === "opzione") continue;
    const da = p.arrival > primo ? p.arrival : primo, a = p.departure < fine ? p.departure : fine;
    const n = nottiFra(da, a);
    if (n <= 0) continue;
    if (p.stato === "confermata" && p.total != null && p.total > 0) {
      const tot = nottiFra(p.arrival, p.departure);
      if (tot > 0) { ricavo += (p.total / tot) * n; nottiRicavo += n; }
    }
    // Attiva a quella data: già prenotata, e non ancora cancellata.
    passi.forEach((d, i) => {
      if (p.createdAt && p.createdAt > d) return;
      if (p.stato !== "confermata" && !(p.cancelledAt && p.cancelledAt > d)) return;
      serie[i] += n;
    });
  }
  const storia = disponibili > 0 ? serie.map((v) => (v / disponibili) * 100) : [];
  return {
    vendute, disponibili, opzioni,
    occPct: disponibili > 0 ? (vendute / disponibili) * 100 : null,
    adr: nottiRicavo > 0 ? ricavo / nottiRicavo : null,
    coperte: giorni.length, notti,
    delta7: storia.length ? storia[4] - storia[3] : null,
    storia,
  };
}

// ------------------------------------------------------------ scheda

let istanza: { el: HTMLElement; start: (s: ScatolaSnapshot | null) => void } | null = null;

/** Il posto della scheda nella pagina: dopo il disegno ci va l'elemento vero. */
export function viewRadar(): string {
  return `<section class="page" id="radar-slot"></section>`;
}

/** Da chiamare dopo ogni disegno, quando la scheda aperta è il Radar. */
export function radarMount(scatola: ScatolaSnapshot | null): void {
  const slot = document.getElementById("radar-slot");
  if (!slot) return;
  if (!istanza) istanza = creaRadar();
  slot.replaceWith(istanza.el);
  istanza.start(scatola);
}

const RADAR_HTML = `
  <div class="rp-head">
    <div class="seg" role="tablist" aria-label="Sezioni del Radar prezzi">
      <button role="tab" data-rtab="confronto" aria-pressed="true" aria-selected="true">Confronto</button>
      <button role="tab" data-rtab="barometro" aria-pressed="false" aria-selected="false">Barometro</button>
      <button role="tab" data-rtab="variazioni" aria-pressed="false" aria-selected="false">Variazioni</button>
      <button role="tab" data-rtab="nuova" aria-pressed="false" aria-selected="false">Nuova rilevazione</button>
      <button role="tab" data-rtab="storico" aria-pressed="false" aria-selected="false">Storico</button>
      <button role="tab" data-rtab="guida" aria-pressed="false" aria-selected="false">Come funziona</button>
    </div>
    <span class="rp-status" id="rp-status">Carico le rilevazioni…</span>
  </div>
  <div id="rp-errore"></div>

  <section class="rp-tab" id="rp-tab-confronto">
    <h2 class="lead">Prezzi delle case AlpStay contro i concorrenti su Booking.</h2>
    <div class="rp-toolbar">
      <label class="rp-f">Periodo di soggiorno
        <select id="rp-periodo"></select>
      </label>
      <button class="btn gold" id="rp-btn-pdf">Crea PDF per email</button>
      <p class="rp-note">Per ogni struttura conta l'ultima rilevazione del periodo. Solo camere confrontabili (doppie e matrimoniali d'hotel).</p>
    </div>
    <div id="rp-pdf-box" class="rp-panel" hidden>
      <div id="rp-pdf-msg"></div>
      <label class="rp-f" for="rp-mail-text">Testo pronto per la mail (allega il PDF salvato)</label>
      <textarea id="rp-mail-text" class="rp-mail" rows="9"></textarea>
      <div class="rp-actions"><button class="btn ghost sm" id="rp-btn-copy">Copia testo</button><button class="btn ghost sm" id="rp-btn-pdf-close">Chiudi</button></div>
    </div>
    <div id="rp-houses" class="rp-houses"></div>
    <div class="rp-legend">
      <span><span class="rp-pill sotto">sotto mercato</span> oltre il 10% sotto la media</span>
      <span><span class="rp-pill linea">in linea</span> entro ±10%</span>
      <span><span class="rp-pill sopra">sopra mercato</span> oltre il 10% sopra</span>
    </div>
  </section>

  <section class="rp-tab" id="rp-tab-barometro" hidden>
    <h2 class="lead">Quanto è piena la località e quanto hanno venduto le nostre case.</h2>
    <div class="rp-toolbar">
      <label class="rp-f">Periodo di soggiorno
        <select id="rp-b-periodo"></select>
      </label>
      <p class="rp-note">Mercato: quota di strutture non disponibili su Booking nella località. Casa: camere già vendute nel periodo secondo lo scatto di La Scatola, lo stesso che usa il resto della piattaforma.</p>
    </div>
    <div id="rp-baro" class="rp-baro-grid"></div>
    <h3 class="sec">Periodi critici da monitorare</h3>
    <p class="rp-note">Settimane da sabato a sabato in cui una casa aperta ha meno del 70% di camere vendute (le settimane senza nessuna camera venduta non compaiono: di solito la casa è ancora chiusa). Premi «Apri» per vederla nel barometro, poi fai la ricerca Booking con quelle date.</p>
    <div class="rp-tbl"><table>
      <thead><tr><th>Periodo</th><th>Casa</th><th class="right">Venduto oggi</th><th class="right">Ultimi 7 giorni</th><th class="right">ADR</th><th>Ricerca Booking</th><th></th></tr></thead>
      <tbody id="rp-crit"></tbody>
    </table></div>
    <h3 class="sec">Come leggiamo la domanda</h3>
    <div class="rp-method">
      <ol>
        <li><b>Booking, "XX% di strutture non disponibili".</b> Il segnale più diretto sul mercato: più è alto, più la località è piena. Vale solo per Booking e cambia con i filtri, quindi va rilevato sempre con la stessa ricerca (Hotel e B&amp;B, senza "Animali ammessi"). Il Radar su claude.ai lo legge dagli screenshot.</li>
        <li><b>La Scatola (dati Slope).</b> Camere già vendute per ogni notte e tariffa media (ADR) delle case AlpStay, dallo scatto che la piattaforma riceve ogni mattina. L'andamento delle ultime settimane si ricostruisce dalle date di prenotazione e di cancellazione. Lo scatto copre solo le date future: il confronto con l'anno scorso non c'è.</li>
        <li><b>Portale val-gardena.com.</b> Pubblica per Ortisei prezzi medi e disponibilità settimanali di B&amp;B e pensioni (rilevato il 01.11.2026: disponibilità circa 31 a gennaio e 47 a metà marzo; prezzo medio per persona 84–112 € a gennaio, 74–94 € a marzo). Il metodo non è spiegato: lo usiamo solo come conferma dell'andamento.</li>
        <li><b>ASTAT, statistiche provinciali.</b> Occupazione dei mesi passati per comune: utile per la stagionalità, non per le date future.</li>
        <li><b>Strumenti a pagamento</b> (Lighthouse Market Insight e simili): l'unica fonte che stima la domanda futura di tutta la destinazione.</li>
      </ol>
      <p class="rp-note" style="margin-top:12px">Livelli del mercato: <span class="rp-lvl calmo">calmo</span> sotto il 50% di strutture non disponibili, <span class="rp-lvl vivace">vivace</span> dal 50 al 79%, <span class="rp-lvl pieno">quasi pieno</span> dall'80%.</p>
    </div>
  </section>

  <section class="rp-tab" id="rp-tab-variazioni" hidden>
    <h2 class="lead">Cosa è cambiato dall'ultima rilevazione.</h2>
    <div id="rp-changes"></div>
  </section>

  <section class="rp-tab" id="rp-tab-nuova" hidden>
    <article class="card rp-new">
      <h3>Nuova rilevazione</h3>
      <p>Gli screenshot di Booking si caricano nel <b>Radar prezzi su claude.ai</b>: lì Claude li legge, tu controlli le righe e le salvi. Qui la pagina non può leggere immagini.</p>
      <p>Le rilevazioni salvate compaiono in questa scheda <b>la mattina dopo</b>, con l'aggiornamento giornaliero insieme allo scatto di La Scatola.</p>
      <div class="rp-actions"><a class="btn gold" href="${ARTIFACT_RADAR}" target="_blank" rel="noopener">Apri il Radar su claude.ai</a></div>
    </article>
  </section>

  <section class="rp-tab" id="rp-tab-guida" hidden>
    <h2 class="lead">Come funziona il Radar prezzi.</h2>
    <p class="rp-note">Il Radar raccoglie i prezzi che vedi su Booking.com, li confronta con quelli delle case AlpStay e tiene lo storico. Ripetendo la stessa ricerca nel tempo, mostra chi alza o abbassa i prezzi.</p>
    <div class="rp-guide-grid">
      <article class="rp-step"><span class="rp-step-n">1</span><div>
        <h3>Fai la ricerca su Booking</h3>
        <ul>
          <li>Località della casa: <b>S. Cristina</b> per Saslong, <b>Ortisei</b> per Hartmann, <b>Selva</b> per Acadia.</li>
          <li>Date del periodo da valutare, <b>2 adulti, 1 camera</b>.</li>
          <li>Filtri: <b>Hotel</b> e <b>Bed &amp; Breakfast</b>. Togli <b>"Animali ammessi"</b>, altrimenti spariscono molti hotel.</li>
          <li>Scatta gli screenshot della lista dei risultati, anche più di uno.</li>
        </ul>
      </div></article>
      <article class="rp-step"><span class="rp-step-n">2</span><div>
        <h3>Carica gli screenshot su claude.ai</h3>
        <ul>
          <li>Apri il <a class="linkbtn" href="${ARTIFACT_RADAR}" target="_blank" rel="noopener">Radar prezzi su claude.ai</a>, scheda <b>Nuova rilevazione</b>.</li>
          <li>Scegli la <b>casa</b> e inserisci <b>check-in e check-out</b> uguali a quelli cercati su Booking.</li>
          <li>Trascina gli screenshot e premi <b>Leggi gli screenshot</b>.</li>
        </ul>
      </div></article>
      <article class="rp-step"><span class="rp-step-n">3</span><div>
        <h3>Controlla e salva</h3>
        <ul>
          <li><b>Salva</b>: togli la spunta alle righe da scartare.</li>
          <li><b>Confr.</b> (confrontabile): lasciala solo per camere doppie o matrimoniali d'hotel. Toglila ad appartamenti, monolocali, suite, camere singole, triple, quadruple o familiari.</li>
          <li><b>AlpStay</b>: spuntata sulle nostre case.</li>
          <li>Salvata la rilevazione, qui compare la mattina dopo.</li>
        </ul>
      </div></article>
      <article class="rp-step"><span class="rp-step-n">4</span><div>
        <h3>Leggi il confronto</h3>
        <ul>
          <li>In <b>Confronto</b> scegli il periodo dal menu.</li>
          <li>Per ogni casa vedi il prezzo per notte, la media dei concorrenti e la posizione:</li>
          <li><span class="rp-pill sotto">sotto mercato</span> oltre il 10% sotto la media, <span class="rp-pill linea">in linea</span> entro ±10%, <span class="rp-pill sopra">sopra mercato</span> oltre il 10% sopra.</li>
          <li>Le righe evidenziate sono le case AlpStay.</li>
        </ul>
      </div></article>
      <article class="rp-step"><span class="rp-step-n">5</span><div>
        <h3>Segui le variazioni</h3>
        <ul>
          <li>Ripeti <b>la stessa ricerca con le stesse date</b>, per esempio ogni lunedì.</li>
          <li>In <b>Variazioni</b> compare chi ha alzato <span class="rp-chg up">▲</span> o abbassato <span class="rp-chg down">▼</span> il prezzo rispetto alla volta prima.</li>
          <li>Le variazioni compaiono dalla seconda rilevazione dello stesso periodo.</li>
        </ul>
      </div></article>
      <article class="rp-step"><span class="rp-step-n">6</span><div>
        <h3>Condividi il risultato</h3>
        <ul>
          <li>In <b>Confronto</b> premi <b>Crea PDF per email</b>: il PDF si salva sul computer.</li>
          <li>Sotto compare un testo email già scritto: premi <b>Copia testo</b>, incollalo nella mail e allega il PDF.</li>
          <li>In <b>Storico</b> puoi esportare tutto in CSV per Excel.</li>
        </ul>
      </div></article>
    </div>
    <div class="rp-tips">
      <h3>Consigli per dati affidabili</h3>
      <ul>
        <li><b>La casa non compare su Booking?</b> Probabilmente è piena per quelle date. Nel Radar su claude.ai inserisci il suo prezzo dal booking engine con <b>Aggiungi riga a mano</b> e spunta AlpStay.</li>
        <li><b>Stesso account:</b> cerca sempre con lo stesso account Booking, o sempre senza accesso. Gli sconti Genius e "Bonus VIP" cambiano i prezzi mostrati.</li>
        <li><b>Messaggio "XX% di strutture non disponibili":</b> includilo sempre negli screenshot. Il Radar lo legge e lo porta nel <b>Barometro</b>, dove si confronta con le camere già vendute delle nostre case secondo La Scatola.</li>
        <li><b>Errori:</b> questa pagina è in sola lettura. Una riga sbagliata si elimina dallo Storico del Radar su claude.ai e sparisce da qui con l'aggiornamento successivo.</li>
      </ul>
    </div>
  </section>

  <section class="rp-tab" id="rp-tab-storico" hidden>
    <h2 class="lead">Tutte le rilevazioni salvate.</h2>
    <div class="rp-toolbar">
      <label class="rp-f">Casa
        <select id="rp-s-casa"><option value="">Tutte</option><option>Saslong</option><option>Hartmann</option><option>Acadia</option></select>
      </label>
      <button class="btn ghost" id="rp-btn-csv">Esporta CSV</button>
      <span id="rp-csv-msg" class="rp-note"></span>
    </div>
    <div class="rp-tbl"><table>
      <thead><tr><th>Rilevato</th><th>Casa</th><th>Struttura</th><th>Camera</th><th>Periodo</th><th class="right">Totale</th><th class="right">€/notte</th><th>Confr.</th></tr></thead>
      <tbody id="rp-storico"></tbody>
    </table></div>
  </section>`;

// Tipi minimi di jsPDF e del suo plugin, quelli che la scheda usa davvero.
interface AutoTableHook { section: string; column: { index: number }; row: { index: number }; cell: { raw: unknown; styles: Record<string, unknown> } }
interface JsPdfDoc {
  internal: { pageSize: { getWidth(): number } };
  lastAutoTable: { finalY: number };
  setFont(f: string, s: string): void;
  setFontSize(n: number): void;
  setTextColor(...c: number[]): void;
  setDrawColor(...c: number[]): void;
  setLineWidth(n: number): void;
  line(a: number, b: number, c: number, d: number): void;
  text(t: string | string[], x: number, y: number, o?: Record<string, unknown>): void;
  splitTextToSize(t: string, w: number): string[];
  addPage(): void;
  getNumberOfPages(): number;
  setPage(n: number): void;
  output(t: "blob"): Blob;
  autoTable(o: { startY: number; head: string[][]; body: (string | number)[][]; styles?: Record<string, unknown>; headStyles?: Record<string, unknown>;
    columnStyles?: Record<number, Record<string, unknown>>; didParseCell?: (h: AutoTableHook) => void }): void;
}
interface JsPdfWin { jspdf?: { jsPDF: new (o: Record<string, unknown>) => JsPdfDoc } }

function caricaScript(src: string): Promise<void> {
  return new Promise((ok, ko) => {
    if (document.querySelector(`script[src="${src}"]`)) { ok(); return; }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => ok();
    s.onerror = () => { s.remove(); ko(new Error(src)); };
    document.head.appendChild(s);
  });
}

/** Il PDF si genera di rado: jsPDF si carica da cdnjs, come SheetJS, solo alla prima richiesta. */
async function jsPDF(): Promise<JsPdfWin["jspdf"] | null> {
  const w = window as unknown as JsPdfWin;
  try {
    if (!w.jspdf?.jsPDF) await caricaScript(JSPDF);
    await caricaScript(AUTOTABLE);
  } catch { return null; }
  return w.jspdf?.jsPDF ? w.jspdf : null;
}

function scarica(nome: string, dati: Blob): void {
  const url = URL.createObjectURL(dati);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

interface Mercato { ult: DatoMercato | null; prev: DatoMercato | null }
interface DatiCasa { casa: string; loc: string; own: Rilevazione[]; comps: Rilevazione[]; ownP: number | null; avg: number | null; d: number | null }

function creaRadar(): { el: HTMLElement; start: (s: ScatolaSnapshot | null) => void } {
  const R = document.createElement("section");
  R.id = "radar-root";
  R.className = "page";
  R.innerHTML = RADAR_HTML;
  // Gli eventi del Radar restano dentro il Radar: i gestori della piattaforma su #app non li vedono.
  for (const t of ["click", "change", "input", "dragover", "drop", "mousemove", "touchstart"]) {
    R.addEventListener(t, (e) => e.stopPropagation(), t === "touchstart" ? { passive: true } : undefined);
  }

  let rows: Rilevazione[] = [];
  let baro: DatoMercato[] = [];
  let scatola: ScatolaSnapshot | null = null;
  let perNotte: ReturnType<typeof capienzaPerNotte> = new Map();
  let caricato = false, avviato = false;
  const extraPeriodi = new Set<string>();

  const $ = <T extends HTMLElement = HTMLElement>(s: string): T => R.querySelector(s) as T;
  const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  const eur = (n: number | null | undefined): string => n == null || isNaN(n) ? "–" : Math.round(n).toLocaleString("it-IT") + " €";
  const sgn = (n: number): string => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(Math.round(n)).toLocaleString("it-IT") + " €";
  const pct = (n: number): string => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n * 100).toFixed(0) + "%";
  const punti = (n: number): string => Math.round(Math.abs(n)) === 0 ? "invariato" : `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(0)} punti`;
  const dIt = (s: string | null | undefined): string => s ? s.split("-").reverse().join(".") : "";
  const norm = (s: unknown): string => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const perNotteR = (r: { totale: number; notti: number }): number | null => r.notti > 0 ? r.totale / r.notti : null;
  const periodKey = (r: { checkIn: string; checkOut: string }): string => r.checkIn + "_" + r.checkOut;
  const today = (): string => new Date().toISOString().slice(0, 10);
  const livello = (p: number | null): [string, string] | null => p == null ? null : p >= 80 ? ["pieno", "quasi pieno"] : p >= 50 ? ["vivace", "vivace"] : ["calmo", "calmo"];
  const etichetta = (d: number | null): string => d == null ? "dati insufficienti" : d < -0.1 ? "sotto mercato" : d > 0.1 ? "sopra mercato" : "in linea";
  const occDi = (casa: string, pk: string): OccPeriodo | null => {
    const c = CASE[casa];
    if (!scatola || !c) return null;
    const [ci, co] = pk.split("_");
    return occupazione(scatola, perNotte, c.hotelId, ci, co);
  };

  /* ---------- Sotto-schede ---------- */
  const TABS_R = ["confronto", "barometro", "variazioni", "nuova", "storico", "guida"];
  R.querySelectorAll<HTMLElement>("[data-rtab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.rtab ?? "")));
  function showTab(t: string): void {
    if (!TABS_R.includes(t)) t = "confronto";
    R.querySelectorAll<HTMLElement>("[data-rtab]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.rtab === t));
      b.setAttribute("aria-selected", String(b.dataset.rtab === t));
    });
    TABS_R.forEach((x) => { $("#rp-tab-" + x).hidden = x !== t; });
    try { localStorage.setItem("radar-tab", t); } catch { /* archivio non disponibile */ }
  }
  try { const t = localStorage.getItem("radar-tab"); if (t) showTab(t); } catch { /* niente */ }

  /* ---------- Confronto ---------- */
  function latestPerStruttura(list: Rilevazione[]): Rilevazione[] {
    const m = new Map<string, Rilevazione>();
    for (const r of list) {
      const k = norm(r.struttura);
      const cur = m.get(k);
      if (!cur || r.rilevatoIl > cur.rilevatoIl || (r.rilevatoIl === cur.rilevatoIl && (r.creatoIl || "") > (cur.creatoIl || ""))) m.set(k, r);
    }
    return [...m.values()];
  }
  function previousChange(r: Rilevazione): { delta: number; pct: number; da: string } | null {
    const hist = rows.filter((x) => norm(x.struttura) === norm(r.struttura) && periodKey(x) === periodKey(r) && x.rilevatoIl < r.rilevatoIl)
      .sort((a, b) => a.rilevatoIl < b.rilevatoIl ? 1 : -1);
    if (!hist.length) return null;
    const a = perNotteR(hist[0]), b = perNotteR(r);
    if (a == null || b == null) return null;
    return { delta: b - a, pct: (b - a) / a, da: hist[0].rilevatoIl };
  }
  function chgHtml(c: { delta: number; da: string } | null): string {
    if (!c || Math.abs(c.delta) < 1) return c ? '<span class="rp-chg muted">= invariato</span>' : "";
    return `<span class="rp-chg ${c.delta > 0 ? "up" : "down"}">${c.delta > 0 ? "▲" : "▼"} ${sgn(c.delta)} dal ${dIt(c.da)}</span>`;
  }
  function opzioniPeriodi(keys: string[]): string {
    return keys.map((k) => { const [a, b] = k.split("_"); return `<option value="${k}">${dIt(a)} → ${dIt(b)} · ${nottiFra(a, b)} notti</option>`; }).join("");
  }
  function renderPeriodi(): void {
    const base = [...new Set([...rows, ...baro].map(periodKey))].sort();
    const sel = $<HTMLSelectElement>("#rp-periodo"), prev = sel.value;
    sel.innerHTML = opzioniPeriodi(base);
    if (base.includes(prev)) sel.value = prev;
    const bk = [...new Set([...base, ...extraPeriodi])].sort();
    const bsel = $<HTMLSelectElement>("#rp-b-periodo"), bprev = bsel.value;
    bsel.innerHTML = opzioniPeriodi(bk);
    if (bk.includes(bprev)) bsel.value = bprev;
  }
  function vuoto(titolo: string, testo: string): string {
    return `<div class="rp-empty"><strong>${esc(titolo)}</strong>${esc(testo)}</div>`;
  }
  function datiCase(pk: string): DatiCasa[] {
    const inP = rows.filter((r) => periodKey(r) === pk && r.confrontabile);
    const casi = [...new Set([...ORDINE, ...inP.map((r) => r.casa)])].filter((c) => inP.some((r) => r.casa === c));
    return casi.map((casa) => {
      const list = latestPerStruttura(inP.filter((r) => r.casa === casa));
      const own = list.filter((r) => r.tipo === "AlpStay");
      const comps = list.filter((r) => r.tipo !== "AlpStay").sort((a, b) => (perNotteR(a) ?? 0) - (perNotteR(b) ?? 0));
      const ownP = own.length ? own.reduce((s, r) => s + (perNotteR(r) ?? 0), 0) / own.length : null;
      const avg = comps.length ? comps.reduce((s, r) => s + (perNotteR(r) ?? 0), 0) / comps.length : null;
      return { casa, loc: CASE[casa]?.loc || list[0]?.localita || "", own, comps, ownP, avg, d: ownP != null && avg ? (ownP - avg) / avg : null };
    });
  }
  function renderConfronto(): void {
    const el = $("#rp-houses");
    if (!rows.length) {
      el.innerHTML = caricato
        ? vuoto("Nessuna rilevazione da mostrare", "Le rilevazioni si caricano nel Radar su claude.ai e compaiono qui la mattina dopo.")
        : vuoto("Carico le rilevazioni…", "Qui compare il confronto di Saslong, Hartmann e Acadia con i concorrenti.");
      return;
    }
    const pk = $<HTMLSelectElement>("#rp-periodo").value;
    const dati = datiCase(pk);
    if (!dati.length) { el.innerHTML = vuoto("Nessuna camera confrontabile in questo periodo", "Controlla lo storico."); return; }
    el.innerHTML = dati.map((x) => {
      let pill = '<span class="rp-pill na">dati insufficienti</span>';
      if (x.d != null && x.ownP != null && x.avg != null) {
        const cls = x.d < -0.1 ? "sotto" : x.d > 0.1 ? "sopra" : "linea";
        pill = `<span class="rp-pill ${cls}">${pct(x.d)} vs media · ${sgn(x.ownP - x.avg)}/notte</span>`;
      }
      const all = [...x.own, ...x.comps];
      return `<article class="rp-house">
      <div class="rp-house-head">
        <div><div class="rp-house-name">${esc(x.casa)}</div><div class="rp-house-loc">${esc(x.loc)}</div></div>
        <div class="rp-kpis">
          <div class="rp-kpi"><b>${eur(x.ownP)}</b><span>Casa / notte</span></div>
          <div class="rp-kpi"><b>${eur(x.avg)}</b><span>Media compset (${x.comps.length})</span></div>
          ${pill}
        </div>
      </div>
      ${x.own.length ? "" : `<div class="rp-ref-form"><div class="rp-ref-title"><b>Manca il prezzo di ${esc(x.casa)} per questo periodo.</b> Inseriscilo nel <a class="linkbtn" href="${ARTIFACT_RADAR}" target="_blank" rel="noopener">Radar su claude.ai</a> (booking engine o listino) per completare il confronto.</div></div>`}
      <div class="rp-tbl"><table>
        <thead><tr><th>Struttura</th><th>Stelle</th><th class="right">Voto</th><th>Camera</th><th class="right">€/notte</th><th class="right">Casa vs struttura</th><th>Rilevato</th></tr></thead>
        <tbody>${all.map((r) => {
          const p = perNotteR(r); const isOwn = r.tipo === "AlpStay";
          return `<tr class="${isOwn ? "own" : ""}"><td>${esc(r.struttura)}${r.fonte === "manuale" ? ' <span class="rp-ref-badge">prezzo di riferimento</span>' : ""}</td><td>${esc(r.stelle)}</td><td class="right">${r.voto ?? "–"}</td><td>${esc(r.camera)}</td>
            <td class="right">${eur(p)}<br>${chgHtml(previousChange(r))}</td>
            <td class="right">${isOwn || x.ownP == null || p == null ? "–" : sgn(x.ownP - p)}</td><td class="muted">${dIt(r.rilevatoIl)}</td></tr>`;
        }).join("")}
        </tbody></table></div>
    </article>`;
    }).join("");
  }

  /* ---------- Variazioni ---------- */
  function renderVariazioni(): void {
    const groups = new Map<string, Rilevazione[]>();
    for (const r of rows) { const k = norm(r.struttura) + "|" + periodKey(r); const g = groups.get(k); if (g) g.push(r); else groups.set(k, [r]); }
    const out: { r: Rilevazione; a: number; b: number; d: number; p: number; da: string }[] = [];
    for (const list of groups.values()) {
      const dates = [...new Set(list.map((r) => r.rilevatoIl))].sort();
      if (dates.length < 2) continue;
      const last = latestPerStruttura(list.filter((r) => r.rilevatoIl === dates[dates.length - 1]))[0];
      const prev = latestPerStruttura(list.filter((r) => r.rilevatoIl === dates[dates.length - 2]))[0];
      const a = perNotteR(prev), b = perNotteR(last);
      if (a == null || b == null) continue;
      out.push({ r: last, a, b, d: b - a, p: (b - a) / a, da: prev.rilevatoIl });
    }
    const el = $("#rp-changes");
    if (!out.length) {
      el.innerHTML = vuoto("Ancora nessuna variazione da mostrare", "Le variazioni compaiono quando una struttura viene rilevata almeno due volte per lo stesso periodo di soggiorno.");
      return;
    }
    out.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
    el.innerHTML = `<div class="rp-tbl"><table><thead><tr><th>Struttura</th><th>Casa</th><th>Periodo</th><th class="right">Prima</th><th class="right">Ora</th><th class="right">Variazione</th><th>Rilevazioni</th></tr></thead><tbody>${out.map((x) => `<tr class="${x.r.tipo === "AlpStay" ? "own" : ""}"><td>${esc(x.r.struttura)}</td><td>${esc(x.r.casa)}</td><td class="muted">${dIt(x.r.checkIn)} → ${dIt(x.r.checkOut)}</td>
      <td class="right">${eur(x.a)}</td><td class="right">${eur(x.b)}</td>
      <td class="right"><span class="rp-chg ${Math.abs(x.d) < 1 ? "muted" : x.d > 0 ? "up" : "down"}">${Math.abs(x.d) < 1 ? "= invariato" : (x.d > 0 ? "▲ " : "▼ ") + sgn(x.d) + " (" + pct(x.p) + ")"}</span></td>
      <td class="muted">${dIt(x.da)} → ${dIt(x.r.rilevatoIl)}</td></tr>`).join("")}</tbody></table></div>
    <p class="rp-note" style="margin-top:10px">Prezzi per notte. ▲ la struttura ha alzato il prezzo, ▼ l'ha abbassato.</p>`;
  }

  /* ---------- Storico ---------- */
  function renderStorico(): void {
    const f = $<HTMLSelectElement>("#rp-s-casa").value;
    const list = rows.filter((r) => !f || r.casa === f).sort((a, b) => (b.rilevatoIl + (b.creatoIl || "")).localeCompare(a.rilevatoIl + (a.creatoIl || "")));
    $("#rp-storico").innerHTML = list.length ? list.map((r) => `<tr class="${r.tipo === "AlpStay" ? "own" : ""}">
    <td>${dIt(r.rilevatoIl)}</td><td>${esc(r.casa)}</td><td>${esc(r.struttura)}</td><td>${esc(r.camera)}</td>
    <td class="muted">${dIt(r.checkIn)} → ${dIt(r.checkOut)}</td><td class="right">${eur(r.totale)}</td><td class="right">${eur(perNotteR(r))}</td>
    <td>${r.confrontabile ? "sì" : '<span class="muted">no</span>'}</td></tr>`).join("") : `<tr><td colspan="8" class="muted">Nessuna rilevazione.</td></tr>`;
  }
  $("#rp-s-casa").addEventListener("change", renderStorico);
  $("#rp-btn-csv").addEventListener("click", () => {
    const msg = $("#rp-csv-msg");
    if (!rows.length) { msg.textContent = "Non ci sono rilevazioni da esportare."; return; }
    const head = ["id", "rilevatoIl", "casa", "localita", "struttura", "tipo", "stelle", "voto", "camera", "checkIn", "checkOut", "notti", "totale", "perNotte", "confrontabile"] as const;
    const q = (v: unknown): string => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const cella = (r: Rilevazione, h: (typeof head)[number]): string => {
      if (h === "perNotte") return perNotteR(r)?.toFixed(2).replace(".", ",") ?? "";
      if (h === "totale" || h === "voto") return String(r[h] ?? "").replace(".", ",");
      return q(r[h]);
    };
    const csv = [head.join(";"), ...rows.map((r) => head.map((h) => cella(r, h)).join(";"))].join("\n");
    scarica(`radar-prezzi-${today()}.csv`, new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    msg.textContent = "File pronto.";
  });

  /* ---------- Barometro ---------- */
  function gaugeSvg(p: number | null, label: string): string {
    const cx = 110, cy = 104, r = 82;
    const pt = (v: number, rr = r): [number, number] => { const a = Math.PI * (1 - Math.max(0, Math.min(100, v)) / 100); return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)]; };
    const arc = (a: number, b: number, cls: string): string => { const [x1, y1] = pt(a), [x2, y2] = pt(b); return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" class="rp-arc ${cls}"/>`; };
    let needle = "";
    // Un segno sull'arco invece di un ago dal centro: il numero al centro resta leggibile.
    if (p != null) { const [x1, y1] = pt(Math.min(p, 100), r - 15), [x2, y2] = pt(Math.min(p, 100), r + 11); needle = `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="rp-needle"/>`; }
    return `<svg class="rp-gauge" viewBox="0 0 220 132" role="img" aria-label="${esc(label)}: ${p == null ? "nessun dato" : Math.round(p) + "%"}">
    ${arc(0, 50, "calm")}${arc(50, 80, "lively")}${arc(80, 100, "hot")}
    ${p == null ? arc(0, 100, "track") : ""}${needle}
    <text class="rp-gauge-tick" x="20" y="124">0</text><text class="rp-gauge-tick" x="190" y="124">100</text>
    <text class="rp-gauge-val" x="${cx}" y="${cy}" dy="-14">${p == null ? "–" : Math.round(p) + "%"}</text>
    <text class="rp-gauge-lbl" x="${cx}" y="128">${esc(label)}</text></svg>`;
  }
  function spark(vs: number[]): string {
    if (vs.length < 2) return "";
    const mx = Math.max(100, ...vs), w = 200, h = 36;
    const d = vs.map((v, i) => `${i ? "L" : "M"}${(i / (vs.length - 1) * (w - 8) + 4).toFixed(1)} ${(h - 4 - v / mx * (h - 8)).toFixed(1)}`).join(" ");
    return `<svg class="rp-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg>`;
  }
  function mercato(loc: string, pk: string): Mercato {
    const l = baro.filter((b) => b.localita === loc && periodKey(b) === pk)
      .sort((a, b) => (a.rilevatoIl + (a.creatoIl || "")).localeCompare(b.rilevatoIl + (b.creatoIl || "")));
    const ult = l[l.length - 1] ?? null;
    const prev = ult ? [...l].reverse().find((b) => b.rilevatoIl < ult.rilevatoIl) ?? null : null;
    return { ult, prev };
  }
  /** La valutazione: mercato e casa insieme. Senza anno scorso, l'andamento è quello degli ultimi 7 giorni. */
  function valuta(m: number | null, c: number | null, d7: number | null, d: number | null): { titolo: string; testo: string } {
    const t: string[] = [];
    let titolo = "Dati insufficienti";
    if (m == null && c == null) return { titolo, testo: "Carica una ricerca Booking per questo periodo nel Radar su claude.ai: domattina compare qui." };
    if (c != null && c > 100) t.push("La casa risulta venduta oltre la capacità: verifica gli overbooking.");
    if (m != null && m >= 80) {
      if (c != null && c >= 85) { titolo = "Alza i prezzi"; t.push("Mercato quasi pieno e casa quasi venduta: le camere rimaste valgono di più."); }
      else if (c != null) { titolo = "Mercato pieno, casa con camere libere"; t.push(d != null && d < -0.1 ? "Il prezzo è già sotto mercato: il freno non è il prezzo. Controlla disponibilità sui canali e restrizioni come il soggiorno minimo." : "Controlla visibilità su Booking e sul sito, restrizioni e soggiorno minimo. Non serve scontare."); }
      else { titolo = "Domanda alta"; t.push("Mercato quasi pieno: evita sconti e tieni i prezzi."); }
    } else if (m != null && m >= 50) {
      const ferma = d7 != null && d7 <= 0 && c != null && c < 70;
      titolo = ferma ? "Recupera sul diretto" : "Mantieni";
      t.push(ferma ? "Domanda normale ma la casa non ha venduto nell'ultima settimana: valuta un'offerta sul canale diretto." : "Domanda normale: allinea il prezzo alla media del compset.");
    } else if (m != null) {
      titolo = "Domanda debole";
      t.push(d != null && d > 0.1 ? "Prezzo sopra mercato con domanda debole: rischio camere vuote, valuta di riallineare." : "Mercato calmo: spingi il canale diretto prima di scendere di prezzo sulle OTA.");
    } else {
      titolo = c != null && c >= 85 ? "Casa quasi venduta" : "Manca il dato di mercato";
      t.push("Carica una ricerca Booking per questo periodo per completare il quadro.");
    }
    if (d7 != null) t.push(`Nell'ultima settimana prima dello scatto: ${punti(d7)}.`);
    return { titolo, testo: t.join(" ") };
  }
  function rigaCasa(o: OccPeriodo | null, pk: string): string {
    if (!scatola) return "scatto di La Scatola non disponibile";
    if (!o) return `${dIt(pk.split("_")[0])} è fuori dal periodo coperto dallo scatto`;
    if (o.occPct == null) return "casa chiusa in queste date";
    const parz = o.coperte < o.notti ? ` · ${o.coperte} notti su ${o.notti} nello scatto` : "";
    return `${Math.round(o.occPct)}% · ${o.vendute} notti camera su ${o.disponibili}${o.opzioni ? ` · ${o.opzioni} in opzione` : ""}${parz}`;
  }
  function renderBarometro(): void {
    const el = $("#rp-baro");
    const pk = $<HTMLSelectElement>("#rp-b-periodo").value;
    if (!pk) { el.innerHTML = vuoto("Nessun periodo ancora", "Il barometro si accende con la prima ricerca Booking caricata nel Radar su claude.ai."); return; }
    const dati = datiCase(pk);
    el.innerHTML = ORDINE.map((casa) => {
      const loc = CASE[casa].loc;
      const { ult, prev } = mercato(loc, pk);
      const m = ult?.nonDisponibiliPct ?? null;
      const dm = ult && prev ? ult.nonDisponibiliPct - prev.nonDisponibiliPct : null;
      const o = occDi(casa, pk);
      const c = o?.occPct ?? null;
      const d = dati.find((z) => z.casa === casa)?.d ?? null;
      const lv = livello(m);
      const v = valuta(m, c, o?.delta7 ?? null, d);
      const row = (k: string, val: string): string => `<div class="rp-baro-row"><span>${k}</span><span>${val}</span></div>`;
      return `<article class="rp-baro">
      <div class="rp-baro-top"><div><div class="rp-house-name">${esc(casa)}</div><div class="rp-house-loc">${esc(loc)}</div></div>
        ${lv ? `<span class="rp-lvl ${lv[0]}">mercato ${lv[1]}</span>` : ""}</div>
      <div class="rp-gauges">
        <div>${gaugeSvg(m, "Mercato pieno")}</div><div>${gaugeSvg(c, "Casa venduta")}</div>
      </div>
      ${ult && ult.filtriStandard === false ? '<span class="rp-badge-warn">Ricerca con filtri non standard: dato di mercato falsato</span>' : ""}
      ${row("Mercato (Booking)", !ult ? "nessuna ricerca" : `${Math.round(ult.nonDisponibiliPct)}% non disponibili · ${dIt(ult.rilevatoIl)}${dm != null ? ` · ${punti(dm)}` : ""}`)}
      ${row("Casa (La Scatola)", rigaCasa(o, pk))}
      ${row("Ultimi 7 giorni", o?.delta7 == null || o.occPct == null ? "–" : punti(o.delta7))}
      ${row("ADR casa venduto", eur(o?.adr))}
      ${row("Anno scorso", '<span class="muted">non presente nello scatto</span>')}
      ${row("Prezzo vs compset Booking", d == null ? "–" : `<span class="rp-pill ${d < -0.1 ? "sotto" : d > 0.1 ? "sopra" : "linea"}">${pct(d)} · ${etichetta(d)}</span>`)}
      ${o && o.occPct != null && o.storia.length > 1 ? `<div><div class="rp-small">Andamento vendite casa, ultime 4 settimane</div>${spark(o.storia)}</div>` : ""}
      <div class="rp-verdict"><b>${esc(v.titolo)}</b>${esc(v.testo)}</div>
    </article>`;
    }).join("");
  }
  $("#rp-b-periodo").addEventListener("change", renderBarometro);

  /** Settimane da sabato a sabato nel periodo dello scatto, dove una casa aperta vende meno del 70%. */
  function critici(): { pk: string; casa: string; o: OccPeriodo; cerca: boolean }[] {
    if (!scatola) return [];
    const da = scatola.finestra.da > today() ? scatola.finestra.da : today();
    let sab = da;
    while (new Date(t0(sab)).getUTCDay() !== 6) sab = piuGiorni(sab, 1);
    const out: { pk: string; casa: string; o: OccPeriodo; cerca: boolean }[] = [];
    for (; piuGiorni(sab, 6) <= scatola.finestra.a; sab = piuGiorni(sab, 7)) {
      const pk = `${sab}_${piuGiorni(sab, 7)}`;
      for (const casa of ORDINE) {
        const o = occDi(casa, pk);
        // Nessuna camera venduta in tutta la settimana vuol dire, quasi sempre, casa ancora chiusa.
        if (!o || o.occPct == null || o.coperte < o.notti || o.vendute === 0 || o.occPct >= 70) continue;
        const cerca = baro.some((b) => b.localita === CASE[casa].loc && b.checkIn <= sab && b.checkOut > sab);
        out.push({ pk, casa, o, cerca });
      }
    }
    return out;
  }
  function renderCritici(): void {
    const tb = $("#rp-crit");
    if (!caricato) { tb.innerHTML = `<tr><td colspan="7" class="muted">Carico…</td></tr>`; return; }
    if (!scatola) { tb.innerHTML = `<tr><td colspan="7" class="muted">Lo scatto di La Scatola non è disponibile: senza, non so quali settimane sono deboli.</td></tr>`; return; }
    const list = critici();
    tb.innerHTML = list.length ? list.map((x) => {
      const [a, b] = x.pk.split("_");
      const grave = (x.o.occPct ?? 0) < 40;
      return `<tr>
    <td>${dIt(a)} → ${dIt(b)}</td><td>${esc(x.casa)}</td>
    <td class="right"><span class="rp-pill ${grave ? "sopra" : "sotto"}">${Math.round(x.o.occPct ?? 0)}%</span></td>
    <td class="right">${x.o.delta7 == null ? "–" : punti(x.o.delta7)}</td>
    <td class="right">${eur(x.o.adr)}</td>
    <td>${x.cerca ? '<span class="muted">fatta</span>' : `<span class="rp-badge-warn">da fare · ${esc(CASE[x.casa].loc)}</span>`}</td>
    <td><button class="btn ghost sm" data-apri="${x.pk}">Apri</button></td></tr>`;
    }).join("") : `<tr><td colspan="7" class="muted">Nessun periodo critico al momento.</td></tr>`;
  }
  $("#rp-crit").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-apri]");
    if (!b?.dataset.apri) return;
    extraPeriodi.add(b.dataset.apri);
    renderPeriodi();
    $<HTMLSelectElement>("#rp-b-periodo").value = b.dataset.apri;
    renderBarometro();
    $("#rp-tab-barometro").scrollIntoView({ behavior: "smooth" });
  });

  /* ---------- PDF per email ---------- */
  const pdfTxt = (s: unknown): string => String(s ?? "").replace(/★/g, "*").replace(/[−–—]/g, "-").replace(/→/g, "-").replace(/[^\x20-\x7E\xA0-\xFF€]/g, "");
  const eurP = (n: number | null): string => n == null || isNaN(n) ? "-" : Math.round(n).toLocaleString("it-IT") + " €";
  const sgnP = (n: number): string => (n > 0 ? "+" : n < 0 ? "-" : "") + Math.abs(Math.round(n)).toLocaleString("it-IT") + " €";
  const pctP = (n: number): string => (n > 0 ? "+" : n < 0 ? "-" : "") + Math.abs(n * 100).toFixed(0) + "%";
  $("#rp-btn-pdf").addEventListener("click", async () => {
    const box = $("#rp-pdf-box"), m = $("#rp-pdf-msg");
    box.hidden = false;
    const show = (t: string, c = ""): void => { m.innerHTML = `<div class="rp-msg ${c}">${esc(t)}</div>`; };
    const pk = $<HTMLSelectElement>("#rp-periodo").value;
    if (!rows.length || !pk) { show("Non ci sono ancora rilevazioni da mettere nel PDF.", "err"); return; }
    show("Preparo il PDF…");
    const lib = await jsPDF();
    if (!lib) { show("Il generatore di PDF non si è caricato: serve la rete. Riprova tra poco.", "err"); return; }
    const [ci, co] = pk.split("_");
    const nN = nottiFra(ci, co);
    const dati = datiCase(pk);
    const doc = new lib.jsPDF({ unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const pine = [29, 74, 60], ink = [18, 38, 31], grey = [92, 104, 99], soft = [230, 237, 233];
    doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(...ink);
    doc.text("Radar Prezzi AlpStay", 14, 18);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...grey);
    doc.text(pdfTxt(`Soggiorno ${dIt(ci)} - ${dIt(co)} (${nN} notti, 2 adulti) · prezzi per notte, tasse incluse`), 14, 25);
    doc.text(`Creato il ${dIt(today())} · fonte: ricerche Booking.com rilevate dallo staff`, 14, 30);
    doc.setDrawColor(...pine); doc.setLineWidth(0.6); doc.line(14, 33, W - 14, 33);
    doc.autoTable({ startY: 38, head: [["Casa", "Località", "Casa / notte", "Media compset", "Strutture", "Differenza", "Posizione"]],
      body: dati.map((x) => [x.casa, x.loc, eurP(x.ownP), eurP(x.avg), String(x.comps.length), x.d == null || x.ownP == null || x.avg == null ? "-" : `${pctP(x.d)} (${sgnP(x.ownP - x.avg)})`, etichetta(x.d)]),
      styles: { font: "helvetica", fontSize: 9.5, cellPadding: 2.2 }, headStyles: { fillColor: pine, textColor: 255 },
      columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "center" }, 5: { halign: "right" } },
      didParseCell: (h) => { if (h.section === "body" && h.column.index === 6) { const v = h.cell.raw; h.cell.styles.textColor = v === "sotto mercato" ? [122, 92, 43] : v === "sopra mercato" ? [178, 68, 47] : v === "in linea" ? [63, 125, 95] : grey; h.cell.styles.fontStyle = "bold"; } } });
    {
      const y = doc.lastAutoTable.finalY + 10;
      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...ink); doc.text("Barometro della domanda", 14, y);
      const bb = ORDINE.map((casa) => {
        const { ult } = mercato(CASE[casa].loc, pk);
        const m2 = ult?.nonDisponibiliPct ?? null;
        const o = occDi(casa, pk);
        const c = o?.occPct ?? null;
        const v = valuta(m2, c, o?.delta7 ?? null, dati.find((z) => z.casa === casa)?.d ?? null);
        return [casa, m2 == null ? "-" : `${Math.round(m2)}% (${livello(m2)?.[1] ?? ""})`, c == null ? "-" : `${Math.round(c)}%`,
          o?.delta7 == null || c == null ? "-" : pdfTxt(punti(o.delta7)), eurP(o?.adr ?? null), pdfTxt(v.titolo + ". " + v.testo)];
      });
      doc.autoTable({ startY: y + 3, head: [["Casa", "Mercato non disp.", "Casa venduta", "Ultimi 7 gg", "ADR", "Valutazione"]], body: bb,
        styles: { font: "helvetica", fontSize: 8.5, cellPadding: 1.8, overflow: "linebreak" }, headStyles: { fillColor: pine, textColor: 255 },
        columnStyles: { 1: { halign: "center", cellWidth: 24 }, 2: { halign: "center", cellWidth: 20 }, 3: { halign: "center", cellWidth: 22 }, 4: { halign: "right", cellWidth: 18 }, 5: { cellWidth: "auto" } } });
    }
    for (const x of dati) {
      let y = doc.lastAutoTable.finalY + 10;
      if (y > 255) { doc.addPage(); y = 18; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...ink);
      doc.text(pdfTxt(`${x.casa} · ${x.loc}`), 14, y);
      const all = [...x.own, ...x.comps];
      const body = all.map((r) => {
        const p = perNotteR(r), c = previousChange(r);
        return [pdfTxt(r.struttura), pdfTxt(r.stelle), r.voto ?? "-", pdfTxt(r.camera), eurP(p), r.tipo === "AlpStay" || x.ownP == null || p == null ? "-" : sgnP(x.ownP - p),
          !c ? "-" : Math.abs(c.delta) < 1 ? "invariato" : `${sgnP(c.delta)} dal ${dIt(c.da)}`, dIt(r.rilevatoIl)];
      });
      doc.autoTable({ startY: y + 3, head: [["Struttura", "Stelle", "Voto", "Camera", "€/notte", "Casa vs struttura", "Variazione", "Rilevato"]], body,
        styles: { font: "helvetica", fontSize: 8.5, cellPadding: 1.8, overflow: "linebreak" }, headStyles: { fillColor: soft, textColor: ink },
        columnStyles: { 0: { cellWidth: 46 }, 2: { halign: "right" }, 3: { cellWidth: 44 }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
        didParseCell: (h) => { if (h.section === "body" && x.own.includes(all[h.row.index])) { h.cell.styles.fontStyle = "bold"; h.cell.styles.fillColor = soft; } } });
    }
    let y = doc.lastAutoTable.finalY + 10;
    if (y > 262) { doc.addPage(); y = 18; }
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...grey);
    doc.text(doc.splitTextToSize(`Note: per ogni struttura vale l'ultima rilevazione del periodo; solo camere doppie/matrimoniali d'hotel. I prezzi Booking possono includere sconti Genius o Bonus VIP legati all'account usato per la ricerca. Posizione: "sotto mercato" oltre il 10% sotto la media del compset, "sopra mercato" oltre il 10% sopra. Camere vendute e ADR dallo scatto di La Scatola${scatola ? ` del ${dIt(scatola.generato.slice(0, 10))}` : ""}.`, W - 28), 14, y);
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(8); doc.text(`AlpStay · Radar Prezzi · pagina ${i}/${pages}`, W - 14, 290, { align: "right" }); }
    $<HTMLTextAreaElement>("#rp-mail-text").value = [
      `Oggetto: Radar prezzi AlpStay – soggiorno ${dIt(ci)}–${dIt(co)}`, "",
      "Buongiorno,", "",
      `in allegato il confronto prezzi delle case AlpStay con i concorrenti per il soggiorno ${dIt(ci)}–${dIt(co)} (${nN} notti, 2 adulti), rilevato su Booking.com.`, "",
      "In sintesi (prezzo per notte):",
      ...dati.map((x) => `• ${x.casa}: ${eur(x.ownP)} contro una media di ${eur(x.avg)} su ${x.comps.length} ${x.comps.length === 1 ? "struttura" : "strutture"} – ${x.d == null ? "dati insufficienti" : pct(x.d) + ", " + etichetta(x.d)}`),
      "", "Barometro della domanda:",
      ...ORDINE.map((casa) => {
        const { ult } = mercato(CASE[casa].loc, pk);
        const o = occDi(casa, pk);
        return `• ${casa}: mercato ${ult ? Math.round(ult.nonDisponibiliPct) + "% non disponibili" : "non rilevato"}, casa venduta ${o?.occPct != null ? Math.round(o.occPct) + "%" : "n.d."}`;
      }),
      "", "Cordiali saluti"].join("\n");
    const filename = `radar-prezzi-alpstay-${ci}_${co}.pdf`;
    scarica(filename, doc.output("blob"));
    show(`PDF "${filename}" salvato. Allegalo alla mail e usa il testo qui sotto.`, "ok");
  });
  $("#rp-btn-copy").addEventListener("click", async () => {
    const ta = $<HTMLTextAreaElement>("#rp-mail-text"), b = $("#rp-btn-copy");
    try { await navigator.clipboard.writeText(ta.value); b.textContent = "Copiato"; setTimeout(() => { b.textContent = "Copia testo"; }, 1800); }
    catch { ta.focus(); ta.select(); b.textContent = "Testo selezionato: premi Ctrl+C"; }
  });
  $("#rp-btn-pdf-close").addEventListener("click", () => { $("#rp-pdf-box").hidden = true; });

  /* ---------- Render e dati ---------- */
  function renderAll(): void { renderPeriodi(); renderConfronto(); renderBarometro(); renderCritici(); renderVariazioni(); renderStorico(); }
  $("#rp-periodo").addEventListener("change", renderConfronto);
  renderAll();

  async function carica(): Promise<void> {
    const { dati, errore } = await caricaRadar();
    caricato = true;
    const st = $("#rp-status");
    if (!dati) {
      st.textContent = "Rilevazioni non disponibili";
      $("#rp-errore").innerHTML = `<div class="warns"><p class="wd">Radar prezzi non disponibile</p><ul><li>${esc(errore ?? "radar.json non è leggibile.")}</li>
        <li>Il resto della piattaforma funziona normalmente. Le rilevazioni si caricano nel <a class="linkbtn" href="${ARTIFACT_RADAR}" target="_blank" rel="noopener">Radar su claude.ai</a>.</li></ul></div>`;
      renderAll();
      return;
    }
    rows = dati.rilevazioni;
    baro = dati.barometro;
    const ultima = rows.map((r) => r.rilevatoIl).sort().pop();
    st.textContent = rows.length
      ? `${rows.length} rilevazioni · ultima del ${dIt(ultima)}${dati.generatedAt ? ` · aggiornate il ${dIt(dati.generatedAt.slice(0, 10))}` : ""}`
      : "Nessuna rilevazione";
    if (dati.scartati) {
      $("#rp-errore").innerHTML = `<div class="warns"><p class="wd">Righe non usate</p><ul><li>${dati.scartati} ${dati.scartati === 1 ? "documento di radar.json è incompleto e non è mostrato" : "documenti di radar.json sono incompleti e non sono mostrati"}.</li></ul></div>`;
    }
    renderAll();
  }

  function start(s: ScatolaSnapshot | null): void {
    if (s !== scatola) {
      scatola = s;
      perNotte = s ? capienzaPerNotte(s) : new Map();
      if (avviato) renderAll();
    }
    if (avviato) return;
    avviato = true;
    carica().catch(() => {
      caricato = true;
      $("#rp-status").textContent = "Rilevazioni non disponibili";
      renderAll();
    });
  }

  return { el: R, start };
}
