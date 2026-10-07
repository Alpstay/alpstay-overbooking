import type { ObCase } from "./cases";
// ============================================================
// AlpStay Overbooking — tipi di dominio
// Regola fondamentale: l'ID prenotazione di Slope non viene MAI modificato.
// ============================================================

export type ISODate = string; // "YYYY-MM-DD"
export type HotelId = string;

export type ResStatus = "confermata" | "cancellata" | "noshow" | "opzione";

/** Prenotazione normalizzata. Slope resta la fonte di verità (read-only). */
export interface Reservation {
  id: string;                 // ID Slope, invariato
  hotelId: HotelId;
  createdAt: ISODate | null;  // data di prenotazione
  arrival: ISODate;
  departure: ISODate;
  status: ResStatus;
  cancelledAt: ISODate | null;
  channel: string;            // canale normalizzato (minuscolo)
  channelRaw: string;
  roomType: string;
  room: string | null;
  rooms: number;
  adults: number;
  children: number;
  total: number;              // importo lordo soggiorno
  guest: string;
  customerId: string | null;
  email: string;              // indirizzo dell'ospite, per scrivergli
  groupRef: string | null;
  tags: string;               // tag + note Slope concatenati
  rateName: string;
  payment: string;
  paymentStatus: string;          // stato del pagamento in Slope (pagato, in attesa, carta non valida…)
  paymentDue: ISODate | null;     // scadenza della caparra
  nonRefundable: boolean;
  repeaterFlag: boolean;
  checkedIn: boolean;
  source: "slope";
  sourceId: string;           // = id
  syncedAt: string;           // ISO datetime
}

export interface RoomType {
  code: string;      // come appare nell'export Slope
  label: string;
  count: number;
  maxPax: number;
  rank: number;      // gerarchia per upgrade interni (più alto = migliore)
  rooms?: string[];  // numeri camera, opzionali
}

export interface Hotel {
  id: HotelId;
  name: string;
  matchText: string;        // testo che identifica la casa nella colonna "struttura"
  category: number;         // livello per riprotezione (upgrade / downgrade)
  adultsOnly: boolean;
  roomTypes: RoomType[];
  walkCost: number;         // costo stimato di una camera "walk" (€)
  adrOverride: number | null;
  maxOverbookPct: number;   // tetto massimo di overbooking (% camere)
}

export type EventKind = "altissima" | "evento";

export interface SeasonEvent {
  id: string;
  name: string;
  kind: EventKind;
  from: ISODate;
  to: ISODate;              // incluso
  hotels: HotelId[];        // vuoto = tutte
  washMultiplier: number | null; // null = calcolato dallo storico
  maxOverbookPct: number | null; // null = quello della casa
  recurringYearly: boolean;
}

export interface ProtectionRules {
  fixedTag: string;               // uno o più tag separati da virgola, es. "NO OVERBOOKING, OB-FISSA"
  groupMinRooms: number;          // prenotazione con >= N camere = gruppo
  groupChannelWords: string;      // parole che identificano un gruppo nel canale / tariffa
  repeaterMinStays: number;       // soggiorni conclusi per essere "abituale"
  expediaCollectWords: string;    // parole che identificano Expedia Collect
  protectNonRefundable: boolean;
  cancellation: CancelRules;
  outOfOrder: OutOfOrder[];
  speculativeWindowDays: number;   // due periodi entro N giorni = prenotazioni speculative
}

export interface WalkWeights {
  value: number;        // valore netto della prenotazione
  fit: number;          // principio tetris: quanto la rimozione libera solo notti in conflitto
  early: number;        // chi ha prenotato prima resta
  prepaid: number;      // prepagate / non rimborsabili restano
  speculative: number;   // doppie prenotazioni: escono per prime
  cancellabile: number;  // annullabili per motivo valido: si annullano prima di spostare chi è in regola
}

export interface Settings {
  version: number;
  hotels: Hotel[];
  reprotectionOrder: HotelId[];
  events: SeasonEvent[];
  rules: ProtectionRules;
  weights: WalkWeights;
  channelCommission: Record<string, number>; // canale -> %
  riskMaxPct: number;          // probabilità massima accettata di dover spostare almeno un ospite
  freezeDays: number;          // entro N giorni dall'arrivo non si aumenta l'overbooking
  defaultWashPct: number;      // tasso di cancellazione a priori se lo storico manca
  horizonDays: number;
  mailSignature: string;       // firma delle email agli ospiti
}

export type MappingField =
  | "id" | "hotel" | "createdAt" | "arrival" | "departure" | "nights" | "status"
  | "cancelledAt" | "channel" | "roomType" | "room" | "rooms" | "adults" | "children"
  | "total" | "guest" | "customerId" | "groupRef" | "tags" | "notes" | "rateName"
  | "payment" | "paymentStatus" | "paymentDue" | "repeater" | "checkedIn"
  | "agency" | "guestLast" | "email";

export type ColumnMapping = Partial<Record<MappingField, string>>;

export interface ImportLog {
  at: string;
  hotelId: HotelId | "multi";
  file: string;
  rows: number;
  inserted: number;
  updated: number;
  skipped: number;
  warnings: string[];
}

export interface Meta {
  caseChunks?: number;
  chunks: Record<HotelId, number>;
  lastImport: ImportLog | null;
  history: ImportLog[];
  revision: number;
}

export interface ManualLock {
  at: string;
  note: string;
}

export type ProtectionReason = "tag" | "gruppo" | "abituale" | "expedia-collect" | "non-rimborsabile" | "manuale" | "in-casa";

// ---------- Analisi / forecast ----------

export interface WashCell { alive: number; washed: number; }

export interface WashModel {
  buckets: number[];
  /** chiave: `${hotel}|${channel}|${bucket}` */
  cells: Map<string, WashCell>;
  seasonFactor: Map<HotelId, number>;
  prior: number;
}

export interface DayForecast {
  date: ISODate;
  hotelId: HotelId | "gruppo";
  capacity: number;
  otb: number;              // camere occupate a oggi
  protectedRooms: number;
  expCancel: number;
  sdCancel: number;
  expOccPct: number;        // occupazione finale attesa senza nuove vendite
  ceiling: number;          // camere vendibili totali raccomandate
  headroom: number;         // ceiling - otb
  walkRiskPct: number;      // probabilità di dover spostare qualcuno con l'OTB attuale
  leadDays: number;
  frozen: boolean;
  event: SeasonEvent | null;
  maxPct: number;
}

// ---------- Solver ----------

export type MoveKind = "upgrade" | "riprotezione" | "cancellazione" | "walk";

export interface MoveDecision {
  seq: number;
  res: Reservation;
  kind: MoveKind;
  targetHotel: HotelId | null;
  targetType: string | null;
  keepScore: number;
  netValue: number;
  reason: string;
  note: string;
  targetRoom?: string;
  /** Solo per kind "cancellazione": il motivo documentato che la giustifica. */
  cancelGround?: "carta-non-valida" | "mancato-pagamento" | "camera-inagibile";
}

export interface GridBooking {
  res: Reservation;
  start: number;   // indice giorno nella finestra (può essere < 0)
  end: number;     // esclusivo
  style: "normale" | "protetta" | "entrata" | "upgrade";
}

export interface GridRoom {
  hotelId: HotelId;
  type: string;
  room: string;
  bookings: GridBooking[];
}

export type RoomMoveKind = "cambio" | "upgrade" | "entrata" | "assegna";

/** Istruzione di camera: da camera X a camera Y. */
export interface RoomMove {
  res: Reservation;
  hotelId: HotelId;          // casa di destinazione
  type: string;              // tipologia di destinazione
  fromHotel: HotelId;
  fromRoom: string | null;   // camera attuale in Slope
  toRoom: string;            // camera proposta
  kind: RoomMoveKind;
  reason: string;
}

/** Vuoto di 1-2 notti tra due soggiorni nella stessa camera. */
export interface OrphanGap {
  hotelId: HotelId;
  type: string;
  room: string;
  firstNight: ISODate;
  nights: number;
  before: Reservation;
  after: Reservation;
}

export interface SolveResult {
  from: ISODate;
  days: ISODate[];
  moves: MoveDecision[];
  grid: GridRoom[];
  roomMoves: RoomMove[];
  orphans: OrphanGap[];
  orphanNightsSlope: Record<HotelId, number | null>;
  orphanNights: Record<HotelId, number>;
  conflictsBefore: Record<HotelId, number>;
  warnings: string[];
}

export interface AppState {
  settings: Settings;
  meta: Meta;
  reservations: Map<string, Reservation>;
  locks: Record<string, ManualLock>;
  done: Record<string, string>;   // passi del piano segnati come fatti
  waitlist: WaitEntry[];
  cases: ObCase[];
  mails: MailLogEntry[];
  storage: "cloud" | "locale";
  canWrite: boolean;
}

// ---------- Lista d'attesa ----------
export type WaitSource = "richiesta" | "rientro";
export type WaitStatus = "attesa" | "proposta" | "confermata" | "rinuncia";

export interface WaitEntry {
  id: string;
  source: WaitSource;          // richiesta non impegnativa / ospite ricollocato fuori
  status: WaitStatus;
  hotels: HotelId[];           // case accettate (vuoto = tutte)
  arrival: ISODate;
  departure: ISODate;
  rooms: number;
  pax: number;                 // ospiti per camera
  children: boolean;
  guest: string;
  contact: string;             // email o telefono
  lang: "it" | "de" | "en";
  slopeId: string | null;      // ID Slope della prenotazione originale (rientri)
  fromHotel: HotelId | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

/** Quando una cancellazione è legittima: parole e tempi, non invenzioni. */
export interface CancelRules {
  noGuaranteeWords: string;   // testo che in Slope indica una garanzia non valida
  unpaidWords: string;        // testo che indica una caparra non pagata
  paidWords: string;          // testo che indica che è tutto a posto
  depositDays: number;        // giorni dalla prenotazione entro cui attendere la caparra
  preavvisoGiorni: number;    // giorni di tempo da dare all'ospite prima di annullare
}

/** Camera dichiarata fuori servizio dalla direzione. */
export interface OutOfOrder {
  id: string;
  hotelId: HotelId;
  room: string;
  from: ISODate;
  to: ISODate;       // escluso
  motivo: string;
}

/** Una email preparata e segnata come inviata: la corrispondenza fatta con l'ospite. */
export interface MailLogEntry {
  id: string;
  key: string;              // hotel::idSlope, vuoto se legata solo alla lista d'attesa
  resId: string;            // ID Slope, invariato
  hotelId: HotelId | "";
  guest: string;
  waitId: string | null;
  template: string;         // MailTemplate
  lang: string;             // it | de | en
  subject: string;
  motivo: string;           // il fatto dichiarato all'ospite, così resta agli atti
  sentAt: string;           // ISO datetime
  via: "copiata" | "programma-email" | "manuale";
  note: string;
}
