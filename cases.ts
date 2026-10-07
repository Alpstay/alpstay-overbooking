// Registro delle posizioni di overbooking: cosa è successo davvero, con quale esito e a quale costo.
import type { HotelId, ISODate, MoveDecision, MoveKind, Reservation } from "./types";

export type CaseOutcome =
  | "aperto"
  | "rientrata"              // si è risolta da sola: cancellazione o no-show altrui
  | "upgrade"                // upgrade o cambio tipologia nella stessa casa
  | "cambio-camera"          // solo cambio camera, stessa tipologia
  | "riprotetta-alpstay"     // spostata in un'altra casa del gruppo
  | "ricollocata-partner"    // ricollocata in un hotel di colleghi
  | "cancellata";            // prenotazione annullata

export type CancelReason =
  | "carta-non-valida"
  | "doppia-prenotazione"
  | "piano-camere"
  | "richiesta-ospite"
  | "no-show"
  | "mancato-pagamento"
  | "camera-inagibile"
  | "altro";

export interface ObCase {
  id: string;
  resId: string;              // ID Slope, invariato
  key: string;                // hotel::id
  hotelId: HotelId;
  guest: string;
  arrival: ISODate;
  departure: ISODate;
  rooms: number;
  netValue: number;
  channel: string;
  openedAt: string;
  openedBy: "piano" | "manuale";
  proposed: MoveKind | null;  // cosa proponeva il piano
  outcome: CaseOutcome;
  closedAt: string | null;
  targetHotel: HotelId | null;
  partnerName: string;
  cost: number;               // € a nostro carico
  compensation: string;       // gesto commerciale (notte omaggio, sconto…)
  cancelReason: CancelReason | null;
  speculative: boolean;
  note: string;
  updatedAt: string;
}

export const OUTCOME_LABEL: Record<CaseOutcome, string> = {
  aperto: "Da gestire",
  rientrata: "Rientrata da sola",
  upgrade: "Upgrade in casa",
  "cambio-camera": "Cambio camera",
  "riprotetta-alpstay": "Riprotetta in AlpStay",
  "ricollocata-partner": "Hotel partner",
  cancellata: "Cancellata",
};

export const OUTCOME_HELP: Record<CaseOutcome, string> = {
  aperto: "Il caso è aperto: nessuna decisione presa.",
  rientrata: "Non è servito intervenire: sono arrivate cancellazioni e la camera è tornata disponibile.",
  upgrade: "Risolta con un upgrade o un cambio di tipologia nella stessa casa, a costo zero per l'ospite.",
  "cambio-camera": "Risolta spostando la prenotazione in un'altra camera della stessa tipologia.",
  "riprotetta-alpstay": "L'ospite è stato accolto in un'altra casa del gruppo.",
  "ricollocata-partner": "L'ospite è stato ricollocato in un hotel di colleghi, a nostro carico.",
  cancellata: "La prenotazione è stata annullata.",
};

export const CANCEL_LABEL: Record<CancelReason, string> = {
  "carta-non-valida": "Carta non valida",
  "doppia-prenotazione": "Doppia o multipla prenotazione",
  "piano-camere": "Rovinava il piano camere",
  "richiesta-ospite": "Richiesta dell'ospite",
  "no-show": "No-show",
  "mancato-pagamento": "Mancato pagamento della caparra",
  "camera-inagibile": "Camera inagibile",
  altro: "Altro",
};

/** Esiti che contano come "risolta senza disturbare l'ospite". */
export const SOFT_OUTCOMES: CaseOutcome[] = ["rientrata", "upgrade", "cambio-camera"];
export const CLOSED_OUTCOMES: CaseOutcome[] = ["rientrata", "upgrade", "cambio-camera", "riprotetta-alpstay", "ricollocata-partner", "cancellata"];

export function caseId(): string {
  return `OB${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function caseFromMove(m: MoveDecision, netValue: number, speculative: boolean): ObCase {
  const now = new Date().toISOString();
  const r = m.res;
  return {
    id: caseId(),
    resId: r.id,
    key: `${r.hotelId}::${r.id}`,
    hotelId: r.hotelId,
    guest: r.guest,
    arrival: r.arrival,
    departure: r.departure,
    rooms: r.rooms,
    netValue,
    channel: r.channel,
    openedAt: now,
    openedBy: "piano",
    proposed: m.kind,
    outcome: "aperto",
    closedAt: null,
    targetHotel: m.kind === "riprotezione" ? m.targetHotel : null,
    partnerName: "",
    cost: 0,
    compensation: "",
    cancelReason: m.kind === "cancellazione" && m.cancelGround ? m.cancelGround : null,
    speculative,
    note: "",
    updatedAt: now,
  };
}

export function caseFromReservation(r: Reservation, speculative: boolean, netValue: number): ObCase {
  const now = new Date().toISOString();
  return {
    id: caseId(), resId: r.id, key: `${r.hotelId}::${r.id}`, hotelId: r.hotelId, guest: r.guest,
    arrival: r.arrival, departure: r.departure, rooms: r.rooms, netValue, channel: r.channel,
    openedAt: now, openedBy: "manuale", proposed: null, outcome: "aperto", closedAt: null,
    targetHotel: null, partnerName: "", cost: 0, compensation: "", cancelReason: null,
    speculative, note: "", updatedAt: now,
  };
}

// ------------------------------------------------------------ statistiche
export interface CaseStats {
  total: number;
  aperti: number;
  chiusi: number;
  perEsito: { outcome: CaseOutcome; n: number; camere: number; costo: number }[];
  perMotivo: { reason: CancelReason; n: number }[];
  perCasa: { hotelId: HotelId; n: number; costo: number }[];
  perPartner: { nome: string; n: number; costo: number }[];
  costoTotale: number;
  costoMedioChiuso: number;
  valoreSalvato: number;     // valore netto delle prenotazioni non cancellate
  valorePerso: number;       // valore netto delle cancellate
  softPct: number;           // quota risolta senza spostare l'ospite fuori casa
  mesi: { mese: string; aperti: number; costo: number }[];
}

export function computeStats(cases: ObCase[]): CaseStats {
  const chiusi = cases.filter((c) => c.outcome !== "aperto");
  const perEsito = (Object.keys(OUTCOME_LABEL) as CaseOutcome[]).map((o) => {
    const l = cases.filter((c) => c.outcome === o);
    return { outcome: o, n: l.length, camere: l.reduce((a, c) => a + c.rooms, 0), costo: l.reduce((a, c) => a + c.cost, 0) };
  }).filter((x) => x.n > 0);

  const canc = cases.filter((c) => c.outcome === "cancellata" && c.cancelReason);
  const perMotivo = (Object.keys(CANCEL_LABEL) as CancelReason[])
    .map((reason) => ({ reason, n: canc.filter((c) => c.cancelReason === reason).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);

  const case_ = new Map<HotelId, { n: number; costo: number }>();
  for (const c of cases) {
    const v = case_.get(c.hotelId) ?? { n: 0, costo: 0 };
    v.n++; v.costo += c.cost;
    case_.set(c.hotelId, v);
  }

  const part = new Map<string, { n: number; costo: number }>();
  for (const c of cases) {
    if (c.outcome !== "ricollocata-partner") continue;
    const nome = c.partnerName.trim() || "Partner non indicato";
    const v = part.get(nome) ?? { n: 0, costo: 0 };
    v.n++; v.costo += c.cost;
    part.set(nome, v);
  }

  const mesiMap = new Map<string, { aperti: number; costo: number }>();
  for (const c of cases) {
    const k = c.openedAt.slice(0, 7);
    const v = mesiMap.get(k) ?? { aperti: 0, costo: 0 };
    v.aperti++; v.costo += c.cost;
    mesiMap.set(k, v);
  }

  const costoTotale = cases.reduce((a, c) => a + c.cost, 0);
  const soft = chiusi.filter((c) => SOFT_OUTCOMES.includes(c.outcome)).length;
  return {
    total: cases.length,
    aperti: cases.length - chiusi.length,
    chiusi: chiusi.length,
    perEsito,
    perMotivo,
    perCasa: [...case_].map(([hotelId, v]) => ({ hotelId, ...v })).sort((a, b) => b.n - a.n),
    perPartner: [...part].map(([nome, v]) => ({ nome, ...v })).sort((a, b) => b.n - a.n),
    costoTotale,
    costoMedioChiuso: chiusi.length ? costoTotale / chiusi.length : 0,
    valoreSalvato: chiusi.filter((c) => c.outcome !== "cancellata").reduce((a, c) => a + c.netValue, 0),
    valorePerso: chiusi.filter((c) => c.outcome === "cancellata").reduce((a, c) => a + c.netValue, 0),
    softPct: chiusi.length ? soft / chiusi.length : 0,
    mesi: [...mesiMap].map(([mese, v]) => ({ mese, ...v })).sort((a, b) => a.mese.localeCompare(b.mese)).slice(-12),
  };
}
