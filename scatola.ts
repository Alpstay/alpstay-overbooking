/**
 * La Scatola — lettura dello scatto giornaliero.
 *
 * La pagina pubblicata non parla con La Scatola. Non potrebbe: il gateway `/api/v1` accetta
 * solo client registrati, e un client registrato con la sua chiave dentro una pagina pubblica
 * non è un accesso, è una chiave lasciata sulla porta. Quindi si fa come per il counter
 * colazioni: un'attività pianificata interroga La Scatola via MCP una volta al giorno, scrive
 * `scatola.json` nel repository e pubblica. La pagina legge quel file, che sta accanto a lei.
 *
 * Conseguenze da tenere a mente, non difetti da nascondere:
 * - i dati valgono il momento dello scatto, non adesso: `generato` e `freschezza` vanno mostrati;
 * - lo scatto non si salva nell'archivio: viene riletto a ogni apertura, e il giorno dopo è
 *   sostituito. Niente da sincronizzare, niente da ripulire;
 * - i nomi degli ospiti sono cifrati. Il repository è pubblico: senza la password della
 *   reception restano cifrati e la piattaforma lavora su camere e numeri, che bastano per
 *   decidere chi spostare.
 *
 * Gli ID di Slope non vengono mai modificati: `id` e `scatolaTypeId` sono copiati identici.
 */
import type { HotelId, Reservation, ResStatus, RoomType } from "./types";

// ------------------------------------------------------------ forma del file

export interface BloccoCifrato {
  alg: string;
  iter: number;
  salt: string;
  iv: string;
  ct: string;
}

export interface ScatolaTipologia {
  /** ID tipologia di Slope, invariato. */
  id: string;
  /** Camere fisiche che La Scatola dichiara per questa tipologia. */
  camere: number;
  /** Etichetta leggibile, se chi aggiorna l'ha indicata. La Scatola non espone il nome. */
  etichetta: string | null;
}

export interface ScatolaCasa {
  /** `property_id` di Slope, invariato. */
  scatolaId: string;
  /** La casa corrispondente nelle impostazioni della piattaforma. */
  hotelId: HotelId;
  nome: string;
  tipologie: ScatolaTipologia[];
}

export interface ScatolaFreschezza {
  stato: "ok" | "failing" | "sconosciuta";
  ultimoSuccesso: string | null;
  etaOre: number | null;
}

/** [giorno, property_id, lodging_type_id, camere, chiusure, confermate, opzioni] */
export type RigaCapienza = [string, string, string, number, number, number, number];

export interface PrenotazioneScatola {
  id: string;
  hotelId: HotelId;
  scatolaTypeId: string;
  arrival: string;
  departure: string;
  room: string | null;
  rooms: number;
  adults: number;
  children: number;
  isOption: boolean;
  isOverbooking: boolean;
  orderId: string | null;
  createdAt: string | null;
  /** Importo della singola prenotazione: `room_amount`, non il totale dell'ordine. */
  total: number | null;
  openBalance: number | null;
  checkedIn: boolean;
  stato: ResStatus;
  cancelledAt: string | null;
  canale: string;
  agenzia: string;
  /** Lingua dell'intestatario: serve a scegliere la lingua dell'email senza aprire i nomi. */
  lingua: string;
  /** L'intestatario è un'azienda: di solito vuol dire gruppo. */
  azienda: boolean;
  /** C'è un nome nel blocco cifrato, anche se non è stato aperto. */
  haNome: boolean;
}

export interface ScatolaSnapshot {
  fonte: string;
  generato: string;
  finestra: { da: string; a: string };
  freschezza: ScatolaFreschezza;
  /** Cosa La Scatola non dà, scritto dall'attività pianificata. Serve a non far finta. */
  mancanti: string[];
  case: ScatolaCasa[];
  capienza: RigaCapienza[];
  prenotazioni: PrenotazioneScatola[];
  ospitiEnc: BloccoCifrato | null;
}

export interface EsitoScatola {
  snapshot: ScatolaSnapshot | null;
  /** Perché non c'è, in italiano, da mostrare così com'è. */
  errore: string | null;
}

// ------------------------------------------------------------ lettura

const PERCORSO = "./scatola.json";

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Uno stato che non riconosco non diventa «confermata» di nascosto: resta opzione. */
function statoOk(v: unknown): ResStatus {
  return v === "cancellata" || v === "noshow" || v === "opzione" || v === "confermata" ? v : "opzione";
}

/**
 * Controlla la forma del file prima di fidarsene. Uno scatto malformato deve dare un errore
 * visibile, non una piattaforma che mostra numeri a caso: su questi numeri si decide se
 * spostare un ospite.
 */
function valida(j: unknown): EsitoScatola {
  if (!j || typeof j !== "object") return { snapshot: null, errore: "scatola.json non è un oggetto JSON." };
  const o = j as Record<string, unknown>;
  const generato = str(o.generato);
  if (!generato) return { snapshot: null, errore: "scatola.json non dice quando è stato generato." };
  if (!Array.isArray(o.case) || o.case.length === 0) return { snapshot: null, errore: "scatola.json non contiene nessuna casa." };
  if (!Array.isArray(o.prenotazioni)) return { snapshot: null, errore: "scatola.json non contiene l'elenco delle prenotazioni." };
  // Uno scatto di una versione precedente non ha `stato` né `canale`. Letto come se li avesse,
  // diventerebbe un elenco di prenotazioni tutte in opzione e senza canale: numeri sbagliati e
  // dall'aria normale. Meglio rifiutarlo e lavorare su quello che c'è già.
  const prima = o.prenotazioni[0] as Record<string, unknown> | undefined;
  if (prima && !("stato" in prima)) {
    return { snapshot: null, errore: "scatola.json è in un formato più vecchio di questa pagina: non lo uso, aspetto l'aggiornamento di stanotte." };
  }
  if (!Array.isArray(o.capienza)) return { snapshot: null, errore: "scatola.json non contiene la capienza per notte." };

  const fin = (o.finestra ?? {}) as Record<string, unknown>;
  const da = str(fin.da), a = str(fin.a);
  if (!da || !a) return { snapshot: null, errore: "scatola.json non dichiara il periodo coperto." };

  const fr = (o.freschezza ?? {}) as Record<string, unknown>;
  const stato = fr.stato === "ok" || fr.stato === "failing" ? fr.stato : "sconosciuta";

  const case_: ScatolaCasa[] = [];
  for (const c of o.case as Record<string, unknown>[]) {
    const scatolaId = str(c.scatolaId), hotelId = str(c.hotelId);
    if (!scatolaId || !hotelId) return { snapshot: null, errore: "una casa nello scatto non ha l'ID della Scatola o della piattaforma." };
    const tip: ScatolaTipologia[] = [];
    for (const t of (Array.isArray(c.tipologie) ? c.tipologie : []) as Record<string, unknown>[]) {
      const id = str(t.id);
      if (!id) continue;
      tip.push({ id, camere: Math.max(0, Math.round(num(t.camere, 0))), etichetta: str(t.etichetta) });
    }
    case_.push({ scatolaId, hotelId, nome: str(c.nome) ?? hotelId, tipologie: tip });
  }

  const noti = new Set(case_.map((c) => c.scatolaId));
  const pren: PrenotazioneScatola[] = [];
  for (const p of o.prenotazioni as Record<string, unknown>[]) {
    const id = str(p.id), hotelId = str(p.hotelId), arrival = str(p.arrival), departure = str(p.departure);
    if (!id || !hotelId || !arrival || !departure) {
      return { snapshot: null, errore: "una prenotazione nello scatto è incompleta (ID, casa o date mancanti)." };
    }
    if (!(arrival < departure)) return { snapshot: null, errore: `la prenotazione ${id} ha date non valide (${arrival} → ${departure}).` };
    pren.push({
      id,
      hotelId,
      scatolaTypeId: str(p.scatolaTypeId) ?? "",
      arrival,
      departure,
      room: str(p.room),
      // Una riga di La Scatola è una camera: più camere sullo stesso ordine restano righe distinte.
      rooms: 1,
      adults: Math.max(0, Math.round(num(p.adults, 0))),
      children: Math.max(0, Math.round(num(p.children, 0))),
      isOption: p.isOption === true,
      isOverbooking: p.isOverbooking === true,
      orderId: str(p.orderId),
      createdAt: str(p.createdAt),
      total: typeof p.total === "number" ? p.total : null,
      openBalance: typeof p.openBalance === "number" ? p.openBalance : null,
      checkedIn: p.checkedIn === true,
      stato: statoOk(p.stato),
      cancelledAt: str(p.cancelledAt),
      canale: str(p.canale) ?? "",
      agenzia: str(p.agenzia) ?? "",
      lingua: str(p.lingua) ?? "",
      azienda: p.azienda === true,
      haNome: p.haNome === true,
    });
  }

  const cap: RigaCapienza[] = [];
  for (const r of o.capienza as unknown[]) {
    if (!Array.isArray(r) || r.length < 7) continue;
    const [g, casa, tipo] = r as unknown[];
    if (typeof g !== "string" || typeof casa !== "string" || typeof tipo !== "string") continue;
    if (!noti.has(casa)) continue;
    cap.push([g, casa, tipo, num(r[3], 0), num(r[4], 0), num(r[5], 0), num(r[6], 0)]);
  }

  const enc = o.ospitiEnc && typeof o.ospitiEnc === "object" ? (o.ospitiEnc as unknown as BloccoCifrato) : null;

  return {
    snapshot: {
      fonte: str(o.fonte) ?? "La Scatola",
      generato,
      finestra: { da, a },
      freschezza: {
        stato,
        ultimoSuccesso: str(fr.ultimoSuccesso),
        etaOre: typeof fr.etaOre === "number" ? fr.etaOre : null,
      },
      mancanti: Array.isArray(o.mancanti) ? (o.mancanti as unknown[]).filter((m): m is string => typeof m === "string") : [],
      case: case_,
      capienza: cap,
      prenotazioni: pren,
      ospitiEnc: enc && str(enc.ct) && str(enc.salt) && str(enc.iv) ? enc : null,
    },
    errore: null,
  };
}

/**
 * Legge `scatola.json` accanto alla pagina. Un 404 non è un errore: vuol dire che lo scatto
 * non è ancora stato pubblicato, e la piattaforma continua con quello che ha.
 */
export async function caricaScatola(percorso = PERCORSO): Promise<EsitoScatola> {
  let r: Response;
  try {
    r = await fetch(`${percorso}?t=${Date.now()}`, { cache: "no-store" });
  } catch {
    return { snapshot: null, errore: "Non sono riuscito a leggere scatola.json: la rete non risponde." };
  }
  if (r.status === 404) return { snapshot: null, errore: null };
  if (!r.ok) return { snapshot: null, errore: `scatola.json non è leggibile (errore ${r.status}).` };
  try {
    return valida(await r.json());
  } catch {
    return { snapshot: null, errore: "scatola.json non è un JSON valido: non lo uso." };
  }
}

// ------------------------------------------------------------ da scatto a piattaforma

/** Codice di tipologia usato dalla piattaforma: le prime 8 cifre dell'ID, non l'ID modificato. */
export function codiceTipologia(scatolaTypeId: string): string {
  return scatolaTypeId ? scatolaTypeId.slice(0, 8).toUpperCase() : "ND";
}

/**
 * Le tipologie come le dichiara La Scatola, nella forma delle impostazioni.
 * Le camere fisiche vengono da lì: è il motivo per cui la tabella compilata a mano può sparire.
 */
export function tipologieDaScatola(s: ScatolaSnapshot, hotelId: HotelId): RoomType[] {
  const casa = s.case.find((c) => c.hotelId === hotelId);
  if (!casa) return [];
  return casa.tipologie
    .slice()
    .sort((a, b) => b.camere - a.camere)
    .map((t, i) => ({
      code: codiceTipologia(t.id),
      label: t.etichetta ?? `Tipologia ${codiceTipologia(t.id)}`,
      count: t.camere,
      maxPax: 2,
      rank: i + 1,
    }));
}

/**
 * Le prenotazioni dello scatto nella forma della piattaforma.
 *
 * Canale, importo, data di prenotazione e stato vengono da `curated_reservations` e sono
 * quelli veri. `total` è `room_amount`, cioè l'importo della singola prenotazione: non va
 * ripartito fra le camere di un ordine, è già suo.
 *
 * Restano vuoti, e quindi elencati in `mancanti`, il piano tariffario e i tag di Slope: le
 * protezioni che si reggono su quei campi — non rimborsabile, tag NO OVERBOOKING — non
 * possono scattare, e la piattaforma lo dice invece di far credere che siano attive.
 */
export function prenotazioniDaScatola(s: ScatolaSnapshot, nomi?: Map<string, string>): Reservation[] {
  const perOrdine = new Map<string, number>();
  for (const p of s.prenotazioni) {
    if (p.orderId) perOrdine.set(p.orderId, (perOrdine.get(p.orderId) ?? 0) + 1);
  }
  return s.prenotazioni.map((p) => {
    const camereOrdine = p.orderId ? (perOrdine.get(p.orderId) ?? 1) : 1;
    const nome = nomi?.get(p.id) ?? null;
    const r: Reservation = {
      id: p.id,
      hotelId: p.hotelId,
      createdAt: p.createdAt,
      arrival: p.arrival,
      departure: p.departure,
      status: p.stato,
      cancelledAt: p.cancelledAt,
      channel: p.canale.toLowerCase(),
      channelRaw: p.agenzia || p.canale,
      roomType: codiceTipologia(p.scatolaTypeId),
      room: p.room,
      rooms: 1,
      adults: p.adults,
      children: p.children,
      total: p.total ?? 0,
      guest: nome ?? (p.room ? `Camera ${p.room}` : `Pren. ${p.id.slice(0, 8)}`),
      // L'ordine non è il cliente: un ordine raggruppa le camere prenotate insieme, e lo stesso
      // cliente può averne molti. Metterlo in `customerId` faceva sembrare ogni gruppo un ospite
      // che tiene aperte dieci prenotazioni sovrapposte. Il raggruppamento sta in `groupRef`,
      // che è il campo giusto e che il solver usa per non spezzare le prenotazioni multiple.
      customerId: null,
      email: "",
      groupRef: p.orderId,
      tags: "",
      rateName: "",
      payment: "",
      paymentStatus: p.openBalance != null && p.openBalance > 0 ? "saldo aperto" : "",
      paymentDue: null,
      nonRefundable: false,
      repeaterFlag: false,
      checkedIn: p.checkedIn,
      anonimo: !nome,
      source: "slope",
      sourceId: p.id,
      syncedAt: s.generato,
    };
    return r;
  });
}

export interface CapienzaNotte {
  camere: number;
  chiusure: number;
  confermate: number;
  opzioni: number;
}

/**
 * Capienza e occupazione per casa e per notte, sommate sulle tipologie.
 *
 * Attenzione a una cosa che non si vede: La Scatola **omette** la riga di una tipologia che in
 * quel giorno non ha né prenotazioni né chiusure. Una riga assente vuol dire tipologia
 * completamente libera, non tipologia inesistente. Le camere fisiche vengono quindi dalla
 * tabella delle tipologie, non dalla somma delle righe del giorno: sommare le righe
 * sottostimerebbe la capienza e farebbe apparire deficit che non esistono.
 */
export function capienzaPerNotte(s: ScatolaSnapshot): Map<HotelId, Map<string, CapienzaNotte>> {
  const perCasa = new Map<string, ScatolaCasa>(s.case.map((c) => [c.scatolaId, c]));
  const fisiche = new Map<HotelId, number>();
  for (const c of s.case) fisiche.set(c.hotelId, c.tipologie.reduce((n, t) => n + t.camere, 0));

  const out = new Map<HotelId, Map<string, CapienzaNotte>>();
  for (const [giorno, casaId, , , chiusure, confermate, opzioni] of s.capienza) {
    const casa = perCasa.get(casaId);
    if (!casa) continue;
    let perGiorno = out.get(casa.hotelId);
    if (!perGiorno) out.set(casa.hotelId, (perGiorno = new Map()));
    const v = perGiorno.get(giorno) ?? { camere: fisiche.get(casa.hotelId) ?? 0, chiusure: 0, confermate: 0, opzioni: 0 };
    v.chiusure += chiusure;
    v.confermate += confermate;
    v.opzioni += opzioni;
    perGiorno.set(giorno, v);
  }
  return out;
}

// ------------------------------------------------------------ nomi cifrati

function daBase64(s: string): Uint8Array {
  const b = atob(s);
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}

/**
 * Apre il blocco dei nomi con la password della reception. Stessa cifratura del counter
 * colazioni: PBKDF2-SHA256 e AES-GCM, con `generato` come dato autenticato, così un blocco di
 * ieri non si apre su uno scatto di oggi.
 *
 * I nomi restano in memoria. Non vengono salvati nell'archivio condiviso e non sopravvivono
 * alla chiusura della pagina.
 */
export async function apriNomi(b: BloccoCifrato, password: string, generato: string): Promise<Map<string, string>> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: daBase64(b.salt) as BufferSource, iterations: b.iter, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const chiaro = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: daBase64(b.iv) as BufferSource, additionalData: enc.encode(generato) },
    key,
    daBase64(b.ct) as BufferSource,
  );
  const j = JSON.parse(new TextDecoder().decode(chiaro)) as Record<string, string>;
  return new Map(Object.entries(j));
}

// ------------------------------------------------------------ da mostrare

/** Quante ore ha lo scatto. Serve per decidere se fidarsi, quindi va in testa alla pagina. */
export function etaOre(s: ScatolaSnapshot, adesso = Date.now()): number {
  const t = Date.parse(s.generato);
  return Number.isFinite(t) ? Math.max(0, (adesso - t) / 3_600_000) : NaN;
}

/**
 * La frase da mostrare sopra i numeri, o null se non c'è niente da segnalare.
 * Due casi diversi: lo scatto è vecchio, oppure lo scatto è di oggi ma La Scatola non si
 * aggiornava quando è stato preso. Il secondo è più insidioso del primo.
 */
export function avvisoScatola(s: ScatolaSnapshot, adesso = Date.now()): string | null {
  const ore = etaOre(s, adesso);
  const vecchio = Number.isFinite(ore) && ore >= 36;
  const fermo = s.freschezza.stato === "failing";
  if (!vecchio && !fermo) return null;
  const quando = Number.isFinite(ore)
    ? ore < 48 ? `${Math.round(ore)} ore` : `${Math.round(ore / 24)} giorni`
    : "un tempo imprecisato";
  if (fermo && vecchio) {
    return `Questi numeri hanno ${quando} e quando sono stati presi La Scatola non si aggiornava: ` +
      `prima di spostare qualcuno, controlla in Slope.`;
  }
  if (fermo) {
    return "Quando questo scatto è stato preso La Scatola non si aggiornava: i numeri sono gli " +
      "ultimi disponibili, non quelli di adesso. Le prenotazioni delle ultime ore possono mancare.";
  }
  return `Questi numeri hanno ${quando}: l'aggiornamento giornaliero non è passato. Controlla in Slope prima di decidere.`;
}
