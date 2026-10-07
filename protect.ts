import type { ManualLock, ProtectionReason, ProtectionRules, Reservation } from "./types";
import { normText, todayISO } from "./util";
import { resKey } from "./importer";

export const REASON_LABEL: Record<ProtectionReason, string> = {
  tag: "Tag Slope: intoccabile",
  gruppo: "Gruppo",
  abituale: "Ospite abituale",
  "expedia-collect": "Expedia Collect",
  "non-rimborsabile": "Non rimborsabile: intoccabile",
  manuale: "Bloccata in piattaforma",
  "in-casa": "Già in casa",
};

function words(s: string): string[] {
  return s.split(",").map((w) => normText(w)).filter(Boolean);
}

function guestKey(r: Reservation): string | null {
  if (r.customerId) return "c:" + r.customerId;
  const n = normText(r.guest);
  return n.split(" ").length >= 2 ? "n:" + n : null;
}

export class Protector {
  private staysByGuest = new Map<string, string[]>(); // chiave -> date di partenza soggiorni conclusi
  private groupSizes = new Map<string, number>();
  private gWords: string[];
  private ecWords: string[];
  private tags: string[];

  constructor(all: Reservation[], private rules: ProtectionRules, private locks: Record<string, ManualLock>) {
    const today = todayISO();
    this.gWords = words(rules.groupChannelWords);
    this.ecWords = words(rules.expediaCollectWords);
    this.tags = words(rules.fixedTag);
    for (const r of all) {
      if (r.status !== "confermata") continue;
      if (r.departure <= today) {
        const k = guestKey(r);
        if (k) {
          const arr = this.staysByGuest.get(k) ?? [];
          arr.push(r.departure);
          this.staysByGuest.set(k, arr);
        }
      }
      if (r.groupRef) {
        const gk = r.hotelId + "|" + normText(r.groupRef);
        this.groupSizes.set(gk, (this.groupSizes.get(gk) ?? 0) + r.rooms);
      }
    }
  }

  reasons(r: Reservation): ProtectionReason[] {
    const out: ProtectionReason[] = [];
    const today = todayISO();
    if (r.checkedIn || (r.arrival < today && r.departure > today)) out.push("in-casa");
    if (this.locks[resKey(r)]) out.push("manuale");
    const tagBlob = ` ${normText(r.tags)} `;
    if (this.tags.some((t) => tagBlob.includes(` ${t} `))) out.push("tag");

    const blob = normText(`${r.channelRaw} ${r.rateName} ${r.tags}`);
    const groupRooms = r.groupRef ? this.groupSizes.get(r.hotelId + "|" + normText(r.groupRef)) ?? r.rooms : r.rooms;
    // Se Slope indica un gruppo, è un gruppo: le camere di un gruppo non si separano mai.
    if (normText(r.groupRef ?? "") !== "" || groupRooms >= this.rules.groupMinRooms || this.gWords.some((w) => ` ${blob} `.includes(` ${w} `))) out.push("gruppo");

    if (r.repeaterFlag) out.push("abituale");
    else {
      const k = guestKey(r);
      if (k) {
        const prev = (this.staysByGuest.get(k) ?? []).filter((d) => d <= r.arrival).length;
        if (prev >= this.rules.repeaterMinStays) out.push("abituale");
      }
    }

    if (r.channel === "expedia") {
      const pay = ` ${normText(`${r.payment} ${r.rateName} ${r.channelRaw}`)} `;
      // "Hotel Collect" è l'opposto: incassiamo noi, quindi è una prenotazione normale
      const hotelCollect = / hotel collect | hotel payment | pagamento in hotel /.test(pay);
      if (!hotelCollect && (this.ecWords.length === 0 || this.ecWords.some((w) => pay.includes(w)))) out.push("expedia-collect");
    }
    if (this.rules.protectNonRefundable && r.nonRefundable) out.push("non-rimborsabile");
    return out;
  }

  /**
   * Intoccabile: il piano non la sposta, non le cambia tipologia e non le cambia camera.
   * Vale per il tag Slope, per il blocco manuale, per chi è già in casa e per le non rimborsabili:
   * l'ospite ha già pagato e la prenotazione non si tocca.
   * Le altre protezioni (gruppo, abituale, Expedia Collect) impediscono solo l'uscita dalla casa:
   * un upgrade gratuito resta possibile.
   */
  untouchable(r: Reservation): boolean {
    const x = this.reasons(r);
    return x.includes("tag") || x.includes("manuale") || x.includes("in-casa") || x.includes("non-rimborsabile");
  }
}
