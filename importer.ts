// Importazione degli export Excel/CSV di Slope.
// I nomi colonna esatti vanno confermati sulla prima esportazione reale:
// il riconoscimento è per sinonimi e la mappatura scelta viene salvata.
import type { ColumnMapping, Hotel, MappingField, Reservation, ResStatus } from "./types";
import { normText, parseDate, parseMoney, parseIntSafe, parseBool, normChannel, addDays } from "./util";

declare const XLSX: {
  read(data: ArrayBuffer, opts: Record<string, unknown>): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_json(ws: unknown, opts: Record<string, unknown>): unknown[][] };
};

export interface FieldDef { field: MappingField; label: string; required: boolean; hint: string; syn: string[]; }

export const FIELDS: FieldDef[] = [
  { field: "id", label: "ID prenotazione", required: true, hint: "Identificativo Slope, usato così com'è", syn: ["id prenotazione", "numero prenotazione", "n prenotazione", "nr prenotazione", "codice prenotazione", "booking id", "reservation id", "id", "prenotazione", "buchungsnummer", "=numero", "=nr", "=n"] },
  { field: "hotel", label: "Struttura", required: false, hint: "Se manca, scegli la casa sopra", syn: ["struttura", "hotel", "proprieta", "property", "casa", "albergo", "esercizio"] },
  { field: "createdAt", label: "Data prenotazione", required: true, hint: "Serve per la curva di cancellazione", syn: ["data prenotazione", "data inserimento", "data creazione", "creata il", "prenotato il", "booking date", "created", "data conferma", "inserita il", "data di creazione", "creazione", "data di prenotazione", "data di inserimento"] },
  { field: "arrival", label: "Arrivo", required: true, hint: "", syn: ["arrivo", "data arrivo", "check in", "checkin", "anreise", "dal"] },
  { field: "departure", label: "Partenza", required: false, hint: "Oppure la colonna Notti", syn: ["partenza", "data partenza", "check out", "checkout", "abreise", "al"] },
  { field: "nights", label: "Notti", required: false, hint: "", syn: ["notti", "nights", "pernottamenti", "n notti"] },
  { field: "status", label: "Stato", required: true, hint: "Confermata / cancellata / no-show", syn: ["stato", "status", "stato prenotazione"] },
  { field: "cancelledAt", label: "Data cancellazione", required: false, hint: "Molto utile: senza, la curva è stimata", syn: ["data cancellazione", "data annullamento", "cancellata il", "annullata il", "cancellation date", "data storno", "data di cancellazione", "data di annullamento"] },
  { field: "channel", label: "Canale", required: true, hint: "", syn: ["canale", "fonte", "provenienza", "origine", "source", "channel", "portale", "ota", "canale di vendita"] },
  { field: "agency", label: "Agenzia / portale", required: false, hint: "In Slope il canale dice «Channel manager»: il portale vero è qui. Se compilata, vince su Canale.", syn: ["agenzia", "agency", "intermediario", "portale", "ota", "channel manager"] },
  { field: "roomType", label: "Tipologia camera", required: true, hint: "", syn: ["tipologia camera", "tipologia alloggio", "tipo camera", "tipologia", "categoria camera", "categoria", "room type", "zimmertyp"] },
  { field: "room", label: "Camera assegnata", required: false, hint: "", syn: ["nome alloggio", "camera", "n camera", "numero camera", "stanza", "room", "zimmer", "alloggio", "unita"] },
  { field: "rooms", label: "Numero camere", required: false, hint: "Default 1 per riga", syn: ["numero camere", "n camere", "camere", "rooms", "qta camere"] },
  { field: "adults", label: "Adulti", required: false, hint: "", syn: ["adulti", "adults", "erwachsene", "n adulti"] },
  { field: "children", label: "Bambini", required: false, hint: "Serve per le case solo adulti", syn: ["bambini", "children", "kinder", "ragazzi", "n bambini"] },
  { field: "total", label: "Totale soggiorno", required: true, hint: "Importo lordo", syn: ["totale prenotazione", "totale soggiorno", "importo totale", "totale", "importo", "prezzo", "valore", "revenue", "amount"] },
  { field: "guest", label: "Ospite / intestatario", required: true, hint: "", syn: ["intestatario", "ospite", "cliente", "nome ospite", "cognome nome", "nominativo", "guest", "name", "nome"] },
  { field: "guestLast", label: "Cognome (se separato)", required: false, hint: "Quando Slope esporta nome e cognome in due colonne", syn: ["cognome", "surname", "last name", "nachname"] },
  { field: "email", label: "Email dell'ospite", required: false, hint: "Serve per scrivergli e per riconoscere l'ospite abituale", syn: ["indirizzo e mail", "indirizzo email", "e mail", "email", "mail", "posta elettronica"] },
  { field: "customerId", label: "ID cliente", required: false, hint: "Per riconoscere gli abituali", syn: ["id cliente", "codice cliente", "customer id", "id anagrafica", "id ospite"] },
  { field: "groupRef", label: "Gruppo", required: false, hint: "", syn: ["nome gruppo", "id gruppo", "gruppo", "group"] },
  { field: "tags", label: "Tag", required: false, hint: "Qui si legge il tag di blocco", syn: ["tag", "tags", "etichette", "etichetta", "label", "segmento"] },
  { field: "notes", label: "Note", required: false, hint: "Il tag viene cercato anche qui", syn: ["note interne", "note", "commenti", "notes", "osservazioni"] },
  { field: "rateName", label: "Tariffa", required: false, hint: "", syn: ["tariffa", "piano tariffario", "listino", "rate", "rate plan", "trattamento"] },
  { field: "payment", label: "Pagamento / garanzia", required: false, hint: "Per Expedia Collect", syn: ["tipo pagamento", "metodo pagamento", "pagamento", "payment", "garanzia", "modalita pagamento"] },
  { field: "paymentStatus", label: "Stato pagamento", required: false, hint: "Serve per proporre la cancellazione per carta non valida o caparra non pagata", syn: ["stato pagamento", "stato incasso", "situazione pagamento", "payment status", "stato carta", "esito carta", "stato garanzia"] },
  { field: "paymentDue", label: "Scadenza pagamento", required: false, hint: "Entro quando deve arrivare la caparra", syn: ["scadenza pagamento", "scadenza caparra", "data scadenza", "termine pagamento", "payment due", "due date", "scadenza opzione"] },
  { field: "repeater", label: "Ospite abituale", required: false, hint: "", syn: ["ospite abituale", "abituale", "repeater", "fedelta", "stammgast"] },
  { field: "checkedIn", label: "Check-in effettuato", required: false, hint: "", syn: ["check in effettuato", "arrivato", "in casa", "checked in"] },
];

/** Oltre questa soglia il numero di camere è quasi certamente una colonna sbagliata. */
export const MAX_ROOMS_PER_RES = 20;

/**
 * Riporta a 1 un numero di camere impossibile. Vale anche per i dati già salvati
 * da import vecchi: una riga sbagliata falsava l'occupazione di tutta la casa.
 */
export function roomsOk(n: unknown): number {
  const v = Math.floor(Number(n));
  if (!isFinite(v) || v < 1) return 1;
  return v > MAX_ROOMS_PER_RES ? 1 : v;
}

export interface ParsedSheet { headers: string[]; rows: unknown[][]; fileName: string; }

export async function readFile(file: File): Promise<ParsedSheet> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true, raw: false, dateNF: "yyyy-mm-dd" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const all = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false }) as unknown[][];
  // riga di intestazione: la prima con almeno 3 colonne riconosciute
  let hIdx = 0;
  let best = -1;
  for (let i = 0; i < Math.min(15, all.length); i++) {
    const score = autoMap((all[i] ?? []).map((c) => String(c ?? ""))).count;
    if (score > best) { best = score; hIdx = i; }
    if (score >= 5) break;
  }
  const headers = (all[hIdx] ?? []).map((c, i) => (c === null || c === "" ? `Colonna ${i + 1}` : String(c).trim()));
  const rows = all.slice(hIdx + 1).filter((r) => r.some((c) => c !== null && c !== ""));
  return { headers, rows, fileName: file.name };
}

export function autoMap(headers: string[], saved: ColumnMapping = {}): { mapping: ColumnMapping; count: number } {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  const normH = headers.map((h) => normText(h));
  // 1) mappatura salvata se la colonna esiste ancora
  for (const f of FIELDS) {
    const s = saved[f.field];
    if (s && headers.includes(s) && !used.has(s)) { mapping[f.field] = s; used.add(s); }
  }
  // 2) corrispondenza esatta, 3) corrispondenza parziale
  for (const pass of ["exact", "partial"] as const) {
    for (const f of FIELDS) {
      if (mapping[f.field]) continue;
      let bestI = -1;
      let bestLen = 0;
      normH.forEach((h, i) => {
        if (used.has(headers[i]) || !h) return;
        for (const syn of f.syn) {
          // un sinonimo con "=" vale solo per corrispondenza esatta: "numero" non deve
          // agganciare "numero camere" o "numero telefonico"
          const soloEsatto = syn.startsWith("=");
          const w = soloEsatto ? syn.slice(1) : syn;
          if (soloEsatto && pass !== "exact") continue;
          const ok = pass === "exact" ? h === w : (` ${h} `.includes(` ${w} `) && w.length >= 4);
          if (ok && w.length > bestLen) { bestLen = w.length; bestI = i; }
        }
      });
      if (bestI >= 0) { mapping[f.field] = headers[bestI]; used.add(headers[bestI]); }
    }
  }
  return { mapping, count: Object.keys(mapping).length };
}

export function missingRequired(m: ColumnMapping): FieldDef[] {
  return FIELDS.filter((f) => f.required && !m[f.field]).filter((f) => !(f.field === "departure" && m.nights));
}

/**
 * Senza una colonna "ID cliente" si usa l'email per riconoscere l'ospite.
 * Gli alias monouso dei portali non identificano nessuno: si scartano.
 */
function emailKey(e: string): string | null {
  const v = String(e ?? "").trim().toLowerCase();
  if (!v || !v.includes("@")) return null;
  if (/guest\.booking\.com|expediapartnercentral|airbnb\.com|m\.expedia|guest\.airbnb/.test(v)) return null;
  return v;
}

function normStatus(raw: string, hasCancelDate: boolean): { status: ResStatus; checkedIn: boolean } {
  const s = normText(raw);
  const checkedIn = /check ?in|in casa|in soggiorno|soggiorno|presente|arrivat|checked|partit|check ?out|in house/.test(s);
  if (/no ?show/.test(s)) return { status: "noshow", checkedIn: false };
  if (/cancel|annull|storn|stornier|disdett|rifiut/.test(s)) return { status: "cancellata", checkedIn: false };
  if (/opzion|option|richiest|preventiv/.test(s)) return { status: "opzione", checkedIn };
  if (!s && hasCancelDate) return { status: "cancellata", checkedIn: false };
  return { status: "confermata", checkedIn };
}

function detectNonRefundable(...parts: string[]): boolean {
  const s = normText(parts.join(" "));
  return /non rimb|nonrimb|nrf|non refund|nonrefund|prepag|anticipat|pagata|paid|vorauszahl/.test(s);
}

export interface NormalizeResult { records: Reservation[]; skipped: number; warnings: string[]; }

export function normalize(sheet: ParsedSheet, m: ColumnMapping, hotels: Hotel[], fixedHotel: string | null): NormalizeResult {
  const idx: Partial<Record<MappingField, number>> = {};
  for (const f of FIELDS) {
    const h = m[f.field];
    if (h) idx[f.field] = sheet.headers.indexOf(h);
  }
  const get = (row: unknown[], f: MappingField): unknown => {
    const i = idx[f];
    return i === undefined || i < 0 ? null : row[i];
  };
  const str = (row: unknown[], f: MappingField): string => {
    const v = get(row, f);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return v === null || v === undefined ? "" : String(v).trim();
  };

  const now = new Date().toISOString();
  const records: Reservation[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  let unknownHotel = 0;
  let badDates = 0;
  let noId = 0;
  const badRooms: string[] = [];

  for (const row of sheet.rows) {
    const id = str(row, "id");
    if (!id) { noId++; skipped++; continue; }

    let hotelId: string | null = fixedHotel;
    if (!hotelId) {
      const hv = normText(str(row, "hotel"));
      const h = hotels.find((x) => hv && (hv.includes(normText(x.matchText)) || hv.includes(normText(x.name))));
      hotelId = h ? h.id : null;
    }
    if (!hotelId) { unknownHotel++; skipped++; continue; }

    const arrival = parseDate(get(row, "arrival"));
    let departure = parseDate(get(row, "departure"));
    if (arrival && !departure) {
      const n = parseIntSafe(get(row, "nights"), 0);
      if (n > 0) departure = addDays(arrival, n);
    }
    if (!arrival || !departure || departure <= arrival) { badDates++; skipped++; continue; }

    const cancelledAt = parseDate(get(row, "cancelledAt"));
    const st = normStatus(str(row, "status"), !!cancelledAt);
    const ci = idx.checkedIn !== undefined ? parseBool(get(row, "checkedIn")) : st.checkedIn;
    const tags = [str(row, "tags"), str(row, "notes")].filter(Boolean).join(" | ");
    const rateName = str(row, "rateName");
    const payment = str(row, "payment");
    // In Slope "Canale" dice come è entrata (Channel manager, Backoffice…): il portale
    // vero sta in "Agenzia". Quando c'è, è quello che conta per commissioni e cancellazioni.
    const agenzia = str(row, "agency");
    const channelRaw = agenzia || str(row, "channel");
    const roomsRaw = Math.max(1, parseIntSafe(get(row, "rooms"), 1));
    const rooms = roomsOk(roomsRaw);
    if (rooms !== roomsRaw) badRooms.push(`${id} (${roomsRaw})`);

    records.push({
      id, // invariato
      hotelId,
      createdAt: parseDate(get(row, "createdAt")),
      arrival,
      departure,
      status: st.status,
      cancelledAt,
      channel: normChannel(channelRaw),
      channelRaw,
      roomType: str(row, "roomType") || "?",
      room: str(row, "room") || null,
      rooms,
      adults: Math.max(0, parseIntSafe(get(row, "adults"), 2)),
      children: Math.max(0, parseIntSafe(get(row, "children"), 0)),
      total: parseMoney(get(row, "total")),
      guest: [str(row, "guestLast"), str(row, "guest")].filter(Boolean).join(" ").trim() || str(row, "guest"),
      email: str(row, "email"),
      customerId: str(row, "customerId") || emailKey(str(row, "email")),
      groupRef: str(row, "groupRef") || null,
      tags,
      rateName,
      payment,
      paymentStatus: str(row, "paymentStatus"),
      paymentDue: parseDate(get(row, "paymentDue")),
      nonRefundable: detectNonRefundable(rateName, payment),
      repeaterFlag: idx.repeater !== undefined ? parseBool(get(row, "repeater")) : false,
      checkedIn: ci,
      source: "slope",
      sourceId: id,
      syncedAt: now,
    });
  }
  const { merged, gruppi } = mergeRows(records);

  // tipologie che non esistono nelle impostazioni della casa: la capienza sarebbe sbagliata
  const note = new Map<string, Set<string>>();
  for (const h of hotels) note.set(h.id, new Set(h.roomTypes.map((t) => normText(t.code))));
  const ignote = new Map<string, number>();
  for (const r of merged) {
    const set = note.get(r.hotelId);
    if (!set || !r.roomType || r.roomType === "?") continue;
    if (!set.has(normText(r.roomType))) ignote.set(r.roomType, (ignote.get(r.roomType) ?? 0) + r.rooms);
  }
  if (ignote.size) {
    const el = [...ignote.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `«${t}» (${n})`);
    warnings.push(`${ignote.size === 1 ? "Una tipologia non è" : `${ignote.size} tipologie non sono`} tra quelle impostate per la casa: ${el.slice(0, 6).join(", ")}${el.length > 6 ? ` e altre ${el.length - 6}` : ""}. Finché non le aggiungi in Impostazioni → Le tre case, con il numero di camere di ciascuna, la capienza e il piano camere non possono essere giusti.`);
  }

  if (gruppi) {
    warnings.push(`${gruppi} ${gruppi === 1 ? "prenotazione occupava" : "prenotazioni occupavano"} più righe dell'export, una per camera: ${gruppi === 1 ? "è stata riunita" : "sono state riunite"} in una sola prenotazione con il numero di camere giusto. È il formato normale di Slope e non serve fare nulla: il numero di prenotazione resta invariato.`);
  }

  if (badRooms.length) warnings.push(`${badRooms.length} ${badRooms.length === 1 ? "prenotazione ha" : "prenotazioni hanno"} un numero di camere impossibile (oltre ${MAX_ROOMS_PER_RES}) e ${badRooms.length === 1 ? "è stata riportata" : "sono state riportate"} di 1 camera: ${badRooms.slice(0, 4).join(", ")}${badRooms.length > 4 ? ` e altre ${badRooms.length - 4}` : ""}. Quasi sempre la colonna «Numero camere» è collegata alla colonna sbagliata: controllala qui sopra.`);
  if (noId) warnings.push(`${noId} righe senza ID prenotazione ignorate.`);
  if (unknownHotel) warnings.push(`${unknownHotel} righe con struttura non riconosciuta: controlla il "testo di riconoscimento" delle case nelle impostazioni.`);
  if (badDates) warnings.push(`${badDates} righe con date di arrivo/partenza mancanti o non valide.`);
  if (!m.cancelledAt) warnings.push("Manca la data di cancellazione: la curva di cancellazione per anticipo sarà meno precisa.");
  if (!m.createdAt) warnings.push("Manca la data di prenotazione: impossibile calcolare l'anticipo, uso il tasso medio.");
  return { records: merged, skipped, warnings };
}

/**
 * Slope esporta una riga per camera: la stessa prenotazione compare più volte,
 * con lo stesso numero e camere diverse. Senza riunirle si perderebbero le camere in più
 * (stessa chiave, l'ultima sovrascrive le altre) e i gruppi verrebbero spezzati.
 */
function mergeRows(list: Reservation[]): { merged: Reservation[]; gruppi: number } {
  const by = new Map<string, Reservation>();
  const camere = new Map<string, string[]>();
  const righe = new Map<string, number>();
  for (const r of list) {
    const k = `${r.hotelId}::${r.id}::${r.arrival}::${r.departure}`;
    righe.set(k, (righe.get(k) ?? 0) + 1);
    const p = by.get(k);
    if (!p) {
      by.set(k, r);
      camere.set(k, r.room ? [r.room] : []);
      continue;
    }
    p.rooms += r.rooms;
    p.total += r.total;
    p.adults += r.adults;
    p.children += r.children;
    if (r.room) camere.get(k)!.push(r.room);
    // basta una riga cancellata perché non lo sia tutta: si tiene lo stato più "vivo"
    if (p.status === "cancellata" && r.status !== "cancellata") { p.status = r.status; p.cancelledAt = r.cancelledAt; }
    if (r.checkedIn) p.checkedIn = true;
    if (!p.email && r.email) p.email = r.email;
    if (!p.customerId && r.customerId) p.customerId = r.customerId;
    if (!p.createdAt && r.createdAt) p.createdAt = r.createdAt;
  }
  for (const [k, r] of by) {
    const c = camere.get(k) ?? [];
    if (c.length > 1) r.room = c.join(", ");
  }
  let gruppi = 0;
  for (const n of righe.values()) if (n > 1) gruppi++;
  return { merged: [...by.values()], gruppi };
}

export function resKey(r: { hotelId: string; id: string }): string {
  return `${r.hotelId}::${r.id}`;
}
