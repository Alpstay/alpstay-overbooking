// Scenario dimostrativo completo: serve a verificare tutta la catena in pochi minuti.
// Aggiunge allo storico una settimana deliberatamente sovravenduta, con tutte le categorie
// protette, doppie prenotazioni, una lista d'attesa e un registro esiti già popolato.
import type { HotelId, Reservation, Settings, WaitEntry } from "./types";
import type { ObCase, CancelReason, CaseOutcome } from "./cases";
import { caseId } from "./cases";
import { typeOf } from "./solver";
import { isActive } from "./forecast";
import { addDays, todayISO } from "./util";

const NOMI: [string, string][] = [
  ["Moroder", "Elena"], ["Demetz", "Thomas"], ["Senoner", "Marta"], ["Insam", "Paolo"],
  ["Müller", "Katharina"], ["Schmidt", "Andreas"], ["Weber", "Lena"], ["Hofer", "Stefan"],
  ["Rossi", "Giulia"], ["Ferrari", "Marco"], ["Conti", "Sara"], ["Greco", "Luca"],
  ["Smith", "Emily"], ["Brown", "Oliver"], ["Taylor", "Hannah"], ["Wilson", "James"],
  ["Dubois", "Camille"], ["Lefèvre", "Pierre"], ["de Vries", "Eva"], ["Janssen", "Jan"],
  ["Nowak", "Agnieszka"], ["Kowalski", "Tomasz"], ["García", "Lucía"], ["Fernández", "Pablo"],
  ["Nielsen", "Mia"], ["Andersson", "Noah"], ["Horvat", "Petra"], ["Novák", "Filip"],
];

interface Ctx { out: Reservation[]; s: Settings; n: number; }

function add(c: Ctx, o: Partial<Reservation> & { hotelId: HotelId; arrival: string; departure: string; roomType: string; total: number }): Reservation {
  const [cog, nome] = NOMI[c.n % NOMI.length];
  c.n++;
  const id = o.id ?? `DEMO-SC-${String(c.n).padStart(4, "0")}`;
  const r: Reservation = {
    id,
    hotelId: o.hotelId,
    createdAt: o.createdAt ?? addDays(todayISO(), -(20 + (c.n % 60))),
    arrival: o.arrival,
    departure: o.departure,
    status: "confermata",
    cancelledAt: null,
    channel: o.channel ?? "booking.com",
    channelRaw: o.channelRaw ?? "Booking.com",
    roomType: o.roomType,
    room: o.room ?? null,
    rooms: o.rooms ?? 1,
    adults: o.adults ?? 2 * (o.rooms ?? 1),
    children: o.children ?? 0,
    total: o.total,
    guest: o.guest ?? `${cog} ${nome}`,
    customerId: o.customerId ?? `SC${1000 + c.n}`,
    email: o.email ?? "",
    groupRef: o.groupRef ?? null,
    tags: o.tags ?? "",
    rateName: o.rateName ?? "Flessibile",
    payment: o.payment ?? "",
    paymentStatus: o.paymentStatus ?? "",
    paymentDue: o.paymentDue ?? null,
    nonRefundable: o.nonRefundable ?? false,
    repeaterFlag: o.repeaterFlag ?? false,
    checkedIn: false,
    source: "slope",
    sourceId: id,
    syncedAt: new Date().toISOString(),
  };
  c.out.push(r);
  return r;
}

/** Occupazione massima di una tipologia nella finestra. */
function picco(list: Reservation[], s: Settings, hotelId: HotelId, code: string, from: string, nights: number): number {
  const h = s.hotels.find((x) => x.id === hotelId)!;
  let max = 0;
  for (let i = 0; i < nights; i++) {
    const d = addDays(from, i);
    let occ = 0;
    for (const r of list) {
      if (r.hotelId !== hotelId || !isActive(r)) continue;
      if (r.arrival <= d && r.departure > d && typeOf(h, r).code === code) occ += r.rooms;
    }
    max = Math.max(max, occ);
  }
  return max;
}

export interface ScenarioResult {
  reservations: Reservation[];
  waitlist: WaitEntry[];
  cases: ObCase[];
  /** Righe da mostrare all'utente per sapere cosa controllare. */
  attese: string[];
}

export function buildScenario(base: Reservation[], s: Settings): ScenarioResult {
  const today = todayISO();
  const from = addDays(today, 4);     // la settimana critica parte fra 4 giorni
  const NIGHTS = 7;
  const to = addDays(from, NIGHTS);
  const c: Ctx = { out: [], s, n: 0 };
  const attese: string[] = [];
  const tutte = (): Reservation[] => [...base, ...c.out];

  // Storico: due soggiorni conclusi per due clienti, così risultano "abituali"
  const fedeli: Record<string, { cid: string; nome: string }> = {};
  s.hotels.forEach((h, i) => {
    const f = { cid: `SC-FED-${h.id}`, nome: ["Prinoth Anna", "Kostner Georg", "Runggaldier Ivan"][i % 3] };
    fedeli[h.id] = f;
    for (const g of [120, 60]) {
      add(c, { hotelId: h.id, arrival: addDays(today, -g), departure: addDays(today, -g + 3),
        roomType: h.roomTypes[0].code, total: 900, customerId: f.cid, guest: f.nome, channel: "sito web", channelRaw: "Sito web" });
    }
  });

  const sasBase = s.hotels.find((x) => x.id === "saslong") ?? s.hotels[0] ?? null;

  // Sovravendita controllata su ogni casa e tipologia
  const sovra: Record<HotelId, number> = { saslong: 3, acadia: 2, hartmann: 1 };
  for (const h of s.hotels) {
    const over = sovra[h.id] ?? 2;
    h.roomTypes.forEach((t, ti) => {
      // su una tipologia piccola non ha senso un eccesso grande quanto su una grande
      const overT = Math.max(1, Math.min(over, Math.ceil(t.count * 0.25)));
      const p = picco(tutte(), s, h.id, t.code, from, NIGHTS);
      const daAggiungere = Math.max(0, t.count - p + overT);
      for (let i = 0; i < daAggiungere; i++) {
        const prezzo = 90 + ((i * 37) % 260);
        // coprono tutta la settimana: così l'eccesso è garantito su ogni notte
        const base_ = { hotelId: h.id, arrival: from, departure: to, roomType: t.code, total: prezzo * NIGHTS };
        // una prenotazione protetta a rotazione, così ogni categoria è rappresentata
        switch (i % 7) {
          case 0: add(c, { ...base_, tags: "NO OVERBOOKING", guest: `Tag fisso ${h.id.slice(0, 3)}${i}` }); break;
          case 1: add(c, { ...base_, channel: "expedia", channelRaw: "Expedia", payment: "Expedia Collect" }); break;
          case 2: add(c, { ...base_, rateName: "Non rimborsabile", nonRefundable: true }); break;
          case 3:
            // un solo ospite abituale per casa, sulla prima tipologia: altrimenti sembrerebbe un furbetto
            if (ti === 0) { add(c, { ...base_, customerId: fedeli[h.id].cid, guest: fedeli[h.id].nome }); break; }
            add(c, { ...base_, channel: "sito web", channelRaw: "Sito web" }); break;
          default: add(c, { ...base_, channel: i % 2 ? "sito web" : "booking.com", channelRaw: i % 2 ? "Sito web" : "Booking.com" });
        }
      }
      // qualche soggiorno breve, così il planning non è una griglia piatta
      for (let k = 0; k < 2; k++) {
        const inizio = addDays(from, 1 + k * 3);
        add(c, { hotelId: h.id, arrival: inizio, departure: addDays(inizio, 2), roomType: t.code, total: 260, channel: "telefono", channelRaw: "Telefono" });
      }
      attese.push(`${h.name}, ${t.label}: ${t.count} camere, almeno ${t.count + overT} in portafoglio ogni notte della settimana`);
    });
  }

  // Una prenotazione già messa in lista d'attesa: resta sul tabellone, a righe blu
  const inAttesa = sasBase ? add(c, { hotelId: "saslong", arrival: addDays(from, 1), departure: addDays(from, 5),
    roomType: sasBase.roomTypes[0].code, total: 1480, channel: "sito web", channelRaw: "Sito web",
    guest: "Nowak Piotr" }) : null;

  // Prenotazioni con un motivo valido di cancellazione, una per casa
  s.hotels.forEach((h, i) => {
    add(c, { hotelId: h.id, arrival: addDays(from, 1), departure: addDays(from, 5), roomType: h.roomTypes[0].code,
      total: 760, channel: "sito web", channelRaw: "Sito web", guest: i === 0 ? "Fischer Daniel" : i === 1 ? "Lombardi Serena" : "Brunner Markus",
      payment: "Carta di credito", paymentStatus: "Carta rifiutata" });
    if (i === 0) {
      add(c, { hotelId: h.id, arrival: addDays(from, 2), departure: addDays(from, 6), roomType: h.roomTypes[0].code,
        total: 980, channel: "telefono", channelRaw: "Telefono", guest: "Pichler Veronika",
        payment: "Bonifico", paymentStatus: "Caparra non pagata", paymentDue: addDays(today, -6) });
    }
  });
  attese.push("Quattro prenotazioni con un motivo documentato di cancellazione: tre con carta rifiutata, una con caparra scaduta");

  // Un gruppo su più prenotazioni: non si separa mai
  const sas = s.hotels.find((x) => x.id === "saslong");
  if (sas) {
    for (let i = 0; i < 2; i++) {
      add(c, { hotelId: "saslong", arrival: addDays(from, 1), departure: addDays(from, 4), roomType: sas.roomTypes[0].code,
        rooms: 2, total: 640, groupRef: "SCI CLUB VAL GARDENA", guest: `Sci Club Val Gardena ${i + 1}`, channel: "agenzia", channelRaw: "Agenzia gruppo" });
    }
    attese.push("Un gruppo da 4 camere su 2 prenotazioni: resta sempre intero");
    // Famiglia con bambini: non può essere riprotetta all'Acadia (solo adulti)
    add(c, { hotelId: "saslong", arrival: addDays(from, 2), departure: addDays(from, 6), roomType: sas.roomTypes[1]?.code ?? sas.roomTypes[0].code,
      rooms: 1, adults: 2, children: 2, total: 820, guest: "Famiglia con bambini" });
    attese.push("Una famiglia con bambini: mai riprotetta a Hotel Acadia, che è solo adulti");
  }

  // Doppie prenotazioni: stesso ospite, stesse notti in due case
  const coppie: [HotelId, HotelId][] = [["saslong", "acadia"], ["saslong", "hartmann"]];
  coppie.forEach(([a, b], i) => {
    const ha = s.hotels.find((x) => x.id === a), hb = s.hotels.find((x) => x.id === b);
    if (!ha || !hb) return;
    const cid = `SC-DOPPIO${i}`;
    const nome = i === 0 ? "Bianchi Riccardo" : "Keller Sabine";
    add(c, { hotelId: a, arrival: addDays(from, 1), departure: addDays(from, 5), roomType: ha.roomTypes[0].code, total: 1200, customerId: cid, guest: nome, channel: "sito web", channelRaw: "Sito web" });
    add(c, { hotelId: b, arrival: addDays(from, 1), departure: addDays(from, 5), roomType: hb.roomTypes[0].code, total: 1400, customerId: cid, guest: nome });
  });
  // Un terzo furbetto con due periodi diversi nella stessa casa
  if (sas) {
    for (const g of [2, 40]) {
      add(c, { hotelId: "saslong", arrival: addDays(from, g), departure: addDays(from, g + 3), roomType: sas.roomTypes[0].code,
        total: 900, customerId: "SC-DOPPIO2", guest: "Ricci Alessandro", channel: "expedia", channelRaw: "Expedia", payment: "Hotel Collect" });
    }
  }
  attese.push("Tre ospiti con doppie prenotazioni, di cui due sulle stesse notti in case diverse");

  // Lista d'attesa già popolata
  const now = new Date().toISOString();
  const waitlist: WaitEntry[] = [
    { id: "WSC1", source: "richiesta", status: "attesa", hotels: [], arrival: addDays(from, 1), departure: addDays(from, 4),
      rooms: 1, pax: 2, children: false, guest: "Zanetti Chiara", contact: "chiara.zanetti@example.com", lang: "it",
      slopeId: null, fromHotel: null, note: "Ha chiesto una doppia, eravamo pieni", createdAt: now, updatedAt: now },
    { id: "WSC2", source: "richiesta", status: "attesa", hotels: ["hartmann"], arrival: addDays(from, 20), departure: addDays(from, 27),
      rooms: 1, pax: 4, children: true, guest: "Berger Familie", contact: "+39 333 1234567", lang: "de",
      slopeId: null, fromHotel: null, note: "Vuole solo il Chalet", createdAt: now, updatedAt: now },
  ];
  if (inAttesa) {
    waitlist.push({ id: "WSC3", source: "rientro", status: "attesa", hotels: [inAttesa.hotelId],
      arrival: inAttesa.arrival, departure: inAttesa.departure, rooms: inAttesa.rooms, pax: 2, children: false,
      guest: inAttesa.guest, contact: "piotr.nowak@example.com", lang: "en", slopeId: inAttesa.id,
      fromHotel: inAttesa.hotelId, note: "Prenotazione indesiderata: da annullare in Slope", createdAt: now, updatedAt: now });
    attese.push("Una prenotazione già in lista d'attesa: sul tabellone resta a righe blu finché non la annulli in Slope");
  }

  // Registro esiti: sei mesi di casi chiusi, per far vedere le statistiche
  const esiti: [CaseOutcome, number, string, CancelReason | null][] = [
    ["rientrata", 0, "", null], ["rientrata", 0, "", null], ["rientrata", 0, "", null],
    ["upgrade", 0, "", null], ["upgrade", 0, "", null], ["upgrade", 0, "", null], ["upgrade", 0, "", null],
    ["cambio-camera", 0, "", null], ["cambio-camera", 0, "", null],
    ["riprotetta-alpstay", 60, "", null], ["riprotetta-alpstay", 0, "", null], ["riprotetta-alpstay", 90, "", null],
    ["ricollocata-partner", 480, "Hotel Aurora, Ortisei", null], ["ricollocata-partner", 520, "Hotel Aurora, Ortisei", null],
    ["ricollocata-partner", 390, "Garni Cendepinei", null], ["ricollocata-partner", 610, "Hotel Dolomiti, Selva", null],
    ["cancellata", 0, "", "carta-non-valida"], ["cancellata", 0, "", "carta-non-valida"], ["cancellata", 0, "", "carta-non-valida"],
    ["cancellata", 0, "", "doppia-prenotazione"], ["cancellata", 0, "", "doppia-prenotazione"],
    ["cancellata", 0, "", "piano-camere"], ["cancellata", 0, "", "mancato-pagamento"], ["cancellata", 0, "", "no-show"],
  ];
  const cases: ObCase[] = esiti.map(([outcome, cost, partner, reason], i) => {
    const h = s.hotels[i % s.hotels.length];
    const apertura = addDays(today, -(10 + i * 7));
    const [cog, nome] = NOMI[(i + 9) % NOMI.length];
    return {
      id: caseId(), resId: `DEMO-SC-OLD${String(i).padStart(3, "0")}`, key: `${h.id}::DEMO-SC-OLD${String(i).padStart(3, "0")}`,
      hotelId: h.id, guest: `${cog} ${nome}`, arrival: addDays(apertura, 6), departure: addDays(apertura, 9),
      rooms: 1, netValue: 380 + ((i * 53) % 700), channel: i % 3 === 0 ? "booking.com" : i % 3 === 1 ? "sito web" : "expedia",
      openedAt: apertura + "T09:00:00.000Z", openedBy: "piano",
      proposed: outcome === "ricollocata-partner" ? "walk" : outcome === "riprotetta-alpstay" ? "riprotezione" : "upgrade",
      outcome, closedAt: addDays(apertura, 2) + "T17:00:00.000Z",
      targetHotel: outcome === "riprotetta-alpstay" ? (s.hotels.find((x) => x.id !== h.id)?.id ?? null) : null,
      partnerName: partner, cost, compensation: cost ? "Trasferimento e prima notte offerti" : "",
      cancelReason: reason, speculative: reason === "doppia-prenotazione",
      note: "", updatedAt: apertura + "T17:00:00.000Z",
    };
  });
  attese.push(`Registro con ${cases.length} posizioni già chiuse e ${waitlist.length} ospiti in lista d'attesa`);

  return { reservations: c.out, waitlist, cases, attese };
}
