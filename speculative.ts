// Rilevamento delle prenotazioni speculative ("furbetti"):
// lo stesso ospite tiene aperte più prenotazioni che non può usare tutte,
// e ne cancellerà alcune poco prima dell'arrivo.
import type { HotelId, ISODate, Reservation, Settings } from "./types";
import { isActive } from "./forecast";
import { diffDays, normText, todayISO } from "./util";
import { resKey } from "./importer";

export type SpecLevel = "alta" | "media";
export type SpecKind = "case-diverse" | "sovrapposte" | "periodi-multipli";

export const SPEC_KIND_LABEL: Record<SpecKind, string> = {
  "case-diverse": "Stesse notti in case diverse",
  sovrapposte: "Notti sovrapposte nella stessa casa",
  "periodi-multipli": "Più periodi tenuti aperti",
};

export interface SpecFlag {
  res: Reservation;
  level: SpecLevel;
  kind: SpecKind;
  others: Reservation[];      // le altre prenotazioni dello stesso ospite
  pastCancels: number;        // cancellazioni già fatte in passato
  note: string;               // spiegazione pronta da mostrare
  penalty: number;            // 0..1, quanto pesa nella scelta di chi spostare
}

/** Chiave di identità dell'ospite: ID cliente di Slope, altrimenti nome e cognome. */
export function guestKey(r: Reservation): string | null {
  if (r.customerId && r.customerId.trim()) return "c:" + normText(r.customerId);
  const n = normText(r.guest);
  return n.split(" ").filter(Boolean).length >= 2 ? "n:" + n : null;
}

function overlaps(a: Reservation, b: Reservation): boolean {
  return a.arrival < b.departure && b.arrival < a.departure;
}

function sameDates(a: Reservation, b: Reservation): boolean {
  return a.arrival === b.arrival && a.departure === b.departure;
}

function hotelName(s: Settings, id: HotelId): string {
  return s.hotels.find((h) => h.id === id)?.name ?? id;
}

function fmtShort(d: ISODate): string {
  const [, m, dd] = d.split("-");
  return `${+dd}/${+m}`;
}

export interface SpecResult {
  /** chiave prenotazione -> segnalazione */
  byRes: Map<string, SpecFlag>;
  /** un gruppo per ospite, ordinato per gravità */
  groups: { key: string; guest: string; level: SpecLevel; flags: SpecFlag[] }[];
}

export function detectSpeculative(list: Reservation[], s: Settings): SpecResult {
  const today = todayISO();
  const win = s.rules.speculativeWindowDays;
  const byGuest = new Map<string, Reservation[]>();
  const cancels = new Map<string, number>();

  for (const r of list) {
    const k = guestKey(r);
    if (!k) continue;
    if (r.status === "cancellata" || r.status === "noshow") {
      cancels.set(k, (cancels.get(k) ?? 0) + 1);
      continue;
    }
    // solo arrivi futuri: chi è già in casa o è appena partito non sta speculando
    if (!isActive(r) || r.arrival < today) continue;
    byGuest.set(k, [...(byGuest.get(k) ?? []), r]);
  }

  const byRes = new Map<string, SpecFlag>();
  const groups: SpecResult["groups"] = [];

  for (const [k, rs] of byGuest) {
    if (rs.length < 2) continue;
    const past = cancels.get(k) ?? 0;
    const flags = new Map<string, SpecFlag>();

    const put = (r: Reservation, other: Reservation, kind: SpecKind, level: SpecLevel): void => {
      const key = resKey(r);
      const prev = flags.get(key);
      const rank = (l: SpecLevel): number => (l === "alta" ? 2 : 1);
      if (prev && rank(prev.level) >= rank(level)) {
        if (!prev.others.some((x) => x.id === other.id)) prev.others.push(other);
        return;
      }
      flags.set(key, {
        res: r, level, kind,
        others: prev ? [...prev.others.filter((x) => x.id !== other.id), other] : [other],
        pastCancels: past, note: "", penalty: 0,
      });
    };

    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j];
        if (overlaps(a, b)) {
          if (a.hotelId !== b.hotelId) { put(a, b, "case-diverse", "alta"); put(b, a, "case-diverse", "alta"); }
          else if (!sameDates(a, b)) { put(a, b, "sovrapposte", "media"); put(b, a, "sovrapposte", "media"); }
          // stesse date nella stessa casa: quasi sempre due camere della stessa comitiva, non si segnala
        } else if (Math.abs(diffDays(a.arrival, b.arrival)) <= win) {
          put(a, b, "periodi-multipli", "media");
          put(b, a, "periodi-multipli", "media");
        }
      }
    }
    if (!flags.size) continue;

    // due cancellazioni già fatte in passato alzano il livello
    for (const f of flags.values()) {
      if (past >= 2 && f.level === "media") f.level = "alta";
      const others = f.others.map((o) => `${hotelName(s, o.hotelId)} ${fmtShort(o.arrival)}–${fmtShort(o.departure)} (${o.id})`).join(", ");
      const parts: string[] = [];
      if (f.kind === "case-diverse") parts.push(`stesse notti anche in un'altra casa: ${others}`);
      else if (f.kind === "sovrapposte") parts.push(`notti sovrapposte con un'altra sua prenotazione: ${others}`);
      else parts.push(`tiene aperto anche un altro periodo: ${others}`);
      if (past) parts.push(`${past === 1 ? "1 cancellazione" : `${past} cancellazioni`} già fatte in passato`);
      if (f.res.nonRefundable) parts.push("questa però è prepagata, quindi non la cancellerà");
      f.note = parts.join(" · ");
      f.penalty = f.res.nonRefundable ? 0 : f.level === "alta" ? 1 : 0.55;
      byRes.set(resKey(f.res), f);
    }
    const arr = [...flags.values()];
    groups.push({ key: k, guest: arr[0].res.guest || k, level: arr.some((f) => f.level === "alta") ? "alta" : "media", flags: arr });
  }

  groups.sort((a, b) => (a.level === b.level ? b.flags.length - a.flags.length : a.level === "alta" ? -1 : 1));
  return { byRes, groups };
}
