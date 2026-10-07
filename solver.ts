import type { GridBooking, GridRoom, Hotel, HotelId, ISODate, MoveDecision, OrphanGap, Reservation, RoomMove, RoomType, Settings, SolveResult } from "./types";
import { resKey } from "./importer";
import type { Protector } from "./protect";
import type { SpecResult, SpecFlag } from "./speculative";
import type { CancelResult, CancelCase } from "./cancellable";
import { GROUND_LABEL, scadenzaRisposta } from "./cancellable";
import { REASON_LABEL } from "./protect";
import { isActive } from "./forecast";
import { netValue } from "./analytics";
import { addDays, diffDays, eur, fmtDate, normText, rangeDays, todayISO, toUTC } from "./util";

interface Placed {
  r: Reservation;
  hotelId: HotelId;
  type: string;
  origin: "originale" | "upgrade" | "entrata";
  keep: number;
  net: number;
  vn: number;      // percentile del valore netto (0 = il più basso)
  early: number;   // 1 = prenotata per prima
  protectedBy: string[];
  locked: boolean;
  spec?: SpecFlag;
  canc?: CancelCase;     // tag Slope, blocco manuale o già in casa: camera e tipologia non si toccano
}

type Usage = Map<string, number[]>; // `${hotel}|${type}` -> camere occupate per notte

export function typeOf(h: Hotel, r: Reservation): { code: string; known: boolean } {
  const raw = normText(r.roomType);
  const exact = h.roomTypes.find((t) => normText(t.code) === raw || normText(t.label) === raw);
  if (exact) return { code: exact.code, known: true };
  const partial = h.roomTypes.find((t) => raw && (raw.includes(normText(t.code)) || raw.includes(normText(t.label)) || normText(t.label).includes(raw)));
  if (partial) return { code: partial.code, known: true };
  const pax = paxPerRoom(r);
  const fit = [...h.roomTypes].sort((a, b) => a.maxPax - b.maxPax).find((t) => t.maxPax >= pax) ?? h.roomTypes[0];
  return { code: fit.code, known: false };
}

export function paxPerRoom(r: Reservation): number {
  return Math.max(1, Math.ceil((r.adults + r.children) / Math.max(1, r.rooms)));
}

export function solve(all: Reservation[], s: Settings, protector: Protector, fromIn: ISODate, windowDays: number, spec?: SpecResult, cancel?: CancelResult): SolveResult {
  const today = todayISO();
  const from = fromIn < today ? today : fromIn;
  const winEnd = addDays(from, windowDays);
  const warnings: string[] = [];
  const hotels = new Map(s.hotels.map((h) => [h.id, h]));

  // 1) insieme rilevante (con estensione per soggiorni che escono dalla finestra)
  let rel = all.filter((r) => isActive(r) && hotels.has(r.hotelId) && r.arrival < winEnd && r.departure > from);
  const extEnd = rel.reduce((m, r) => (r.departure > m ? r.departure : m), winEnd);
  rel = all.filter((r) => isActive(r) && hotels.has(r.hotelId) && r.arrival < extEnd && r.departure > from);
  const span = diffDays(extEnd, from);
  const idxRange = (r: Reservation): [number, number] => [Math.max(0, diffDays(r.arrival, from)), Math.min(span, diffDays(r.departure, from))];

  // 2) punteggio di permanenza (più alto = resta). Ranghi percentili: robusti agli importi dei gruppi.
  const pctRank = (vals: number[]): ((v: number) => number) => {
    const sorted = [...vals].sort((a, b) => a - b);
    return (v: number): number => {
      if (sorted.length < 2) return 0.5;
      let lo = 0, hi = sorted.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
      return lo / (sorted.length - 1);
    };
  };
  // Importo 0 = dato mancante nell'export (tipico del channel manager): non deve far spostare quella prenotazione per prima.
  const knownNets = rel.filter((r) => r.total > 0).map((r) => netValue(s, r)).sort((a, b) => a - b);
  const medianNet = knownNets.length ? knownNets[Math.floor(knownNets.length / 2)] : 0;
  const effNet = (r: Reservation): number => (r.total > 0 ? netValue(s, r) : medianNet);
  const noValue = rel.filter((r) => r.total <= 0).length;
  if (noValue) warnings.push(`${noValue} ${noValue === 1 ? "prenotazione non ha" : "prenotazioni non hanno"} l'importo nell'export di Slope (0 €): nel punteggio ${noValue === 1 ? "viene considerata" : "vengono considerate"} di valore medio. Controlla che la colonna Totale sia collegata e compilata, soprattutto per le prenotazioni da channel manager.`);
  const rankNet = pctRank(knownNets.length ? knownNets : [0]);
  const rankCreated = pctRank(rel.map((r) => toUTC(r.createdAt ?? r.arrival)));
  const W = s.weights;
  const specOf = (r: Reservation): SpecFlag | undefined => spec?.byRes.get(resKey(r));
  // una prenotazione senza garanzia valida o con la caparra non pagata si annulla, non si sposta
  const cancOf = (r: Reservation): CancelCase | undefined => {
    const x = cancel?.byRes.get(resKey(r));
    return x && !x.protetta ? x : undefined;
  };
  const baseKeep = (r: Reservation): number => {
    const vn = rankNet(effNet(r));
    const early = 1 - rankCreated(toUTC(r.createdAt ?? r.arrival));
    // Le doppie prenotazioni ("furbetti") scendono in fondo: sono le prime da mettere in overbooking.
    const speculativa = (W.speculative ?? 0) * (specOf(r)?.penalty ?? 0);
    const annullabile = cancOf(r) ? (W.cancellabile ?? 0) : 0;
    return (W.value * vn + W.early * early + W.prepaid * (r.nonRefundable ? 1 : 0) - speculativa - annullabile) / 100;
  };

  const usage: Usage = new Map();
  const u = (h: HotelId, t: string): number[] => {
    const k = `${h}|${t}`;
    let a = usage.get(k);
    if (!a) { a = new Array(span).fill(0); usage.set(k, a); }
    return a;
  };
  const addUse = (p: Placed, sign: 1 | -1): void => {
    const [a, b] = idxRange(p.r);
    const arr = u(p.hotelId, p.type);
    for (let i = a; i < b; i++) arr[i] += sign * p.r.rooms;
  };
  const countOf = (h: HotelId, t: string): number => hotels.get(h)!.roomTypes.find((x) => x.code === t)?.count ?? 0;
  const fits = (r: Reservation, h: HotelId, t: string): boolean => {
    const [a, b] = idxRange(r);
    const arr = u(h, t);
    const c = countOf(h, t);
    for (let i = a; i < b; i++) if (arr[i] + r.rooms > c) return false;
    return true;
  };

  const placed: Placed[] = [];
  const unknownTypes = new Set<string>();
  for (const r of rel) {
    const h = hotels.get(r.hotelId)!;
    const t = typeOf(h, r);
    if (!t.known) unknownTypes.add(`${h.name}: "${r.roomType}"`);
    const p: Placed = { r, hotelId: h.id, type: t.code, origin: "originale", keep: baseKeep(r), net: netValue(s, r), vn: rankNet(effNet(r)), early: 1 - rankCreated(toUTC(r.createdAt ?? r.arrival)), protectedBy: protector.reasons(r).map((x) => REASON_LABEL[x]), locked: protector.untouchable(r), spec: specOf(r), canc: cancOf(r) };
    placed.push(p);
    addUse(p, 1);
  }
  if (unknownTypes.size) warnings.push(`Tipologie non riconosciute, assegnate per numero ospiti: ${[...unknownTypes].slice(0, 6).join(", ")}. Aggiungile nelle impostazioni.`);

  const overNights = (h: HotelId, t: string): number[] => {
    const arr = u(h, t), c = countOf(h, t), out: number[] = [];
    const lim = Math.min(span, diffDays(winEnd, from));
    for (let i = 0; i < lim; i++) if (arr[i] > c) out.push(i);
    return out;
  };

  const moves: MoveDecision[] = [];
  let seq = 0;
  const conflictsBefore: Record<HotelId, number> = {};
  const moved: Placed[] = [];

  for (const h of s.hotels) {
    conflictsBefore[h.id] = h.roomTypes.reduce((a, t) => a + overNights(h.id, t.code).reduce((x, i) => x + u(h.id, t.code)[i] - t.count, 0), 0);
    const types = [...h.roomTypes].sort((a, b) => a.rank - b.rank);

    // A1) upgrade interni: il posto migliore va agli ospiti con punteggio più alto
    for (const t of types) {
      for (let guard = 0; guard < 500; guard++) {
        const over = new Set(overNights(h.id, t.code));
        if (!over.size) break;
        const higher = types.filter((x) => x.rank > t.rank);
        const cands = placed
          .filter((p) => p.hotelId === h.id && p.type === t.code && !p.locked && p.r.arrival >= from && coversAny(idxRange(p.r), over))
          .sort((a, b) => b.keep - a.keep);
        let done = false;
        for (const p of cands) {
          const target = higher.find((x) => x.maxPax >= paxPerRoom(p.r) && fits(p.r, h.id, x.code));
          if (!target) continue;
          addUse(p, -1);
          p.type = target.code;
          p.origin = "upgrade";
          addUse(p, 1);
          moves.push({ seq: ++seq, res: p.r, kind: "upgrade", targetHotel: h.id, targetType: target.code, keepScore: p.keep, netValue: p.net, reason: "Upgrade gratuito interno: libera la tipologia in conflitto", note: `${t.label} → ${target.label}` });
          done = true;
          break;
        }
        if (!done) break;
      }
    }

    // A2) scelta di chi spostare: punteggio di permanenza più basso, corretto dal principio tetris
    for (const t of types) {
      const removedHere: Placed[] = [];
      for (let guard = 0; guard < 500; guard++) {
        const overArr = overNights(h.id, t.code);
        if (!overArr.length) break;
        const over = new Set(overArr);
        const cands = placed.filter((p) => p.hotelId === h.id && p.type === t.code && !p.protectedBy.length && coversAny(idxRange(p.r), over));
        if (!cands.length) {
          warnings.push(`${h.name}, ${t.label}: conflitto su ${overArr.length} notti con sole prenotazioni fisse. Serve una decisione del responsabile.`);
          break;
        }
        let best: Placed | null = null, bestScore = Infinity, bestFit = 0;
        for (const p of cands) {
          const [a, b] = idxRange(p.r);
          let hit = 0;
          for (let i = a; i < b; i++) if (over.has(i)) hit++;
          const fit = hit / Math.max(1, b - a);
          const score = p.keep - (W.fit / 100) * fit;
          if (score < bestScore) { bestScore = score; best = p; bestFit = fit; }
        }
        const p = best!;
        addUse(p, -1);
        placed.splice(placed.indexOf(p), 1);
        (p as Placed & { fitShare?: number }).fitShare = bestFit;
        removedHere.push(p);
      }
      // A3) recupero: se togliendo altri si è liberato spazio, rientra chi vale di più
      removedHere.sort((a, b) => b.keep - a.keep);
      for (const p of [...removedHere]) {
        if (fits(p.r, h.id, t.code)) {
          addUse(p, 1);
          placed.push(p);
          removedHere.splice(removedHere.indexOf(p), 1);
        }
      }
      moved.push(...removedHere);
    }
  }

  // B) riprotezione: prima gli ospiti con punteggio più alto
  moved.sort((a, b) => b.keep - a.keep);
  const walkOrder: Placed[] = [];
  const cancelOrder: Placed[] = [];
  for (const p of moved) {
    if (p.canc) { cancelOrder.push(p); continue; }
    const own = hotels.get(p.hotelId)!;
    const pax = paxPerRoom(p.r);
    const others = s.reprotectionOrder.filter((id) => id !== own.id && hotels.has(id)).map((id) => hotels.get(id)!);
    const ordered = [own, ...others.filter((h) => h.category >= own.category), ...others.filter((h) => h.category < own.category)];
    let chosen: { h: Hotel; t: RoomType } | null = null;
    for (const h of ordered) {
      if (h.adultsOnly && p.r.children > 0) continue;
      const feas = h.roomTypes.filter((t) => t.maxPax >= pax && !(h.id === own.id && t.code === p.type) && fits(p.r, h.id, t.code));
      if (!feas.length) continue;
      feas.sort((a, b) => adjacency(p.r, h.id, b.code) - adjacency(p.r, h.id, a.code) || a.maxPax - b.maxPax);
      chosen = { h, t: feas[0] };
      break;
    }
    const why = walkReason(p, s);
    if (chosen) {
      const fromType = own.roomTypes.find((x) => x.code === p.type)?.label ?? p.type;
      const np: Placed = { ...p, hotelId: chosen.h.id, type: chosen.t.code, origin: chosen.h.id === own.id ? "upgrade" : "entrata" };
      addUse(np, 1);
      placed.push(np);
      const down = chosen.h.category < own.category;
      moves.push({
        seq: ++seq,
        res: p.r,
        kind: chosen.h.id === own.id ? "upgrade" : "riprotezione",
        targetHotel: chosen.h.id,
        targetType: chosen.t.code,
        keepScore: p.keep,
        netValue: p.net,
        reason: why,
        note: chosen.h.id === own.id
          ? `Cambio tipologia interno: ${fromType} → ${chosen.t.label}`
          : `${own.name} → ${chosen.h.name}, ${chosen.t.label}${down ? " · categoria inferiore: serve il consenso dell'ospite e l'adeguamento del prezzo" : ""}`,
      });
    } else walkOrder.push(p);
  }
  // C1) cancellazioni per motivo valido: si fanno prima di disturbare chi è in regola
  cancelOrder.sort((a, b) => a.keep - b.keep);
  for (const p of cancelOrder) {
    const x = p.canc!;
    moves.push({
      seq: ++seq, res: p.r, kind: "cancellazione", targetHotel: null, targetType: null,
      keepScore: p.keep, netValue: p.net, reason: walkReason(p, s), cancelGround: x.ground,
      note: `${GROUND_LABEL[x.ground]}: ${x.prova}${x.ground === "camera-inagibile" ? " La camera non è utilizzabile: proponi un'alternativa e, se l'ospite rifiuta, annulla con rimborso completo." : ` Manda il sollecito e concedi tempo fino al ${fmtDate(scadenzaRisposta(x))}; annulla solo se non arriva risposta.`}`,
    });
  }
  // C2) walk esterni in sequenza prioritaria: prima il punteggio più basso
  walkOrder.sort((a, b) => a.keep - b.keep);
  for (const p of walkOrder) {
    moves.push({ seq: ++seq, res: p.r, kind: "walk", targetHotel: null, targetType: null, keepScore: p.keep, netValue: p.net, reason: walkReason(p, s), note: "Overbooking: nessuna camera libera per tutto il soggiorno nelle tre case. Ricollocare in hotel partner di pari o superiore categoria a carico nostro" });
  }

  // D) griglia tetris sulla finestra, con istruzioni "da camera X a camera Y"
  const days = rangeDays(from, windowDays);
  const grid: GridRoom[] = [];
  const roomMoves: RoomMove[] = [];
  const orphans: OrphanGap[] = [];
  const orphanNights: Record<HotelId, number> = {};
  const orphanNightsSlope: Record<HotelId, number | null> = {};
  for (const h of s.hotels) {
    orphanNights[h.id] = 0;
    for (const t of h.roomTypes) {
      const res = tetris(placed.filter((p) => p.hotelId === h.id && p.type === t.code), h, t, all, from, windowDays, s);
      const orfane = res.rows.find((g) => g.room.includes("senza camera"));
      if (orfane) {
        // una prenotazione con più camere occupa più righe: si contano le prenotazioni, non le righe
        const uniche = [...new Map(orfane.bookings.map((b) => [b.res.id, b.res])).values()];
        const nomi = uniche.slice(0, 4).map((r) => `${r.guest || r.id} (${r.id})`).join(", ");
        const resto = uniche.length > 4 ? ` e altre ${uniche.length - 4}` : "";
        warnings.push(`${h.name}, ${t.label}: ${uniche.length === 1 ? "una prenotazione non trova" : `${uniche.length} prenotazioni non trovano`} una camera libera per tutto il soggiorno, perché le altre camere sono occupate da prenotazioni intoccabili che non si possono spostare — ${nomi}${resto}. Assegnale a mano in Slope accettando un cambio camera a metà soggiorno, oppure togli il blocco a una delle intoccabili.`);
      }
      grid.push(...res.rows);
      roomMoves.push(...res.moves);
      for (const g of res.rows) {
        const gaps = findOrphans(g, from, windowDays);
        orphans.push(...gaps);
        orphanNights[h.id] += gaps.reduce((a, x) => a + x.nights, 0);
      }
    }
    orphanNightsSlope[h.id] = slopeOrphans(placed.filter((p) => p.hotelId === h.id && p.origin === "originale"), from, windowDays);
  }
  // camera proposta nelle azioni del piano
  const roomsByKey = new Map<string, string[]>();
  for (const rm of roomMoves) {
    const k = resKey(rm.res);
    roomsByKey.set(k, [...(roomsByKey.get(k) ?? []), rm.toRoom]);
  }
  for (const g of grid) for (const b of g.bookings) {
    const k = resKey(b.res);
    if (!roomsByKey.has(k)) roomsByKey.set(k, [g.room]);
  }
  for (const m of moves) {
    if (m.kind === "walk") continue;
    const rooms = roomsByKey.get(resKey(m.res));
    if (rooms?.length) {
      m.targetRoom = rooms.join(", ");
      m.note += ` · ${rooms.length > 1 ? "camere" : "camera"} ${m.targetRoom}${m.res.room ? ` (oggi ${m.res.room})` : ""}`;
    }
  }
  roomMoves.sort((a, b) => a.res.arrival.localeCompare(b.res.arrival) || a.toRoom.localeCompare(b.toRoom, "it", { numeric: true }));
  orphans.sort((a, b) => a.firstNight.localeCompare(b.firstNight) || a.room.localeCompare(b.room, "it", { numeric: true }));
  return { from, days, moves, grid, roomMoves, orphans, orphanNightsSlope, orphanNights, conflictsBefore, warnings };

  // --- funzioni locali ---
  function adjacency(r: Reservation, h: HotelId, t: string): number {
    const [a, b] = idxRange(r);
    const arr = u(h, t), c = Math.max(1, countOf(h, t));
    const before = a > 0 ? arr[a - 1] / c : 0.5;
    const after = b < span ? arr[b] / c : 0.5;
    return before + after;
  }
}

function coversAny(range: [number, number], set: Set<number>): boolean {
  for (let i = range[0]; i < range[1]; i++) if (set.has(i)) return true;
  return false;
}

function walkReason(p: Placed & { fitShare?: number }, s: Settings): string {
  const parts: string[] = [];
  if (p.canc) parts.push(`MOTIVO VALIDO DI CANCELLAZIONE — ${GROUND_LABEL[p.canc.ground]}: ${p.canc.prova}`);
  if (p.spec) parts.push(`DOPPIA PRENOTAZIONE (rischio ${p.spec.level}): ${p.spec.note}`);
  if (p.r.total <= 0) parts.push("importo assente nell'export di Slope (0 €): considerata di valore medio, verifica il totale prima di chiamare");
  else parts.push(`valore netto ${eur(p.net)}, vale meno del ${Math.round((1 - p.vn) * 100)}% delle altre prenotazioni del periodo`);
  if (p.r.createdAt) parts.push(`prenotata il ${fmtDate(p.r.createdAt)}${p.early < 0.34 ? " (tra le ultime)" : p.early > 0.66 ? " (tra le prime)" : ""}`);
  if (typeof p.fitShare === "number") parts.push(`${Math.round(p.fitShare * 100)}% delle sue notti sono in conflitto`);
  parts.push(p.r.nonRefundable ? "prepagata" : "non prepagata");
  const comm = s.channelCommission[p.r.channel];
  if (comm) parts.push(`commissione ${p.r.channel} ${comm}%`);
  parts.push("nessun tag fisso");
  return parts.join(" · ");
}

function roomNamesFor(h: Hotel, t: RoomType, all: Reservation[]): string[] {
  let names = t.rooms && t.rooms.length ? [...t.rooms] : [];
  if (!names.length) {
    const seen = new Set<string>();
    for (const r of all) if (r.hotelId === h.id && r.room && normText(r.roomType) && typeOf(h, r).code === t.code) seen.add(r.room);
    names = [...seen].sort((a, b) => a.localeCompare(b, "it", { numeric: true })).slice(0, t.count);
  }
  for (let i = names.length; i < t.count; i++) names.push(`${t.code}-${i + 1}`);
  return names;
}

const isGap = (g: number): boolean => g >= 1 && g <= 2;
const nn = (n: number): string => (n === 1 ? "1 notte isolata" : `${n} notti isolate`);

/**
 * Assegnazione "tetris" con il minimo di spostamenti.
 * 1) Ogni prenotazione resta nella camera che ha in Slope.
 * 2) Chi non ha camera (riprotetti, upgrade, non assegnati) va dove crea meno notti isolate e si attacca ai soggiorni vicini.
 * 3) Miglioramento: si sposta una prenotazione solo se il totale delle notti isolate scende.
 * Gli ospiti già in casa non cambiano mai camera.
 */
function tetris(list: Placed[], h: Hotel, t: RoomType, all: Reservation[], from: ISODate, n: number, s: Settings): { rows: GridRoom[]; moves: RoomMove[] } {
  const names = roomNamesFor(h, t, all);
  const nameSet = new Set(names);
  interface Unit { p: Placed; start: number; end: number; slopeRoom: string | null; inHouse: boolean; room: string | null; why: string; prio: number; }
  // "inHouse" qui significa: camera bloccata, nessuno può spostarla
  const units: Unit[] = [];
  for (const p of list) {
    const start = Math.max(0, diffDays(p.r.arrival, from));
    const end = Math.min(n, diffDays(p.r.departure, from));
    if (end <= start) continue;
    for (let k = 0; k < p.r.rooms; k++) {
      const sr = k === 0 && p.origin === "originale" && p.r.room && nameSet.has(p.r.room) ? p.r.room : null;
      // prio 0 = intoccabile o già in casa, 1 = fissa, 2 = normale: decide chi ha la camera se non bastano
      const prio = p.locked || p.r.arrival < from ? 0 : p.protectedBy.length ? 1 : 2;
      units.push({ p, start, end, slopeRoom: sr, inHouse: p.r.arrival < from || p.locked, room: null, why: "", prio });
    }
  }
  units.sort((a, b) => a.start - b.start || b.end - a.end);
  const iv = new Map<string, Unit[]>(names.map((x) => [x, []]));
  const add = (room: string, u: Unit): void => { const l = iv.get(room)!; l.push(u); l.sort((a, b) => a.start - b.start); u.room = room; };
  const remove = (u: Unit): void => { const l = iv.get(u.room!)!; l.splice(l.indexOf(u), 1); u.room = null; };
  const free = (room: string, u: Unit): boolean => iv.get(room)!.every((x) => x === u || x.end <= u.start || x.start >= u.end);
  const orph = (l: Unit[]): number => {
    let c = 0;
    for (let i = 1; i < l.length; i++) { const g = l[i].start - l[i - 1].end; if (isGap(g) && l[i].start < n) c += g; }
    return c;
  };
  const withU = (room: string, u: Unit): Unit[] => [...iv.get(room)!.filter((x) => x !== u), u].sort((a, b) => a.start - b.start);
  const without = (room: string, u: Unit): Unit[] => iv.get(room)!.filter((x) => x !== u);
  const adjacency = (room: string, u: Unit): number => iv.get(room)!.reduce((a, x) => a + (x !== u && (x.end === u.start || x.start === u.end) ? 1 : 0), 0);
  const neighbour = (room: string, u: Unit): Reservation | null => iv.get(room)!.find((x) => x !== u && (x.end === u.start || x.start === u.end))?.p.r ?? null;

  const whoFor = (u: Unit): string => `${u.p.r.guest || u.p.r.id}${u.p.origin === "entrata" ? " (riprotetta da un'altra casa)" : u.p.origin === "upgrade" ? " (cambio tipologia)" : ""}`;
  /** Prova a far posto a u in una camera spostando altrove le prenotazioni che la occupano (mai chi è in casa). */
  const makeRoom = (u: Unit): boolean => {
    let bestPlan: { room: string; moves: [Unit, string][] } | null = null;
    for (const room of names) {
      const blockers = iv.get(room)!.filter((x) => x.start < u.end && x.end > u.start);
      if (!blockers.length || blockers.some((x) => x.inHouse)) continue;
      // simulazione: u entra in room, i blocker cercano un'altra camera
      const plan: [Unit, string][] = [];
      const taken = new Map<string, Unit[]>();
      const freeSim = (r2: string, b: Unit): boolean => [...iv.get(r2)!, ...(taken.get(r2) ?? [])].every((x) => x === b || blockers.includes(x) || x.end <= b.start || x.start >= b.end) && !(r2 === room);
      let ok = true;
      for (const b of blockers) {
        const dest = names.find((r2) => freeSim(r2, b));
        if (!dest) { ok = false; break; }
        plan.push([b, dest]);
        taken.set(dest, [...(taken.get(dest) ?? []), b]);
      }
      if (ok && (!bestPlan || plan.length < bestPlan.moves.length)) bestPlan = { room, moves: plan };
    }
    if (!bestPlan) return false;
    for (const [b, dest] of bestPlan.moves) {
      remove(b);
      add(dest, b);
      b.why = `Spostata per fare posto a ${whoFor(u)}, che non ha un'altra camera libera per tutto il soggiorno.`;
    }
    add(bestPlan.room, u);
    return true;
  };

  // 1) camera di Slope
  const pending: Unit[] = [];
  for (const u of units) {
    const want = u.slopeRoom ?? (u.inHouse && u.p.r.room && nameSet.has(u.p.r.room) ? u.p.r.room : null);
    if (want && free(want, u)) add(want, u);
    else {
      if (want) {
        const occ = iv.get(want)!.find((x) => x.start < u.end && x.end > u.start);
        u.why = `La camera ${want} è occupata${occ ? ` da ${occ.p.r.guest || occ.p.r.id} fino al ${fmtDate(occ.p.r.departure)}` : ""} nelle stesse notti.`;
      }
      pending.push(u);
    }
  }
  // 2) chi non ha camera: prima le intoccabili, poi le fisse; a parità, minor numero di notti isolate
  pending.sort((x, y) => x.start - y.start || x.prio - y.prio || y.end - x.end);
  let failed = false;
  for (const u of pending) {
    let best: string | null = null, bestScore = Infinity;
    for (const room of names) {
      if (!free(room, u)) continue;
      const score = (orph(withU(room, u)) - orph(iv.get(room)!)) * 10 - adjacency(room, u);
      if (score < bestScore) { bestScore = score; best = room; }
    }
    if (best === null) {
      // riparazione locale: libera una camera spostando chi la occupa in quelle notti
      if (!makeRoom(u)) { failed = true; break; }
      continue;
    }
    add(best, u);
  }
  // riorganizzazione se le camere sono troppo frammentate: chi può tiene la camera di Slope,
  // gli altri prendono la camera che si incastra meglio. Se le camere non bastano per tutti,
  // la precedenza va alle intoccabili, poi alle fisse: senza camera resta chi è meno protetto.
  if (failed) {
    for (const l of iv.values()) l.length = 0;
    for (const u of units) { u.room = null; u.why = ""; }
    const claimedByOther = (room: string, u: Unit): boolean => units.some((c) => c !== u && !c.room && c.slopeRoom === room && c.start < u.end && c.end > u.start);
    const byPrio = [...units].sort((x, y) => x.start - y.start || x.prio - y.prio || y.end - x.end);
    for (const u of byPrio) if (u.inHouse && u.p.r.room && iv.has(u.p.r.room) && free(u.p.r.room, u)) add(u.p.r.room, u);
    for (const u of byPrio) {
      if (u.room) continue;
      if (u.slopeRoom && free(u.slopeRoom, u)) { add(u.slopeRoom, u); continue; }
      const pickFrom = (avoid: boolean): string | null => {
        let pick: string | null = null, best = -Infinity;
        for (const room of names) {
          if (!free(room, u) || (avoid && claimedByOther(room, u))) continue;
          const le = iv.get(room)!.filter((x) => x.end <= u.start).reduce((m, x) => Math.max(m, x.end), -Infinity);
          if (pick === null || le > best) { best = le; pick = room; }
        }
        return pick;
      };
      const pick = pickFrom(true) ?? pickFrom(false);
      if (!pick) continue;
      if (u.slopeRoom) {
        const occ = iv.get(u.slopeRoom)!.find((x) => x.start < u.end && x.end > u.start);
        u.why = `La camera ${u.slopeRoom} serve a ${occ ? whoFor(occ) : "un'altra prenotazione"} nelle stesse notti: le camere di questa tipologia sono piene e vanno ridistribuite.`;
      }
      add(pick, u);
    }
  }
  // 2b) riparazione: se le camere non bastano, senza camera resta chi è meno protetto
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const u of units.filter((x) => !x.room).sort((a, b) => a.prio - b.prio)) {
      if (makeRoom(u)) { changed = true; continue; }
      let best: { room: string; victims: Unit[] } | null = null;
      for (const room of names) {
        const victims = iv.get(room)!.filter((x) => x.start < u.end && x.end > u.start);
        if (!victims.length || victims.some((x) => x.prio <= u.prio)) continue;
        if (!best || victims.length < best.victims.length) best = { room, victims };
      }
      if (!best) continue;
      for (const v of best.victims) { remove(v); v.why = ""; }
      add(best.room, u);
      changed = true;
    }
    if (!changed) break;
  }

  // 3) miglioramento: si sposta solo se le notti isolate diminuiscono
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (const u of units) {
      if (!u.room || u.inHouse) continue;
      const src = u.room;
      const srcBefore = orph(iv.get(src)!), srcAfter = orph(without(src, u));
      let best: string | null = null, bestDelta = 0, bestAdj = -1;
      for (const room of names) {
        if (room === src || !free(room, u)) continue;
        const delta = srcAfter - srcBefore + orph(withU(room, u)) - orph(iv.get(room)!);
        const adj = adjacency(room, u);
        if (delta < bestDelta || (delta === bestDelta && delta < 0 && adj > bestAdj)) { bestDelta = delta; best = room; bestAdj = adj; }
      }
      if (best) {
        remove(u);
        add(best, u);
        const nb = neighbour(best, u);
        const freed = srcBefore - srcAfter;
        const parts = [`Elimina ${nn(-bestDelta)} in totale`];
        if (freed > 0) parts.push(`in camera ${src} ${freed === 1 ? "sparisce 1 notte isolata" : `spariscono ${freed} notti isolate`}`);
        if (nb) parts.push(`in camera ${best} il soggiorno si attacca a quello di ${nb.guest || nb.id}`);
        u.why = parts[0] + (parts.length > 1 ? ": " + parts.slice(1).join("; ") : "") + ".";
        improved = true;
      }
    }
    if (!improved) break;
  }

  // griglia e istruzioni
  const rows: GridRoom[] = names.map((room) => ({
    hotelId: h.id,
    type: t.code,
    room,
    bookings: iv.get(room)!.map((u) => ({ res: u.p.r, start: u.start, end: u.end, style: (u.p.origin === "entrata" ? "entrata" : u.p.origin === "upgrade" ? "upgrade" : u.p.protectedBy.length ? "protetta" : "normale") as GridBooking["style"] })),
  }));
  const lost = units.filter((u) => !u.room);
  if (lost.length) rows.push({ hotelId: h.id, type: t.code, room: `${t.code} senza camera`, bookings: lost.map((u) => ({ res: u.p.r, start: u.start, end: u.end, style: "protetta" as const })) });

  const moves: RoomMove[] = [];
  const otherHotel = (id: HotelId): string => s.hotels.find((x) => x.id === id)?.name ?? id;
  for (const u of units) {
    if (!u.room) continue;
    const r = u.p.r;
    const base = { res: r, hotelId: h.id, type: t.code, toRoom: u.room };
    if (u.p.origin === "entrata") moves.push({ ...base, fromHotel: r.hotelId, fromRoom: r.room, kind: "entrata", reason: `Riprotezione da ${otherHotel(r.hotelId)} prevista dal piano: camera scelta per non creare notti isolate.` });
    else if (u.p.origin === "upgrade") moves.push({ ...base, fromHotel: r.hotelId, fromRoom: r.room, kind: "upgrade", reason: "Cambio di tipologia previsto dal piano: camera scelta per non creare notti isolate." });
    else if (u.slopeRoom && u.room !== u.slopeRoom) moves.push({ ...base, fromHotel: r.hotelId, fromRoom: u.slopeRoom, kind: "cambio", reason: u.why || "Riorganizzazione delle camere." });
    else if (!u.slopeRoom && !u.inHouse) moves.push({ ...base, fromHotel: r.hotelId, fromRoom: r.room, kind: "assegna", reason: r.room ? `La camera ${r.room} di Slope non appartiene a questa tipologia.` : "Camera non ancora assegnata in Slope: questa evita notti isolate." });
  }
  return { rows, moves };
}

function findOrphans(g: GridRoom, from: ISODate, n: number): OrphanGap[] {
  if (g.room.includes("senza camera")) return [];
  const bs = [...g.bookings].sort((a, b) => a.start - b.start);
  const out: OrphanGap[] = [];
  for (let i = 1; i < bs.length; i++) {
    const gap = bs[i].start - bs[i - 1].end;
    if (isGap(gap) && bs[i].start < n) {
      out.push({ hotelId: g.hotelId, type: g.type, room: g.room, firstNight: addDays(from, bs[i - 1].end), nights: gap, before: bs[i - 1].res, after: bs[i].res });
    }
  }
  return out;
}

/** Notti isolate con l'assegnazione attuale di Slope (null se troppe prenotazioni senza camera). */
function slopeOrphans(list: Placed[], from: ISODate, n: number): number | null {
  const withRoom = list.filter((p) => p.r.room);
  if (!list.length || withRoom.length < list.length * 0.6) return null;
  const byRoom = new Map<string, [number, number][]>();
  for (const p of withRoom) {
    const a = Math.max(0, diffDays(p.r.arrival, from)), b = Math.min(n, diffDays(p.r.departure, from));
    if (b <= a) continue;
    byRoom.set(p.r.room!, [...(byRoom.get(p.r.room!) ?? []), [a, b]]);
  }
  let c = 0;
  for (const iv of byRoom.values()) {
    iv.sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < iv.length; i++) { const g = iv[i][0] - iv[i - 1][1]; if (isGap(g) && iv[i][0] < n) c += g; }
  }
  return c;
}
