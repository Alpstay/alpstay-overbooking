// Dati dimostrativi per provare la piattaforma prima del primo import reale.
// Tutti gli ID iniziano con "DEMO-" e si cancellano con un clic.
import type { Reservation, Settings } from "./types";
import { addDays, diffDays, todayISO } from "./util";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}


// Nomi di fantasia per i dati dimostrativi (nessun ospite reale).
const FIRST = ["Marco", "Giulia", "Luca", "Francesca", "Andrea", "Chiara", "Matteo", "Sara", "Stefan", "Anna", "Thomas", "Katharina", "Michael", "Sophie", "Lukas", "Laura", "James", "Emily", "Oliver", "Charlotte", "Pierre", "Camille", "Jan", "Eva", "Tomasz", "Agnieszka", "Pablo", "Lucía", "Daniel", "Hannah", "Elias", "Lena", "Paolo", "Elena", "Martin", "Julia", "Filip", "Petra", "Noah", "Mia"];
const LAST = ["Rossi", "Bianchi", "Ferrari", "Esposito", "Romano", "Colombo", "Ricci", "Marino", "Greco", "Bruno", "Gallo", "Conti", "Moroder", "Demetz", "Perathoner", "Senoner", "Insam", "Runggaldier", "Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Wagner", "Becker", "Hofer", "Gruber", "Huber", "Smith", "Johnson", "Brown", "Taylor", "Wilson", "Dubois", "Martin", "Lefèvre", "de Vries", "Janssen", "Nowak", "Kowalski", "García", "Fernández", "Novák", "Horvat", "Andersson", "Nielsen"];
function personName(seed: number): string {
  const a = Math.abs(Math.imul(seed + 7, 2654435761)) >>> 0;
  return `${LAST[a % LAST.length]} ${FIRST[(a >>> 8) % FIRST.length]}`;
}
const GROUP = ["Sci Club", "CAI Sezione", "Alpenverein", "Tour", "Incentive", "Ski Team", "Bike Tour", "Coro"];

const CH = [
  { raw: "Booking.com", ch: "booking.com", w: 0.42, lead: 35, canc: 0.27 },
  { raw: "Expedia", ch: "expedia", w: 0.14, lead: 40, canc: 0.2 },
  { raw: "Sito web", ch: "sito web", w: 0.22, lead: 60, canc: 0.09 },
  { raw: "Telefono", ch: "telefono", w: 0.1, lead: 75, canc: 0.06 },
  { raw: "Agenzia", ch: "agenzia", w: 0.12, lead: 110, canc: 0.14 },
];

const DEMO_ROOMS: Record<string, Record<string, string[]>> = {
  saslong: {
    DBL: [...Array.from({ length: 16 }, (_, i) => String(101 + i)), ...Array.from({ length: 16 }, (_, i) => String(201 + i))],
    TPL: Array.from({ length: 15 }, (_, i) => String(301 + i)),
    QDR: ["401", "402"],
  },
  acadia: { DBL: [...Array.from({ length: 7 }, (_, i) => String(11 + i)), ...Array.from({ length: 7 }, (_, i) => String(21 + i)), ...Array.from({ length: 7 }, (_, i) => String(31 + i))] },
  hartmann: { APP: Array.from({ length: 9 }, (_, i) => `App ${i + 1}`) },
};

export function demoReservations(s: Settings): Reservation[] {
  const r = rng(20260922);
  const today = todayISO();
  const out: Reservation[] = [];
  const adrBase: Record<string, number> = { saslong: 145, acadia: 330, hartmann: 270 };
  let n = 1;
  for (const h of s.hotels) {
    const cap = h.roomTypes.reduce((a, t) => a + t.count, 0);
    const occ = new Map<string, number>();
    const roomOcc = new Map<string, Set<string>>();
    const start = addDays(today, -540);
    for (let dayI = 0; dayI < 540 + 200; dayI++) {
      const arr = addDays(start, dayI);
      const m = +arr.slice(5, 7);
      const season = [12, 1, 2, 3].includes(m) ? 1.0 : [7, 8].includes(m) ? 0.95 : [6, 9].includes(m) ? 0.7 : 0.25;
      const future = arr >= today;
      const lead0 = diffDays(arr, today);
      const extraCap = future && lead0 >= 2 && lead0 <= 12 ? Math.ceil(cap * 0.08) : 0;
      const tries = Math.round((cap / 3.8) * season * (1.2 + r() * 0.5));
      for (let k = 0; k < tries; k++) {
        let x = r(), c = CH[0];
        for (const cc of CH) { if (x < cc.w) { c = cc; break; } x -= cc.w; }
        const lead = Math.floor(-Math.log(1 - r()) * c.lead);
        const created = addDays(arr, -lead);
        if (created > today) continue;
        const los = 2 + Math.floor(r() * 6);
        const dep = addDays(arr, los);
        const willCancel = r() < c.canc * (season > 0.9 ? 0.75 : 1);
        const cancelAt = willCancel ? addDays(created, Math.floor(r() * Math.max(1, lead))) : null;
        let status: Reservation["status"] = "confermata";
        if (willCancel && cancelAt! <= today) status = "cancellata";
        if (!willCancel && !future && r() < 0.02) status = "noshow";
        const isGroup = r() < 0.03;
        const rooms = isGroup ? 4 + Math.floor(r() * 4) : 1;
        if (status === "confermata" || status === "noshow") {
          let ok = true;
          for (let i = 0; i < los; i++) if ((occ.get(addDays(arr, i)) ?? 0) + rooms > cap + (future ? extraCap : 0)) ok = false;
          if (!ok) continue;
          for (let i = 0; i < los; i++) occ.set(addDays(arr, i), (occ.get(addDays(arr, i)) ?? 0) + rooms);
        }
        let tw = r() * cap, type = h.roomTypes[0];
        for (const t of h.roomTypes) { if (tw < t.count) { type = t; break; } tw -= t.count; }
        const pickRoom = (): string | null => {
          // assegnazione "da reception": camera libera a caso, come capita in Slope
          const cand = (DEMO_ROOMS[h.id]?.[type.code] ?? []).filter((rm) => {
            const set = roomOcc.get(rm);
            for (let i = 0; i < los; i++) if (set?.has(addDays(arr, i))) return false;
            return true;
          });
          if (!cand.length || (future && lead0 > 20 && r() < 0.5)) return null;
          const rm = cand[Math.floor(r() * cand.length)];
          const set = roomOcc.get(rm) ?? new Set<string>();
          for (let i = 0; i < los; i++) set.add(addDays(arr, i));
          roomOcc.set(rm, set);
          return rm;
        };
        const adults = Math.min(type.maxPax, 2);
        const children = h.adultsOnly ? 0 : type.maxPax > 2 && r() < 0.5 ? type.maxPax - 2 : 0;
        const nightly = adrBase[h.id] * (0.7 + season * 0.6) * (0.85 + r() * 0.3);
        const repeat = r() < 0.08;
        const repeatNo = Math.floor(r() * 60);
        const id = `DEMO-${h.id.slice(0, 3).toUpperCase()}-${String(n++).padStart(6, "0")}`;
        const expCollect = c.ch === "expedia" && r() < 0.5;
        out.push({
          id,
          hotelId: h.id,
          createdAt: created,
          arrival: arr,
          departure: dep,
          status,
          cancelledAt: status === "cancellata" ? cancelAt : null,
          channel: c.ch,
          channelRaw: c.raw,
          roomType: type.code,
          room: status === "confermata" ? pickRoom() : null,
          rooms,
          adults: adults * rooms,
          children: children * rooms,
          total: Math.round(nightly * los * rooms),
          guest: isGroup
            ? `${GROUP[Math.floor(r() * GROUP.length)]} ${LAST[Math.floor(r() * LAST.length)]}`
            : personName(repeat ? repeatNo : 1000 + n),
          customerId: repeat && !isGroup ? `C${repeatNo}` : `C${100000 + n}`,
          email: "",
          groupRef: isGroup ? `GRP-${n}` : null,
          tags: r() < 0.03 ? s.rules.fixedTag.split(",")[0].trim() : "",
          rateName: r() < 0.2 ? "Non rimborsabile" : "Flessibile",
          payment: expCollect ? "Expedia Collect" : "",
          paymentStatus: "",
          paymentDue: null,
          nonRefundable: false,
          repeaterFlag: false,
          checkedIn: arr < today && dep > today,
          source: "slope",
          sourceId: id,
          syncedAt: new Date().toISOString(),
        });
        out[out.length - 1].nonRefundable = out[out.length - 1].rateName === "Non rimborsabile";
      }
    }
  }
  // Alcuni "furbetti": stesso ospite con più prenotazioni future che non può usare tutte.
  const spec: { casa: string; giorni: number; notti: number }[][] = [
    [{ casa: "saslong", giorni: 9, notti: 4 }, { casa: "acadia", giorni: 9, notti: 4 }],      // stesse notti, due case
    [{ casa: "saslong", giorni: 16, notti: 3 }, { casa: "hartmann", giorni: 16, notti: 3 }],  // stesse notti, due case
    [{ casa: "saslong", giorni: 12, notti: 5 }, { casa: "saslong", giorni: 34, notti: 5 }],   // due periodi, stessa casa
    [{ casa: "acadia", giorni: 21, notti: 3 }, { casa: "acadia", giorni: 47, notti: 4 }],     // due periodi, stessa casa
    [{ casa: "hartmann", giorni: 26, notti: 7 }, { casa: "saslong", giorni: 26, notti: 7 }, { casa: "acadia", giorni: 60, notti: 3 }],
  ];
  spec.forEach((gruppo, gi) => {
    const cid = `C9${String(gi).padStart(3, "0")}`;
    const nome = personName(4000 + gi * 37);
    gruppo.forEach((b, bi) => {
      const h = s.hotels.find((x) => x.id === b.casa);
      if (!h) return;
      const type = h.roomTypes[0];
      const arr = addDays(today, b.giorni);
      const id = `DEMO-${h.id.slice(0, 3).toUpperCase()}-SPEC${gi}${bi}`;
      out.push({
        id, hotelId: h.id, createdAt: addDays(today, -20 + gi), arrival: arr, departure: addDays(arr, b.notti),
        status: "confermata", cancelledAt: null, channel: bi % 2 ? "booking.com" : "sito web",
        channelRaw: bi % 2 ? "Booking.com" : "Sito web", roomType: type.code, room: null, rooms: 1,
        adults: 2, children: 0, total: Math.round(adrBase[h.id] * b.notti * 0.95),
        guest: nome, customerId: cid, email: "", groupRef: null, tags: "", rateName: "Flessibile", payment: "", paymentStatus: "", paymentDue: null,
        nonRefundable: false, repeaterFlag: false, checkedIn: false,
        source: "slope", sourceId: id, syncedAt: new Date().toISOString(),
      });
    });
  });

  return out;
}
