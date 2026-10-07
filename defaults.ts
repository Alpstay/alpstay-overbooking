import type { Settings, Meta } from "./types";

export const SETTINGS_VERSION = 1;

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    hotels: [
      {
        id: "saslong",
        name: "Smart Hotel Saslong",
        matchText: "saslong",
        category: 2,
        adultsOnly: false,
        walkCost: 220,
        adrOverride: null,
        maxOverbookPct: 8,
        roomTypes: [
          { code: "DBL", label: "Doppia / matrimoniale", count: 32, maxPax: 2, rank: 1 },
          { code: "TPL", label: "Tripla", count: 15, maxPax: 3, rank: 2 },
          { code: "QDR", label: "Quadrupla", count: 2, maxPax: 4, rank: 3 },
        ],
      },
      {
        id: "acadia",
        name: "Hotel Acadia",
        matchText: "acadia",
        category: 3,
        adultsOnly: true,
        walkCost: 450,
        adrOverride: null,
        maxOverbookPct: 5,
        roomTypes: [{ code: "DBL", label: "Doppia", count: 21, maxPax: 2, rank: 1 }],
      },
      {
        id: "hartmann",
        name: "Chalet Hartmann",
        matchText: "hartmann",
        category: 3,
        adultsOnly: false,
        walkCost: 400,
        adrOverride: null,
        maxOverbookPct: 12,
        roomTypes: [{ code: "APP", label: "Unità", count: 9, maxPax: 4, rank: 1 }],
      },
    ],
    reprotectionOrder: ["saslong", "acadia", "hartmann"],
    events: [],
    rules: {
      fixedTag: "NO OVERBOOKING, OB-FISSA",
      groupMinRooms: 4,
      groupChannelWords: "gruppo, group, gruppe, allotment",
      repeaterMinStays: 2,
      expediaCollectWords: "collect",
      protectNonRefundable: true,
      speculativeWindowDays: 90,
      cancellation: {
        noGuaranteeWords: "carta non valida, carta rifiutata, garanzia non valida, nessuna garanzia, carta scaduta, invalid card, declined",
        unpaidWords: "non pagato, in attesa di pagamento, caparra non pagata, acconto non pagato, scaduto, unpaid, pending",
        paidWords: "pagato, pagata, saldato, incassato, prepagata, paid, expedia collect",
        depositDays: 7,
        preavvisoGiorni: 3,
      },
      outOfOrder: [],
    },
    weights: { value: 55, fit: 25, early: 10, prepaid: 10, speculative: 45, cancellabile: 70 },
    channelCommission: { "booking.com": 18, expedia: 20, "sito web": 3, diretto: 0, telefono: 0, email: 0, agenzia: 15, airbnb: 15 },
    riskMaxPct: 10,
    freezeDays: 2,
    defaultWashPct: 12,
    horizonDays: 120,
    mailSignature: "",
  };
}

export function emptyMeta(): Meta {
  return { chunks: {}, lastImport: null, history: [], revision: 0 };
}
