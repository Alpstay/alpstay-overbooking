// Cancellazione per motivo valido: si propone solo quando i dati la giustificano.
// Nessun motivo viene inventato: ogni proposta porta con sé la prova che la sostiene.
import type { HotelId, ISODate, OutOfOrder, Reservation, Settings } from "./types";
import { isActive } from "./forecast";
import { addDays, diffDays, fmtDate, normText, todayISO } from "./util";
import { resKey } from "./importer";

export type CancelGround = "carta-non-valida" | "mancato-pagamento" | "camera-inagibile";

export const GROUND_LABEL: Record<CancelGround, string> = {
  "carta-non-valida": "Garanzia non valida",
  "mancato-pagamento": "Caparra non pagata",
  "camera-inagibile": "Camera inagibile",
};

export const GROUND_SHORT: Record<CancelGround, string> = {
  "carta-non-valida": "carta",
  "mancato-pagamento": "caparra",
  "camera-inagibile": "tecnico",
};

export interface CancelCase {
  res: Reservation;
  ground: CancelGround;
  /** La prova, in parole: va scritta nella pratica e detta all'ospite. */
  prova: string;
  /** Giorni da concedere prima di annullare davvero. */
  preavviso: number;
  /** Vero quando la prenotazione è protetta: decide una persona, non il piano. */
  protetta: boolean;
  room?: string;
}

function words(s: string): string[] {
  return String(s ?? "").split(",").map((w) => normText(w)).filter(Boolean);
}

function matches(txt: string, ws: string[]): boolean {
  if (!ws.length) return false;
  const t = ` ${normText(txt)} `;
  return ws.some((w) => t.includes(` ${w} `));
}

const NEGAZIONI = ["non", "nessun", "nessuna", "mancato", "mancata", "senza", "no", "not", "never"];

/**
 * Come matches, ma ignora le occorrenze negate: "caparra non pagata" non conta
 * come pagata, "senza garanzia" non conta come garanzia valida.
 */
function matchesPositive(txt: string, ws: string[]): boolean {
  if (!ws.length) return false;
  const t = normText(txt).split(/\s+/).filter(Boolean);
  const pulito: string[] = [];
  for (let i = 0; i < t.length; i++) {
    if (NEGAZIONI.includes(t[i])) { i++; continue; }  // salta la negazione e la parola che regge
    pulito.push(t[i]);
  }
  const s2 = ` ${pulito.join(" ")} `;
  return ws.some((w) => s2.includes(` ${w} `));
}

/** La camera è dichiarata fuori servizio in quelle notti? */
export function outOfOrderFor(res: Reservation, list: OutOfOrder[]): OutOfOrder | null {
  if (!res.room) return null;
  const r = normText(res.room);
  for (const o of list) {
    if (o.hotelId !== res.hotelId || normText(o.room) !== r) continue;
    if (res.arrival < o.to && o.from < res.departure) return o;
  }
  return null;
}

export interface CancelResult {
  byRes: Map<string, CancelCase>;
  lista: CancelCase[];
}

export function detectCancellable(list: Reservation[], s: Settings, protetta: (r: Reservation) => boolean): CancelResult {
  const today = todayISO();
  const c = s.rules.cancellation;
  const preavviso = Math.max(1, Number(c.preavvisoGiorni) || 3);
  const depositDays = Math.max(0, Number(c.depositDays) || 0);
  const wGar = words(c.noGuaranteeWords);
  const wPag = words(c.unpaidWords);
  const wOk = words(c.paidWords);
  const byRes = new Map<string, CancelCase>();

  for (const r of list) {
    if (!isActive(r) || r.arrival < today || r.checkedIn) continue;
    const pagamento = `${r.payment} ${r.paymentStatus}`;
    const gia = matchesPositive(pagamento, wOk);

    // 1) camera dichiarata fuori servizio: è un fatto nostro, lo dichiara la direzione
    const oo = outOfOrderFor(r, s.rules.outOfOrder);
    if (oo) {
      byRes.set(resKey(r), {
        res: r, ground: "camera-inagibile", protetta: protetta(r), room: r.room ?? "",
        preavviso: 0,
        prova: `Camera ${r.room} dichiarata fuori servizio dal ${fmtDate(oo.from)} al ${fmtDate(oo.to)}${oo.motivo ? ` — ${oo.motivo}` : ""}.`,
      });
      continue;
    }
    if (gia) continue;

    // 2) caparra non pagata oltre la scadenza
    const scadenza = r.paymentDue ?? (r.createdAt && depositDays > 0 ? addDays(r.createdAt, depositDays) : null);
    const nonPagata = matches(pagamento, wPag);
    if (scadenza && scadenza < today && (nonPagata || r.paymentDue)) {
      byRes.set(resKey(r), {
        res: r, ground: "mancato-pagamento", protetta: protetta(r), preavviso,
        prova: `Caparra attesa entro il ${fmtDate(scadenza)}, a oggi non risulta pagata${r.paymentStatus ? ` (stato in Slope: «${r.paymentStatus}»)` : ""}: sono passati ${diffDays(today, scadenza)} giorni.`,
      });
      continue;
    }

    // 3) garanzia non valida
    if (matches(pagamento, wGar)) {
      byRes.set(resKey(r), {
        res: r, ground: "carta-non-valida", protetta: protetta(r), preavviso,
        prova: `Lo stato registrato in Slope è «${r.paymentStatus || r.payment}».`,
      });
    }
  }

  const ordine: CancelGround[] = ["camera-inagibile", "carta-non-valida", "mancato-pagamento"];
  const lista = [...byRes.values()].sort((a, b) =>
    ordine.indexOf(a.ground) - ordine.indexOf(b.ground) || a.res.arrival.localeCompare(b.res.arrival));
  return { byRes, lista };
}

/** Riepilogo per casa, per la pagina Problem solving. */
export function countByHotel(l: CancelCase[]): Map<HotelId, number> {
  const m = new Map<HotelId, number>();
  for (const x of l) m.set(x.res.hotelId, (m.get(x.res.hotelId) ?? 0) + x.res.rooms);
  return m;
}

export function scadenzaRisposta(x: CancelCase, oggi: ISODate = todayISO()): ISODate {
  const limite = addDays(x.res.arrival, -1);
  const proposta = addDays(oggi, Math.max(0, Number(x.preavviso) || 0));
  return proposta > limite ? limite : proposta;
}
