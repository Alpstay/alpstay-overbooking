// Tabellone di lavoro in stile planning Slope:
// una riga per camera, barre a freccia da metà giornata (arrivo) a metà giornata (partenza).
import type { GridBooking, GridRoom, Hotel, HotelId, MoveDecision, ProtectionReason, Reservation, SolveResult } from "./types";
import type { Ctx } from "./views";
import { REASON_LABEL } from "./protect";
import { mailButtons, waitButton, caseButton } from "./dayplan";
import { resKey } from "./importer";
import { netValue } from "./analytics";
import { diffDays, esc, eur, fmtDate, MO, nights, todayISO, weekday, tagList } from "./util";
import type { MailTemplate } from "./emails";
import { TEMPLATE_LABEL } from "./emails";
import { GROUND_LABEL } from "./cancellable";

export const DAY_W = 78; // px per notte

type BarKind = "normale" | "fissa" | "casa" | "opzione" | "attesa" | "upgrade" | "entrata" | "walk";

export const BAR_LABEL: Record<BarKind, string> = {
  normale: "Confermata",
  fissa: "Fissa",
  casa: "In casa",
  opzione: "Opzione",
  attesa: "In lista d'attesa",
  upgrade: "Upgrade / cambio",
  entrata: "Riprotetta da altra casa",
  walk: "Overbooking",
};

// Icone bianche come nel planning Slope
const I = {
  euro: `<svg viewBox="0 0 12 12"><path d="M8.6 3.2A3.2 3.2 0 0 0 3.6 4.6M3.6 7.4a3.2 3.2 0 0 0 5 1.4M2 5.3h4.6M2 6.8h4.6" /></svg>`,
  lock: `<svg viewBox="0 0 12 12"><rect x="2.5" y="5.2" width="7" height="5" rx="1" class="f"/><path d="M4 5.2V3.8a2 2 0 0 1 4 0v1.4"/></svg>`,
  group: `<svg viewBox="0 0 12 12"><circle cx="4.3" cy="4" r="1.6" class="f"/><circle cx="8.2" cy="4.4" r="1.3" class="f"/><path d="M1.6 10a2.7 2.7 0 0 1 5.4 0M6.6 9.6a2.2 2.2 0 0 1 4-.4" /></svg>`,
  star: `<svg viewBox="0 0 12 12"><path class="f" d="M6 1.4l1.4 2.9 3.1.4-2.3 2.2.6 3.1L6 8.5 3.2 10l.6-3.1L1.5 4.7l3.1-.4z"/></svg>`,
  in: `<svg viewBox="0 0 12 12"><path d="M1.5 6h6M5.5 3.5L8 6 5.5 8.5M10 2v8"/></svg>`,
  swap: `<svg viewBox="0 0 12 12"><path d="M2 4h7.5M7.5 2L9.5 4 7.5 6M10 8H2.5M4.5 6L2.5 8l2 2"/></svg>`,
  up: `<svg viewBox="0 0 12 12"><path d="M6 10V2.5M3 5.3L6 2.3l3 3"/></svg>`,
  out: `<svg viewBox="0 0 12 12"><path d="M4.5 6h6M8.5 3.5L11 6 8.5 8.5M5 2H1.5v8H5"/></svg>`,
  ec: `<svg viewBox="0 0 12 12"><text x="6" y="8.6" text-anchor="middle" class="t">EC</text></svg>`,
  wait: `<svg viewBox="0 0 12 12"><path d="M3.3 1.8h5.4M3.3 10.2h5.4M4 1.8c0 2 .9 3 2 4.2 1.1-1.2 2-2.2 2-4.2M4 10.2c0-2 .9-3 2-4.2 1.1 1.2 2 2.2 2 4.2"/></svg>`,
};

function icons(res: Reservation, reasons: ProtectionReason[], kind: BarKind, inWait: boolean): string {
  const out: string[] = [];
  if (inWait) out.push(I.wait);
  if (kind === "walk") out.push(I.out);
  if (kind === "entrata") out.push(I.swap);
  if (kind === "upgrade") out.push(I.up);
  if (reasons.includes("in-casa")) out.push(I.in);
  if (reasons.includes("tag") || reasons.includes("manuale")) out.push(I.lock);
  if (reasons.includes("gruppo")) out.push(I.group);
  if (reasons.includes("abituale")) out.push(I.star);
  if (reasons.includes("expedia-collect")) out.push(I.ec);
  if (res.nonRefundable) out.push(I.euro);
  return out.map((s) => `<i class="ic">${s}</i>`).join("");
}

/** ID Slope delle prenotazioni già messe in lista d'attesa e non ritirate. */
function waitingIds(c: Ctx): Set<string> {
  const out = new Set<string>();
  for (const w of c.app.waitlist) if (w.slopeId && w.status !== "rinuncia") out.add(w.slopeId);
  return out;
}

function kindOf(b: GridBooking, reasons: ProtectionReason[], inWait: boolean): BarKind {
  if (b.style === "entrata") return "entrata";
  if (b.style === "upgrade") return "upgrade";
  if (reasons.includes("in-casa")) return "casa";
  if (inWait) return "attesa";   // già gestita: aspetta solo l'annullamento in Slope
  if (b.res.status === "opzione") return "opzione";
  if (reasons.length) return "fissa";
  return "normale";
}

function bar(b: GridBooking, kind: BarKind, reasons: ProtectionReason[], r: SolveResult, move: MoveDecision | undefined, s: Ctx["app"]["settings"], inWait = false): string {
  const n = r.days.length;
  const openL = b.res.arrival < r.from;                         // soggiorno iniziato prima della finestra
  const openR = diffDays(b.res.departure, r.from) >= n;          // prosegue oltre la finestra
  const left = openL ? 0 : b.start * DAY_W + DAY_W / 2;
  const right = openR ? n * DAY_W : b.end * DAY_W + DAY_W / 2;
  const width = Math.max(18, right - left - 2);
  const cls = `bar k-${kind}${openL ? " ol" : ""}${openR ? " or" : ""}`;
  const name = b.res.guest || b.res.id;
  const seq = move ? `<b class="sq">${move.seq}</b>` : "";
  const from = kind === "entrata" && move ? ` da ${s.hotels.find((h) => h.id === b.res.hotelId)?.name ?? ""}` : "";
  const title = `${name} — ${b.res.id} — ${fmtDate(b.res.arrival)} → ${fmtDate(b.res.departure)} — ${b.res.channel}${from}${b.res.room ? ` — camera in Slope ${b.res.room}` : ""}${inWait ? " — IN LISTA D'ATTESA: ancora attiva in Slope, da annullare lì" : ""}`;
  return `<button class="${cls}" style="left:${left}px;width:${width}px" data-act="detail" data-v="${esc(resKey(b.res))}" title="${esc(title)}">${seq}<span class="nm">${esc(name)}</span><span class="ics">${icons(b.res, reasons, kind, inWait)}</span></button>`;
}

/** Corsie per le prenotazioni da ricollocare: nessuna sovrapposizione nella stessa corsia. */
function walkLanes(moves: MoveDecision[], r: SolveResult): GridBooking[][] {
  const n = r.days.length;
  const items = moves
    .map((m) => ({ res: m.res, start: Math.max(0, diffDays(m.res.arrival, r.from)), end: Math.min(n, diffDays(m.res.departure, r.from)), style: "normale" as const }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);
  const lanes: GridBooking[][] = [];
  for (const it of items) {
    for (let k = 0; k < it.res.rooms; k++) {
      const lane = lanes.find((l) => l[l.length - 1].end <= it.start);
      if (lane) lane.push(it); else lanes.push([it]);
    }
  }
  return lanes;
}

function orphanCells(g: GridRoom, n: number): number[] {
  const bs = [...g.bookings].sort((a, b) => a.start - b.start);
  const out: number[] = [];
  for (let i = 1; i < bs.length; i++) {
    const gap = bs[i].start - bs[i - 1].end;
    if (gap > 0 && gap <= 2) for (let d = bs[i - 1].end; d < bs[i].start && d < n; d++) out.push(d);
  }
  return out;
}

function hotelBlock(c: Ctx, r: SolveResult, h: Hotel, moveByKey: Map<string, MoveDecision>): string {
  const n = r.days.length;
  const waiting = waitingIds(c);
  const rows = r.grid.filter((g) => g.hotelId === h.id);
  const typeLabel = (code: string): string => h.roomTypes.find((t) => t.code === code)?.label ?? code;
  let lastType = "";
  const body = rows
    .map((g) => {
      const holes = orphanCells(g, n);
      const over = g.room.includes("senza camera");
      const sep = g.type !== lastType ? `<div class="bd-type"><span>${esc(typeLabel(g.type))}</span></div>` : "";
      lastType = g.type;
      const bars = g.bookings
        .map((b) => {
          const reasons = c.d.protector.reasons(b.res);
          const inWait = waiting.has(b.res.id);
          return bar(b, kindOf(b, reasons, inWait), reasons, r, moveByKey.get(resKey(b.res)), c.app.settings, inWait);
        })
        .join("");
      const holeHtml = holes.map((d) => `<i class="hole" style="left:${d * DAY_W}px"></i>`).join("");
      const dot = over ? "red" : holes.length ? "gold" : "green";
      return `${sep}<div class="bd-row${over ? " over" : ""}"><div class="bd-rm"><i class="dot ${dot}"></i><b>${esc(g.room)}</b></div><div class="bd-lane" style="width:${n * DAY_W}px">${holeHtml}${bars}</div></div>`;
    })
    .join("");

  const walks = r.moves.filter((m) => m.kind === "walk" && m.res.hotelId === h.id);
  const lanes = walkLanes(walks, r);
  const walkHtml = lanes.length
    ? `<div class="bd-type walk"><span>Overbooking: da ricollocare fuori, in ordine di chiamata</span></div>` +
      lanes
        .map((lane, i) => `<div class="bd-row"><div class="bd-rm"><i class="dot red"></i><b>Overbooking ${i + 1}</b></div><div class="bd-lane" style="width:${n * DAY_W}px">${lane
          .map((b) => bar(b, "walk", c.d.protector.reasons(b.res), r, moveByKey.get(resKey(b.res)), c.app.settings, waiting.has(b.res.id)))
          .join("")}</div></div>`)
        .join("")
    : "";
  return `<div class="bd-hotel"><span>${esc(h.name)}</span><small>${r.conflictsBefore[h.id] ?? 0} camere-notte in conflitto · ${r.orphanNights[h.id] ?? 0} notti isolate</small></div>${body}${walkHtml}`;
}

export function board(c: Ctx, r: SolveResult, hotelSel: HotelId | "tutte"): string {
  const n = r.days.length;
  const today = todayISO();
  const moveByKey = new Map<string, MoveDecision>();
  for (const m of r.moves) moveByKey.set(resKey(m.res), m);
  const head = r.days
    .map((d) => {
      const wd = weekday(d);
      const cls = [wd === 0 || wd === 6 ? "we" : "", d === today ? "td" : ""].join(" ");
      const [, m, dd] = d.split("-");
      const nOver = r.moves.filter((mv) => mv.res.arrival <= d && mv.res.departure > d).length;
      return `<button class="bd-d ${cls}${nOver ? " has" : ""}" style="width:${DAY_W}px" data-act="day" data-v="${d}" title="Cosa fare per questa notte"><small>${fmtDate(d, true).split(" ")[0]}</small><b>${+dd}</b>${nOver ? `<i class="cnt">${nOver}</i>` : ""}</button>`;
    })
    .join("");
  // fascia dei mesi sopra i giorni: un blocco per ogni mese attraversato
  const mesi: { label: string; giorni: number }[] = [];
  for (const d of r.days) {
    const [y, m] = d.split("-");
    const label = `${MO[+m - 1]} ${y}`;
    const ultimo = mesi[mesi.length - 1];
    if (ultimo && ultimo.label === label) ultimo.giorni++;
    else mesi.push({ label, giorni: 1 });
  }
  const monthBand = mesi
    .map((x) => `<div class="bd-m" style="width:${x.giorni * DAY_W}px"><span>${esc(x.label)}</span></div>`)
    .join("");

  const cols = r.days.map((d, i) => { const wd = weekday(d); return wd === 0 || wd === 6 ? `<i class="bd-we" style="left:${i * DAY_W}px;width:${DAY_W}px"></i>` : ""; }).join("");
  const hotels = c.app.settings.hotels.filter((h) => hotelSel === "tutte" || h.id === hotelSel);
  return `<div class="board" style="--dw:${DAY_W}px">
    <div class="bd-scroll"><div class="bd-inner" style="width:${n * DAY_W + 130}px">
      <div class="bd-head">
        <div class="bd-hcol">
          <div class="bd-rm hd months">${esc(String(new Date().getFullYear()))}</div>
          <div class="bd-rm hd">Camera</div>
        </div>
        <div class="bd-hcol">
          <div class="bd-months">${monthBand}</div>
          <div class="bd-days">${head}</div>
        </div>
      </div>
      <div class="bd-body"><div class="bd-cols" style="width:${n * DAY_W}px">${cols}</div>
      ${hotels.map((h) => hotelBlock(c, r, h, moveByKey)).join("")}
      </div>
    </div></div>
  </div>`;
}

export function boardLegend(): string {
  const k: BarKind[] = ["normale", "fissa", "casa", "opzione", "attesa", "upgrade", "entrata", "walk"];
  return `<div class="legend bd-legend"><button class="info-btn" data-act="info" data-v="legend" aria-label="Spiegazione di colori e simboli" title="Spiegazione di colori e simboli">i</button>${k.map((x) => `<span><i class="sw k-${x}"></i>${BAR_LABEL[x]}</span>`).join("")}
    <span><i class="sw hole"></i>Notte isolata</span>
    <span class="icl"><i class="ic dark">${I.lock}</i>Intoccabile</span><span class="icl"><i class="ic dark">${I.group}</i>Gruppo</span><span class="icl"><i class="ic dark">${I.star}</i>Abituale</span><span class="icl"><i class="ic dark">${I.ec}</i>Expedia Collect</span><span class="icl"><i class="ic dark">${I.euro}</i>Prepagata</span><span class="icl"><i class="ic dark">${I.in}</i>In casa</span><span class="icl"><i class="ic dark">${I.wait}</i>In lista d'attesa</span><button class="linkbtn" data-act="info" data-v="legend">Cosa significano?</button></div>`;
}

/** Scheda di dettaglio che si apre toccando una barra. */

const MAIL_GROUPS: { titolo: string; nota: string; voci: MailTemplate[] }[] = [
  { titolo: "Overbooking", nota: "Prima si chiede, poi si sposta. Nessuna prenotazione confermata viene annullata per fare spazio.",
    voci: ["flessibilita", "riprotezione", "ricollocamento"] },
  { titolo: "Cancellazione per motivo valido", nota: "Prima il sollecito, con una scadenza. L'annullamento solo dopo, e solo se la scadenza passa senza risposta.",
    voci: ["garanzia-sollecito", "garanzia-annullo", "caparra-sollecito", "caparra-annullo", "tecnico-camera"] },
  { titolo: "Lista d'attesa", nota: "Per chi aspetta una camera: conferma dell'attesa e avviso quando si libera.",
    voci: ["attesa-conferma", "attesa-disponibile"] },
];

/** Tutti i testi disponibili per questa prenotazione, raggruppati per situazione. */
function mailMenu(c: Ctx, key: string, res: Reservation): string {
  if (!c.app.canWrite) return "";
  const cc = c.d.canc.byRes.get(key);
  const consigliati = new Set<MailTemplate>();
  if (cc) {
    if (cc.ground === "camera-inagibile") consigliati.add("tecnico-camera");
    else if (cc.ground === "mancato-pagamento") consigliati.add("caparra-sollecito");
    else consigliati.add("garanzia-sollecito");
  }
  const mv = c.ui.solve?.moves.find((m) => resKey(m.res) === key);
  if (mv?.kind === "walk") consigliati.add("ricollocamento");
  if (mv?.kind === "riprotezione") consigliati.add("riprotezione");

  const gruppi = MAIL_GROUPS.map((g) => `<div class="mg">
      <b>${esc(g.titolo)}</b>
      <div class="mg-b">${g.voci.map((t) => `<button class="btn ${consigliati.has(t) ? "gold" : "ghost"} sm" data-act="mail-res" data-v="${esc(key)}" data-t="${t}">${esc(TEMPLATE_LABEL[t])}</button>`).join("")}</div>
      <small class="muted">${esc(g.nota)}</small>
    </div>`).join("");

  return `<details class="mailmenu" ${cc || mv ? "open" : ""}>
    <summary>Scrivi all'ospite: scegli il testo</summary>
    ${cc ? `<p class="muted"><small>Questa prenotazione ha un motivo documentato di cancellazione — <b>${esc(GROUND_LABEL[cc.ground])}</b>: ${esc(cc.prova)} Il testo consigliato è in evidenza.</small></p>` : ""}
    ${gruppi}
    <small class="muted">Il testo si apre già compilato con i dati della prenotazione, in italiano, tedesco o inglese. Puoi modificarlo prima di copiarlo.</small>
  </details>`;
}

const VIA_LABEL: Record<string, string> = { copiata: "testo copiato", "programma-email": "aperta nel programma email", manuale: "segnata a mano" };

/** La corrispondenza già fatta con questo ospite. */
function mailHistory(c: Ctx, key: string, resId: string): string {
  const l = c.app.mails.filter((m) => m.key === key || (resId && m.resId === resId)).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  if (!l.length) return `<p class="muted"><small>Nessuna email registrata per questa prenotazione. Ogni testo che copri o apri nel programma email finisce qui, con data e ora.</small></p>`;
  return `<h4 class="lg-h">Corrispondenza (${l.length})</h4>
    <ol class="mlog">${l.map((m) => `<li>
      <div class="ml-h"><b>${esc(TEMPLATE_LABEL[m.template as MailTemplate] ?? m.template)}</b><span class="muted">${esc(fmtDate(m.sentAt.slice(0, 10), true))} ${esc(m.sentAt.slice(11, 16))}</span></div>
      <small class="muted">${esc(m.subject)}</small>
      <small class="muted">${esc(m.lang.toUpperCase())} · ${esc(VIA_LABEL[m.via] ?? m.via)}</small>
      ${m.motivo ? `<small class="ml-m">Motivo dichiarato: ${esc(m.motivo)}</small>` : ""}
      ${c.app.canWrite ? `<button class="linkbtn" data-act="mail-log-del" data-v="${esc(m.id)}">Togli dal registro</button>` : ""}
    </li>`).join("")}</ol>`;
}

export function detailSheet(c: Ctx, key: string | null): string {
  if (!key) return "";
  const res = c.app.reservations.get(key);
  if (!res) return "";
  const s = c.app.settings;
  const reasons = c.d.protector.reasons(res);
  const move = c.ui.solve?.moves.find((m) => resKey(m.res) === key);
  const locked = !!c.app.locks[key];
  const row = (l: string, v: string): string => `<div><dt>${l}</dt><dd>${v}</dd></div>`;
  return `<div class="sheet-bg" data-act="detail-close"></div>
  <aside class="sheet" role="dialog" aria-label="Dettaglio prenotazione">
    <header><div><h3>${esc(res.guest || res.id)}</h3><code>${esc(res.id)}</code></div><button class="btn ghost sm" data-act="detail-close">Chiudi</button></header>
    ${(() => { const sp = c.d.spec.byRes.get(key); return sp ? `<p class="mv spec ${sp.level}"><b>Doppia prenotazione — rischio ${sp.level}</b><br><small>${esc(sp.note)}</small></p>` : ""; })()}
    ${move ? `<p class="mv k-${move.kind === "walk" ? "walk" : move.kind === "riprotezione" ? "entrata" : "upgrade"}"><b>${move.seq}. ${esc(move.note)}</b><br><small>${esc(move.reason)}</small></p>` : ""}
    <dl>
      ${row("Casa", esc(s.hotels.find((h) => h.id === res.hotelId)?.name ?? res.hotelId))}
      ${row("Soggiorno", `${fmtDate(res.arrival, true)} → ${fmtDate(res.departure, true)}, ${nights(res)} notti`)}
      ${row("Camere / ospiti", `${res.rooms} · ${res.adults} adulti${res.children ? `, ${res.children} bambini` : ""}`)}
      ${row("Tipologia", esc(res.roomType))}
      ${(() => {
        const rms = c.ui.solve?.roomMoves.filter((x) => resKey(x.res) === key) ?? [];
        const now = res.room ? `camera ${esc(res.room)}` : "nessuna camera assegnata";
        return row("Camera", rms.length ? `${now} → <b>camera ${rms.map((x) => esc(x.toRoom)).join(", ")}</b><br><small class="muted">${esc(rms[0].reason)}</small>` : now);
      })()}
      ${row("Canale", esc(res.channelRaw || res.channel))}
      ${res.email ? row("Email", `<a href="mailto:${esc(res.email)}">${esc(res.email)}</a>`) : ""}
      ${row("Tariffa", esc(res.rateName || "—"))}
      ${row("Totale / netto", `${eur(res.total)} / ${eur(netValue(s, res))}`)}
      ${row("Prenotata il", fmtDate(res.createdAt))}
      ${row("Fissa", reasons.length ? reasons.map((x) => `<span class="chip p">${REASON_LABEL[x]}</span>`).join(" ") : "no")}
      ${res.tags ? row("Tag / note", esc(res.tags)) : ""}
    </dl>
    ${(() => {
      const inWait = c.app.waitlist.some((w) => w.slopeId === res.id && w.status !== "rinuncia");
      const isWalk = move?.kind === "walk";
      return `${move ? mailButtons(key, move.kind, inWait, c.d.canc.byRes.get(key)?.ground) : ""}
    ${c.app.canWrite && !isWalk ? `<div class="row tight mailrow">${waitButton(key, inWait, false)}${move ? "" : caseButton(key, c.app.cases.some((k) => k.key === key))}</div>
    <p class="muted"><small>${inWait ? "È già nella pagina «Lista d'attesa»." : "In lista d'attesa la ritrovi nella pagina apposita: quando si libera una camera adatta te lo segnala e prepara l'email per l'ospite."}</small></p>` : ""}`;
    })()}
    ${mailMenu(c, key, res)}
    ${mailHistory(c, key, res.id)}
    ${c.app.canWrite ? `<button class="btn ${locked ? "gold" : ""}" data-act="lock" data-v="${esc(key)}">${locked ? "Sblocca" : "Blocca: intoccabile"}</button><p class="muted"><small>Il blocco resta finché non lo togli e rende la prenotazione intoccabile: niente cambio casa, tipologia o camera. Meglio aggiungere anche in Slope il tag ${esc(tagList(s.rules.fixedTag))}, così lo vede tutta la reception.</small></p>` : ""}
  </aside>`;
}

/** Spiegazione dettagliata di colori, simboli e segni del tabellone. */
export function legendSheet(c: Ctx): string {
  const s = c.app.settings;
  const colorRow = (k: BarKind, title: string, text: string): string =>
    `<li><i class="sw big k-${k}"></i><div><b>${title}</b><p>${text}</p></div></li>`;
  const iconRow = (svg: string, title: string, text: string): string =>
    `<li><i class="ic dark big">${svg}</i><div><b>${title}</b><p>${text}</p></div></li>`;
  const otherRow = (html: string, title: string, text: string): string =>
    `<li><span class="lg-sample">${html}</span><div><b>${title}</b><p>${text}</p></div></li>`;
  return `<div class="sheet-bg" data-act="info-close"></div>
  <aside class="sheet wide" role="dialog" aria-label="Legenda del tabellone">
    <header><div><h3>Come leggere il tabellone</h3><small class="muted">Colori, simboli e segni del planning</small></div><button class="btn ghost sm" data-act="info-close">Chiudi</button></header>

    <h4 class="lg-h">Colori delle barre</h4>
    <ul class="lg-list">
      ${colorRow("normale", "Confermata", "Prenotazione confermata senza protezioni. Resta dov'è finché non serve spazio. In caso di conflitto è tra quelle che il piano può spostare, secondo il punteggio di permanenza: valore netto, tetris, data di prenotazione, prepagato.")}
      ${colorRow("fissa", "Fissa o intoccabile", `Prenotazione protetta: non viene mai spostata in un'altra casa né messa in overbooking. È fissa se è un gruppo, è un ospite abituale o è Expedia Collect: può ancora ricevere un upgrade gratuito nella stessa casa. È <b>intoccabile</b>, e quindi non cambia nemmeno tipologia o camera, se ha il tag ${esc(tagList(s.rules.fixedTag))} in Slope, se è stata bloccata in piattaforma${s.rules.protectNonRefundable ? ", se è non rimborsabile o già pagata" : ""} o se l'ospite è già in casa. Tocca la barra per vedere il motivo.`)}
      ${colorRow("casa", "In casa", "L'ospite è già arrivato. La camera assegnata in Slope viene mantenuta e la prenotazione non si sposta mai. La barra parte piatta a sinistra perché il soggiorno è iniziato prima dei giorni visualizzati.")}
      ${colorRow("opzione", "Opzione", "Prenotazione in opzione o preventivo, non ancora confermata. Occupa la camera e conta nella previsione. Verifica la scadenza dell'opzione: se decade, libera spazio senza dover spostare nessuno.")}
      ${colorRow("attesa", "In lista d'attesa", "Prenotazione che hai già messo in lista d'attesa: l'hai gestita, ma <b>è ancora attiva in Slope</b>, quindi la camera risulta occupata finché non la annulli lì e non fai un nuovo import. Il tratteggio serve proprio a ricordarlo: non venderla come libera, e non contarci per risolvere un'altra notte. La trovi nella pagina «Lista d'attesa» con il suo ID Slope.")}
      ${colorRow("upgrade", "Upgrade / cambio", "Il piano sposta questa prenotazione in un'altra tipologia della stessa casa: upgrade gratuito, oppure tipologia diversa adatta allo stesso numero di ospiti. Si fa in Slope senza cambiare il prezzo. Il numero bianco è il passo della sequenza.")}
      ${colorRow("entrata", "Riprotetta da altra casa", "Prenotazione che il piano porta qui da un'altra casa AlpStay, perché nella casa originale non c'era posto. Compare nella casa di destinazione. Va proposta all'ospite, creata in questa casa e annullata senza penale in quella di origine.")}
      ${colorRow("walk", "Overbooking", "Nessuna camera libera per tutto il soggiorno in nessuna delle tre case. L'ospite va ricollocato in un hotel partner di pari o superiore categoria, a nostro carico. Compare nelle righe «Overbooking» in fondo alla casa. Il numero è l'ordine di chiamata: si parte dal più basso.")}
    </ul>

    <h4 class="lg-h">Simboli sulle barre</h4>
    <ul class="lg-list">
      ${iconRow(I.lock, "Intoccabile", `La prenotazione ha il tag ${esc(tagList(s.rules.fixedTag))} in Slope, oppure è stata bloccata in piattaforma: il piano non la sposta di casa, non le cambia tipologia e non le cambia camera.`)}
      ${iconRow(I.group, "Gruppo", `Almeno ${s.rules.groupMinRooms} camere nella stessa prenotazione o nello stesso gruppo, oppure il canale, la tariffa o il tag contengono una delle parole: ${esc(s.rules.groupChannelWords)}.`)}
      ${iconRow(I.star, "Ospite abituale", `L'ospite ha già soggiornato almeno ${s.rules.repeaterMinStays} volte in una delle case (riconosciuto dall'ID cliente di Slope), oppure è segnato come abituale nell'export.`)}
      ${iconRow(I.ec, "Expedia Collect", "Prenotazione Expedia in cui incassa Expedia. Spostarla comporta penali e complicazioni con il portale, per questo è fissa.")}
      ${iconRow(I.euro, "Prepagata", `Tariffa non rimborsabile o già pagata. ${s.rules.protectNonRefundable ? "È intoccabile: l'ospite ha già pagato, quindi il piano non la sposta in nessun modo." : "Pesa a favore della permanenza: chi ha già pagato si sposta per ultimo."}`)}
      ${iconRow(I.in, "In casa", "Check-in effettuato o soggiorno già iniziato.")}
      ${iconRow(I.up, "Upgrade", "La prenotazione sale a una tipologia superiore o cambia tipologia nella stessa casa.")}
      ${iconRow(I.swap, "Arriva da un'altra casa", "Riprotezione in entrata da un'altra casa AlpStay.")}
      ${iconRow(I.out, "Esce in overbooking", "Da ricollocare fuori dal gruppo AlpStay.")}
      ${otherRow(`<b class="sq-demo">7</b>`, "Numero bianco", "Il passo nella sequenza del piano. Lo stesso numero compare nella tabella «Sequenza delle azioni» e nel pannello della notte.")}
    </ul>

    <h4 class="lg-h">Altri segni</h4>
    <ul class="lg-list">
      ${otherRow(`<i class="sw big hole"></i>`, "Notte isolata", "Una o due notti libere chiuse tra due soggiorni nella stessa camera: difficili da vendere. Il tetris le riduce al minimo. Se restano, conviene proporre un'estensione agli ospiti vicini o aprire la vendita anche per 1-2 notti.")}
      ${otherRow(`<i class="dot green"></i>`, "Pallino verde", "La camera è in ordine: nessun conflitto e nessuna notte isolata.")}
      ${otherRow(`<i class="dot gold"></i>`, "Pallino oro", "La camera ha almeno una notte isolata nel periodo visualizzato.")}
      ${otherRow(`<i class="dot red"></i>`, "Pallino rosso", "Riga di overbooking, oppure riga «senza camera» con prenotazioni fisse che non trovano posto. Serve una decisione del responsabile.")}
      ${otherRow(`<span class="shape-demo"></span>`, "Forma della barra", "La punta a sinistra è l'arrivo, la punta a destra è la partenza. Le barre iniziano e finiscono a metà giornata, come in Slope, così un arrivo e una partenza nello stesso giorno si incastrano. Un lato piatto indica che il soggiorno continua oltre i giorni visualizzati.")}
      ${otherRow(`<span class="day-demo">26<i class="cnt">7</i></span>`, "Data in rosso con contatore", "Quella notte ci sono azioni da fare: il numero indica quante prenotazioni sono coinvolte. Clicca la data per il piano passo per passo.")}
      ${otherRow(`<span class="day-demo td">22</span>`, "Data sottolineata in oro", "Oggi. Le colonne di sabato e domenica sono leggermente ombreggiate.")}
    </ul>
  </aside>`;
}
