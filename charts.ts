import type { DayForecast } from "./types";
import { actionOf } from "./forecast";
import { esc, fmtDate, pct } from "./util";
import { BUCKET_LABEL } from "./analytics";

const ACT_TXT: Record<string, string> = { vendi: "Vendi in overbooking", stop: "Soglia raggiunta", rischio: "Oltre soglia", pieno: "Quasi pieno", libero: "Vendita normale" };
const f1 = (n: number): string => n.toFixed(1).replace(".", ",");
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Contenuto del riquadro che compare passando sopra una barra: il problema e cosa fare. */
export function skyTip(d: DayForecast, freezeDays: number): string {
  const a = actionOf(d);
  const over = d.otb - d.capacity;
  const extra = d.ceiling - d.capacity;
  const free = d.capacity - d.otb;
  let todo: string;
  switch (a) {
    case "rischio":
      todo = `${plural(d.otb - d.ceiling, "camera", "camere")} oltre la soglia di sicurezza. Chiudi subito le vendite su tutti i canali. ` +
        (d.expCancel >= over && over > 0 && !d.frozen
          ? `Le cancellazioni attese (${f1(d.expCancel)}) potrebbero bastare: fai subito i cambi in casa e ricontrolla dopo il prossimo import prima di chiamare gli ospiti.`
          : `Le cancellazioni attese (${f1(d.expCancel)}) non bastano a coprire ${plural(Math.max(0, over), "camera", "camere")} in eccesso: clicca la barra per aprire il piano di riprotezione.`);
      break;
    case "stop":
      todo = "Soglia raggiunta: chiudi le vendite su tutti i canali, sito compreso. Riapri solo se arrivano cancellazioni.";
      break;
    case "vendi":
      todo = `Casa piena ma con margine: puoi vendere ancora ${plural(d.headroom, "camera", "camere")} oltre la capienza. Sul channel manager apri un overbooking di +${extra} e chiudi quando il margine arriva a zero.`;
      break;
    case "pieno":
      todo = extra > 0
        ? `Restano ${plural(free, "camera libera", "camere libere")}. Quando la casa si riempie puoi continuare a vendere fino a ${d.ceiling} camere in totale (+${extra} oltre capienza).`
        : `Restano ${plural(free, "camera libera", "camere libere")}. Vendi fino alla capienza: per questa notte l'overbooking non è consigliato${d.frozen ? " perché l'arrivo è troppo vicino" : " perché il rischio supererebbe la soglia impostata"}.`;
      break;
    default:
      todo = `Nessun problema: vendita normale, ${plural(free, "camera libera", "camere libere")}.` + (extra > 0 ? ` Quando si riempie, la soglia consente +${extra} oltre capienza.` : "");
  }
  if (d.frozen && a !== "rischio") todo += ` Mancano meno di ${freezeDays + 1} giorni: niente nuovo overbooking.`;
  return `<div class="tt-h"><b>${esc(fmtDate(d.date, true))}</b>${d.event ? `<span class="chip ${d.event.kind}">${esc(d.event.name)}</span>` : ""}<span class="tag ${a}">${ACT_TXT[a]}</span></div>
    <dl class="tt-dl">
      <dt>In portafoglio</dt><dd><b>${d.otb}</b> su ${d.capacity}${over > 0 ? ` <span class="neg">(+${over} oltre capienza)</span>` : ""}</dd>
      <dt>Soglia vendibile</dt><dd><b>${d.ceiling}</b>, margine <b class="${d.headroom < 0 ? "neg" : d.headroom > 0 ? "pos" : ""}">${d.headroom > 0 ? "+" : ""}${d.headroom}</b></dd>
      <dt>Cancellazioni attese</dt><dd>${meter(d.expCancel, Math.max(0, over), d.sdCancel, Math.ceil(d.capacity * 0.12))} ${f1(d.expCancel)}</dd>
      ${d.walkRiskPct > 0.005 ? `<dt>Rischio overbooking</dt><dd><b class="neg">${pct(d.walkRiskPct)}</b></dd>` : ""}
      ${d.protectedRooms ? `<dt>Prenotazioni fisse</dt><dd>${d.protectedRooms} camere</dd>` : ""}
    </dl>
    <p class="tt-todo"><b>Cosa fare:</b> ${esc(todo)}</p>
    ${a === "rischio" && d.hotelId !== "gruppo" ? `<p class="tt-hint">Clicca la barra per il piano di riprotezione</p>` : ""}`;
}

/** Profilo "skyline": occupazione a oggi per notte, con capienza e soglia vendibile. */
export function skyline(days: DayForecast[], freezeDays = 2): string {
  if (!days.length) return "";
  const bw = 9, gap = 2, H = 190, top = 18, bottom = 26;
  const W = days.length * (bw + gap);
  const maxR = Math.max(1.15, ...days.map((d) => Math.max(d.otb, d.ceiling) / Math.max(1, d.capacity))) * 1.03;
  const y = (ratio: number): number => top + (H - top - bottom) * (1 - ratio / maxR);
  const capY = y(1);
  let bands = "", bars = "", ticks = "", labels = "", hits = "";
  days.forEach((d, i) => {
    const x = i * (bw + gap);
    if (d.event) bands += `<rect x="${x - 1}" y="${top - 12}" width="${bw + gap}" height="${H - top - bottom + 12}" class="sk-ev${d.event.kind === "evento" ? " e" : ""}"/>`;
    const r = d.otb / Math.max(1, d.capacity);
    const a = actionOf(d);
    const yy = y(r);
    bars += `<rect x="${x}" y="${yy}" width="${bw}" height="${Math.max(0, H - bottom - yy)}" class="sk-b ${a}" rx="1.5" data-sk="${i}"/>`;
    if (d.ceiling > d.capacity) ticks += `<line x1="${x - 1}" x2="${x + bw + 1}" y1="${y(d.ceiling / d.capacity)}" y2="${y(d.ceiling / d.capacity)}" class="sk-ceil"/>`;
    if (d.date.endsWith("-01") || i === 0) labels += `<text x="${x}" y="${H - 8}" class="sk-l">${esc(fmtDate(d.date).replace(/ \d\d$/, ""))}</text>`;
    const click = a === "rischio" && d.hotelId !== "gruppo" ? ` data-act="solve-from" data-v="${d.date}"` : "";
    hits += `<rect x="${x - gap / 2}" y="0" width="${bw + gap}" height="${H - bottom + 4}" class="sk-hit${click ? " clk" : ""}" data-sk="${i}" data-tip="${esc(skyTip(d, freezeDays))}"${click}/>`;
  });
  return `<div class="sky"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Occupazione a oggi e soglia di overbooking per i prossimi ${days.length} giorni. Passa sopra una barra per i dettagli.">
    ${bands}
    <line x1="0" x2="${W}" y1="${capY}" y2="${capY}" class="sk-cap"/>
    ${bars}${ticks}${labels}${hits}
  </svg></div>`;
}

export function washChart(series: { name: string; values: number[]; cls: string }[]): string {
  const W = 560, H = 230, l = 40, r = 12, t = 14, b = 44;
  const n = BUCKET_LABEL.length;
  const maxV = Math.max(0.1, ...series.flatMap((s) => s.values)) * 1.15;
  const x = (i: number): number => l + ((W - l - r) * i) / (n - 1);
  const y = (v: number): number => t + (H - t - b) * (1 - v / maxV);
  let grid = "";
  for (let k = 0; k <= 4; k++) {
    const v = (maxV * k) / 4;
    grid += `<line x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${l - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${pct(v)}</text>`;
  }
  const xl = BUCKET_LABEL.map((lab, i) => `<text x="${x(i)}" y="${H - b + 16}" class="ax" text-anchor="middle">${esc(lab.replace(" gg", ""))}</text>`).join("");
  const lines = series
    .map((s) => `<polyline class="ln ${s.cls}" points="${s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}"/>` + s.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" class="pt ${s.cls}"><title>${esc(`${s.name}, ${BUCKET_LABEL[i]}: ${pct(v, 1)}`)}</title></circle>`).join(""))
    .join("");
  const legend = series.map((s) => `<span class="lg"><i class="${s.cls}"></i>${esc(s.name)}</span>`).join("");
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Probabilità di cancellazione per giorni mancanti all'arrivo">${grid}${xl}<text x="${(W + l) / 2}" y="${H - 6}" class="ax" text-anchor="middle">giorni mancanti all'arrivo</text>${lines}</svg><figcaption>${legend}</figcaption></figure>`;
}

export function monthBars(months: { month: string; occ: number }[]): string {
  const W = 560, H = 170, b = 24, t = 10;
  const bw = (W - 20) / months.length - 6;
  const bars = months
    .map((m, i) => {
      const x = 10 + i * (bw + 6);
      const h = (H - b - t) * Math.min(1, m.occ);
      const [yy, mm] = m.month.split("-");
      return `<rect x="${x}" y="${H - b - h}" width="${bw}" height="${h}" class="mb" rx="2"><title>${esc(`${mm}/${yy}: ${pct(m.occ)}`)}</title></rect><text x="${x + bw / 2}" y="${H - 8}" class="ax" text-anchor="middle">${mm}/${yy.slice(2)}</text><text x="${x + bw / 2}" y="${H - b - h - 4}" class="ax" text-anchor="middle">${Math.round(m.occ * 100)}</text>`;
    })
    .join("");
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Occupazione mensile ultimi 12 mesi">${bars}</svg></figure>`;
}

/**
 * Misurometro: cancellazioni attese contro camere in eccesso.
 * Zona rossa = eccesso non ancora coperto, zona verde = cancellazioni oltre il necessario.
 */
export function gauge(expected: number, excess: number, sd: number): string {
  const M = Math.max(2, excess * 2, Math.ceil((expected + sd) * 1.3));
  const cx = 60, cy = 58, R = 46, w = 11;
  const pt = (v: number, r: number): [number, number] => {
    const a = Math.PI * (1 - Math.min(v, M) / M);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };
  const arc = (from: number, to: number, cls: string): string => {
    if (to <= from) return "";
    const [x1, y1] = pt(from, R), [x2, y2] = pt(to, R);
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" class="${cls}" stroke-width="${w}" fill="none"/>`;
  };
  const lo = Math.max(0, expected - sd), hi = Math.min(M, expected + sd);
  const [bx1, by1] = pt(lo, R + w / 2 + 3), [bx2, by2] = pt(hi, R + w / 2 + 3);
  const band = hi > lo ? `<path d="M${bx1.toFixed(1)} ${by1.toFixed(1)} A${R + w / 2 + 3} ${R + w / 2 + 3} 0 0 1 ${bx2.toFixed(1)} ${by2.toFixed(1)}" class="gg-sd" fill="none"/>` : "";
  const [nx, ny] = pt(expected, R - 4);
  const [tx, ty] = pt(excess, R + w / 2 + 1);
  const [tx2, ty2] = pt(excess, R - w / 2 - 1);
  const ok = expected >= excess;
  const state = excess === 0 ? "nessun eccesso" : ok ? "le cancellazioni coprono l'eccesso" : "le cancellazioni non bastano";
  const fmt = (n: number): string => n.toFixed(1).replace(".", ",");
  const title = `Cancellazioni attese ${fmt(expected)} (±${fmt(sd)}) contro ${excess} camere in eccesso: ${state}`;
  return `<figure class="gauge ${excess === 0 ? "none" : ok ? "ok" : "ko"}" title="${esc(title)}">
    <svg viewBox="0 0 120 70" role="img" aria-label="${esc(title)}">
      ${arc(0, M, "gg-bg")}${arc(0, Math.min(excess, M), "gg-red")}${arc(Math.min(excess, M), M, "gg-green")}
      ${band}
      ${excess > 0 ? `<line x1="${tx.toFixed(1)}" y1="${ty.toFixed(1)}" x2="${tx2.toFixed(1)}" y2="${ty2.toFixed(1)}" class="gg-tick"/>` : ""}
      <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" class="gg-needle"/>
      <circle cx="${cx}" cy="${cy}" r="4.5" class="gg-hub"/>
      <text x="${cx - R}" y="69" class="gg-l" text-anchor="middle">0</text>
      <text x="${cx + R}" y="69" class="gg-l" text-anchor="middle">${M}</text>
    </svg>
    <figcaption>${state}</figcaption>
  </figure>`;
}

/** Misurometro compatto per le righe di tabella. */
export function meter(expected: number, excess: number, sd: number, scale: number): string {
  const M = Math.max(2, scale, excess * 1.6, expected + sd);
  const w = (v: number): string => `${Math.min(100, (v / M) * 100).toFixed(1)}%`;
  const ok = expected >= excess;
  const fmt = (n: number): string => n.toFixed(1).replace(".", ",");
  const title = `Cancellazioni attese ${fmt(expected)} (±${fmt(sd)})${excess ? `, camere in eccesso ${excess}` : ""}`;
  return `<span class="meter ${excess === 0 ? "none" : ok ? "ok" : "ko"}" title="${esc(title)}" role="img" aria-label="${esc(title)}">
    <i class="m-sd" style="left:${w(Math.max(0, expected - sd))};width:calc(${w(Math.min(M, expected + sd))} - ${w(Math.max(0, expected - sd))})"></i>
    <i class="m-fill" style="width:${w(expected)}"></i>
    ${excess ? `<i class="m-need" style="left:${w(excess)}"></i>` : ""}
  </span>`;
}
