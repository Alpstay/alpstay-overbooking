// Persistenza: database condiviso dell'artifact (tutti i receptionist vedono gli stessi dati).
// Se il database non è disponibile si lavora in locale sul browser.
import type { Reservation, Settings, Meta, ManualLock, HotelId, WaitEntry, MailLogEntry } from "./types";
import type { ObCase } from "./cases";
import { roomsOk } from "./importer";
import { initFirebase } from "./firebase";
import { firebaseConfigurato } from "./firebase-config";

interface DocSnap { exists: boolean; data(): Record<string, unknown> | undefined; }
interface DocRef {
  get(): Promise<DocSnap>;
  set(d: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  onSnapshot(next: (s: DocSnap) => void, err?: (e: { code: string }) => void): () => void;
}
interface DB { doc(path: string): DocRef; }
interface DownloadsNS { save(o: { filename: string; data: Blob | string | ArrayBuffer }): Promise<unknown>; }
interface UserNS { can?(name: string): Promise<boolean | null> | boolean | null; }
interface ClaudeUse { use(name: string): Promise<unknown>; }

declare global {
  interface Window { claude?: ClaudeUse; }
}

const CHUNK = 700; // prenotazioni per documento (~160 KiB, sotto il limite di 256 KiB)
// i codici con il trattino sono quelli di Firestore, quelli con l'underscore dell'artifact
const RETRY_CODES = ["resource_exhausted", "unavailable", "queue_overflow", "resource-exhausted", "deadline-exceeded", "aborted", "internal"];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Messaggio comprensibile per chi sta alla reception. */
function describeDbError(e: { code?: string; message?: string } | null): string {
  switch (e?.code) {
    case "permission-denied": return "Il database ha rifiutato la scrittura: il tuo accesso non ha i permessi, oppure la sessione è scaduta. Esci e rientra.";
    case "unauthenticated": return "La sessione è scaduta. Esci e rientra per continuare a salvare.";
    case "failed-precondition": return "Il database non è pronto: controlla che Firestore sia stato creato nella console Firebase.";
    case "deadline-exceeded": return "Il salvataggio ha impiegato troppo: controlla la connessione e riprova.";
    case "resource-exhausted":
    case "resource_exhausted": return "Il salvataggio è stato rifiutato per troppe scritture ravvicinate. Riprova fra un minuto: i dati già salvati restano.";
    case "quota_exceeded": return "Lo spazio dati della piattaforma è pieno. Elimina i dati dimostrativi o lo storico più vecchio, poi riprova.";
    case "invalid_argument": return "Un blocco di dati è troppo grande o non valido e non è stato salvato. Segnalalo: va ridotta la dimensione dei blocchi.";
    case "revoked": return "Il permesso di scrittura è stato tolto mentre salvavo. Ricarica la pagina.";
    case "not_granted":
    case "capability_disabled":
    case "capability_removed": return "Questa pagina non può salvare i dati condivisi. Ricarica la pagina; se il problema resta, riapri il link.";
    default: return `Salvataggio non riuscito${e?.code ? ` (${e.code})` : ""}. ${e?.message ?? "Riprova fra poco."}`;
  }
}
const LS = "alpstay-ob:";

type Compact = (string | number | boolean | null)[];

const KEYS: (keyof Reservation)[] = [
  "id", "hotelId", "createdAt", "arrival", "departure", "status", "cancelledAt", "channel", "channelRaw",
  "roomType", "room", "rooms", "adults", "children", "total", "guest", "customerId", "groupRef", "tags",
  "rateName", "payment", "paymentStatus", "paymentDue", "nonRefundable", "repeaterFlag", "checkedIn", "syncedAt",
];

/**
 * Una prenotazione diventa una riga di testo: i valori nell'ordine di KEYS, in JSON.
 * Il testo serve perché Firestore non accetta liste dentro liste, e un blocco di
 * prenotazioni è proprio questo. Le righe restano compatte quanto prima.
 */
function pack(r: Reservation): string {
  return JSON.stringify(KEYS.map((k) => r[k] as string | number | boolean | null));
}
}
let repaired = 0;

/** Quante prenotazioni salvate avevano un numero di camere impossibile. */
export function takeRepaired(): number {
  const n = repaired;
  repaired = 0;
  return n;
}

function unpack(a: Compact): Reservation {
  const o: Record<string, unknown> = {};
  KEYS.forEach((k, i) => (o[k] = a[i]));
  o.source = "slope";
  o.sourceId = o.id;
  const ok = roomsOk(o.rooms);
  if (ok !== o.rooms) { repaired++; o.rooms = ok; }
  return o as unknown as Reservation;
}

export class Store {
  private db: DB | null = null;
  downloads: DownloadsNS | null = null;
  mode: "cloud" | "locale" = "locale";
  canWrite = true;

  async init(): Promise<void> {
    const c = window.claude;
    if (c && typeof c.use === "function") {
      try {
        const [db, dl, user] = await Promise.all([
          c.use("db") as Promise<DB | null>,
          c.use("downloads") as Promise<DownloadsNS | null>,
          c.use("user") as Promise<UserNS | null>,
        ]);
        this.db = db;
        this.downloads = dl;
        if (db) this.mode = "cloud";
        if (user && typeof user.can === "function") {
          const w = await user.can("data.write");
          if (w === false) this.canWrite = false;
        }
      } catch {
        this.db = null;
      }
    }
    // Fuori dall'artifact: se Firebase è configurato e c'è un utente collegato, si scrive lì.
    if (!this.db && firebaseConfigurato()) {
      try {
        const h = await initFirebase();
        if (h.auth.currentUser) {
          this.db = h.db as unknown as DB;
          this.mode = "cloud";
        }
      } catch {
        this.db = null;   // la piattaforma continua in locale, il motivo lo dice la schermata di accesso
      }
    }
  }

  private async read(path: string): Promise<Record<string, unknown> | null> {
    if (this.db) {
      const s = await this.db.doc(path).get();
      return s.exists ? (s.data() ?? null) : null;
    }
    try {
      const raw = localStorage.getItem(LS + path);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private async write(path: string, data: Record<string, unknown>): Promise<void> {
    if (this.db) {
      // il database condiviso può rifiutare una raffica di scritture: si riprova con pause crescenti
      let last: unknown = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await this.db.doc(path).set(data);
          return;
        } catch (e) {
          last = e;
          const code = (e as { code?: string }).code ?? "";
          if (!RETRY_CODES.includes(code)) break;
          await sleep(500 * (attempt + 1) * (attempt + 1));
        }
      }
      const err = last as { code?: string; message?: string } | null;
      throw new Error(describeDbError(err));
    }
    try {
      localStorage.setItem(LS + path, JSON.stringify(data));
    } catch (e) {
      throw new Error("Spazio del browser esaurito: riduci lo storico importato o apri la piattaforma dal link pubblicato.");
    }
  }

  private async remove(path: string): Promise<void> {
    if (this.db) return this.db.doc(path).delete();
    try { localStorage.removeItem(LS + path); } catch { /* ignora */ }
  }

  async loadSettings(): Promise<Settings | null> {
    return (await this.read("config/settings")) as Settings | null;
  }
  async saveSettings(s: Settings): Promise<void> {
    await this.write("config/settings", s as unknown as Record<string, unknown>);
  }

  async loadMeta(): Promise<Meta | null> {
    return (await this.read("config/meta")) as Meta | null;
  }
  async saveMeta(m: Meta): Promise<void> {
    await this.write("config/meta", m as unknown as Record<string, unknown>);
  }

  async loadLocks(): Promise<Record<string, ManualLock>> {
    return ((await this.read("config/locks")) as Record<string, ManualLock> | null) ?? {};
  }
  async saveLocks(l: Record<string, ManualLock>): Promise<void> {
    await this.write("config/locks", l as unknown as Record<string, unknown>);
  }

  async loadWaitlist(): Promise<WaitEntry[]> {
    const d = await this.read("config/waitlist");
    return ((d?.entries as WaitEntry[] | undefined) ?? []);
  }
  async saveWaitlist(e: WaitEntry[]): Promise<void> {
    await this.write("config/waitlist", { entries: e });
  }

  async loadCases(meta: Meta): Promise<ObCase[]> {
    const out: ObCase[] = [];
    for (let i = 0; i < (meta.caseChunks ?? 0); i++) {
      const d = await this.read(`cases/${i}`);
      for (const r of (d?.rows as ObCase[] | undefined) ?? []) out.push(r);
    }
    return out;
  }
  /** Riscrive il registro a blocchi. Ritorna il numero di blocchi. */
  async saveCases(list: ObCase[], prev: number): Promise<number> {
    const size = 200;
    const n = Math.max(1, Math.ceil(list.length / size));
    for (let i = 0; i < n; i++) await this.write(`cases/${i}`, { rows: list.slice(i * size, (i + 1) * size) });
    for (let i = n; i < prev; i++) await this.remove(`cases/${i}`);
    return n;
  }

  async loadMails(): Promise<MailLogEntry[]> {
    const d = await this.read("config/mails");
    return (d as { rows?: MailLogEntry[] } | null)?.rows ?? [];
  }

  async saveMails(l: MailLogEntry[]): Promise<void> {
    // si tiene la corrispondenza recente: basta e avanza per il lavoro quotidiano
    await this.write("config/mails", { rows: l.slice(-1500) });
  }

  async loadDone(): Promise<Record<string, string>> {
    return ((await this.read("config/done")) as Record<string, string> | null) ?? {};
  }
  async saveDone(d: Record<string, string>): Promise<void> {
    await this.write("config/done", d);
  }

  async loadMapping(): Promise<Record<string, string>> {
    return ((await this.read("config/mapping")) as Record<string, string> | null) ?? {};
  }
  async saveMapping(m: Record<string, string>): Promise<void> {
    await this.write("config/mapping", m);
  }

  async loadReservations(meta: Meta): Promise<Reservation[]> {
    const out: Reservation[] = [];
    const jobs: Promise<void>[] = [];
    for (const [hotel, n] of Object.entries(meta.chunks)) {
      for (let i = 0; i < n; i++) {
        jobs.push(
          this.read(`res/${hotel}-${i}`).then((d) => {
            const rows = (d?.rows as Compact[] | undefined) ?? [];
            for (const r of rows) out.push(unpack(r));
          }),
        );
      }
    }
    await Promise.all(jobs);
    return out;
  }

  /** Riscrive i blocchi di una casa. Ritorna il nuovo numero di blocchi. */
  async saveHotelReservations(hotel: HotelId, list: Reservation[], prevChunks: number, progress?: (fatto: number, totale: number) => void): Promise<number> {
    const n = Math.ceil(list.length / CHUNK);
    for (let i = 0; i < n; i++) {
      await this.write(`res/${hotel}-${i}`, { rows: list.slice(i * CHUNK, (i + 1) * CHUNK).map(pack) });
      progress?.(i + 1, n);
      if (this.db && i < n - 1) await sleep(120); // respiro fra una scrittura e l'altra
    }
    for (let i = n; i < prevChunks; i++) await this.remove(`res/${hotel}-${i}`);
    return n;
  }

  watchMeta(cb: (m: Meta) => void): void {
    if (!this.db) return;
    this.db.doc("config/meta").onSnapshot(
      (s) => { if (s.exists) cb(s.data() as unknown as Meta); },
      () => { /* la pagina continua a funzionare con i dati caricati */ },
    );
  }

  async saveFile(filename: string, data: Blob): Promise<"ok" | "declined" | "fallback"> {
    if (this.downloads) {
      try {
        await this.downloads.save({ filename, data });
        return "ok";
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === "declined") return "declined";
      }
    }
    // Fuori dal visualizzatore (anteprima / file locale) un link diretto funziona.
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return "fallback";
  }
}
