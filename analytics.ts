import type { HotelId, ISODate, Reservation, SeasonEvent, Settings, WashCell, WashModel } from "./types";
import { addDays, diffDays, nights, todayISO, clamp } from "./util";

export const LEAD_BUCKETS = [0, 1, 3, 7, 14, 30, 60, 90, 180];
export const BUCKET_LABEL = ["giorno stesso", "1-2 gg", "3-6 gg", "7-13 gg", "14-29 gg", "30-59 gg", "60-89 gg", "90-179 gg", "180+ gg"];
const SHRINK = 25; // peso a priori (camere) per stabilizzare segmenti con pochi dati

export function bucketIdx(lead: number): number {
  let i = 0;
  for (let k = 0; k < LEAD_BUCKETS.length; k++) if (lead >= LEAD_BUCKETS[k]) i = k;
  return i;
}

// ---------- eventi / alta stagione ----------

function mmdd(d: ISODate): string { return d.slice(5); }

export function eventFor(d: ISODate, hotelId: HotelId | "gruppo", events: SeasonEvent[]): SeasonEvent | null {
  let found: SeasonEvent | null = null;
  for (const e of events) {
    if (hotelId !== "gruppo" && e.hotels.length && !e.hotels.includes(hotelId)) continue;
    let inside: boolean;
    if (e.recurringYearly) {
      const a = mmdd(e.from), b = mmdd(e.to), x = mmdd(d);
      inside = a <= b ? x >= a && x <= b : x >= a || x <= b;
    } else inside = d >= e.from && d <= e.to;
    if (inside && (!found || e.kind === "evento")) found = e; // l'evento specifico prevale sulla stagione
  }
  return found;
}

// ---------- modello di cancellazione ----------

function cellAdd(map: Map<string, WashCell>, key: string, alive: number, washed: number): void {
  const c = map.get(key) ?? { alive: 0, washed: 0 };
  c.alive += alive;
  c.washed += washed;
  map.set(key, c);
}

export function buildWashModel(all: Reservation[], s: Settings): WashModel {
  const today = todayISO();
  const cells = new Map<string, WashCell>();
  const seasonAgg = new Map<string, WashCell>(); // hotel|ev / hotel|norm (a 30 giorni)

  for (const r of all) {
    if (r.arrival >= today || !r.createdAt) continue; // esito non ancora noto
    const washedFinal = r.status === "cancellata" || r.status === "noshow";
    let cancelAt: ISODate | null = null;
    if (r.status === "cancellata") {
      cancelAt = r.cancelledAt ?? addDays(r.createdAt, Math.floor(Math.max(0, diffDays(r.arrival, r.createdAt)) / 2));
    }
    const isEv = !!eventFor(r.arrival, r.hotelId, s.events);
    LEAD_BUCKETS.forEach((b, bi) => {
      const checkpoint = addDays(r.arrival, -b);
      if (r.createdAt! > checkpoint) return;
      if (cancelAt && cancelAt <= checkpoint) return;
      const w = washedFinal ? r.rooms : 0;
      cellAdd(cells, `${r.hotelId}|${r.channel}|${bi}`, r.rooms, w);
      cellAdd(cells, `${r.hotelId}|*|${bi}`, r.rooms, w);
      cellAdd(cells, `*|*|${bi}`, r.rooms, w);
      if (b === 30) cellAdd(seasonAgg, `${r.hotelId}|${isEv ? "ev" : "norm"}`, r.rooms, w);
    });
  }

  const prior = s.defaultWashPct / 100;
  const seasonFactor = new Map<HotelId, number>();
  for (const h of s.hotels) {
    const ev = seasonAgg.get(`${h.id}|ev`);
    const no = seasonAgg.get(`${h.id}|norm`);
    if (ev && no && ev.alive >= 30 && no.alive >= 30) {
      const rEv = (ev.washed + SHRINK * prior) / (ev.alive + SHRINK);
      const rNo = (no.washed + SHRINK * prior) / (no.alive + SHRINK);
      seasonFactor.set(h.id, clamp(rEv / Math.max(0.01, rNo), 0.3, 1.5));
    } else seasonFactor.set(h.id, 0.8); // prudenza: in altissima stagione si cancella meno
  }
  return { buckets: LEAD_BUCKETS, cells, seasonFactor, prior };
}

function shrink(c: WashCell | undefined, parent: number): number {
  if (!c) return parent;
  return (c.washed + SHRINK * parent) / (c.alive + SHRINK);
}

/** Probabilità che una camera oggi in portafoglio non si presenti (cancellazione o no-show). */
export function washProb(m: WashModel, hotelId: HotelId, channel: string, lead: number): number {
  const bi = bucketIdx(Math.max(0, lead));
  const g = shrink(m.cells.get(`*|*|${bi}`), m.prior);
  const h = shrink(m.cells.get(`${hotelId}|*|${bi}`), g);
  if (channel === "*") return h;
  return shrink(m.cells.get(`${hotelId}|${channel}|${bi}`), h);
}

export function seasonMultiplier(m: WashModel, hotelId: HotelId, ev: SeasonEvent | null): number {
  if (!ev) return 1;
  if (ev.washMultiplier !== null && ev.washMultiplier > 0) return ev.washMultiplier;
  return m.seasonFactor.get(hotelId) ?? 0.8;
}

export function washSampleSize(m: WashModel, hotelId: HotelId | "*", bi: number): number {
  return m.cells.get(`${hotelId}|*|${bi}`)?.alive ?? 0;
}

// ---------- statistiche storiche ----------

export interface HotelStats {
  hotelId: HotelId;
  total: number;
  confirmed: number;
  cancelled: number;
  noshow: number;
  cancelPct: number;
  noshowPct: number;
  avgLead: number;
  avgLos: number;
  adr: number;
  adrNet: number;
  months: { month: string; occ: number; roomNights: number }[];
}

export function commissionFor(s: Settings, channel: string): number {
  return (s.channelCommission[channel] ?? 0) / 100;
}

export function netValue(s: Settings, r: Reservation): number {
  return r.total * (1 - commissionFor(s, r.channel));
}

export function hotelStats(all: Reservation[], s: Settings, hotelId: HotelId): HotelStats {
  const today = todayISO();
  const list = all.filter((r) => r.hotelId === hotelId && r.arrival < today);
  const h = s.hotels.find((x) => x.id === hotelId);
  const cap = h ? h.roomTypes.reduce((a, t) => a + t.count, 0) : 0;
  let conf = 0, canc = 0, ns = 0, leadSum = 0, leadN = 0, losSum = 0, rev = 0, revNet = 0, rn = 0;
  const since = addDays(today, -365);
  const monthRn = new Map<string, number>();
  for (const r of list) {
    if (r.status === "cancellata") canc += r.rooms;
    else if (r.status === "noshow") ns += r.rooms;
    else {
      conf += r.rooms;
      if (r.createdAt) { leadSum += diffDays(r.arrival, r.createdAt) * r.rooms; leadN += r.rooms; }
      const n = nights(r);
      losSum += n * r.rooms;
      if (r.arrival >= since) {
        rev += r.total;
        revNet += netValue(s, r);
        rn += n * r.rooms;
      }
      for (let i = 0; i < n; i++) {
        const d = addDays(r.arrival, i);
        if (d < since || d >= today) continue;
        const mk = d.slice(0, 7);
        monthRn.set(mk, (monthRn.get(mk) ?? 0) + r.rooms);
      }
    }
  }
  const totalRooms = conf + canc + ns;
  const months: HotelStats["months"] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const v = monthRn.get(mk) ?? 0;
    months.push({ month: mk, roomNights: v, occ: cap ? v / (cap * dim) : 0 });
  }
  const adr = rn ? rev / rn : 0;
  return {
    hotelId,
    total: totalRooms,
    confirmed: conf,
    cancelled: canc,
    noshow: ns,
    cancelPct: totalRooms ? canc / totalRooms : 0,
    noshowPct: conf + ns ? ns / (conf + ns) : 0,
    avgLead: leadN ? leadSum / leadN : 0,
    avgLos: conf ? losSum / conf : 0,
    adr,
    adrNet: h?.adrOverride ?? (rn ? revNet / rn : 0),
    months,
  };
}

export interface ChannelStat {
  channel: string;
  rooms: number;
  cancelPct: number;
  noshowPct: number;
  avgLead: number;
  netPerNight: number;
  score: number;
  verdict: "migliore" | "peggiore" | "";
}

/** Classifica oggettiva dei canali: valore netto per notte x affidabilità. */
export function channelStats(all: Reservation[], s: Settings, hotelId: HotelId | "gruppo"): ChannelStat[] {
  const today = todayISO();
  const agg = new Map<string, { rooms: number; canc: number; ns: number; lead: number; leadN: number; net: number; rn: number }>();
  for (const r of all) {
    if (r.arrival >= today) continue;
    if (hotelId !== "gruppo" && r.hotelId !== hotelId) continue;
    const a = agg.get(r.channel) ?? { rooms: 0, canc: 0, ns: 0, lead: 0, leadN: 0, net: 0, rn: 0 };
    a.rooms += r.rooms;
    if (r.status === "cancellata") a.canc += r.rooms;
    else if (r.status === "noshow") a.ns += r.rooms;
    else {
      a.net += netValue(s, r);
      a.rn += nights(r) * r.rooms;
      if (r.createdAt) { a.lead += diffDays(r.arrival, r.createdAt) * r.rooms; a.leadN += r.rooms; }
    }
    agg.set(r.channel, a);
  }
  const out: ChannelStat[] = [];
  for (const [channel, a] of agg) {
    if (a.rooms < 5) continue;
    const cancelPct = a.canc / a.rooms;
    const noshowPct = a.ns / Math.max(1, a.rooms - a.canc);
    const netPerNight = a.rn ? a.net / a.rn : 0;
    out.push({ channel, rooms: a.rooms, cancelPct, noshowPct, avgLead: a.leadN ? a.lead / a.leadN : 0, netPerNight, score: netPerNight * (1 - cancelPct) * (1 - noshowPct), verdict: "" });
  }
  out.sort((x, y) => y.score - x.score);
  const k = Math.min(3, Math.floor(out.length / 2));
  out.forEach((c, i) => { if (i < k) c.verdict = "migliore"; else if (i >= out.length - k) c.verdict = "peggiore"; });
  return out;
}
