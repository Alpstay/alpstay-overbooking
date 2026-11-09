/**
 * Rischio meteo per la Val Gardena: un avviso, non un calcolo che sposta la soglia.
 *
 * Fonte: Open Data Hub dell'Alto Adige (dati aperti della Provincia, nessuna chiave).
 * - Weather/Measuringpoint: stazioni neve vicino alla Val Gardena (altezza neve, neve fresca,
 *   ultima nevicata, temperatura).
 * - Weather/Forecast: previsioni giornaliere dei comuni di Ortisei, S. Cristina e Selva.
 *
 * L'effetto del meteo sulle cancellazioni AlpStay non è ancora misurato: per questo il risultato
 * resta un avviso con consigli e non entra nella soglia di overbooking. Le regole sono scritte qui
 * sotto per intero, così si possono rivedere quando ci sarà una stagione di dati.
 */

import type { HotelId, Reservation } from "./types";

const API = "https://tourism.api.opendatahub.com/v1";
/** Centro della Val Gardena (tra S. Cristina e Selva) e raggio di ricerca delle stazioni neve. */
const LAT = 46.565, LON = 11.73, RAGGIO_M = 12000;
/** Codici ISTAT dei tre comuni: Ortisei, S. Cristina, Selva. */
const ISTAT = ["021061", "021085", "021089"];
const NOMI_COMUNI = /urtij|ortisei|st\.? ulrich|cristina|selva|wolkenstein|sëlva/i;
const CACHE = "meteo-valgardena-v1";
const CACHE_ORE = 3;

export type Livello = "basso" | "medio" | "alto";

export interface Stazione { nome: string; quota: number | null; neve: number | null; fresca: number | null; ultimaNevicata: string | null; aggiornata: string | null }
export interface Giorno { data: string; min: number | null; max: number | null; pioggiaMm: number | null; prob: number | null; desc: string }

export interface Fattore { nome: string; valore: string; punti: number }

export interface RischioMeteo {
  livello: Livello;
  punti: number;
  fattori: Fattore[];
  stazioni: Stazione[];
  giorni: Giorno[];
  /** Quando sono stati scaricati i dati. */
  letto: string;
  inverno: boolean;
}

type Stato = { stato: "attesa" } | { stato: "ok"; r: RischioMeteo } | { stato: "errore"; msg: string };
let stato: Stato = { stato: "attesa" };

export function statoMeteo(): Stato { return stato; }

// ------------------------------------------------------------ lettura

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") { const n = parseFloat(v.replace(",", ".")); return Number.isFinite(n) ? n : null; }
  return null;
};
const giorno = (v: unknown): string | null => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
const elenco = (j: unknown): Record<string, unknown>[] => {
  if (Array.isArray(j)) return j as Record<string, unknown>[];
  const o = j as { Items?: unknown };
  return Array.isArray(o?.Items) ? (o.Items as Record<string, unknown>[]) : [];
};

function leggiStazioni(j: unknown): Stazione[] {
  return elenco(j).filter((m) => m.Active !== false).map((m) => {
    const gps = Array.isArray(m.GpsInfo) ? (m.GpsInfo as Record<string, unknown>[]) : [];
    return {
      nome: String(m.Shortname ?? "stazione"),
      quota: gps.length ? num(gps[0].Altitude) : null,
      neve: num(m.SnowHeight),
      fresca: num(m.newSnowHeight),
      ultimaNevicata: giorno(m.LastSnowDate),
      aggiornata: giorno(m.LastUpdate),
    };
  }).filter((s) => s.neve != null || s.fresca != null);
}

function leggiPrevisioni(j: unknown): Giorno[] {
  const comuni = elenco(j).filter((f) => ISTAT.includes(String(f.MunicipalityIstatCode ?? "")) ||
    NOMI_COMUNI.test(String(f.Shortname ?? "")) || NOMI_COMUNI.test(JSON.stringify(f.MunicipalityName ?? {})));
  const perGiorno = new Map<string, { min: number[]; max: number[]; mm: number[]; prob: number[]; desc: string }>();
  for (const c of comuni) {
    const daily = Array.isArray(c.ForeCastDaily) ? (c.ForeCastDaily as Record<string, unknown>[]) : [];
    for (const d of daily) {
      const g = giorno(d.Date);
      if (!g) continue;
      const v = perGiorno.get(g) ?? { min: [], max: [], mm: [], prob: [], desc: "" };
      const mi = num(d.MinTemp), ma = num(d.MaxTemp), mm = num(d.Precipitation), pr = num(d.PrecipitationProbability);
      if (mi != null) v.min.push(mi);
      if (ma != null) v.max.push(ma);
      if (mm != null) v.mm.push(mm);
      if (pr != null) v.prob.push(pr);
      if (!v.desc && typeof d.WeatherDesc === "string") v.desc = d.WeatherDesc;
      perGiorno.set(g, v);
    }
  }
  const media = (a: number[]): number | null => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  return [...perGiorno.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([data, v]) => ({
    data, min: media(v.min), max: media(v.max), pioggiaMm: media(v.mm), prob: media(v.prob), desc: v.desc,
  }));
}

// ------------------------------------------------------------ regole

const oggi = (): string => new Date().toISOString().slice(0, 10);
const giorniFra = (a: string, b: string): number => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
const mediana = (a: number[]): number | null => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Stagione della neve: dal 15 novembre al 15 aprile. Fuori conta solo il brutto tempo. */
function inverno(d: string): boolean {
  const md = d.slice(5);
  return md >= "11-15" || md <= "04-15";
}

/**
 * Le regole, in punti (più punti = più rischio):
 * - Neve sulle piste (mediana delle stazioni sopra i 1.800 m, aggiornate negli ultimi 5 giorni):
 *   50 cm o più 0, da 20 a 49 cm +1, meno di 20 cm +2.
 * - Ultima nevicata: entro 7 giorni −1, oltre 21 giorni +1.
 * - Notti fredde per l'innevamento (minima in paese a 0 °C o meno, cioè circa −4 °C in quota)
 *   nei giorni di previsione: 3 o più −1, nessuna +1.
 * - Giorni di pioggia in paese (2 mm o più con massima sopra 3 °C): 3 o più +1.
 * - Giorni di neve in arrivo (2 mm o più con massima fino a 2 °C): almeno uno −1.
 * Livello: 0 o meno basso, 1–2 medio, 3 o più alto. Fuori stagione contano solo pioggia e neve in arrivo.
 */
export function calcola(stazioni: Stazione[], giorni: Giorno[], d = oggi()): RischioMeteo {
  const inv = inverno(d);
  const fattori: Fattore[] = [];
  const futuri = giorni.filter((g) => g.data >= d);

  if (inv) {
    const recenti = stazioni.filter((s) => !s.aggiornata || giorniFra(s.aggiornata, d) <= 5);
    const alte = recenti.filter((s) => (s.quota ?? 0) >= 1800 && s.neve != null);
    const base = (alte.length ? alte : recenti.filter((s) => s.neve != null)).map((s) => s.neve as number);
    const cm = mediana(base);
    if (cm != null) fattori.push({ nome: "Neve sulle piste", valore: `${Math.round(cm)} cm (mediana di ${base.length} stazioni)`, punti: cm >= 50 ? 0 : cm >= 20 ? 1 : 2 });
    else fattori.push({ nome: "Neve sulle piste", valore: "nessuna stazione aggiornata", punti: 0 });

    const ultime = stazioni.map((s) => s.ultimaNevicata).filter((x): x is string => !!x).sort();
    const ult = ultime.length ? ultime[ultime.length - 1] : null;
    if (ult) {
      const gg = giorniFra(ult, d);
      fattori.push({ nome: "Ultima nevicata", valore: gg <= 0 ? "oggi" : `${gg} giorni fa`, punti: gg <= 7 ? -1 : gg > 21 ? 1 : 0 });
    }

    if (futuri.length) {
      const fredde = futuri.filter((g) => g.min != null && g.min <= 0).length;
      fattori.push({ nome: "Notti fredde per l'innevamento", valore: `${fredde} su ${futuri.length}`, punti: fredde >= 3 ? -1 : fredde === 0 ? 1 : 0 });
    }
  }

  if (futuri.length) {
    const pioggia = futuri.filter((g) => (g.pioggiaMm ?? 0) >= 2 && (g.max ?? 99) > 3).length;
    fattori.push({ nome: "Giorni di pioggia in paese", valore: `${pioggia} su ${futuri.length}`, punti: pioggia >= 3 ? 1 : 0 });
    const neve = futuri.filter((g) => (g.pioggiaMm ?? 0) >= 2 && g.max != null && g.max <= 2).length;
    fattori.push({ nome: "Neve in arrivo", valore: neve ? `${neve} ${neve === 1 ? "giorno" : "giorni"}` : "nessuna", punti: neve ? -1 : 0 });
  }

  const punti = fattori.reduce((s, f) => s + f.punti, 0);
  const livello: Livello = punti >= 3 ? "alto" : punti >= 1 ? "medio" : "basso";
  return { livello, punti, fattori, stazioni, giorni: futuri, letto: new Date().toISOString(), inverno: inv };
}

// ------------------------------------------------------------ caricamento

async function json(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Scarica i dati (al massimo ogni 3 ore, poi dalla memoria del browser) e calcola il rischio. */
export async function caricaMeteo(): Promise<void> {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) ?? "null") as { t: number; s: Stazione[]; g: Giorno[] } | null;
    if (c && Date.now() - c.t < CACHE_ORE * 3600e3) { stato = { stato: "ok", r: calcola(c.s, c.g) }; return; }
  } catch { /* memoria non disponibile: si scarica */ }
  try {
    const [m, f] = await Promise.allSettled([
      json(`${API}/Weather/Measuringpoint?latitude=${LAT}&longitude=${LON}&radius=${RAGGIO_M}&pagesize=50&removenullvalues=true`),
      json(`${API}/Weather/Forecast?language=it&pagesize=200`),
    ]);
    const s = m.status === "fulfilled" ? leggiStazioni(m.value) : [];
    const g = f.status === "fulfilled" ? leggiPrevisioni(f.value) : [];
    if (!s.length && !g.length) {
      stato = { stato: "errore", msg: "I dati meteo dell'Open Data Hub non sono raggiungibili in questo momento." };
      return;
    }
    stato = { stato: "ok", r: calcola(s, g) };
    try { localStorage.setItem(CACHE, JSON.stringify({ t: Date.now(), s, g })); } catch { /* niente */ }
  } catch {
    stato = { stato: "errore", msg: "I dati meteo dell'Open Data Hub non sono raggiungibili in questo momento." };
  }
}

// ------------------------------------------------------------ riquadro

const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const dIt = (d: string): string => { const [, m, g] = d.split("-"); return `${Number(g)}.${m}`; };

const CONSIGLI: Record<Livello, string> = {
  alto: "Per gli arrivi delle prossime 2 settimane aspettati più cancellazioni e meno prenotazioni dell'ultimo minuto. Non ricollocare in anticipo gli ospiti delle notti oltre soglia: una parte dei conflitti si risolverà con le cancellazioni. Non vendere altre camere oltre capienza: quelle liberate saranno difficili da rivendere.",
  medio: "Condizioni da seguire. Nessun cambio di strategia, ma ricontrolla tra qualche giorno prima di aggiungere overbooking sulle notti vicine.",
  basso: "Condizioni buone: la domanda dell'ultimo minuto tiene. Mantieni i prezzi e la soglia come indicato dalla guida.",
};

/** Il riquadro per la Guida strategica, con gli arrivi esposti della casa scelta (o del gruppo). */
export function riquadroMeteo(list: Reservation[], hotel: HotelId | "gruppo"): string {
  const s = stato;
  if (s.stato === "attesa") return `<div class="meteo"><p class="muted">Carico il meteo della Val Gardena…</p></div>`;
  if (s.stato === "errore") return `<div class="meteo"><p class="muted">${esc(s.msg)} La guida funziona lo stesso.</p></div>`;
  const r = s.r, d = oggi(), fine = new Date(Date.parse(d + "T00:00:00Z") + 14 * 864e5).toISOString().slice(0, 10);
  const arrivi = list.filter((x) => x.status === "confermata" && (hotel === "gruppo" || x.hotelId === hotel) && x.arrival >= d && x.arrival <= fine);
  const camere = arrivi.reduce((n, x) => n + (x.rooms || 1), 0);
  const titolo = r.livello === "alto" ? "Rischio meteo alto" : r.livello === "medio" ? "Rischio meteo medio" : "Rischio meteo basso";
  const giorniHtml = r.giorni.slice(0, 7).map((g) => `<li><b>${dIt(g.data)}</b><span>${g.min == null ? "–" : Math.round(g.min)}° / ${g.max == null ? "–" : Math.round(g.max)}°</span><small>${g.pioggiaMm == null ? "" : `${Math.round(g.pioggiaMm)} mm`}</small></li>`).join("");
  return `<article class="meteo ${r.livello}">
    <header><span class="tag ${r.livello === "alto" ? "rischio" : r.livello === "medio" ? "pieno" : "vendi"}">${titolo}</span>
      <span class="muted">Val Gardena · prossimi giorni · ${camere} ${camere === 1 ? "camera in arrivo" : "camere in arrivo"} entro 14 giorni</span></header>
    <p>${esc(CONSIGLI[r.livello])}</p>
    <ul class="meteo-f">${r.fattori.map((f) => `<li><span>${esc(f.nome)}</span><b>${esc(f.valore)}</b><i class="${f.punti > 0 ? "neg" : f.punti < 0 ? "pos" : "muted"}">${f.punti > 0 ? "+" : ""}${f.punti}</i></li>`).join("")}</ul>
    ${giorniHtml ? `<ul class="meteo-g">${giorniHtml}</ul>` : ""}
    <p class="muted"><small>Fonte: Open Data Hub Alto Adige (stazioni neve e previsioni dei comuni). Solo un avviso: la soglia di overbooking non cambia. Le regole sono spiegate in «Come funziona».</small></p>
  </article>`;
}
