// Cliccando una data del tabellone: cosa fare, passo per passo, per risolvere l'overbooking di quella notte.
import type { Hotel, ISODate, MoveDecision, Reservation, RoomMove } from "./types";
import type { CancelGround } from "./cancellable";
import type { Ctx } from "./views";
import { isActive } from "./forecast";
import { typeOf } from "./solver";
import { resKey } from "./importer";
import { diffDays, esc, eur, fmtDate, nights, pct, todayISO } from "./util";
import { gauge } from "./charts";

export interface DayStep {
  key: string;          // per segnare "fatto", condiviso con lo staff
  hotelId: string;
  title: string;
  how: string[];        // istruzioni operative
  move?: MoveDecision;
}

export function mailButtons(key: string, kind: string, inWait: boolean, ground?: CancelGround): string {
  const b = (t: string, label: string, gold = false): string => `<button class="btn ${gold ? "gold" : "ghost"} sm" data-act="mail-res" data-v="${esc(key)}" data-t="${t}">${label}</button>`;
  if (kind === "riprotezione") return `<div class="row tight mailrow">${b("riprotezione", "Email: spostamento in altra casa", true)}${b("flessibilita", "Email: proposta volontaria")}${waitButton(key, inWait, true)}${caseButton(key, false)}</div>`;
  if (kind === "cancellazione" && ground) {
    const [sol, ann] = ground === "camera-inagibile"
      ? ["tecnico-camera", "tecnico-camera"]
      : ground === "mancato-pagamento" ? ["caparra-sollecito", "caparra-annullo"] : ["garanzia-sollecito", "garanzia-annullo"];
    return ground === "camera-inagibile"
      ? `<div class="row tight mailrow">${b("tecnico-camera", "Email: camera inagibile, alternativa o rimborso", true)}${caseButton(key, false)}</div>`
      : `<div class="row tight mailrow">${b(sol, "1. Email: sollecito", true)}${b(ann, "2. Email: annullamento")}${caseButton(key, false)}</div>`;
  }
  if (kind === "walk") return `<div class="row tight mailrow">${b("flessibilita", "1. Email: proposta volontaria")}${b("ricollocamento", "2. Email: ricollocamento", true)}${waitButton(key, inWait, true)}${caseButton(key, false)}</div>`;
  return "";
}

/** Pulsante per registrare l'esito della posizione nel Registro. */
export function caseButton(key: string, aperta: boolean): string {
  return `<button class="btn ghost sm" data-act="case-from-res" data-v="${esc(key)}">${aperta ? "Aggiorna l'esito" : "Registra esito"}</button>`;
}

/** Pulsante per inserire la prenotazione nella pagina «Lista d'attesa». */
export function waitButton(key: string, inWait: boolean, rientro: boolean): string {
  if (inWait) return `<button class="btn ghost sm" disabled>Già in lista d'attesa</button>`;
  return `<button class="btn ghost sm" data-act="wait-from-res" data-v="${esc(key)}" data-t="${rientro ? "rientro" : "richiesta"}">${rientro ? "Metti in lista di rientro" : "Metti in lista d'attesa"}</button>`;
}

function covers(r: Reservation, d: ISODate): boolean {
  return r.arrival <= d && r.departure > d;
}

function typeLabel(h: Hotel | undefined, code: string | null): string {
  if (!h || !code) return code ?? "";
  return h.roomTypes.find((t) => t.code === code)?.label ?? code;
}

interface NightLoad { hotel: Hotel; rows: { label: string; sold: number; count: number }[]; over: number; }

function nightLoad(c: Ctx, d: ISODate): NightLoad[] {
  return c.app.settings.hotels.map((h) => {
    const sold = new Map<string, number>();
    for (const r of c.d.list) {
      if (r.hotelId !== h.id || !isActive(r) || !covers(r, d)) continue;
      const t = typeOf(h, r).code;
      sold.set(t, (sold.get(t) ?? 0) + r.rooms);
    }
    const rows = h.roomTypes.map((t) => ({ label: t.label, sold: sold.get(t.code) ?? 0, count: t.count }));
    return { hotel: h, rows, over: rows.reduce((a, x) => a + Math.max(0, x.sold - x.count), 0) };
  });
}

export function daySteps(c: Ctx, d: ISODate): DayStep[] {
  const r = c.ui.solve;
  if (!r) return [];
  const s = c.app.settings;
  const hotelOf = (id: string | null): Hotel | undefined => s.hotels.find((h) => h.id === id);
  const steps: DayStep[] = [];

  // 1) chiudere le vendite dove la notte è già oltre la soglia
  for (const h of s.hotels) {
    const f = c.d.fc.get(h.id)?.find((x) => x.date === d);
    if (f && f.otb >= f.ceiling) {
      steps.push({
        key: `close|${h.id}|${d}`,
        hotelId: h.id,
        title: `${h.name}: chiudi le vendite per questa notte`,
        how: [
          `In portafoglio ${f.otb} camere su ${f.capacity}, soglia vendibile ${f.ceiling}.`,
          "Sul channel manager e in Slope metti disponibilità zero (stop sell) su tutte le tipologie e su tutti i canali, compreso il sito.",
          f.headroom < 0 ? "Non riaprire finché il margine in Guida strategica non torna positivo." : "Riapri solo se arrivano cancellazioni.",
        ],
      });
    }
  }

  // 2) azioni del piano che toccano questa notte, nell'ordine di sequenza
  const moves = r.moves.filter((m) => covers(m.res, d)).sort((a, b) => a.seq - b.seq);
  const rmOf = (res: Reservation): RoomMove[] => r.roomMoves.filter((x) => resKey(x.res) === resKey(res));
  const roomTxt = (res: Reservation): string => {
    const rm = rmOf(res);
    if (!rm.length) return "";
    const to = rm.map((x) => x.toRoom).join(", ");
    return rm[0].fromRoom ? ` dalla camera ${rm[0].fromRoom} alla camera ${to}` : ` nella camera ${to}`;
  };
  for (const m of moves) {
    const res = m.res;
    const own = hotelOf(res.hotelId);
    const dest = hotelOf(m.targetHotel);
    const who = `${res.guest || "ospite"} (ID ${res.id}), ${fmtDate(res.arrival)} → ${fmtDate(res.departure)}, ${nights(res)} notti, ${res.channelRaw || res.channel}`;
    const ota = /booking|expedia|airbnb|hrs|agenz/.test(res.channel);
    if (m.kind === "upgrade") {
      const internalTypeChange = dest?.id === own?.id;
      steps.push({
        key: `${resKey(res)}|upgrade`,
        hotelId: res.hotelId,
        move: m,
        title: `${m.seq}. Cambia tipologia in casa: ${who}`,
        how: [
          `In Slope sposta la prenotazione a ${typeLabel(dest, m.targetType)}${roomTxt(res)}, senza modificare il prezzo.`,
          "Nessuna comunicazione obbligatoria: al check-in presentalo come upgrade di cortesia.",
          "Assegna la camera indicata nel tabellone per non lasciare notti isolate.",
        ],
      });
    } else if (m.kind === "riprotezione") {
      const down = own && dest && dest.category < own.category;
      steps.push({
        key: `${resKey(res)}|riprotezione`,
        hotelId: res.hotelId,
        move: m,
        title: `${m.seq}. Sposta in ${dest?.name ?? "altra casa"}: ${who}`,
        how: [
          `Contatta l'ospite oggi: proponi ${dest?.name}, ${typeLabel(dest, m.targetType)}, alle stesse condizioni e allo stesso prezzo${down ? ", con uno sconto per la categoria inferiore: serve il suo consenso esplicito" : ""}.`,
          `In Slope crea la prenotazione in ${dest?.name}${rmOf(res).length ? `, camera ${rmOf(res).map((x) => x.toRoom).join(", ")}` : ""}, con le stesse date e lo stesso importo, poi annulla quella in ${own?.name}${res.room ? ` (camera ${res.room})` : ""} senza penale. Nelle note di entrambe scrivi il riferimento incrociato degli ID.`,
          ota
            ? `È una prenotazione ${res.channel}: non cancellarla dall'extranet come "cancellazione ospite". Usa la procedura di ricollocamento del portale, così non paghi penali e l'ospite non riceve un'email di annullamento.`
            : "Manda all'ospite la conferma della nuova struttura con indirizzo, parcheggio e orari di check-in.",
          "Se l'ospite rifiuta, blocca la prenotazione come fissa dalla sua scheda e ricalcola il piano.",
        ],
      });
    } else {
      steps.push({
        key: `${resKey(res)}|overbooking`,
        hotelId: res.hotelId,
        move: m,
        title: `${m.seq}. Overbooking: ricollocare fuori ${who}`,
        how: [
          `Prima di chiamare l'ospite, trova la camera: hotel partner di pari o superiore categoria vicino a ${own?.name}, per tutte le ${nights(res)} notti. Costo stimato a nostro carico circa ${eur((own?.walkCost ?? 0) * nights(res) * res.rooms)}.`,
          "Chiama l'ospite il prima possibile, non al banco: spiega, proponi la struttura trovata, offri trasferimento e differenza di prezzo a nostro carico e, se possibile, la prima notte in omaggio o un rientro in casa appena si libera una camera.",
          ota
            ? `Prenotazione ${res.channel}: segna la ricollocazione dall'extranet con la procedura del portale, non come cancellazione dell'ospite.`
            : "Conferma per iscritto la nuova sistemazione e annulla in Slope la prenotazione senza penale, con nota del motivo.",
          "Aspetta a chiamare solo se l'arrivo è lontano: le cancellazioni attese potrebbero risolvere il problema da sole (vedi l'indicazione in alto).",
        ],
      });
    }
  }
  // 3) cambi di camera nella stessa tipologia che toccano questa notte
  const planned = new Set(moves.map((m) => resKey(m.res)));
  const cambi = r.roomMoves.filter((x) => x.kind === "cambio" && covers(x.res, d) && !planned.has(resKey(x.res)))
    .sort((a, b) => a.res.arrival.localeCompare(b.res.arrival));
  for (const x of cambi) {
    const res = x.res;
    const already = res.arrival <= todayISO();
    steps.push({
      key: `${resKey(res)}|camera|${x.toRoom}`,
      hotelId: x.hotelId,
      title: `Cambio camera: ${res.guest || res.id} (ID ${res.id}) dalla camera ${x.fromRoom} alla camera ${x.toRoom}`,
      how: [
        x.reason,
        `In Slope, nel planning di ${hotelOf(x.hotelId)?.name ?? ""}, sposta la prenotazione dalla camera ${x.fromRoom} alla camera ${x.toRoom}: stesse date, stessa tipologia, stesso prezzo.`,
        already ? "L'ospite arriva oggi: aggiorna la camera prima di codificare la chiave." : `Arrivo ${fmtDate(res.arrival, true)}: se all'ospite era già stato comunicato il numero di camera, avvisalo del cambio.`,
      ],
    });
  }
  // 4) camere da assegnare agli arrivi di questa notte
  for (const h of s.hotels) {
    const ass = r.roomMoves.filter((x) => x.kind === "assegna" && x.hotelId === h.id && x.res.arrival === d);
    if (!ass.length) continue;
    steps.push({
      key: `assegna|${h.id}|${d}`,
      hotelId: h.id,
      title: `${h.name}: assegna le camere a ${ass.length} ${ass.length === 1 ? "arrivo" : "arrivi"} senza camera`,
      how: [
        ...ass.map((x) => `${x.res.guest || x.res.id} (ID ${x.res.id}) → camera ${x.toRoom}`),
        "Sono le camere che si incastrano con i soggiorni vicini senza lasciare notti isolate.",
      ],
    });
  }
  return steps;
}

export function daySheet(c: Ctx, d: ISODate | null): string {
  if (!d) return "";
  const s = c.app.settings;
  const steps = daySteps(c, d);
  const loads = nightLoad(c, d);
  const lead = diffDays(d, todayISO());
  const done = c.app.done;
  const open = steps.filter((x) => !done[x.key]).length;

  const loadHtml = loads
    .map((l) => {
      const f = c.d.fc.get(l.hotel.id)?.find((x) => x.date === d);
      const exp = f ? f.expCancel : 0;
      return `<div class="dl-h ${l.over ? "bad" : ""}"><div class="dl-t"><b>${esc(l.hotel.name)}</b>
        <span>${l.rows.map((x) => `${esc(x.label)} <b class="${x.sold > x.count ? "neg" : ""}">${x.sold}/${x.count}</b>`).join(" · ")}</span>
        <small>${l.over ? `${l.over} camere in più del disponibile` : "nessun conflitto"}${f && f.walkRiskPct > 0.005 ? ` · rischio overbooking ${pct(f.walkRiskPct)}` : ""}</small></div>
        ${f ? gauge(exp, l.over, f.sdCancel) : ""}</div>`;
    })
    .join("");

  const totalOver = loads.reduce((a, l) => a + l.over, 0);
  const expAll = loads.reduce((a, l) => a + (c.d.fc.get(l.hotel.id)?.find((x) => x.date === d)?.expCancel ?? 0), 0);
  let timing = "";
  if (totalOver) {
    if (lead <= s.freezeDays) timing = lead === 0 ? "È stanotte. Non aspettare cancellazioni: esegui adesso tutti i passi." : `${lead === 1 ? "Manca 1 giorno" : `Mancano ${lead} giorni`}. Non aspettare cancellazioni: esegui adesso tutti i passi.`;
    else if (expAll >= totalOver) timing = `${lead === 1 ? "Manca 1 giorno" : `Mancano ${lead} giorni`} e sono attese ${expAll.toFixed(1).replace(".", ",")} cancellazioni contro ${totalOver} camere in eccesso: fai subito i cambi in casa (passi senza impatto sull'ospite), rimanda le chiamate di overbooking e ricontrolla dopo il prossimo import.`;
    else timing = `${lead === 1 ? "Manca 1 giorno" : `Mancano ${lead} giorni`} ma le cancellazioni attese (${expAll.toFixed(1).replace(".", ",")}) non bastano a coprire ${totalOver} camere in eccesso: esegui i passi in ordine, partendo dai cambi in casa.`;
  }

  const stepHtml = steps.length
    ? `<ol class="steps">${steps
        .map((x) => `<li class="${done[x.key] ? "done" : ""} ${x.move ? `k-${x.move.kind === "walk" ? "walk" : x.move.kind === "riprotezione" ? "entrata" : "upgrade"}` : "k-close"}">
          <div class="st-head"><b>${esc(x.title)}</b>
            ${c.app.canWrite ? `<button class="btn sm ${done[x.key] ? "gold" : "ghost"}" data-act="step-done" data-v="${esc(x.key)}" aria-pressed="${!!done[x.key]}">${done[x.key] ? "Fatto" : "Segna fatto"}</button>` : ""}</div>
          <ul>${x.how.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>
          ${x.move ? mailButtons(resKey(x.move.res), x.move.kind, c.app.waitlist.some((w) => w.slopeId === x.move!.res.id && w.status !== "rinuncia"), c.d.canc.byRes.get(resKey(x.move.res))?.ground) : ""}
          ${x.move ? `<small class="muted">Perché questa prenotazione: ${esc(x.move.reason)}</small> <button class="linkbtn" data-act="detail" data-v="${esc(resKey(x.move.res))}">Apri scheda</button>` : ""}
        </li>`)
        .join("")}</ol>`
    : `<p class="ok">Nessuna azione per questa notte: le camere bastano${totalOver ? "" : " in tutte e tre le case"}.</p>`;

  return `<div class="sheet-bg" data-act="day-close"></div>
  <aside class="sheet wide" role="dialog" aria-label="Cosa fare il ${fmtDate(d, true)}">
    <header><div><h3>${fmtDate(d, true)} ${d.slice(0, 4)}</h3><small class="muted">${steps.length ? `${open} passi da fare su ${steps.length}` : "Situazione della notte"}</small></div><button class="btn ghost sm" data-act="day-close">Chiudi</button></header>
    <section class="dl">${loadHtml}</section>
    ${timing ? `<p class="notice">${esc(timing)}</p>` : ""}
    ${stepHtml}
  </aside>`;
}
