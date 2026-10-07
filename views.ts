import type { AppState, DayForecast, HotelId, MoveDecision, OrphanGap, Reservation, RoomMove, Settings, SolveResult } from "./types";
import type { HotelStats } from "./analytics";
import type { Protector } from "./protect";
import type { ParsedSheet } from "./importer";
import type { ColumnMapping, WashModel } from "./types";
import { REASON_LABEL } from "./protect";
import { FIELDS, missingRequired, normalize, resKey } from "./importer";
import { actionOf, isActive } from "./forecast";
import { channelStats, washProb, LEAD_BUCKETS, washSampleSize, netValue } from "./analytics";
import { renderTable, Column } from "./table";
import { skyline, washChart, monthBars, meter } from "./charts";
import { board, boardLegend } from "./board";
import { infoButton } from "./info";
import { SPEC_KIND_LABEL, guestKey } from "./speculative";
import type { SpecResult, SpecFlag } from "./speculative";
import type { CancelResult, CancelCase } from "./cancellable";
import { GROUND_LABEL, scadenzaRisposta } from "./cancellable";
import type { InfoKey } from "./info";
import type { MailState } from "./waitlist";
import { esc, eur, fmtDate, nights, pct, todayISO, addDays, tagList } from "./util";
import { utenteCorrente } from "./firebase";

export const MAX_SOLVE_NIGHTS = 90;

export type Tab = "guida" | "solve" | "attesa" | "registro" | "pren" | "storico" | "import" | "settings" | "manuale";

export interface Derived {
  rev: number;
  list: Reservation[];
  protector: Protector;
  model: WashModel;
  fc: Map<HotelId | "gruppo", DayForecast[]>;
  stats: Map<HotelId, HotelStats>;
  spec: SpecResult;
  canc: CancelResult;
}

export interface UIState {
  tab: Tab;
  /** Prenotazioni salvate con un numero di camere impossibile, corrette in lettura. */
  roomsFixed: number;
  hotel: HotelId | "gruppo";
  solveFrom: string;
  solveDays: number;
  solveTo: string;   // ultima notte inclusa
  solve: SolveResult | null;
  gridHotel: HotelId | "tutte";
  detail: string | null;
  day: string | null;
  info: InfoKey | null;
  mail: MailState | null;
  caseId: string | null;
  regHotel: string;
  resFutureOnly: boolean;
  imp: { sheet: ParsedSheet | null; mapping: ColumnMapping; fixedHotel: string; replace: boolean };
  draft: Settings | null;
  busy: string | null;
}

export interface Ctx { app: AppState; d: Derived; ui: UIState; }

/**
 * Import da Slope sospeso: si lavora sui dati dimostrativi finché non arriva la databox.
 * Per riattivarlo basta rimettere true: il codice dell'import è rimasto intatto.
 */
export const IMPORT_ATTIVO = false;

const TABS_ALL: [Tab, string][] = [
  ["guida", "Guida strategica"],
  ["solve", "Problem solving"],
  ["attesa", "Lista d'attesa"],
  ["registro", "Registro"],
  ["pren", "Prenotazioni"],
  ["storico", "Storico"],
  ["import", "Importa da Slope"],
  ["settings", "Impostazioni"],
  ["manuale", "Come funziona"],
];

const TABS: [Tab, string][] = TABS_ALL.filter(([k]) => IMPORT_ATTIVO || k !== "import");

export function hotelName(s: Settings, id: HotelId | "gruppo" | null): string {
  if (id === "gruppo") return "Tutte e tre le case";
  return s.hotels.find((h) => h.id === id)?.name ?? String(id ?? "—");
}

export function header(c: Ctx): string {
  const li = c.app.meta.lastImport;
  return `<header class="top">
    <div class="brand"><span class="mark" aria-hidden="true"></span><div><h1>Overbooking</h1><p>AlpStay Hotels</p></div></div>
    <div class="status">
      <span class="dot ${c.app.storage}"></span>${c.app.storage === "cloud" ? "Dati condivisi con lo staff" : "Dati salvati solo su questo browser"}${(() => {
        const u = utenteCorrente();
        return u?.email ? `<span class="sep"></span><span class="who">${esc(u.email)}</span><button class="linkbtn" data-act="logout">Esci</button>` : "";
      })()}
      <span class="sep"></span>${IMPORT_ATTIVO ? (li ? `Ultimo import ${fmtDate(li.at.slice(0, 10))}, ${li.at.slice(11, 16)}` : "Nessun import") : "Dati dimostrativi — import sospeso"}
    </div>
    <nav class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" aria-selected="${c.ui.tab === k}" data-act="tab" data-v="${k}">${l}</button>`).join("")}</nav>
  </header>`;
}

function hotelSwitch(c: Ctx, withGroup: boolean): string {
  const opts: (HotelId | "gruppo")[] = [...c.app.settings.hotels.map((h) => h.id), ...(withGroup ? ["gruppo" as const] : [])];
  return `<div class="seg" role="group" aria-label="Casa">${opts
    .map((id) => `<button data-act="hotel" data-v="${id}" aria-pressed="${c.ui.hotel === id}">${esc(id === "gruppo" ? "Gruppo" : hotelName(c.app.settings, id))}</button>`)
    .join("")}</div>`;
}

/** Comandi dei dati dimostrativi: mentre l'import è sospeso stanno nelle Impostazioni. */
export function demoBlock(c: Ctx): string {
  const quante = [...c.app.reservations.values()].filter((r) => r.id.startsWith("DEMO-")).length;
  const altre = c.app.reservations.size - quante;
  return `<h3 class="sec">Dati dimostrativi</h3>
    <article class="card">
      ${IMPORT_ATTIVO ? "" : `<p>L'import da Slope è <b>sospeso</b> in attesa della databox. Finché dura, la piattaforma lavora su dati inventati: servono a provare le funzioni e a decidere insieme come devono comportarsi, non a prendere decisioni di vendita.</p>`}
      <p class="muted"><b>Scenario di prova completo</b>: una settimana sovravenduta su tutte e tre le case, con gruppi, ospiti abituali, non rimborsabili, doppie prenotazioni, prenotazioni da annullare per motivo valido, lista d'attesa e registro già pieni. <b>Solo dati dimostrativi</b>: un anno di storico più le prenotazioni future, senza conflitti costruiti apposta.</p>
      <div class="row demo"><button class="btn gold sm" data-act="demo-scenario">Scenario di prova completo</button><button class="btn ghost sm" data-act="demo-load">Solo dati dimostrativi</button><button class="btn ghost sm" data-act="demo-clear">Elimina i dati dimostrativi</button></div>
      <p class="muted"><small>In archivio ci sono ${quante} prenotazioni dimostrative${altre ? ` e ${altre} prenotazioni importate da Slope, che restano dove sono: non le tocco` : ""}.${altre ? " Se vuoi ripartire pulito, dimmelo e aggiungo il comando per toglierle." : ""}</small></p>
    </article>`;
}

function emptyState(): string {
  if (!IMPORT_ATTIVO) {
    return `<section class="empty-state">
      <h2>Nessuna prenotazione caricata</h2>
      <p>L'import da Slope è sospeso: si lavora sui dati dimostrativi finché non arriva la databox. Lo scenario di prova costruisce una settimana sovravenduta su tutte e tre le case, con gruppi, abituali, doppie prenotazioni e cancellazioni motivate: serve a vedere come si comporta la piattaforma.</p>
      <div class="row"><button class="btn gold" data-act="demo-scenario">Scenario di prova completo</button><button class="btn ghost" data-act="demo-load">Solo dati dimostrativi</button></div>
    </section>`;
  }
  return `<section class="empty-state">
    <h2>Nessuna prenotazione caricata</h2>
    <p>La guida si calcola sullo storico di Slope: servono le prenotazioni degli ultimi 12-24 mesi, cancellate comprese, più tutte quelle future.</p>
    <div class="row"><button class="btn gold" data-act="tab" data-v="import">Importa da Slope</button><button class="btn ghost" data-act="demo-scenario">Scenario di prova completo</button><button class="btn ghost" data-act="demo-load">Solo dati dimostrativi</button></div>
  </section>`;
}

const ACTION_LABEL: Record<string, string> = {
  vendi: "Vendi in overbooking",
  stop: "Chiudi le vendite",
  rischio: "Oltre soglia",
  pieno: "Quasi pieno",
  libero: "Vendita normale",
};

// ============================================================ GUIDA
export function viewGuide(c: Ctx): string {
  if (!c.d.list.length) return emptyState();
  const fc = c.d.fc.get(c.ui.hotel) ?? [];
  const risk = fc.filter((d) => actionOf(d) === "rischio");
  const sell = fc.filter((d) => actionOf(d) === "vendi");
  const stop = fc.filter((d) => actionOf(d) === "stop");
  const name = hotelName(c.app.settings, c.ui.hotel);
  const totalExtra = sell.reduce((a, d) => a + d.headroom, 0);

  let lead: string;
  if (risk.length) lead = `${risk.length === 1 ? "Una notte è oltre" : `${risk.length} notti sono oltre`} la soglia di sicurezza: ${risk[0].date === todayISO() ? "stanotte" : "la prima è " + fmtDate(risk[0].date, true)}.`;
  else if (sell.length) lead = `Puoi vendere ancora ${totalExtra} camere-notte oltre la capienza, distribuite su ${sell.length} notti.`;
  else lead = "Nessuna notte richiede overbooking: si vende normalmente fino alla capienza.";

  const list = (arr: DayForecast[], fn: (d: DayForecast) => string, emptyTxt: string): string =>
    arr.length ? `<ul class="acts">${arr.slice(0, 8).map((d) => `<li><span class="d">${fmtDate(d.date, true)}</span>${fn(d)}</li>`).join("")}${arr.length > 8 ? `<li class="muted">e altre ${arr.length - 8}</li>` : ""}</ul>` : `<p class="muted">${emptyTxt}</p>`;

  const cols: Column<DayForecast>[] = [
    { key: "date", label: "Notte", value: (d) => d.date, render: (d) => `<b>${fmtDate(d.date, true)}</b>` },
    { key: "ev", label: "Periodo", value: (d) => d.event?.name ?? "", filter: true, render: (d) => (d.event ? `<span class="chip ${d.event.kind}">${esc(d.event.name)}</span>` : "") },
    { key: "cap", label: "Capienza", value: (d) => d.capacity, align: "right" },
    { key: "otb", label: "In portafoglio", value: (d) => d.otb, align: "right" },
    { key: "fix", label: "Fisse", value: (d) => d.protectedRooms, align: "right" },
    { key: "exc", label: "Cancellaz. attese", value: (d) => Math.round(d.expCancel * 10) / 10, align: "right", render: (d) => meter(d.expCancel, Math.max(0, d.otb - d.capacity), d.sdCancel, Math.ceil(d.capacity * 0.12)) },
    { key: "occ", label: "Occupaz. attesa", value: (d) => Math.round(d.expOccPct * 1000) / 10, align: "right", render: (d) => pct(d.expOccPct) },
    { key: "ceil", label: "Vendibili totali", value: (d) => d.ceiling, align: "right", render: (d) => `<b>${d.ceiling}</b>${d.ceiling > d.capacity ? ` <small class="gold">+${d.ceiling - d.capacity}</small>` : ""}` },
    { key: "head", label: "Margine", value: (d) => d.headroom, align: "right", render: (d) => `<b class="${d.headroom < 0 ? "neg" : d.headroom > 0 ? "pos" : ""}">${d.headroom > 0 ? "+" : ""}${d.headroom}</b>` },
    { key: "risk", label: "Rischio overbooking", value: (d) => Math.round(d.walkRiskPct * 1000) / 10, align: "right", render: (d) => (d.walkRiskPct > 0.005 ? pct(d.walkRiskPct) : "—") },
    { key: "act", label: "Azione", value: (d) => ACTION_LABEL[actionOf(d)], filter: true, render: (d) => `<span class="tag ${actionOf(d)}">${ACTION_LABEL[actionOf(d)]}</span>${d.frozen && d.otb >= d.capacity ? ` <small class="muted">blocco ${c.app.settings.freezeDays} gg</small>` : ""}` },
  ];

  return `<section class="page">
    <div class="pagehead">${hotelSwitch(c, true)}<p class="muted">Prossimi ${fc.length} giorni${c.ui.hotel === "gruppo" ? " — somma delle tre case, senza compensazione tra case" : ""}</p></div>
    ${fixedRoomsNotice(c)}
    ${specBanner(c)}
    <h2 class="lead">${esc(name)}: ${esc(lead)}</h2>
    ${skyline(fc, c.app.settings.freezeDays)}
    <div class="legend"><span><i class="k vendi"></i>Vendi in overbooking</span><span><i class="k stop"></i>Soglia raggiunta</span><span><i class="k rischio"></i>Oltre soglia</span><span><i class="k pieno"></i>Oltre 85%</span><span><i class="k libero"></i>Vendita normale</span><span><i class="k ceil"></i>Soglia vendibile</span><span><i class="k cap"></i>Capienza</span><span><i class="k ev"></i>Alta stagione / evento</span></div>
    <div class="cols3">
      <article class="card risk"><h3>Oltre soglia: intervenire ${infoButton("azioni", "Con quale criterio")}</h3>${list(risk, (d) => `<span><b>${d.otb - d.ceiling}</b> ${d.otb - d.ceiling === 1 ? "camera" : "camere"} oltre, rischio ${pct(d.walkRiskPct)}</span><button class="btn sm" data-act="solve-from" data-v="${d.date}">Risolvi</button>`, "Nessuna notte oltre soglia.")}</article>
      <article class="card sell"><h3>Vendibili oltre capienza ${infoButton("azioni", "Con quale criterio")}</h3>${list(sell, (d) => `<span>ancora <b>+${d.headroom}</b>, tetto ${d.ceiling} su ${d.capacity}</span>`, "Nessuna notte piena con margine.")}</article>
      <article class="card stop"><h3>Soglia raggiunta: chiudere ${infoButton("azioni", "Con quale criterio")}</h3>${list(stop, (d) => `<span>${d.otb} in portafoglio su ${d.capacity}</span>`, "Nessuna notte da chiudere.")}</article>
    </div>
    <details class="howto"><summary>Come applicare la soglia in Slope e sul channel manager</summary>
      <p>“Vendibili totali” è il numero massimo di camere da tenere in portafoglio per quella notte. Quando una notte è piena, apri sul channel manager un overbooking pari al valore in oro (+N) e chiudilo quando il margine arriva a zero. La soglia scende da sola man mano che l'arrivo si avvicina, perché le cancellazioni tardive sono più rare; entro ${c.app.settings.freezeDays} giorni dall'arrivo non si aggiunge overbooking.</p>
      <p>Il calcolo usa la curva di cancellazione di questa casa per canale e anticipo, corretta per alta stagione ed eventi, il valore netto medio della camera e il costo di un overbooking (${c.ui.hotel === "gruppo" ? "per casa" : eur(c.app.settings.hotels.find((h) => h.id === c.ui.hotel)?.walkCost ?? 0)}). Non supera mai il rischio massimo del ${c.app.settings.riskMaxPct}% né il tetto percentuale impostato.</p>
    </details>
    ${specSection(c)}
    <h3 class="sec with-info">Dettaglio per notte ${infoButton("nights", "A cosa serve questa tabella")}</h3>
    <p class="muted narrow"><small>Colonna “Cancellaz. attese”: la barra mostra le cancellazioni previste, la fascia oro è il margine di incertezza, la tacca nera sono le camere in eccesso. Verde: le cancellazioni coprono l'eccesso. Rosso: non bastano.</small></p>
    ${renderTable({ id: "guide-" + c.ui.hotel, columns: cols, rows: fc, exportName: `overbooking-${c.ui.hotel}-${todayISO()}`, empty: "Nessun dato", rowClass: (d) => (d.event ? "evrow" : "") })}
  </section>`;
}

// ============================================================ PROBLEM SOLVING
const KIND_LABEL: Record<string, string> = { upgrade: "Upgrade / cambio interno", riprotezione: "Riprotezione in altra casa", cancellazione: "Cancellazione motivata", walk: "Overbooking" };

export function viewSolve(c: Ctx): string {
  if (!c.d.list.length) return emptyState();
  const s = c.app.settings;
  const r = c.ui.solve;
  const controls = `<div class="controls">
    <label>Dal <input type="date" data-bind="solveFrom" value="${c.ui.solveFrom}" min="${todayISO()}"></label>
    <label>Al (ultima notte) <input type="date" data-bind="solveTo" value="${c.ui.solveTo}" min="${c.ui.solveFrom}" max="${addDays(c.ui.solveFrom, MAX_SOLVE_NIGHTS - 1)}"></label>
    <div class="presets" role="group" aria-label="Periodi rapidi"><span>Rapido</span>${[7, 14, 21, 30, 45].map((n) => `<button class="chipbtn" data-act="solve-preset" data-v="${n}" aria-pressed="${n === c.ui.solveDays}">${n} notti</button>`).join("")}</div>
    <button class="btn gold" data-act="solve">Calcola il piano</button>
    <span class="nights-hint">${c.ui.solveDays} ${c.ui.solveDays === 1 ? "notte" : "notti"}: dal ${fmtDate(c.ui.solveFrom, true)} al ${fmtDate(c.ui.solveTo, true)}, partenza ${fmtDate(addDays(c.ui.solveTo, 1), true)}</span>
  </div>`;
  if (!r) {
    return `<section class="page"><h2 class="lead">Piano di riprotezione sulle notti in conflitto</h2>${controls}
    <p class="muted narrow">Il piano prova in quest'ordine: upgrade o cambio tipologia nella stessa casa, riprotezione nelle altre due case (prima categoria pari o superiore), infine overbooking con ricollocamento esterno. Le prenotazioni fisse non vengono mai toccate. Chi spostare lo decide il punteggio di permanenza: valore netto, data di prenotazione, prepagato e principio tetris.</p></section>`;
  }
  const moves = r.moves;
  const walk = moves.filter((m) => m.kind === "walk");
  const rip = moves.filter((m) => m.kind === "riprotezione");
  const up = moves.filter((m) => m.kind === "upgrade");
  const conflicts = Object.values(r.conflictsBefore).reduce((a, b) => a + b, 0);

  const cols: Column<MoveDecision>[] = [
    { key: "seq", label: "#", value: (m) => m.seq, align: "right", width: "3rem" },
    { key: "kind", label: "Azione", value: (m) => KIND_LABEL[m.kind], filter: true, render: (m) => `<span class="tag ${m.kind}">${KIND_LABEL[m.kind]}</span>` },
    { key: "hotel", label: "Casa", value: (m) => hotelName(s, m.res.hotelId), filter: true },
    { key: "id", label: "ID Slope", value: (m) => m.res.id, render: (m) => `<code>${esc(m.res.id)}</code>` },
    { key: "guest", label: "Ospite", value: (m) => m.res.guest },
    { key: "arr", label: "Arrivo", value: (m) => m.res.arrival, render: (m) => fmtDate(m.res.arrival, true) },
    { key: "n", label: "Notti", value: (m) => nights(m.res), align: "right" },
    { key: "rooms", label: "Cam.", value: (m) => m.res.rooms, align: "right" },
    { key: "ch", label: "Canale", value: (m) => m.res.channel, filter: true },
    { key: "net", label: "Valore netto", value: (m) => Math.round(m.netValue), align: "right", render: (m) => eur(m.netValue) },
    { key: "note", label: "Destinazione", value: (m) => m.note },
    { key: "why", label: "Perché", value: (m) => m.reason, render: (m) => `<small>${esc(m.reason)}</small>` },
  ];

  return `<section class="page">
    <h2 class="lead">${conflicts ? `${conflicts} camere-notte in conflitto dal ${fmtDate(r.from, true)}. Prenotazioni: ${up.length} sistemate in casa, ${rip.length} riprotette nelle altre case, ${walk.length} in overbooking da ricollocare fuori.` : `Nessun conflitto di camere dal ${fmtDate(r.from, true)} per ${r.days.length} notti.`}</h2>
    ${controls}
    ${fixedRoomsNotice(c)}
    ${warnBlock(r.warnings, c.d.list.length > 0 && c.d.list.every((x) => x.id.startsWith("DEMO-")))}
    <div class="kpis">${s.hotels
      .map((h) => `<div><span>${esc(h.name)}</span><b>${r.conflictsBefore[h.id] ?? 0}</b><small>camere-notte in conflitto</small><b class="sm">${r.orphanNights[h.id] ?? 0}</b><small>notti isolate dopo il tetris</small></div>`)
      .join("")}</div>
    <div class="pagehead"><div class="seg">${[...s.hotels.map((h) => [h.id, h.name]), ["tutte", "Tutte le case"]].map(([id, nm]) => `<button data-act="grid-hotel" data-v="${id}" aria-pressed="${id === c.ui.gridHotel}">${esc(nm)}</button>`).join("")}</div></div>
    ${boardLegend()}
    ${board(c, r, c.ui.gridHotel)}
    ${waitNotice(c, r)}
    ${walk.length ? `<div class="notice"><b>Overbooking:</b> una prenotazione confermata non si cancella unilateralmente. Si ricolloca l'ospite in un hotel partner di pari o superiore categoria, con trasferimento e differenza a nostro carico, avvisandolo prima possibile. Per le prenotazioni OTA segui la procedura di ricollocamento del portale. Chiama nell'ordine della sequenza.</div>` : ""}
    <h3 class="sec with-info">Sequenza delle azioni ${infoButton("moves", "Cosa mostra questa tabella")}${c.app.canWrite && moves.length ? `<button class="btn ghost sm" data-act="case-bulk">Porta le posizioni nel registro</button>` : ""}</h3>
    ${renderTable({ id: "moves", columns: cols, rows: moves, exportName: `piano-overbooking-${r.from}`, empty: "Nessuna azione necessaria.", pageSize: 50 })}
    ${cancelSection(c)}
    ${roomSections(c, r)}
  </section>`;
}

// ============================================================ PRENOTAZIONI
export function viewReservations(c: Ctx): string {
  if (!c.d.list.length) return emptyState();
  const s = c.app.settings;
  const today = todayISO();
  const rows = c.d.list.filter((r) => !c.ui.resFutureOnly || r.departure > today);
  const cols: Column<Reservation>[] = [
    { key: "hotel", label: "Casa", value: (r) => hotelName(s, r.hotelId), filter: true },
    { key: "id", label: "ID Slope", value: (r) => r.id, render: (r) => `<code>${esc(r.id)}</code>` },
    { key: "guest", label: "Ospite", value: (r) => r.guest },
    { key: "arr", label: "Arrivo", value: (r) => r.arrival, render: (r) => fmtDate(r.arrival) },
    { key: "dep", label: "Partenza", value: (r) => r.departure, render: (r) => fmtDate(r.departure) },
    { key: "n", label: "Notti", value: (r) => nights(r), align: "right" },
    { key: "rooms", label: "Cam.", value: (r) => r.rooms, align: "right" },
    { key: "type", label: "Tipologia", value: (r) => r.roomType, filter: true },
    { key: "ch", label: "Canale", value: (r) => r.channel, filter: true },
    { key: "st", label: "Stato", value: (r) => r.status, filter: true },
    { key: "tot", label: "Totale", value: (r) => r.total, align: "right", render: (r) => eur(r.total) },
    { key: "net", label: "Netto", value: (r) => Math.round(netValue(s, r)), align: "right", render: (r) => eur(netValue(s, r)) },
    { key: "fix", label: "Fissa", value: (r) => c.d.protector.reasons(r).map((x) => REASON_LABEL[x]).join(", ") || "no", filter: false, render: (r) => c.d.protector.reasons(r).map((x) => `<span class="chip p">${REASON_LABEL[x]}</span>`).join(" ") },
    { key: "lock", label: "Blocca", value: (r) => (c.app.locks[resKey(r)] ? "sì" : ""), render: (r) => (c.app.canWrite ? `<button class="btn sm ${c.app.locks[resKey(r)] ? "gold" : "ghost"}" data-act="lock" data-v="${esc(resKey(r))}" aria-pressed="${!!c.app.locks[resKey(r)]}">${c.app.locks[resKey(r)] ? "Bloccata" : "Blocca"}</button>` : "") },
  ];
  return `<section class="page">
    <h2 class="lead">Prenotazioni importate da Slope</h2>
    <p class="muted narrow">Per rendere <b>intoccabile</b> una prenotazione, il receptionist aggiunge in Slope il tag ${esc(tagList(s.rules.fixedTag))} (nel campo tag o nelle note): al prossimo import il piano non la sposta, non le cambia tipologia e non le cambia camera. “Blocca” serve solo per i casi urgenti tra un import e l'altro.</p>
    <label class="check"><input type="checkbox" data-bind="resFutureOnly" ${c.ui.resFutureOnly ? "checked" : ""}> Solo in casa e future</label>
    ${renderTable({ id: "res", columns: cols, rows, exportName: `prenotazioni-${todayISO()}`, empty: "Nessuna prenotazione.", rowClass: (r) => (r.status === "cancellata" ? "dim" : "") })}
  </section>`;
}

// ============================================================ STORICO
export function viewHistory(c: Ctx): string {
  if (!c.d.list.length) return emptyState();
  const s = c.app.settings;
  const hid = c.ui.hotel;
  const clsFor = ["s1", "s2", "s3"];
  const series = s.hotels.map((h, i) => ({ name: h.name, cls: clsFor[i % 3], values: LEAD_BUCKETS.map((_, bi) => washProb(c.d.model, h.id, "*", LEAD_BUCKETS[bi])) }));
  const st = hid === "gruppo" ? null : c.d.stats.get(hid);
  const ch = channelStats(c.d.list, s, hid);
  const sample = hid === "gruppo" ? 0 : washSampleSize(c.d.model, hid, 5);

  const chCols: Column<(typeof ch)[number]>[] = [
    { key: "ch", label: "Canale", value: (x) => x.channel },
    { key: "v", label: "Giudizio", value: (x) => x.verdict, render: (x) => (x.verdict ? `<span class="tag ${x.verdict === "migliore" ? "vendi" : "rischio"}">${x.verdict}</span>` : "") },
    { key: "r", label: "Camere", value: (x) => x.rooms, align: "right" },
    { key: "c", label: "Cancellazioni", value: (x) => Math.round(x.cancelPct * 1000) / 10, align: "right", render: (x) => pct(x.cancelPct, 1) },
    { key: "n", label: "No-show", value: (x) => Math.round(x.noshowPct * 1000) / 10, align: "right", render: (x) => pct(x.noshowPct, 1) },
    { key: "l", label: "Anticipo medio", value: (x) => Math.round(x.avgLead), align: "right", render: (x) => `${Math.round(x.avgLead)} gg` },
    { key: "p", label: "Netto per notte", value: (x) => Math.round(x.netPerNight), align: "right", render: (x) => eur(x.netPerNight) },
    { key: "s", label: "Resa affidabile", value: (x) => Math.round(x.score), align: "right", render: (x) => eur(x.score) },
  ];

  return `<section class="page">
    <div class="pagehead">${hotelSwitch(c, true)}</div>
    ${st ? `<div class="kpis wide">
      <div><span>Camere prenotate (storico)</span><b>${st.total}</b></div>
      <div><span>Cancellate</span><b>${pct(st.cancelPct, 1)}</b></div>
      <div><span>No-show</span><b>${pct(st.noshowPct, 1)}</b></div>
      <div><span>Anticipo medio</span><b>${Math.round(st.avgLead)} gg</b></div>
      <div><span>Soggiorno medio</span><b>${st.avgLos.toFixed(1).replace(".", ",")} notti</b></div>
      <div><span>ADR lordo 12 mesi</span><b>${eur(st.adr)}</b></div>
      <div><span>ADR netto commissioni</span><b>${eur(st.adrNet)}</b></div>
      <div><span>Cancellazioni in alta stagione</span>${s.events.length ? `<b>×${(c.d.model.seasonFactor.get(hid) ?? 1).toFixed(2).replace(".", ",")}</b><small>rispetto ai periodi normali</small>` : `<b>—</b><small>definisci i periodi nelle impostazioni</small>`}</div>
    </div>` : ""}
    <div class="cols2">
      <article><h3 class="sec">Probabilità che una camera in portafoglio non arrivi</h3>${washChart(series)}
      <p class="muted">Cancellazioni + no-show, per giorni mancanti all'arrivo. ${st && sample < 100 ? "Pochi dati a 30 giorni per questa casa: la curva è ancora appoggiata alla media del gruppo." : ""}</p></article>
      ${st ? `<article><h3 class="sec">Occupazione ultimi 12 mesi</h3>${monthBars(st.months)}</article>` : ""}
    </div>
    <h3 class="sec with-info">Canali: migliori e peggiori ${infoButton("channels", "A cosa serve questa tabella")}</h3>
    <p class="muted narrow">Classifica oggettiva: valore netto per notte corretto per cancellazioni e no-show. Pesa nella previsione dell'overbooking; nella scelta di chi spostare conta il valore netto della singola prenotazione.</p>
    ${renderTable({ id: "ch-" + hid, columns: chCols, rows: ch, exportName: `canali-${hid}`, empty: "Servono almeno 5 camere per canale." })}
  </section>`;
}

// ============================================================ IMPORT
export function viewImport(c: Ctx): string {
  const s = c.app.settings;
  const imp = c.ui.imp;
  const hist = c.app.meta.history;
  let step2 = "";
  if (imp.sheet) {
    const sh = imp.sheet;
    const miss = missingRequired(imp.mapping);
    const sample = sh.rows[0] ?? [];
    const opts = (cur: string | undefined): string => `<option value="">— non presente —</option>` + sh.headers.map((h) => `<option ${h === cur ? "selected" : ""}>${esc(h)}</option>`).join("");
    const rowsMap = FIELDS.filter((f) => !(f.field === "hotel" && imp.fixedHotel)).map((f) => {
      const cur = imp.mapping[f.field];
      const i = cur ? sh.headers.indexOf(cur) : -1;
      const ex = i >= 0 ? sample[i] : null;
      return `<tr class="${f.required && !cur ? "missing" : ""}"><td><b>${esc(f.label)}</b>${f.required ? ' <span class="req">obbligatorio</span>' : ""}<br><small class="muted">${esc(f.hint)}</small></td>
        <td><select data-map="${f.field}">${opts(cur)}</select></td><td><small>${esc(ex instanceof Date ? ex.toISOString().slice(0, 10) : ex ?? "")}</small></td></tr>`;
    }).join("");
    let preview = "";
    if (!miss.length) {
      const res = normalize({ ...sh, rows: sh.rows.slice(0, 300) }, imp.mapping, s.hotels, imp.fixedHotel || null);
      const full = normalize(sh, imp.mapping, s.hotels, imp.fixedHotel || null);
      preview = `<h3 class="sec">Anteprima</h3>
        <p><b>${full.records.length}</b> prenotazioni valide su ${sh.rows.length} righe${full.skipped ? `, ${full.skipped} scartate` : ""}.</p>
        ${warnBlock(full.warnings)}
        <div class="scroll"><table class="mini"><thead><tr><th>Casa</th><th>ID</th><th>Arrivo</th><th>Partenza</th><th>Stato</th><th>Canale</th><th>Tipologia</th><th>Totale</th><th>Tag</th></tr></thead><tbody>
        ${res.records.slice(0, 6).map((r) => `<tr><td>${esc(hotelName(s, r.hotelId))}</td><td><code>${esc(r.id)}</code></td><td>${fmtDate(r.arrival)}</td><td>${fmtDate(r.departure)}</td><td>${r.status}</td><td>${esc(r.channel)}</td><td>${esc(r.roomType)}</td><td>${eur(r.total)}</td><td>${esc(r.tags)}</td></tr>`).join("")}
        </tbody></table></div>
        <label class="check"><input type="checkbox" data-bind="impReplace" ${imp.replace ? "checked" : ""}> Sostituisci tutti i dati delle case presenti nel file (altrimenti aggiorna per ID)</label>
        <div class="row"><button class="btn gold" data-act="do-import" ${c.app.canWrite ? "" : "disabled"}>Importa ${full.records.length} prenotazioni</button><button class="btn ghost" data-act="imp-reset">Annulla</button></div>`;
    }
    step2 = `<article class="card">
      <h3>2. Colonne riconosciute in “${esc(sh.fileName)}”</h3>
      ${miss.length ? `<p class="warn">Mancano: ${miss.map((f) => esc(f.label)).join(", ")}. Scegli la colonna corrispondente.</p>` : `<p class="ok">Tutte le colonne obbligatorie sono collegate. La mappatura viene ricordata per i prossimi import.</p>`}
      <div class="scroll"><table class="mini map"><thead><tr><th>Dato</th><th>Colonna del file</th><th>Esempio</th></tr></thead><tbody>${rowsMap}</tbody></table></div>
      ${preview}
    </article>`;
  }

  return `<section class="page">
    <h2 class="lead">Importa le prenotazioni da Slope</h2>
    <div class="cols2">
      <article class="card">
        <h3>1. Scegli la casa e il file</h3>
        <label class="field">Casa del file
          <select data-bind="impHotel"><option value="">Il file contiene la colonna struttura</option>${s.hotels.map((h) => `<option value="${h.id}" ${imp.fixedHotel === h.id ? "selected" : ""}>${esc(h.name)}</option>`).join("")}</select></label>
        <label class="drop"><input type="file" accept=".xlsx,.xls,.csv" data-act="file"><span>Trascina qui l'export Excel o CSV di Slope, oppure tocca per sceglierlo</span></label>
        <div class="row tight"><button class="btn ghost sm" data-act="sample-xlsx">Scarica il file di esempio</button><span class="muted"><small>Dati inventati nel formato atteso, con la legenda delle colonne. Aprilo, confrontalo con l'export di Slope e, se vuoi, importalo così com'è per provare.</small></span></div>
      </article>
      <article class="card soft">
        <h3>Cosa esportare da Slope</h3>
        <p>L'elenco prenotazioni per data di arrivo, <b>cancellate e no-show compresi</b>: dagli ultimi 24 mesi fino a 12 mesi nel futuro. Il primo import carica lo storico; poi basta l'export di ogni mattina dal giorno prima in avanti, che aggiorna per ID senza duplicare.</p>
        <p class="muted">Colonne che servono: ID prenotazione, data prenotazione, arrivo, partenza, stato, data cancellazione, canale, tipologia camera, camera, n. camere, adulti, bambini, totale, intestatario, ID cliente, gruppo, tag, note, tariffa, pagamento. I nomi esatti delle colonne di Slope vengono riconosciuti in automatico: ti chiedo solo quelli che non trovo. Nazionalità, email e telefono non servono e non vengono letti.</p>
      </article>
    </div>
    ${step2}
    <h3 class="sec">Import eseguiti</h3>
    ${hist.length ? `<div class="scroll"><table class="mini"><thead><tr><th>Quando</th><th>File</th><th>Casa</th><th>Righe</th><th>Nuove</th><th>Aggiornate</th><th>Scartate</th></tr></thead><tbody>${hist
      .map((h) => `<tr><td>${fmtDate(h.at.slice(0, 10))} ${h.at.slice(11, 16)}</td><td>${esc(h.file)}</td><td>${esc(h.hotelId === "multi" ? "più case" : hotelName(s, h.hotelId))}</td><td>${h.rows}</td><td>${h.inserted}</td><td>${h.updated}</td><td>${h.skipped}</td></tr>`)
      .join("")}</tbody></table></div>` : `<p class="muted">Ancora nessun import.</p>`}
    <div class="row demo"><button class="btn ghost sm" data-act="demo-load">Carica dati dimostrativi</button><button class="btn gold sm" data-act="demo-scenario">Scenario di prova completo</button><button class="btn ghost sm" data-act="demo-clear">Elimina tutti i dati dimostrativi</button></div>
    <p class="muted narrow"><small>Lo scenario di prova aggiunge una settimana deliberatamente sovravenduta in tutte e tre le case, con gruppi, ospiti abituali, Expedia Collect, tag NO OVERBOOKING, non rimborsabili, doppie prenotazioni, una lista d'attesa e un registro esiti già compilato: serve per verificare tutta la catena in pochi minuti.</small></p>
  </section>`;
}

// ============================================================ IMPOSTAZIONI
function num(path: string, v: number | null, attrs = ""): string {
  return `<input type="number" data-path="${path}" data-type="num" value="${v ?? ""}" ${attrs}>`;
}
function txt(path: string, v: string, attrs = ""): string {
  return `<input type="text" data-path="${path}" data-type="text" value="${esc(v)}" ${attrs}>`;
}

export function viewSettings(c: Ctx): string {
  const s = c.ui.draft!;
  const channels = [...new Set([...Object.keys(s.channelCommission), ...c.d.list.map((r) => r.channel)])].sort();
  const hotels = s.hotels
    .map((h, hi) => `<article class="card">
      <div class="grid2">
        <label class="field">Nome ${txt(`hotels.${hi}.name`, h.name)}</label>
        <label class="field">Testo che la identifica nell'export ${txt(`hotels.${hi}.matchText`, h.matchText)}</label>
        <label class="field">Categoria (per riprotezione) ${num(`hotels.${hi}.category`, h.category, 'min="1" max="5"')}</label>
        <label class="field">Costo di un overbooking per camera (€) ${num(`hotels.${hi}.walkCost`, h.walkCost, 'min="0"')}</label>
        <label class="field">Tetto overbooking (% camere) ${num(`hotels.${hi}.maxOverbookPct`, h.maxOverbookPct, 'min="0" max="30"')}</label>
        <label class="field">ADR netto manuale (vuoto = dallo storico) ${num(`hotels.${hi}.adrOverride`, h.adrOverride, 'min="0"')}</label>
        <label class="check"><input type="checkbox" data-path="hotels.${hi}.adultsOnly" data-type="bool" ${h.adultsOnly ? "checked" : ""}> Solo adulti (niente riprotezione di famiglie con bambini)</label>
      </div>
      <div class="scroll"><table class="mini"><thead><tr><th>Codice in Slope</th><th>Nome</th><th>Camere</th><th>Max ospiti</th><th>Livello</th><th>Numeri camera (facoltativo)</th><th></th></tr></thead><tbody>
      ${h.roomTypes.map((t, ti) => `<tr><td>${txt(`hotels.${hi}.roomTypes.${ti}.code`, t.code)}</td><td>${txt(`hotels.${hi}.roomTypes.${ti}.label`, t.label)}</td><td>${num(`hotels.${hi}.roomTypes.${ti}.count`, t.count, 'min="0"')}</td><td>${num(`hotels.${hi}.roomTypes.${ti}.maxPax`, t.maxPax, 'min="1"')}</td><td>${num(`hotels.${hi}.roomTypes.${ti}.rank`, t.rank, 'min="1"')}</td><td><input type="text" data-path="hotels.${hi}.roomTypes.${ti}.rooms" data-type="list" value="${esc((t.rooms ?? []).join(", "))}" placeholder="101, 102, 103"></td><td><button class="btn ghost sm" data-act="rt-del" data-h="${hi}" data-t="${ti}" aria-label="Elimina tipologia">Elimina</button></td></tr>`).join("")}
      </tbody></table></div>
      <button class="btn ghost sm" data-act="rt-add" data-h="${hi}">Aggiungi tipologia</button>
      <p class="muted">Totale ${h.roomTypes.reduce((a, t) => a + (Number(t.count) || 0), 0)} camere. Il livello decide gli upgrade interni: si sale solo verso livelli più alti.</p>
    </article>`)
    .join("");

  const order = s.reprotectionOrder
    .map((id, i) => `<li><span>${i + 1}. ${esc(hotelName(s, id))}</span><button class="btn ghost sm" data-act="ord-up" data-i="${i}" ${i === 0 ? "disabled" : ""} aria-label="Sposta su">Su</button><button class="btn ghost sm" data-act="ord-down" data-i="${i}" ${i === s.reprotectionOrder.length - 1 ? "disabled" : ""} aria-label="Sposta giù">Giù</button></li>`)
    .join("");

  const events = s.events
    .map((e, i) => `<tr>
      <td>${txt(`events.${i}.name`, e.name)}</td>
      <td><select data-path="events.${i}.kind" data-type="text"><option value="altissima" ${e.kind === "altissima" ? "selected" : ""}>Altissima stagione</option><option value="evento" ${e.kind === "evento" ? "selected" : ""}>Manifestazione</option></select></td>
      <td><input type="date" data-path="events.${i}.from" data-type="text" value="${e.from}"></td>
      <td><input type="date" data-path="events.${i}.to" data-type="text" value="${e.to}"></td>
      <td>${s.hotels.map((h) => `<label class="check sm"><input type="checkbox" data-evhotel="${i}" value="${h.id}" ${!e.hotels.length || e.hotels.includes(h.id) ? "checked" : ""}>${esc(h.name.split(" ").pop())}</label>`).join("")}</td>
      <td>${num(`events.${i}.washMultiplier`, e.washMultiplier, 'step="0.05" min="0" placeholder="auto"')}</td>
      <td>${num(`events.${i}.maxOverbookPct`, e.maxOverbookPct, 'min="0" max="30" placeholder="casa"')}</td>
      <td><input type="checkbox" data-path="events.${i}.recurringYearly" data-type="bool" ${e.recurringYearly ? "checked" : ""} aria-label="Ogni anno"></td>
      <td><button class="btn ghost sm" data-act="ev-del" data-i="${i}">Elimina</button></td></tr>`)
    .join("");

  const ooRows = s.rules.outOfOrder.length
    ? s.rules.outOfOrder.map((o, i) => `<tr>
      <td><select data-path="rules.outOfOrder.${i}.hotelId" data-type="text">${s.hotels.map((h) => `<option value="${h.id}" ${o.hotelId === h.id ? "selected" : ""}>${esc(h.name)}</option>`).join("")}</select></td>
      <td>${txt(`rules.outOfOrder.${i}.room`, o.room)}</td>
      <td><input type="date" data-path="rules.outOfOrder.${i}.from" data-type="text" value="${o.from}"></td>
      <td><input type="date" data-path="rules.outOfOrder.${i}.to" data-type="text" value="${o.to}"></td>
      <td>${txt(`rules.outOfOrder.${i}.motivo`, o.motivo)}</td>
      <td><button class="btn ghost sm" data-act="oo-del" data-i="${i}">Elimina</button></td></tr>`).join("")
    : `<tr><td colspan="6" class="muted">Nessuna camera fuori servizio.</td></tr>`;

  const w = s.weights;
  const slider = (k: keyof typeof w, label: string, help: string): string =>
    `<label class="field">${label} <b>${w[k]}</b><input type="range" min="0" max="100" data-path="weights.${k}" data-type="num" value="${w[k]}"><small class="muted">${help}</small></label>`;

  return `<section class="page settings">
    <h2 class="lead">Impostazioni</h2>
    <h3 class="sec">Le tre case</h3>${hotels}
    <h3 class="sec">Soglie di rischio</h3>
    <article class="card"><div class="grid2">
      <label class="field">Rischio massimo di dover spostare almeno un ospite (%) ${num("riskMaxPct", s.riskMaxPct, 'min="1" max="40"')}</label>
      <label class="field">Nessun nuovo overbooking entro (giorni dall'arrivo) ${num("freezeDays", s.freezeDays, 'min="0" max="14"')}</label>
      <label class="field">Cancellazioni previste se lo storico manca (%) ${num("defaultWashPct", s.defaultWashPct, 'min="0" max="60"')}</label>
      <label class="field">Orizzonte della guida (giorni) ${num("horizonDays", s.horizonDays, 'min="30" max="365"')}</label>
    </div></article>
    <h3 class="sec">Prenotazioni fisse</h3>
    <article class="card"><div class="grid2">
      <label class="field">Tag Slope che rendono intoccabile una prenotazione ${txt("rules.fixedTag", s.rules.fixedTag)}<small class="muted">Più tag separati da virgola. Da scrivere nel campo tag o nelle note della prenotazione in Slope: quella prenotazione non viene mai spostata, né di casa, né di tipologia, né di camera.</small></label>
      <label class="field">Gruppo da (camere nella stessa prenotazione o gruppo) ${num("rules.groupMinRooms", s.rules.groupMinRooms, 'min="2"')}</label>
      <label class="field">Parole che indicano un gruppo (canale, tariffa, tag) ${txt("rules.groupChannelWords", s.rules.groupChannelWords)}</label>
      <label class="field">Ospite abituale da (soggiorni già fatti) ${num("rules.repeaterMinStays", s.rules.repeaterMinStays, 'min="1"')}</label>
      <label class="field">Parole che indicano Expedia Collect (pagamento o tariffa) ${txt("rules.expediaCollectWords", s.rules.expediaCollectWords)}<small class="muted">Vuoto = tutte le prenotazioni Expedia sono fisse. Le prenotazioni «Hotel Collect», in cui incassiamo noi, restano sempre escluse.</small></label>
      <label class="check"><input type="checkbox" data-path="rules.protectNonRefundable" data-type="bool" ${s.rules.protectNonRefundable ? "checked" : ""}> Le non rimborsabili sono intoccabili<small class="muted"> — l'ospite ha già pagato: niente overbooking, né cambio casa, tipologia o camera. Togli la spunta solo se vuoi poterle spostare.</small></label>
    </div></article>
    <h3 class="sec with-info">Chi si sposta per primo ${infoButton("pesi", "Come si leggono e si tarano i pesi")}</h3>
    <article class="card"><div class="grid2">
      ${slider("value", "Valore netto della prenotazione", "Più alto il peso, prima si spostano le prenotazioni che rendono meno al netto delle commissioni.")}
      ${slider("fit", "Principio tetris", "Preferisce spostare chi occupa solo le notti in conflitto, così non restano buchi.")}
      ${slider("early", "Data di prenotazione", "Chi ha prenotato prima resta.")}
      ${slider("prepaid", "Prepagata / non rimborsabile", "Evita di spostare chi ha già pagato.")}
      ${slider("speculative", "Doppie prenotazioni", "Chi tiene aperte più prenotazioni che non può usare tutte esce per primo: quelle camere si libereranno comunque.")}
      ${slider("cancellabile", "Annullabile con motivo valido", "Garanzia non valida o caparra scaduta: la camera si libera senza costi, quindi viene usata prima delle altre.")}
      <label class="field">Due periodi entro quanti giorni sono una doppia prenotazione ${num("rules.speculativeWindowDays", s.rules.speculativeWindowDays, 'min="7" max="365"')}</label>
    </div><p class="muted">La nazionalità non è tra i criteri: scegliere chi spostare in base alla nazionalità è una discriminazione vietata. Il valore netto e l'affidabilità del canale misurano direttamente quello che conta.</p></article>
    <h3 class="sec with-info">Cancellazione per motivo valido ${infoButton("cancellazioni", "Quando una cancellazione è legittima")}</h3>
    <article class="card"><div class="grid2">
      <label class="field">Parole che indicano una garanzia non valida ${txt("rules.cancellation.noGuaranteeWords", s.rules.cancellation.noGuaranteeWords)}<small class="muted">Come appaiono nel campo pagamento o stato pagamento di Slope. Più parole separate da virgola.</small></label>
      <label class="field">Parole che indicano una caparra non pagata ${txt("rules.cancellation.unpaidWords", s.rules.cancellation.unpaidWords)}<small class="muted">Valgono solo dopo la scadenza della caparra.</small></label>
      <label class="field">Parole che indicano che risulta pagata ${txt("rules.cancellation.paidWords", s.rules.cancellation.paidWords)}<small class="muted">Hanno la precedenza su tutte le altre: se compaiono, la prenotazione non entra mai in lista.</small></label>
      <label class="field">Caparra attesa entro (giorni dalla prenotazione) ${num("rules.cancellation.depositDays", s.rules.cancellation.depositDays, 'min="0" max="60"')}<small class="muted">Usato solo quando Slope non porta una scadenza sua.</small></label>
      <label class="field">Preavviso all'ospite prima di annullare (giorni) ${num("rules.cancellation.preavvisoGiorni", s.rules.cancellation.preavvisoGiorni, 'min="1" max="14"')}<small class="muted">Si manda prima un sollecito; l'annullamento solo dopo questa scadenza, e mai oltre il giorno prima dell'arrivo.</small></label>
    </div><p class="muted">La piattaforma propone una cancellazione soltanto quando uno di questi fatti risulta dai dati. Le prenotazioni protette compaiono in lista segnalate, ma non vengono mai annullate dal piano.</p></article>
    <h3 class="sec">Camere fuori servizio</h3>
    <article class="card"><div class="scroll"><table class="mini"><thead><tr><th>Casa</th><th>Camera</th><th>Dal</th><th>Al</th><th>Motivo</th><th></th></tr></thead><tbody>${ooRows}</tbody></table></div>
    <button class="btn ghost sm" data-act="oo-add">Aggiungi camera fuori servizio</button>
    <p class="muted">Lo dichiara la direzione: la piattaforma non deduce da sé che una camera è inagibile. Gli ospiti assegnati a quella camera in quelle notti ricevono la proposta di un'alternativa o il rimborso, anche se hanno già pagato.</p></article>
    <h3 class="sec">Ordine di riprotezione tra le case</h3>
    <article class="card"><ol class="order">${order}</ol><p class="muted">Si prova sempre prima la stessa casa, poi le altre in quest'ordine, prima quelle di categoria pari o superiore.</p></article>
    <h3 class="sec">Altissima stagione e manifestazioni</h3>
    <article class="card"><div class="scroll"><table class="mini"><thead><tr><th>Nome</th><th>Tipo</th><th>Dal</th><th>Al</th><th>Case</th><th>Moltiplicatore cancellazioni</th><th>Tetto % dedicato</th><th>Ogni anno</th><th></th></tr></thead><tbody>${events || `<tr><td colspan="9" class="muted">Nessun periodo. Aggiungi ad esempio Natale-Epifania, la Coppa del Mondo in Val Gardena, Ferragosto.</td></tr>`}</tbody></table></div>
    <button class="btn ghost sm" data-act="ev-add">Aggiungi periodo</button>
    <p class="muted">Moltiplicatore vuoto = calcolato dallo storico di quella casa (in alta stagione di solito si cancella meno: valori sotto 1).</p></article>
    <h3 class="sec">Email agli ospiti</h3>
    <article class="card"><label class="field">Firma delle email (vuoto = «Il team di ricevimento» e il nome della casa)<textarea data-path="mailSignature" data-type="text" rows="4" placeholder="Il team di ricevimento&#10;Smart Hotel Saslong – AlpStay Hotels&#10;Telefono · email">${esc(s.mailSignature ?? "")}</textarea></label></article>
    <h3 class="sec">Commissioni per canale (%)</h3>
    <article class="card"><div class="grid4">${channels.map((ch) => `<label class="field">${esc(ch)}<input type="number" min="0" max="40" step="0.5" data-comm="${esc(ch)}" value="${s.channelCommission[ch] ?? 0}"></label>`).join("")}</div></article>
    ${IMPORT_ATTIVO ? "" : demoBlock(c)}
    <div class="savebar"><button class="btn gold" data-act="settings-save" ${c.app.canWrite ? "" : "disabled"}>Salva impostazioni</button><button class="btn ghost" data-act="settings-discard">Annulla modifiche</button><span class="grow"></span><button class="btn ghost sm" data-act="settings-reset">Ripristina valori iniziali</button></div>
  </section>`;
}

/** Firma del creatore, a piè di pagina. */
export function appFooter(): string {
  return `<footer class="mpfoot">
    <span class="mp-holo" role="img" aria-label="Logo MP-Alpstay">
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <defs>
          <linearGradient id="mpg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#1fae90"/><stop offset="25%" stop-color="#3a86d6"/>
            <stop offset="50%" stop-color="#8b56cf"/><stop offset="75%" stop-color="#d4853c"/>
            <stop offset="100%" stop-color="#1fae90"/>
          </linearGradient>
        </defs>
        <path d="M22 2.5 39.5 12v20L22 41.5 4.5 32V12z" fill="none" stroke="url(#mpg)" stroke-width="1.6"/>
        <text x="22" y="27.5" text-anchor="middle">MP</text>
      </svg>
    </span>
    <span class="mp-txt">© MP-Alpstay 09/2026</span>
  </footer>`;
}

/** Avvisi in forma compatta: i primi due in chiaro, gli altri raccolti. */
export function warnBlock(list: string[], demo = false): string {
  if (!list.length) return "";
  const riga = (w: string): string => `<li>${esc(w)}</li>`;
  const testa = list.slice(0, 2), coda = list.slice(2);
  return `<div class="warns${demo ? " demo" : ""}">
    ${demo ? `<p class="wd">Stai lavorando sui dati dimostrativi: questi avvisi riguardano dati inventati.</p>` : ""}
    <ul>${testa.map(riga).join("")}</ul>
    ${coda.length ? `<details><summary>Altri ${coda.length} ${coda.length === 1 ? "avviso" : "avvisi"}</summary><ul>${coda.map(riga).join("")}</ul></details>` : ""}
  </div>`;
}

export function busyOverlay(msg: string | null): string {
  return msg ? `<div class="busy" role="status"><div>${esc(msg)}</div></div>` : "";
}

export { addDays };

// ============================================================ CAMERE: spostamenti e notti isolate
const ROOM_KIND: Record<string, string> = { cambio: "Cambio camera", upgrade: "Cambio tipologia", entrata: "Da altra casa", assegna: "Assegna camera" };

function orphanHint(o: OrphanGap): string {
  const n = o.nights === 1 ? "1 notte" : `${o.nights} notti`;
  return `Proponi a ${o.before.guest || o.before.id} di prolungare di ${n} o a ${o.after.guest || o.after.id} di anticipare l'arrivo; altrimenti vendi la camera ${o.room} per ${n} dal ${fmtDate(o.firstNight)}.`;
}

function roomSections(c: Ctx, r: SolveResult): string {
  const s = c.app.settings;
  const hn = (id: HotelId): string => hotelName(s, id);
  const totAfter = Object.values(r.orphanNights).reduce((a, b) => a + b, 0);
  const slopeVals = Object.values(r.orphanNightsSlope);
  const totSlope = slopeVals.some((v) => v === null) ? null : slopeVals.reduce((a: number, b) => a + (b ?? 0), 0);

  const mcols: Column<RoomMove>[] = [
    { key: "arr", label: "Arrivo", value: (m) => m.res.arrival, render: (m) => `<b>${fmtDate(m.res.arrival, true)}</b>` },
    { key: "kind", label: "Tipo", value: (m) => ROOM_KIND[m.kind], filter: true, render: (m) => `<span class="tag rm-${m.kind}">${ROOM_KIND[m.kind]}</span>` },
    { key: "hotel", label: "Casa", value: (m) => hn(m.hotelId), filter: true },
    { key: "guest", label: "Ospite", value: (m) => m.res.guest, render: (m) => `<button class="linkbtn" data-act="detail" data-v="${esc(resKey(m.res))}">${esc(m.res.guest || m.res.id)}</button>` },
    { key: "id", label: "ID Slope", value: (m) => m.res.id, render: (m) => `<code>${esc(m.res.id)}</code>` },
    { key: "per", label: "Soggiorno", value: (m) => `${m.res.arrival} ${m.res.departure}`, render: (m) => `${fmtDate(m.res.arrival)} → ${fmtDate(m.res.departure)}` },
    { key: "from", label: "Da camera", value: (m) => (m.fromHotel !== m.hotelId ? `${hn(m.fromHotel)} ${m.fromRoom ?? ""}` : m.fromRoom ?? "—"), render: (m) => `<span class="room from">${esc(m.fromRoom ?? "—")}</span>${m.fromHotel !== m.hotelId ? `<small class="muted"> ${esc(hn(m.fromHotel))}</small>` : ""}` },
    { key: "to", label: "A camera", value: (m) => m.toRoom, render: (m) => `<span class="room to">${esc(m.toRoom)}</span>` },
    { key: "why", label: "Perché", value: (m) => m.reason, render: (m) => `<small>${esc(m.reason)}</small>` },
  ];
  const ocols: Column<OrphanGap>[] = [
    { key: "night", label: "Notti", value: (o) => o.firstNight, render: (o) => `<b>${fmtDate(o.firstNight, true)}</b>${o.nights > 1 ? ` – ${fmtDate(addDays(o.firstNight, o.nights - 1), true)}` : ""}` },
    { key: "n", label: "N.", value: (o) => o.nights, align: "right" },
    { key: "hotel", label: "Casa", value: (o) => hn(o.hotelId), filter: true },
    { key: "room", label: "Camera", value: (o) => o.room, render: (o) => `<span class="room">${esc(o.room)}</span>` },
    { key: "bef", label: "Parte", value: (o) => o.before.guest, render: (o) => `${esc(o.before.guest || o.before.id)} <small class="muted">${fmtDate(o.before.departure)}</small>` },
    { key: "aft", label: "Arriva", value: (o) => o.after.guest, render: (o) => `${esc(o.after.guest || o.after.id)} <small class="muted">${fmtDate(o.after.arrival)}</small>` },
    { key: "hint", label: "Come recuperarle", value: (o) => orphanHint(o), render: (o) => `<small>${esc(orphanHint(o))}</small>` },
  ];
  const cambi = r.roomMoves.filter((m) => m.kind === "cambio").length;
  return `
    <h3 class="sec with-info">Spostamenti di camera ${infoButton("rooms", "Come leggere gli spostamenti di camera")}</h3>
    <p class="lead-sm">${totSlope !== null ? `Con l'assegnazione attuale di Slope ci sono <b>${totSlope}</b> notti isolate; dopo il piano ne restano <b>${totAfter}</b>.` : `Dopo il piano restano <b>${totAfter}</b> notti isolate.`} ${cambi ? `Servono <b>${cambi}</b> cambi di camera nella stessa tipologia.` : "Nessun cambio di camera nella stessa tipologia."}</p>
    ${renderTable({ id: "roommoves", columns: mcols, rows: r.roomMoves, exportName: `spostamenti-camera-${r.from}`, empty: "Nessuno spostamento: tutte le prenotazioni restano nella camera di Slope.", pageSize: 30 })}
    <h3 class="sec">Notti isolate rimaste</h3>
    ${renderTable({ id: "orphans", columns: ocols, rows: r.orphans, exportName: `notti-isolate-${r.from}`, empty: "Nessuna notte isolata nel periodo.", pageSize: 30 })}`;
}

// ============================================================ DOPPIE PRENOTAZIONI ("furbetti")
/** Una prenotazione già messa in lista d'attesa è stata gestita: sparisce dalle segnalazioni. */
function giaGestita(c: Ctx, f: SpecFlag): boolean {
  return c.app.waitlist.some((w) => w.slopeId === f.res.id && w.status !== "rinuncia");
}

function specRelevant(c: Ctx): { aperte: SpecFlag[]; gestite: number } {
  const all = [...c.d.spec.byRes.values()];
  const f = c.ui.hotel === "gruppo" ? all : all.filter((x) => x.res.hotelId === c.ui.hotel || x.others.some((o) => o.hotelId === c.ui.hotel));
  const gestite = f.filter((x) => giaGestita(c, x)).length;
  const aperte = f.filter((x) => !giaGestita(c, x))
    .sort((a, b) => (a.level === b.level ? a.res.arrival.localeCompare(b.res.arrival) : a.level === "alta" ? -1 : 1));
  return { aperte, gestite };
}

export function specBanner(c: Ctx): string {
  const { aperte: flags } = specRelevant(c);
  if (!flags.length) return "";
  const alte = flags.filter((f) => f.level === "alta").length;
  const ospiti = new Set(flags.map((f) => guestKey(f.res) ?? f.res.guest)).size;
  const camere = flags.reduce((a, f) => a + f.res.rooms, 0);
  const prossima = flags[0];
  return `<section class="alert-spec ${alte ? "alta" : "media"}" role="alert">
    <div class="as-badge" aria-hidden="true">!</div>
    <div class="as-body">
      <h2>${ospiti === 1 ? "1 ospite tiene" : `${ospiti} ospiti tengono`} aperte più prenotazioni: ${camere} ${camere === 1 ? "camera a rischio" : "camere a rischio"}</h2>
      <p>${alte ? `${alte === 1 ? "Una prenotazione è" : `${alte} prenotazioni sono`} a rischio alto: lo stesso ospite ha le stesse notti in un'altra casa o cancellazioni già fatte in passato. ` : ""}Sono le prime da mettere in overbooking: quelle camere si libereranno quasi certamente. La prima in ordine di arrivo è ${esc(prossima.res.guest || prossima.res.id)}, ${fmtDate(prossima.res.arrival, true)}.</p>
    </div>
    <a class="btn gold" href="#doppie">Vedi l'elenco</a>
  </section>`;
}

export function specSection(c: Ctx): string {
  const { aperte: flags, gestite } = specRelevant(c);
  const s = c.app.settings;
  const coda = gestite ? `<p class="muted narrow">${gestite === 1 ? "1 prenotazione è già stata messa" : `${gestite} prenotazioni sono già state messe`} in lista d'attesa e ${gestite === 1 ? "non compare" : "non compaiono"} più qui. <button class="linkbtn" data-act="tab" data-v="attesa">Vai alla lista d'attesa</button></p>` : "";
  if (!flags.length) return `<h3 class="sec with-info" id="doppie">Doppie prenotazioni ${infoButton("spec", "Come funziona il controllo")}</h3><p class="muted narrow">Nessuna segnalazione aperta. Il controllo confronta ID cliente e nominativo su tutte e tre le case a ogni import.</p>${coda}`;
  const cols: Column<SpecFlag>[] = [
    { key: "lev", label: "Rischio", value: (f) => f.level, filter: true, render: (f) => `<span class="tag ${f.level === "alta" ? "rischio" : "pieno"}">${f.level}</span>` },
    { key: "act", label: "Indesiderata", value: () => "", render: (f) => c.app.canWrite
      ? `<button class="btn gold sm" data-act="wait-from-res" data-v="${esc(resKey(f.res))}" data-t="richiesta" title="Toglila dalle segnalazioni e mettila in lista d'attesa">In lista d'attesa</button>`
      : "" },
    { key: "guest", label: "Ospite", value: (f) => f.res.guest, render: (f) => `<button class="linkbtn" data-act="detail" data-v="${esc(resKey(f.res))}">${esc(f.res.guest || f.res.id)}</button>` },
    { key: "hotel", label: "Casa", value: (f) => hotelName(s, f.res.hotelId), filter: true },
    { key: "id", label: "ID Slope", value: (f) => f.res.id, render: (f) => `<code>${esc(f.res.id)}</code>` },
    { key: "arr", label: "Soggiorno", value: (f) => f.res.arrival, render: (f) => `${fmtDate(f.res.arrival, true)} → ${fmtDate(f.res.departure, true)}` },
    { key: "rooms", label: "Cam.", value: (f) => f.res.rooms, align: "right" },
    { key: "ch", label: "Canale", value: (f) => f.res.channel, filter: true },
    { key: "net", label: "Valore netto", value: (f) => Math.round(netValue(s, f.res)), align: "right", render: (f) => eur(netValue(s, f.res)) },
    { key: "kind", label: "Segnale", value: (f) => SPEC_KIND_LABEL[f.kind], filter: true },
    { key: "canc", label: "Cancellaz. passate", value: (f) => f.pastCancels, align: "right" },
    { key: "altre", label: "Le altre prenotazioni", value: (f) => f.others.map((o) => `${hotelName(s, o.hotelId)} ${o.arrival} (${o.id})`).join(" | "),
      render: (f) => f.others.map((o) => `<span class="chip">${esc(hotelName(s, o.hotelId))} ${fmtDate(o.arrival)}→${fmtDate(o.departure)} <code>${esc(o.id)}</code></span>`).join(" ") },
    { key: "fisso", label: "Protetta", value: (f) => c.d.protector.reasons(f.res).map((x) => REASON_LABEL[x]).join(", ") || "no",
      render: (f) => { const r = c.d.protector.reasons(f.res); return r.length ? r.map((x) => `<span class="chip p">${REASON_LABEL[x]}</span>`).join(" ") : "<span class=\"muted\">no</span>"; } },
  ];
  return `<h3 class="sec with-info" id="doppie">Doppie prenotazioni ${infoButton("spec", "Come funziona il controllo")}</h3>
    <p class="muted narrow">Queste prenotazioni scendono in fondo al punteggio di permanenza: nel Problem solving sono le prime a finire in overbooking. Con «Metti in lista d'attesa» le togli da qui: la camera torna vendibile e l'ospite resta in coda, pronto a essere richiamato se si libera. Le prenotazioni protette restano protette anche se segnalate: il peso lo regoli in Impostazioni → Chi si sposta per primo.</p>
    ${renderTable({ id: "spec-" + c.ui.hotel, columns: cols, rows: flags, exportName: `doppie-prenotazioni-${todayISO()}`, empty: "Nessuna segnalazione.", pageSize: 25, rowClass: (f) => (f.level === "alta" ? "specalta" : "") })}
    ${coda}`;
}

/** Avviso: dati salvati da un import vecchio con la colonna camere sbagliata. */
export function fixedRoomsNotice(c: Ctx): string {
  const n = c.ui.roomsFixed;
  if (!n) return "";
  return `<div class="notice"><b>Dati corretti all'apertura.</b> ${n === 1 ? "Una prenotazione salvata aveva" : `${n} prenotazioni salvate avevano`} un numero di camere impossibile — quasi sempre perché in un import precedente la colonna «Numero camere» era collegata alla colonna sbagliata. ${n === 1 ? "È stata riportata" : "Sono state riportate"} a 1 camera, quindi le camere oltre soglia che vedevi (numeri nell'ordine delle centinaia o migliaia) ora tornano realistiche. Al prossimo import controlla che quella colonna sia collegata bene. <button class="linkbtn" data-act="fixed-ok">Ho capito</button></div>`;
}

/** Le prenotazioni in lista d'attesa occupano ancora la camera finché non le annulli in Slope. */
function waitNotice(c: Ctx, r: SolveResult): string {
  const ids = new Set(c.app.waitlist.filter((w) => w.slopeId && w.status !== "rinuncia").map((w) => w.slopeId as string));
  if (!ids.size) return "";
  const fine = addDays(r.from, r.days.length);
  const uniche = new Map(c.d.list
    .filter((x) => ids.has(x.id) && isActive(x) && x.arrival < fine && r.from < x.departure)
    .map((x) => [x.id, x]));
  if (!uniche.size) return "";
  const n = uniche.size;
  const camere = [...uniche.values()].reduce((a, x) => a + x.rooms, 0);
  return `<div class="notice"><b>${n === 1 ? "Una prenotazione in lista d'attesa" : `${n} prenotazioni in lista d'attesa`}</b> ${n === 1 ? "compare" : "compaiono"} ancora sul tabellone, a righe blu: ${camere === 1 ? "quella camera è" : `quelle ${camere} camere sono`} ancora ${camere === 1 ? "occupata" : "occupate"} perché ${n === 1 ? "la prenotazione è" : "le prenotazioni sono"} ancora ${n === 1 ? "attiva" : "attive"} in Slope. Annulla${n === 1 ? "la" : "le"} in Slope e reimporta: solo allora ${camere === 1 ? "la camera torna vendibile" : "le camere tornano vendibili"}. <button class="linkbtn" data-act="tab" data-v="attesa">Vai alla lista d'attesa</button></div>`;
}

// ============================================================ CANCELLAZIONI PER MOTIVO VALIDO
export function cancelSection(c: Ctx): string {
  const s = c.app.settings;
  const lista = c.d.canc.lista;
  if (!lista.length) {
    return `<h3 class="sec with-info" id="cancellabili">Cancellazioni per motivo valido ${infoButton("cancellazioni", "Quando una cancellazione è legittima")}</h3>
      <p class="muted narrow">Nessuna prenotazione ha oggi un motivo documentato di cancellazione. La piattaforma le riconosce solo dai dati: garanzia non valida o caparra non pagata nell'export di Slope, oppure camera dichiarata fuori servizio nelle impostazioni.</p>
      <p class="mailread"><b>I testi delle email</b> li puoi leggere e modificare anche senza una prenotazione collegata: <button class="linkbtn" data-act="mail-res" data-v="" data-t="garanzia-sollecito">carta non valida: sollecito</button> · <button class="linkbtn" data-act="mail-res" data-v="" data-t="garanzia-annullo">carta non valida: annullamento</button> · <button class="linkbtn" data-act="mail-res" data-v="" data-t="caparra-sollecito">caparra scaduta: sollecito</button> · <button class="linkbtn" data-act="mail-res" data-v="" data-t="caparra-annullo">caparra scaduta: annullamento</button> · <button class="linkbtn" data-act="mail-res" data-v="" data-t="tecnico-camera">camera inagibile</button>. Nel pannello che si apre puoi cambiare modello e lingua con i due menu in alto.</p>`;
  }
  const auto = lista.filter((x) => !x.protetta).length;
  const cols: Column<CancelCase>[] = [
    { key: "g", label: "Motivo", value: (x) => GROUND_LABEL[x.ground], filter: true, render: (x) => `<span class="tag ${x.ground === "camera-inagibile" ? "pieno" : "rischio"}">${GROUND_LABEL[x.ground]}</span>` },
    { key: "act", label: "Email", value: () => "", render: (x) => x.ground === "camera-inagibile"
      ? `<button class="btn gold sm" data-act="mail-res" data-v="${esc(resKey(x.res))}" data-t="tecnico-camera">Email: alternativa o rimborso</button>`
      : `<div class="row tight"><button class="btn gold sm" data-act="mail-res" data-v="${esc(resKey(x.res))}" data-t="${x.ground === "mancato-pagamento" ? "caparra-sollecito" : "garanzia-sollecito"}">1. Sollecito</button><button class="btn ghost sm" data-act="mail-res" data-v="${esc(resKey(x.res))}" data-t="${x.ground === "mancato-pagamento" ? "caparra-annullo" : "garanzia-annullo"}">2. Annullamento</button></div>` },
    { key: "hotel", label: "Casa", value: (x) => hotelName(s, x.res.hotelId), filter: true },
    { key: "guest", label: "Ospite", value: (x) => x.res.guest, render: (x) => `<button class="linkbtn" data-act="detail" data-v="${esc(resKey(x.res))}">${esc(x.res.guest || x.res.id)}</button>` },
    { key: "id", label: "ID Slope", value: (x) => x.res.id, render: (x) => `<code>${esc(x.res.id)}</code>` },
    { key: "arr", label: "Soggiorno", value: (x) => x.res.arrival, render: (x) => `${fmtDate(x.res.arrival, true)} → ${fmtDate(x.res.departure, true)}` },
    { key: "cam", label: "Cam.", value: (x) => x.res.rooms, align: "right" },
    { key: "net", label: "Valore netto", value: (x) => Math.round(netValue(s, x.res)), align: "right", render: (x) => eur(netValue(s, x.res)) },
    { key: "prova", label: "La prova", value: (x) => x.prova, render: (x) => `<small>${esc(x.prova)}</small>` },
    { key: "entro", label: "Rispondere entro", value: (x) => (x.ground === "camera-inagibile" ? "" : scadenzaRisposta(x)), render: (x) => (x.ground === "camera-inagibile" ? "—" : fmtDate(scadenzaRisposta(x), true)) },
    { key: "p", label: "Protetta", value: (x) => (x.protetta ? "sì" : ""), render: (x) => (x.protetta ? `<span class="chip p">decisione manuale</span>` : "") },
  ];
  return `<h3 class="sec with-info" id="cancellabili">Cancellazioni per motivo valido ${infoButton("cancellazioni", "Quando una cancellazione è legittima")}</h3>
    <p class="muted narrow">${lista.length === 1 ? "Una prenotazione ha" : `${lista.length} prenotazioni hanno`} un motivo documentato di cancellazione${auto ? `, di cui ${auto} ${auto === 1 ? "usata" : "usate"} dal piano prima di disturbare chi è in regola` : ""}. Manda sempre prima il sollecito: si annulla solo se non arriva risposta entro la data indicata. Le prenotazioni protette non vengono mai annullate dal piano: decide una persona.</p>
    ${renderTable({ id: "canc", columns: cols, rows: lista, exportName: `cancellabili-${todayISO()}`, empty: "Nessuna.", pageSize: 20, rowClass: (x) => (x.protetta ? "" : "specalta") })}
    <p class="mailread"><b>I testi delle email</b> li puoi leggere e modificare anche senza una prenotazione collegata: <button class="linkbtn" data-act="mail-res" data-v="" data-t="garanzia-sollecito">carta non valida: sollecito</button> · <button class="linkbtn" data-act="mail-res" data-v="" data-t="garanzia-annullo">carta non valida: annullamento</button> · <button class="linkbtn" data-act="mail-res" data-v="" data-t="caparra-sollecito">caparra scaduta: sollecito</button> · <button class="linkbtn" data-act="mail-res" data-v="" data-t="caparra-annullo">caparra scaduta: annullamento</button> · <button class="linkbtn" data-act="mail-res" data-v="" data-t="tecnico-camera">camera inagibile</button>. Nel pannello che si apre puoi cambiare modello e lingua con i due menu in alto.</p>`;
}
