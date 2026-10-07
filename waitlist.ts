// Lista d'attesa: richieste non impegnative + ospiti ricollocati fuori che vogliono rientrare.
// Compositore email: testi onesti, già compilati, da copiare o aprire nel programma di posta.
import type { Hotel, HotelId, Reservation, WaitEntry, WaitSource, WaitStatus } from "./types";
import { isActive } from "./forecast";
import { typeOf } from "./solver";
import type { Ctx } from "./views";
import type { MailLang, MailTemplate, MailFields } from "./emails";
import { renderMail, longDate, TEMPLATE_LABEL, TEMPLATE_HELP, DEFAULT_VANTAGGIO, DEFAULT_SCADENZA } from "./emails";
import { scadenzaRisposta } from "./cancellable";
import { resKey } from "./importer";
import { addDays, diffDays, esc, fmtDate, todayISO } from "./util";
import { renderTable, Column } from "./table";
import { infoButton } from "./info";

// ------------------------------------------------------------ disponibilità
export type Avail = { kind: "libera" | "overbooking" | "no" | "fuori"; hotel: Hotel | null; text: string };

// camere vendute per notte e tipologia, ricalcolate a ogni import
type Sold = Map<string, { t: string; id: string; n: number }[]>; // data -> vendite
const soldCache = new Map<string, Sold>();
let soldRev = -1;
function soldFor(c: Ctx, h: Hotel): Sold {
  if (soldRev !== c.d.rev) { soldCache.clear(); soldRev = c.d.rev; }
  let m = soldCache.get(h.id);
  if (m) return m;
  m = new Map();
  const today = todayISO();
  for (const r of c.d.list) {
    if (r.hotelId !== h.id || !isActive(r) || r.departure <= today) continue;
    const t = typeOf(h, r).code;
    for (let d = r.arrival < today ? today : r.arrival; d < r.departure; d = addDays(d, 1)) {
      const arr = m.get(d) ?? [];
      arr.push({ t, id: r.id, n: r.rooms });
      m.set(d, arr);
    }
  }
  soldCache.set(h.id, m);
  return m;
}

/** Camere reali libere per tutte le notti, nelle tipologie adatte al numero di ospiti. Chi rientra non conta sé stesso. */
function hotelFree(c: Ctx, h: Hotel, e: WaitEntry, useCeiling: boolean): boolean | null {
  const fc = c.d.fc.get(h.id);
  if (!fc) return null;
  const types = h.roomTypes.filter((t) => t.maxPax >= e.pax);
  if (!types.length) return false;
  const sold = soldFor(c, h);
  const start = e.arrival < todayISO() ? todayISO() : e.arrival;
  const nights = diffDays(e.departure, start);
  for (let i = 0; i < nights; i++) {
    const d = addDays(start, i);
    const f = fc.find((x) => x.date === d);
    if (!f) return null;
    let totalSold = 0, fitFree = 0;
    const perType = new Map<string, number>();
    for (const x of sold.get(d) ?? []) {
      if (e.slopeId && x.id === e.slopeId) continue;
      perType.set(x.t, (perType.get(x.t) ?? 0) + x.n);
      totalSold += x.n;
    }
    for (const t of types) fitFree += Math.max(0, t.count - (perType.get(t.code) ?? 0));
    const cap = useCeiling ? f.ceiling : f.capacity;
    if (Math.min(fitFree + (useCeiling ? f.ceiling - f.capacity : 0), cap - totalSold) < e.rooms) return false;
  }
  return true;
}

export function availability(c: Ctx, e: WaitEntry): Avail {
  const s = c.app.settings;
  if (e.departure <= todayISO()) return { kind: "no", hotel: null, text: "Date passate" };
  const cands = s.hotels.filter((h) => (!e.hotels.length || e.hotels.includes(h.id)) && !(h.adultsOnly && e.children) && h.roomTypes.some((t) => t.maxPax >= e.pax));
  let beyond = false;
  for (const h of cands) {
    const r = hotelFree(c, h, e, false);
    if (r === null) { beyond = true; continue; }
    if (r) return { kind: "libera", hotel: h, text: `Camera libera ora: ${h.name}` };
  }
  // solo le richieste non impegnative possono entrare nel margine di overbooking; chi rientra deve avere una camera vera
  if (e.source === "richiesta") {
    for (const h of cands) if (hotelFree(c, h, e, true)) return { kind: "overbooking", hotel: h, text: `Solo come overbooking controllato: ${h.name}` };
  }
  if (beyond) return { kind: "fuori", hotel: null, text: "Date oltre l'orizzonte della guida" };
  return { kind: "no", hotel: null, text: "Nessuna disponibilità" };
}

/** Ordine di priorità: prima chi è stato ricollocato, poi le richieste per data di inserimento. */
export function prioritized(list: WaitEntry[]): WaitEntry[] {
  const rank = (e: WaitEntry): number => (e.status === "rinuncia" || e.status === "confermata" ? 2 : e.source === "rientro" ? 0 : 1);
  return [...list].sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt));
}

export function entryFromReservation(res: Reservation, source: WaitSource = "rientro", nota?: string): WaitEntry {
  const now = new Date().toISOString();
  return {
    id: `W${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    source,
    status: "attesa",
    hotels: [res.hotelId],
    arrival: res.arrival,
    departure: res.departure,
    rooms: res.rooms,
    pax: Math.max(1, Math.ceil((res.adults + res.children) / Math.max(1, res.rooms))),
    children: res.children > 0,
    guest: res.guest,
    contact: "",
    lang: "it",
    slopeId: res.id,
    fromHotel: res.hotelId,
    note: nota ?? (source === "rientro" ? "Ricollocata fuori per overbooking" : "Aggiunta dalla scheda della prenotazione"),
    createdAt: now,
    updatedAt: now,
  };
}

// ------------------------------------------------------------ vista
const STATUS_LABEL: Record<WaitStatus, string> = { attesa: "In attesa", proposta: "Camera proposta", confermata: "Confermata", rinuncia: "Rinuncia / scaduta" };
const AVAIL_CLS: Record<Avail["kind"], string> = { libera: "vendi", overbooking: "pieno", no: "libero", fuori: "libero" };

export function viewWaitlist(c: Ctx): string {
  const s = c.app.settings;
  const list = prioritized(c.app.waitlist);
  const active = list.filter((e) => e.status === "attesa" || e.status === "proposta");
  const withRoom = active.filter((e) => availability(c, e).kind === "libera");
  const rientri = active.filter((e) => e.source === "rientro").length;
  const hn = (id: HotelId): string => s.hotels.find((h) => h.id === id)?.name ?? id;

  const cols: Column<WaitEntry>[] = [
    { key: "prio", label: "#", value: (e) => list.indexOf(e) + 1, align: "right", width: "3rem" },
    { key: "src", label: "Tipo", value: (e) => (e.source === "rientro" ? "Rientro" : "Richiesta"), filter: true, render: (e) => `<span class="tag ${e.source === "rientro" ? "rischio" : "stop"}">${e.source === "rientro" ? "Rientro" : "Richiesta"}</span>` },
    { key: "guest", label: "Ospite", value: (e) => e.guest, render: (e) => `<b>${esc(e.guest)}</b>${e.contact ? `<br><small>${esc(e.contact)}</small>` : ""}${e.slopeId ? `<br><code>${esc(e.slopeId)}</code>` : ""}` },
    { key: "dates", label: "Soggiorno", value: (e) => e.arrival, render: (e) => `${fmtDate(e.arrival, true)} → ${fmtDate(e.departure, true)}<br><small class="muted">${diffDays(e.departure, e.arrival)} notti</small>` },
    { key: "rooms", label: "Camere", value: (e) => e.rooms, align: "right", render: (e) => `${e.rooms} × ${e.pax} pers.${e.children ? "<br><small>con bambini</small>" : ""}` },
    { key: "hotels", label: "Case", value: (e) => (e.hotels.length ? e.hotels.map(hn).join(", ") : "Tutte"), render: (e) => `<small>${esc(e.hotels.length ? e.hotels.map(hn).join(", ") : "Tutte")}</small>` },
    { key: "av", label: "Disponibilità", value: (e) => availability(c, e).text, render: (e) => { const a = availability(c, e); return `<span class="tag ${AVAIL_CLS[a.kind]}">${esc(a.text)}</span>`; } },
    { key: "st", label: "Stato", value: (e) => STATUS_LABEL[e.status], filter: true, render: (e) => c.app.canWrite ? `<select data-wstatus="${e.id}" aria-label="Stato">${(Object.keys(STATUS_LABEL) as WaitStatus[]).map((k) => `<option value="${k}" ${k === e.status ? "selected" : ""}>${STATUS_LABEL[k]}</option>`).join("")}</select>` : STATUS_LABEL[e.status] },
    { key: "act", label: "Email", value: () => "", render: (e) => `<div class="row tight"><button class="btn ghost sm" data-act="mail-wait" data-v="${e.id}" data-t="attesa-conferma">Conferma attesa</button><button class="btn ${availability(c, e).kind === "libera" ? "gold" : "ghost"} sm" data-act="mail-wait" data-v="${e.id}" data-t="attesa-disponibile">Camera disponibile</button>${c.app.canWrite ? `<button class="btn ghost sm" data-act="wait-del" data-v="${e.id}" aria-label="Elimina">Elimina</button>` : ""}</div>` },
  ];

  const hotelChecks = s.hotels.map((h) => `<label class="check sm"><input type="checkbox" name="w-hotel" value="${h.id}" checked> ${esc(h.name)}</label>`).join("");
  const t = todayISO();
  return `<section class="page">
    <h2 class="lead">${active.length ? `${active.length} ${active.length === 1 ? "ospite" : "ospiti"} in lista d'attesa${withRoom.length ? `: per ${withRoom.length} c'è già una camera libera.` : "."}` : "Lista d'attesa vuota."}</h2>
    <p class="muted narrow">In cima ci sono gli ospiti ricollocati fuori per overbooking (${rientri}): appena si libera una camera vera, rientrano per primi. Poi le richieste non impegnative, in ordine di arrivo della richiesta. La disponibilità si aggiorna a ogni import da Slope.</p>
    ${c.app.canWrite ? `<details class="card addw"><summary><b>Aggiungi alla lista d'attesa</b></summary>
      <div class="grid2">
        <label class="field">Tipo<select id="w-source"><option value="richiesta">Richiesta non impegnativa</option><option value="rientro">Rientro (ricollocato fuori)</option></select></label>
        <label class="field">Ospite<input id="w-guest" type="text" placeholder="Cognome Nome"></label>
        <label class="field">Email o telefono<input id="w-contact" type="text" placeholder="per avvisarlo quando si libera"></label>
        <label class="field">Lingua email<select id="w-lang"><option value="it">Italiano</option><option value="de">Deutsch</option><option value="en">English</option></select></label>
        <label class="field">Arrivo<input id="w-arr" type="date" min="${t}" value="${t}"></label>
        <label class="field">Partenza<input id="w-dep" type="date" min="${addDays(t, 1)}" value="${addDays(t, 3)}"></label>
        <label class="field">Camere<input id="w-rooms" type="number" min="1" value="1"></label>
        <label class="field">Ospiti per camera<input id="w-pax" type="number" min="1" value="2"></label>
        <label class="check"><input id="w-children" type="checkbox"> Con bambini</label>
        <label class="field">ID Slope (facoltativo)<input id="w-slope" type="text"></label>
        <div class="field">Case accettate<div>${hotelChecks}</div></div>
        <label class="field">Note<input id="w-note" type="text"></label>
      </div>
      <div class="row"><button class="btn gold" data-act="wait-add">Aggiungi</button></div>
    </details>` : ""}
    <h3 class="sec with-info">Lista d'attesa ${infoButton("waitlist", "Come funziona la lista d'attesa")}</h3>
    ${renderTable({ id: "wait", columns: cols, rows: list, exportName: `lista-attesa-${t}`, empty: "Nessuno in lista. Gli ospiti ricollocati fuori si aggiungono dal piano con «Metti in lista di rientro».", rowClass: (e) => (e.status === "rinuncia" || e.status === "confermata" ? "dim" : "") })}
  </section>`;
}

export function readWaitForm(root: HTMLElement): WaitEntry | string {
  const v = (id: string): string => (root.querySelector<HTMLInputElement>(`#${id}`)?.value ?? "").trim();
  const guest = v("w-guest");
  const arrival = v("w-arr"), departure = v("w-dep");
  if (!guest) return "Inserisci il nome dell'ospite.";
  if (!arrival || !departure || departure <= arrival) return "Controlla le date: la partenza deve essere dopo l'arrivo.";
  const hotels = [...root.querySelectorAll<HTMLInputElement>('input[name="w-hotel"]')];
  const on = hotels.filter((x) => x.checked).map((x) => x.value);
  if (!on.length) return "Seleziona almeno una casa.";
  const now = new Date().toISOString();
  return {
    id: `W${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    source: v("w-source") === "rientro" ? "rientro" : "richiesta",
    status: "attesa",
    hotels: on.length === hotels.length ? [] : on,
    arrival,
    departure,
    rooms: Math.max(1, Number(v("w-rooms")) || 1),
    pax: Math.max(1, Number(v("w-pax")) || 2),
    children: !!root.querySelector<HTMLInputElement>("#w-children")?.checked,
    guest,
    contact: v("w-contact"),
    lang: (["it", "de", "en"].includes(v("w-lang")) ? v("w-lang") : "it") as WaitEntry["lang"],
    slopeId: v("w-slope") || null,
    fromHotel: null,
    note: v("w-note"),
    createdAt: now,
    updatedAt: now,
  };
}

// ------------------------------------------------------------ compositore email
export interface MailState {
  template: MailTemplate;
  lang: MailLang;
  resKey: string | null;
  waitId: string | null;
  over: Partial<Record<keyof MailFields, string>>; // valori scritti dall'operatore
}

function baseFields(c: Ctx, m: MailState): { f: MailFields; contact: string; ota: boolean } {
  const s = c.app.settings;
  const L = m.lang;
  let f: MailFields = { motivo: "", ospite: "", casa: "", arrivo: "", partenza: "", notti: 0, alternativa: "", tipologia: "", vantaggio: DEFAULT_VANTAGGIO[m.template][L], scadenza: DEFAULT_SCADENZA[L], firma: "", rientro: false, anticipo: true };
  let contact = "", ota = false;
  if (!m.resKey && !m.waitId) {
    // testo di esempio: si legge come una email vera, con dati evidentemente fittizi
    const a = addDays(todayISO(), 10);
    f = { ...f, ospite: "Nome Cognome", casa: s.hotels[0]?.name ?? "", arrivo: longDate(a, L), partenza: longDate(addDays(a, 4), L), notti: 4,
      firma: "" };
    f.firma = s.mailSignature.trim() || `Il team di ricevimento\n${f.casa || "AlpStay Hotels"}`;
    return { f, contact, ota };
  }
  if (m.resKey) {
    const res = c.app.reservations.get(m.resKey);
    if (res) {
      const h = s.hotels.find((x) => x.id === res.hotelId);
      const mv = c.ui.solve?.moves.find((x) => resKey(x.res) === m.resKey);
      const dest = mv?.targetHotel ? s.hotels.find((x) => x.id === mv.targetHotel) : null;
      const other = dest && dest.id !== res.hotelId ? dest : null;
      f = { ...f, ospite: res.guest, casa: h?.name ?? "", arrivo: longDate(res.arrival, L), partenza: longDate(res.departure, L), notti: diffDays(res.departure, res.arrival),
        anticipo: diffDays(res.arrival, todayISO()) >= 3, alternativa: other?.name ?? "", tipologia: other ? other.roomTypes.find((t) => t.code === mv?.targetType)?.label ?? "" : "" };
      contact = res.email || "";
      ota = /booking|expedia|airbnb|hrs/.test(res.channel);
      const cc = c.d.canc.byRes.get(m.resKey);
      if (cc) {
        f.motivo = cc.ground === "mancato-pagamento"
          ? `Alla data odierna non risulta ancora pervenuta la caparra prevista per questa prenotazione. ${cc.prova}`
          : cc.ground === "carta-non-valida"
            ? cc.prova
            : `${cc.prova} Si tratta di un problema tecnico della camera, indipendente dalla Sua prenotazione.`;
        f.scadenza = longDate(scadenzaRisposta(cc), L);
      }
    }
  } else if (m.waitId) {
    const e = c.app.waitlist.find((x) => x.id === m.waitId);
    if (e) {
      const av = availability(c, e);
      const h = av.hotel ?? s.hotels.find((x) => x.id === (e.fromHotel ?? e.hotels[0]));
      f = { ...f, ospite: e.guest, casa: h?.name ?? "AlpStay Hotels", arrivo: longDate(e.arrival, L), partenza: longDate(e.departure, L), notti: diffDays(e.departure, e.arrival), rientro: e.source === "rientro" };
      contact = e.contact;
    }
  }
  f.firma = s.mailSignature.trim() || `Il team di ricevimento\n${f.casa || "AlpStay Hotels"}`;
  for (const [k, v] of Object.entries(m.over)) if (v !== undefined) (f as unknown as Record<string, unknown>)[k] = v;
  return { f, contact, ota };
}

export function mailSheet(c: Ctx, m: MailState | null): string {
  if (!m) return "";
  const { f, contact, ota } = baseFields(c, m);
  const mail = renderMail(m.template, m.lang, f);
  const input = (k: keyof MailFields, label: string, ph = ""): string =>
    `<label class="field">${label}<input type="text" data-mailf="${k}" value="${esc(String(f[k]))}" placeholder="${esc(ph)}"></label>`;
  const needsAlt = m.template === "flessibilita" || m.template === "riprotezione" || m.template === "ricollocamento" || m.template === "tecnico-camera";
  const needsMotivo = ["garanzia-sollecito", "garanzia-annullo", "caparra-sollecito", "caparra-annullo", "tecnico-camera"].includes(m.template);
  const isEmail = /@/.test(contact);
  return `<div class="sheet-bg" data-act="mail-close"></div>
  <aside class="sheet wide" role="dialog" aria-label="Email all'ospite">
    <header><div><h3>Email all'ospite</h3><small class="muted">${m.resKey || m.waitId ? `${esc(f.ospite)}${contact ? ` · ${esc(contact)}` : ""}` : "Testo di esempio, senza prenotazione collegata: compila i campi a mano"}</small></div><button class="btn ghost sm" data-act="mail-close">Chiudi</button></header>
    <div class="grid2">
      <label class="field">Modello<select data-mailsel="template">${(Object.keys(TEMPLATE_LABEL) as MailTemplate[]).map((k) => `<option value="${k}" ${k === m.template ? "selected" : ""}>${TEMPLATE_LABEL[k]}</option>`).join("")}</select></label>
      <label class="field">Lingua<select data-mailsel="lang"><option value="it" ${m.lang === "it" ? "selected" : ""}>Italiano</option><option value="de" ${m.lang === "de" ? "selected" : ""}>Deutsch</option><option value="en" ${m.lang === "en" ? "selected" : ""}>English</option></select></label>
    </div>
    <p class="muted"><small>${esc(TEMPLATE_HELP[m.template])}</small></p>
    ${ota && m.template === "ricollocamento" ? `<p class="notice"><small>Prenotazione da portale: invia il testo dalla messaggistica del portale e segui la sua procedura di ricollocamento, così l'ospite non riceve un'email di cancellazione.</small></p>` : ""}
    ${needsMotivo ? `<label class="field">Il fatto che giustifica la comunicazione <small class="muted">— scrivi solo quello che risulta davvero dai dati o dalla direzione</small>
      <textarea data-mailf="motivo" rows="3" placeholder="es. la carta indicata è stata rifiutata dal circuito il 12 settembre">${esc(f.motivo)}</textarea></label>` : ""}
    <div class="grid2">
      ${input("ospite", "Ospite")}
      ${needsAlt ? input("alternativa", m.template === "ricollocamento" ? "Hotel partner proposto" : "Struttura proposta", "nome della struttura") : ""}
      ${needsAlt || m.template === "attesa-disponibile" ? input("tipologia", "Tipologia camera", "facoltativa") : ""}
      ${m.template !== "attesa-conferma" ? input("vantaggio", m.template === "attesa-disponibile" ? "Nota sul prezzo (facoltativa)" : "Vantaggio offerto", "facoltativo") : ""}
      ${m.template !== "attesa-conferma" && m.template !== "flessibilita" ? input("scadenza", needsMotivo ? "Entro quando" : "Tempo per rispondere") : ""}
    </div>
    <label class="field">Oggetto<input type="text" id="mail-subject" value="${esc(mail.subject)}"></label>
    <label class="field">Testo <small class="muted">(puoi modificarlo prima di copiarlo)</small><textarea id="mail-body" rows="16">${esc(mail.body)}</textarea></label>
    <div class="row">
      <button class="btn gold" data-act="mail-copy">Copia oggetto e testo</button>
      <button class="btn ghost" data-act="mail-open" data-v="${esc(isEmail ? contact : "")}">Apri nel programma email</button>
      ${(m.resKey || m.waitId) && c.app.canWrite ? `<button class="btn ghost sm" data-act="mail-log" data-t="manuale" title="Se l'hai già mandata da un altro programma">Segna come inviata</button>` : ""}
    </div>
    <p class="muted"><small>La firma si imposta in Impostazioni → Email agli ospiti.</small></p>
  </aside>`;
}

export function waitInfoSheet(): string {
  return `<div class="sheet-bg" data-act="info-close"></div>
  <aside class="sheet wide" role="dialog" aria-label="Lista d'attesa">
    <header><div><h3>Lista d'attesa</h3><small class="muted">A cosa serve e come usarla</small></div><button class="btn ghost sm" data-act="info-close">Chiudi</button></header>
    <p>Raccoglie in un solo posto chi aspetta una camera, così quando arriva una cancellazione sai subito a chi offrirla.</p>
    <ul class="info-cols">
      <li><b>Rientro</b><p>Ospiti ricollocati fuori per overbooking. Hanno la precedenza assoluta: appena si libera una camera vera nelle loro date, si offre a loro. Si aggiungono dal pannello della notte o dalla scheda della prenotazione con «Metti in lista di rientro».</p></li>
      <li><b>Richiesta</b><p>Richieste di prenotazione arrivate quando la casa era piena, non impegnative né per l'ospite né per noi. Si aggiungono con il modulo in alto.</p></li>
      <li><b>Disponibilità</b><p>Calcolata sull'ultimo import di Slope, notte per notte e per le case accettate. «Camera libera ora» vuol dire che c'è una camera reale. «Solo come overbooking controllato» vale solo per le richieste: c'è margine nella soglia, ma la camera oggi non esiste; decidi tu se accettare il rischio.</p></li>
      <li><b>Stato</b><p>In attesa → Camera proposta (hai mandato l'email) → Confermata (l'ospite ha accettato: crea la prenotazione in Slope) oppure Rinuncia / scaduta.</p></li>
      <li><b>Email</b><p>«Conferma attesa» e «Camera disponibile» aprono l'email già compilata nella lingua scelta.</p></li>
    </ul>
    <p class="muted"><small>Contatti e nomi restano nella piattaforma solo il tempo necessario: elimina le righe concluse.</small></p>
  </aside>`;
}
