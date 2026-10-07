import type { ISODate } from "./types";

const DAY = 86_400_000;

export function todayISO(): ISODate {
  const d = new Date();
  return fromParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function fromParts(y: number, m: number, d: number): ISODate {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function toUTC(d: ISODate): number {
  const [y, m, dd] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, dd);
}

export function addDays(d: ISODate, n: number): ISODate {
  const t = new Date(toUTC(d) + n * DAY);
  return fromParts(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(a) - toUTC(b)) / DAY);
}

export function rangeDays(from: ISODate, n: number): ISODate[] {
  const out: ISODate[] = [];
  for (let i = 0; i < n; i++) out.push(addDays(from, i));
  return out;
}

const WD = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
export const MO = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

export function fmtDate(d: ISODate | null, withWeekday = false): string {
  if (!d) return "—";
  const [y, m, dd] = d.split("-").map(Number);
  const wd = WD[new Date(toUTC(d)).getUTCDay()];
  return `${withWeekday ? wd + " " : ""}${dd} ${MO[m - 1]}${withWeekday ? "" : " " + String(y).slice(2)}`;
}

export function weekday(d: ISODate): number {
  return new Date(toUTC(d)).getUTCDay();
}

/** Parsing robusto delle date tipiche degli export Slope. */
export function parseDate(v: unknown): ISODate | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return fromParts(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  if (typeof v === "number" && isFinite(v)) {
    // seriale Excel (1900)
    if (v > 20000 && v < 80000) {
      // la parte decimale è l'ora: va troncata, non arrotondata, o la data slitta di un giorno
      const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * DAY);
      return fromParts(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    }
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return valid(y, +m[2], +m[1]);
  }
  return null;
}

function valid(y: number, m: number, d: number): ISODate | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return fromParts(y, m, d);
}

/** "1.250,50 €" -> 1250.5 ; "1,250.50" -> 1250.5 ; 1250.5 -> 1250.5 */
export function parseMoney(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (v === null || v === undefined) return 0;
  let s = String(v).replace(/[^\d,.\-]/g, "");
  if (!s) return 0;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

export function parseIntSafe(v: unknown, fallback: number): number {
  if (typeof v === "number" && isFinite(v)) return Math.round(v);
  const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10);
  return isFinite(n) ? n : fallback;
}

export function parseBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return ["1", "si", "sì", "yes", "true", "x", "ja", "vero"].includes(s);
}

export function normText(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Canale in forma stabile per le statistiche (es. "Booking.com - XML" -> "booking.com"). */
export function normChannel(raw: string): string {
  const s = String(raw ?? "").toLowerCase().trim();
  if (!s) return "sconosciuto";
  if (s.includes("booking")) return "booking.com";
  if (s.includes("expedia") || s.includes("hotels.com")) return "expedia";
  if (s.includes("airbnb")) return "airbnb";
  if (s.includes("hrs")) return "hrs";
  if (s.includes("sito") || s.includes("website") || s.includes("web") || s.includes("booking engine") || s.includes("ibe")) return "sito web";
  if (s.includes("telefon") || s.includes("phone")) return "telefono";
  if (s.includes("mail")) return "email";
  if (s.includes("agenz") || s.includes("agency") || s.includes("tour")) return "agenzia";
  if (s.includes("diret") || s.includes("direct") || s.includes("walk")) return "diretto";
  return s.replace(/\s+/g, " ").slice(0, 40);
}

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export function eur(n: number): string {
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

export function pct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits).replace(".", ",")}%`;
}

/** I tag di blocco scritti in impostazioni, come elenco leggibile: «NO OVERBOOKING» oppure «OB-FISSA». */
export function tagList(raw: string): string {
  const t = String(raw ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!t.length) return "(nessun tag impostato)";
  if (t.length === 1) return `«${t[0]}»`;
  return t.map((x) => `«${x}»`).slice(0, -1).join(", ") + " oppure " + `«${t[t.length - 1]}»`;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** CDF normale standard (Abramowitz-Stegun). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

export function nights(r: { arrival: ISODate; departure: ISODate }): number {
  return Math.max(1, diffDays(r.departure, r.arrival));
}
