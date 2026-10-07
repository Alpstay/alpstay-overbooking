import type { DayForecast, Hotel, ISODate, Reservation, Settings, WashModel } from "./types";
import { eventFor, hotelStats, seasonMultiplier, washProb } from "./analytics";
import { addDays, diffDays, normCdf, todayISO } from "./util";
import type { Protector } from "./protect";

export function capacityOf(h: Hotel): number {
  return h.roomTypes.reduce((a, t) => a + t.count, 0);
}

export function isActive(r: Reservation): boolean {
  return r.status === "confermata" || r.status === "opzione";
}

interface Dist { mean: number; sd: number; }

function massAt(k: number, n: number, d: Dist): number {
  const lo = k === 0 ? 0 : normCdf((k - 0.5 - d.mean) / d.sd);
  const hi = k === n ? 1 : normCdf((k + 0.5 - d.mean) / d.sd);
  return Math.max(0, hi - lo);
}

/** Resa attesa vendendo n camere con capacità c (ricavo netto delle camere occupate meno costo dei walk). */
function expectedValue(n: number, c: number, d: Dist, adr: number, walkCost: number): number {
  let v = 0;
  for (let k = 0; k <= n; k++) {
    const p = massAt(k, n, d);
    if (p < 1e-7) continue;
    const shows = n - k;
    v += p * (adr * Math.min(shows, c) - walkCost * Math.max(0, shows - c));
  }
  return v;
}

export function forecastHotel(
  all: Reservation[],
  s: Settings,
  model: WashModel,
  hotel: Hotel,
  protector: Protector,
  days: number,
): DayForecast[] {
  const today = todayISO();
  const cap = capacityOf(hotel);
  const stats = hotelStats(all, s, hotel.id);
  const adr = stats.adrNet > 0 ? stats.adrNet : 150;
  const risk = s.riskMaxPct / 100;
  const active = all.filter((r) => r.hotelId === hotel.id && isActive(r) && r.departure > today);
  const protectedSet = new Set(active.filter((r) => protector.reasons(r).length > 0).map((r) => r.id));

  // indice notte -> prenotazioni
  const byNight = new Map<ISODate, Reservation[]>();
  const end = addDays(today, days);
  for (const r of active) {
    let d = r.arrival < today ? today : r.arrival;
    while (d < r.departure && d < end) {
      const arr = byNight.get(d) ?? [];
      arr.push(r);
      byNight.set(d, arr);
      d = addDays(d, 1);
    }
  }

  const out: DayForecast[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i);
    const ev = eventFor(d, hotel.id, s.events);
    const mult = seasonMultiplier(model, hotel.id, ev);
    const list = byNight.get(d) ?? [];
    let otb = 0, E = 0, V = 0, prot = 0;
    for (const r of list) {
      otb += r.rooms;
      if (protectedSet.has(r.id)) prot += r.rooms;
      let p: number;
      if (r.checkedIn || r.arrival < today) p = 0;
      else p = Math.min(0.9, washProb(model, hotel.id, r.channel, diffDays(r.arrival, today)) * mult);
      E += p * r.rooms;
      V += p * (1 - p) * r.rooms;
    }
    const pNew = Math.min(0.9, washProb(model, hotel.id, "*", Math.floor(i / 2)) * mult);
    const maxPct = ev?.maxOverbookPct ?? hotel.maxOverbookPct;
    const maxExtra = Math.floor((cap * maxPct) / 100 + 1e-9);

    let bestN = cap;
    let bestV = -Infinity;
    for (let n = cap; n <= cap + maxExtra; n++) {
      const m = Math.max(0, n - otb);
      const base = n >= otb ? { e: E, v: V } : { e: (E * n) / Math.max(1, otb), v: (V * n) / Math.max(1, otb) };
      const dist: Dist = { mean: base.e + m * pNew, sd: Math.max(0.3, Math.sqrt(base.v + m * pNew * (1 - pNew))) };
      const pWalk = n <= cap ? 0 : normCdf((n - cap - 0.5 - dist.mean) / dist.sd);
      if (pWalk > risk) break;
      const val = expectedValue(n, cap, dist, adr, hotel.walkCost);
      if (val > bestV + 0.01) { bestV = val; bestN = n; }
    }
    const frozen = i <= s.freezeDays;
    const ceiling = frozen ? Math.max(cap, Math.min(bestN, otb)) : bestN;
    const sdNow = Math.max(0.3, Math.sqrt(V));
    const walkRisk = otb <= cap ? 0 : normCdf((otb - cap - 0.5 - E) / sdNow);
    out.push({
      date: d,
      hotelId: hotel.id,
      capacity: cap,
      otb,
      protectedRooms: prot,
      expCancel: E,
      sdCancel: Math.sqrt(V),
      expOccPct: cap ? Math.min(1, (otb - E) / cap) : 0,
      ceiling,
      headroom: ceiling - otb,
      walkRiskPct: walkRisk,
      leadDays: i,
      frozen,
      event: ev,
      maxPct,
    });
  }
  return out;
}

export function forecastGroup(perHotel: DayForecast[][]): DayForecast[] {
  if (!perHotel.length) return [];
  return perHotel[0].map((d0, i) => {
    const rows = perHotel.map((h) => h[i]);
    const cap = rows.reduce((a, r) => a + r.capacity, 0);
    const otb = rows.reduce((a, r) => a + r.otb, 0);
    const E = rows.reduce((a, r) => a + r.expCancel, 0);
    const ceiling = rows.reduce((a, r) => a + r.ceiling, 0);
    return {
      ...d0,
      hotelId: "gruppo",
      capacity: cap,
      otb,
      protectedRooms: rows.reduce((a, r) => a + r.protectedRooms, 0),
      expCancel: E,
      sdCancel: Math.sqrt(rows.reduce((a, r) => a + r.sdCancel ** 2, 0)),
      expOccPct: cap ? Math.min(1, (otb - E) / cap) : 0,
      ceiling,
      headroom: ceiling - otb,
      walkRiskPct: 1 - rows.reduce((a, r) => a * (1 - r.walkRiskPct), 1),
      event: rows.find((r) => r.event)?.event ?? null,
    };
  });
}

export type DayAction = "vendi" | "stop" | "rischio" | "pieno" | "libero";

export function actionOf(f: DayForecast): DayAction {
  if (f.otb > f.ceiling) return "rischio";
  if (f.headroom > 0 && f.otb >= f.capacity) return "vendi"; // già piena: si può andare in overbooking
  if (f.headroom <= 0 && f.otb >= f.capacity) return "stop";
  if (f.otb >= f.capacity * 0.85) return "pieno";
  return "libero";
}
