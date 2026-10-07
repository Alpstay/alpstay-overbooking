// Vista "Registro": statistiche degli esiti e scheda per registrarli.
import type { Ctx } from "./views";
import { hotelName } from "./views";
import type { CancelReason, CaseOutcome, ObCase } from "./cases";
import { CANCEL_LABEL, OUTCOME_HELP, OUTCOME_LABEL, computeStats, CLOSED_OUTCOMES, SOFT_OUTCOMES } from "./cases";
import { renderTable, Column } from "./table";
import { infoButton } from "./info";
import { esc, eur, fmtDate, pct, todayISO, nights } from "./util";
import type { MailLogEntry } from "./types";
import type { MailTemplate } from "./emails";
import { TEMPLATE_LABEL } from "./emails";

const OUT_CLS: Record<CaseOutcome, string> = {
  aperto: "stop",
  rientrata: "vendi",
  upgrade: "vendi",
  "cambio-camera": "vendi",
  "riprotetta-alpstay": "riprotezione",
  "ricollocata-partner": "pieno",
  cancellata: "rischio",
};

/** Barre orizzontali: leggibili anche da telefono, senza grafico. */
function bars(rows: { label: string; n: number; extra?: string; cls?: string }[]): string {
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return `<p class="muted">Nessun dato.</p>`;
  return `<ul class="hbars">${rows.map((r) => `<li><span class="hb-l">${esc(r.label)}</span>
    <span class="hb-t"><i class="${r.cls ?? ""}" style="width:${(r.n / max) * 100}%"></i></span>
    <b class="hb-n">${r.n}</b><small class="hb-x">${esc(r.extra ?? "")}</small></li>`).join("")}</ul>`;
}


const VIA_LABEL: Record<string, string> = { copiata: "testo copiato", "programma-email": "programma email", manuale: "segnata a mano" };

/** Tutta la corrispondenza fatta con gli ospiti, in ordine di invio. */
export function mailSection(c: Ctx): string {
  const s = c.app.settings;
  const tutte = c.ui.regHotel === "gruppo" ? c.app.mails : c.app.mails.filter((m) => m.hotelId === c.ui.regHotel);
  const cols: Column<MailLogEntry>[] = [
    { key: "when", label: "Inviata il", value: (m) => m.sentAt, render: (m) => `${fmtDate(m.sentAt.slice(0, 10), true)}<br><small class="muted">${esc(m.sentAt.slice(11, 16))}</small>` },
    { key: "tpl", label: "Testo", value: (m) => TEMPLATE_LABEL[m.template as MailTemplate] ?? m.template, filter: true,
      render: (m) => `<b>${esc(TEMPLATE_LABEL[m.template as MailTemplate] ?? m.template)}</b>` },
    { key: "hotel", label: "Casa", value: (m) => (m.hotelId ? hotelName(s, m.hotelId) : "—"), filter: true },
    { key: "guest", label: "Ospite", value: (m) => m.guest, render: (m) => (m.key ? `<button class="linkbtn" data-act="detail" data-v="${esc(m.key)}">${esc(m.guest || m.resId)}</button>` : esc(m.guest || "—")) },
    { key: "id", label: "ID Slope", value: (m) => m.resId, render: (m) => (m.resId ? `<code>${esc(m.resId)}</code>` : "—") },
    { key: "subj", label: "Oggetto", value: (m) => m.subject, render: (m) => `<small>${esc(m.subject)}</small>` },
    { key: "motivo", label: "Motivo dichiarato", value: (m) => m.motivo, render: (m) => (m.motivo ? `<small>${esc(m.motivo)}</small>` : "—") },
    { key: "lang", label: "Lingua", value: (m) => m.lang.toUpperCase(), filter: true },
    { key: "via", label: "Come", value: (m) => VIA_LABEL[m.via] ?? m.via, filter: true },
    { key: "act", label: "", value: () => "", render: (m) => (c.app.canWrite ? `<button class="btn ghost sm" data-act="mail-log-del" data-v="${esc(m.id)}">Togli</button>` : "") },
  ];
  return `<h3 class="sec">Corrispondenza con gli ospiti</h3>
    <p class="muted narrow">Ogni testo copiato o aperto nel programma email finisce qui, con data, ora, lingua e il motivo dichiarato all'ospite. Serve a sapere <b>cosa è già stato detto e quando</b>: prima di annullare una prenotazione devi poter dimostrare che il sollecito è partito. Non è una casella di posta: la piattaforma non legge le risposte.</p>
    ${renderTable({ id: "mails-" + c.ui.regHotel, columns: cols, rows: [...tutte].sort((a, b) => b.sentAt.localeCompare(a.sentAt)), exportName: `corrispondenza-${todayISO()}`, empty: "Nessuna email registrata.", pageSize: 25 })}`;
}

export function viewRegister(c: Ctx): string {
  const s = c.app.settings;
  const all = c.app.cases;
  const list = c.ui.regHotel === "gruppo" ? all : all.filter((x) => x.hotelId === c.ui.regHotel);
  const st = computeStats(list);
  const hn = (id: string): string => hotelName(s, id);

  if (!all.length) {
    return `<section class="page">
      <h2 class="lead">Il registro è vuoto.</h2>
      <p class="muted narrow">Qui finisce ogni posizione di overbooking con il suo esito: risolta da sola, upgrade in casa, riprotetta in un'altra casa AlpStay, ricollocata in un hotel partner con il costo, oppure cancellata con il motivo. Da lì nascono le statistiche.</p>
      <div class="row">
        <button class="btn gold" data-act="tab" data-v="solve">Vai al Problem solving</button>
        <button class="btn ghost" data-act="case-new">Registra una posizione a mano</button>
      </div>
      <p class="muted narrow"><small>Nel Problem solving, dopo aver calcolato il piano, il pulsante «Porta le posizioni nel registro» le apre tutte in un colpo; poi registri l'esito di ognuna quando la chiudi.</small></p>
      ${c.app.mails.length ? mailSection(c) : ""}
    </section>`;
  }

  const seg = [...s.hotels.map((h) => [h.id, h.name] as [string, string]), ["gruppo", "Tutte le case"] as [string, string]]
    .map(([id, nm]) => `<button data-act="reg-hotel" data-v="${id}" aria-pressed="${c.ui.regHotel === id}">${esc(nm)}</button>`).join("");

  const cols: Column<ObCase>[] = [
    { key: "out", label: "Esito", value: (x) => OUTCOME_LABEL[x.outcome], filter: true, render: (x) => `<span class="tag ${OUT_CLS[x.outcome]}">${OUTCOME_LABEL[x.outcome]}</span>` },
    { key: "hotel", label: "Casa", value: (x) => hn(x.hotelId), filter: true },
    { key: "guest", label: "Ospite", value: (x) => x.guest, render: (x) => `<b>${esc(x.guest || x.resId)}</b>` },
    { key: "id", label: "ID Slope", value: (x) => x.resId, render: (x) => `<code>${esc(x.resId)}</code>` },
    { key: "arr", label: "Soggiorno", value: (x) => x.arrival, render: (x) => `${fmtDate(x.arrival)} → ${fmtDate(x.departure)}<br><small class="muted">${nights(x)} notti, ${x.rooms} cam.</small>` },
    { key: "ch", label: "Canale", value: (x) => x.channel, filter: true },
    { key: "net", label: "Valore netto", value: (x) => Math.round(x.netValue), align: "right", render: (x) => eur(x.netValue) },
    { key: "dest", label: "Destinazione", value: (x) => (x.targetHotel ? hn(x.targetHotel) : x.partnerName), render: (x) => esc(x.targetHotel ? hn(x.targetHotel) : x.partnerName || "—") },
    { key: "cost", label: "Costo", value: (x) => Math.round(x.cost), align: "right", render: (x) => (x.cost ? `<b class="neg">${eur(x.cost)}</b>` : "—") },
    { key: "why", label: "Motivo cancellazione", value: (x) => (x.cancelReason ? CANCEL_LABEL[x.cancelReason] : ""), filter: true },
    { key: "spec", label: "Doppia", value: (x) => (x.speculative ? "sì" : ""), render: (x) => (x.speculative ? `<span class="tag rischio">doppia</span>` : "") },
    { key: "when", label: "Aperto il", value: (x) => x.openedAt, render: (x) => `${fmtDate(x.openedAt.slice(0, 10))}<br><small class="muted">${x.openedBy === "piano" ? "dal piano" : "a mano"}</small>` },
    { key: "act", label: "", value: () => "", render: (x) => c.app.canWrite ? `<button class="btn ${x.outcome === "aperto" ? "gold" : "ghost"} sm" data-act="case-open" data-v="${esc(x.id)}">${x.outcome === "aperto" ? "Registra esito" : "Modifica"}</button>` : "" },
  ];

  const esiti = st.perEsito.map((e) => ({ label: OUTCOME_LABEL[e.outcome], n: e.n, cls: OUT_CLS[e.outcome], extra: e.costo ? eur(e.costo) : "" }));
  const motivi = st.perMotivo.map((m) => ({ label: CANCEL_LABEL[m.reason], n: m.n, cls: "rischio" }));
  const case_ = st.perCasa.map((h) => ({ label: hn(h.hotelId), n: h.n, extra: h.costo ? eur(h.costo) : "" }));
  const partner = st.perPartner.map((p) => ({ label: p.nome, n: p.n, cls: "pieno", extra: eur(p.costo) }));
  const mesi = st.mesi.map((m) => ({ label: `${m.mese.slice(5)}/${m.mese.slice(2, 4)}`, n: m.aperti, extra: m.costo ? eur(m.costo) : "" }));

  const aperte = st.aperti ? `${st.aperti} ${st.aperti === 1 ? "posizione ancora da gestire" : "posizioni ancora da gestire"}` : "tutto gestito";
  const lead = st.chiusi
    ? `${st.total} ${st.total === 1 ? "posizione" : "posizioni"}, ${aperte}. Delle ${st.chiusi} chiuse, ${pct(st.softPct)} risolte senza spostare l'ospite fuori casa, per ${eur(st.costoTotale)} di costi a nostro carico.`
    : `${st.total} ${st.total === 1 ? "posizione aperta" : "posizioni aperte"}, nessuna ancora chiusa.`;

  return `<section class="page">
    <div class="pagehead"><div class="seg">${seg}</div>
      ${c.app.canWrite ? `<div class="row tight"><button class="btn ghost sm" data-act="case-new">Registra una posizione</button><button class="btn ghost sm" data-act="case-purge">Elimina le chiuse oltre 24 mesi</button></div>` : ""}</div>
    <h2 class="lead">${esc(lead)}</h2>
    <div class="kpis wide">
      <div><span>Posizioni totali</span><b>${st.total}</b></div>
      <div><span>Ancora da gestire</span><b class="${st.aperti ? "neg" : ""}">${st.aperti}</b></div>
      <div><span>Risolte in casa</span><b>${pct(st.softPct)}</b><small>senza spostare l'ospite</small></div>
      <div><span>Costo totale</span><b>${eur(st.costoTotale)}</b></div>
      <div><span>Costo medio per posizione chiusa</span><b>${eur(st.costoMedioChiuso)}</b></div>
      <div><span>Valore trattenuto</span><b>${eur(st.valoreSalvato)}</b><small>ospiti che sono comunque venuti</small></div>
      <div><span>Valore perso</span><b class="neg">${eur(st.valorePerso)}</b><small>prenotazioni cancellate</small></div>
    </div>
    <div class="cols2">
      <article><h3 class="sec">Come sono finite</h3>${bars(esiti)}</article>
      <article><h3 class="sec">Perché sono state cancellate</h3>${motivi.length ? bars(motivi) : `<p class="muted">Nessuna cancellazione registrata.</p>`}</article>
    </div>
    <div class="cols2">
      <article><h3 class="sec">Per casa</h3>${bars(case_)}</article>
      <article><h3 class="sec">Hotel partner usati</h3>${partner.length ? bars(partner) : `<p class="muted">Nessun ricollocamento esterno registrato.</p>`}</article>
    </div>
    <h3 class="sec">Posizioni aperte per mese</h3>${bars(mesi)}
    <h3 class="sec with-info">Registro completo ${infoButton("registro", "Come funziona il registro")}</h3>
    ${renderTable({ id: "cases-" + c.ui.regHotel, columns: cols, rows: [...list].sort((a, b) => b.openedAt.localeCompare(a.openedAt)), exportName: `registro-overbooking-${todayISO()}`, empty: "Nessuna posizione.", pageSize: 30, rowClass: (x) => (x.outcome === "aperto" ? "specalta" : "") })}
    ${mailSection(c)}
  </section>`;
}

// ------------------------------------------------------------ scheda di registrazione
export function caseSheet(c: Ctx, id: string | null): string {
  if (!id) return "";
  const x = c.app.cases.find((k) => k.id === id);
  if (!x) return "";
  const s = c.app.settings;
  const needTarget = x.outcome === "riprotetta-alpstay";
  const needPartner = x.outcome === "ricollocata-partner";
  const needReason = x.outcome === "cancellata";
  const closed = CLOSED_OUTCOMES.includes(x.outcome);
  const suggerito = x.proposed === "walk" ? "ricollocata-partner" : x.proposed === "riprotezione" ? "riprotetta-alpstay" : x.proposed === "upgrade" ? "upgrade" : x.proposed === "cancellazione" ? "cancellata" : null;

  const opt = (o: CaseOutcome): string =>
    `<option value="${o}" ${o === x.outcome ? "selected" : ""}>${OUTCOME_LABEL[o]}${o === suggerito ? " (proposto dal piano)" : ""}</option>`;

  return `<div class="sheet-bg" data-act="case-close"></div>
  <aside class="sheet wide" role="dialog" aria-label="Esito della posizione">
    <header><div><h3>${esc(x.guest || x.resId)}</h3><small class="muted"><code>${esc(x.resId)}</code> · ${esc(hotelName(s, x.hotelId))} · ${fmtDate(x.arrival)} → ${fmtDate(x.departure)} · ${x.rooms} cam. · ${eur(x.netValue)}</small></div><button class="btn ghost sm" data-act="case-close">Chiudi</button></header>
    ${x.speculative ? `<p class="mv spec alta"><b>Era una doppia prenotazione</b><br><small>Lo stesso ospite teneva aperte più prenotazioni.</small></p>` : ""}
    <label class="field">Com'è finita
      <select data-case="outcome">${(Object.keys(OUTCOME_LABEL) as CaseOutcome[]).map(opt).join("")}</select>
      <small class="muted">${esc(OUTCOME_HELP[x.outcome])}</small></label>
    ${needTarget ? `<label class="field">Casa che l'ha accolta
      <select data-case="targetHotel"><option value="">— scegli —</option>${s.hotels.filter((h) => h.id !== x.hotelId).map((h) => `<option value="${h.id}" ${h.id === x.targetHotel ? "selected" : ""}>${esc(h.name)}</option>`).join("")}</select></label>` : ""}
    ${needPartner ? `<label class="field">Hotel partner
      <input type="text" list="partner-list" data-case="partnerName" value="${esc(x.partnerName)}" placeholder="Nome dell'hotel di colleghi">
      <datalist id="partner-list">${[...new Set(c.app.cases.map((k) => k.partnerName).filter(Boolean))].map((p) => `<option value="${esc(p)}"></option>`).join("")}</datalist></label>` : ""}
    ${needReason ? `<label class="field">Motivo della cancellazione
      <select data-case="cancelReason"><option value="">— scegli —</option>${(Object.keys(CANCEL_LABEL) as CancelReason[]).map((r) => `<option value="${r}" ${r === x.cancelReason ? "selected" : ""}>${CANCEL_LABEL[r]}</option>`).join("")}</select></label>` : ""}
    <div class="grid2">
      <label class="field">Costo a nostro carico (€)<input type="number" min="0" step="10" data-case="cost" value="${x.cost || ""}" placeholder="0"></label>
      <label class="field">Gesto commerciale<input type="text" data-case="compensation" value="${esc(x.compensation)}" placeholder="notte omaggio, sconto, transfer…"></label>
    </div>
    <label class="field">Note<textarea data-case="note" rows="3" placeholder="Cosa è successo, chi ha deciso, cosa dire se richiama">${esc(x.note)}</textarea></label>
    <p class="muted"><small>Aperta il ${fmtDate(x.openedAt.slice(0, 10))} ${x.openedAt.slice(11, 16)} ${x.openedBy === "piano" ? "dal piano" : "a mano"}${x.proposed ? `, il piano proponeva: ${x.proposed === "walk" ? "overbooking" : x.proposed === "cancellazione" ? "cancellazione con motivo valido" : x.proposed}` : ""}${closed && x.closedAt ? ` · chiusa il ${fmtDate(x.closedAt.slice(0, 10))}` : ""}</small></p>
    <div class="row">
      <button class="btn gold" data-act="case-save" data-v="${esc(x.id)}">Salva l'esito</button>
      <button class="btn ghost" data-act="detail" data-v="${esc(x.key)}">Apri la prenotazione</button>
      <span class="grow"></span>
      <button class="btn ghost sm" data-act="case-del" data-v="${esc(x.id)}">Elimina</button>
    </div>
  </aside>`;
}

export function registerInfoSheet(c: Ctx): string {
  const s = c.app.settings;
  const soft = SOFT_OUTCOMES.map((o) => OUTCOME_LABEL[o]).join(", ");
  return `<div class="sheet-bg" data-act="info-close"></div>
  <aside class="sheet wide" role="dialog" aria-label="Registro overbooking">
    <header><div><h3>Registro overbooking</h3><small class="muted">Cosa raccoglie e come leggerlo</small></div><button class="btn ghost sm" data-act="info-close">Chiudi</button></header>
    <p>Tiene traccia di ogni posizione di overbooking dall'apertura alla chiusura: cosa proponeva il piano, cosa avete fatto davvero, quanto è costato. È la base per capire se la strategia funziona e quanto vi costa ogni camera venduta oltre la capienza.</p>
    <h4 class="lg-h">Come si apre una posizione</h4>
    <ul class="info-cols">
      <li><b>Dal piano</b><p>Nel Problem solving, «Porta le posizioni nel registro» apre in un colpo tutte le azioni del piano (upgrade, riprotezioni, overbooking). Una posizione già aperta per la stessa prenotazione non viene duplicata.</p></li>
      <li><b>A mano</b><p>«Registra una posizione» serve per i casi nati al banco che il piano non aveva previsto.</p></li>
      <li><b>Dal pannello della notte</b><p>Ogni passo ha il pulsante «Registra esito», che apre o riapre la posizione di quella prenotazione.</p></li>
    </ul>
    <h4 class="lg-h">Gli esiti</h4>
    <ul class="info-cols">
      ${(Object.keys(OUTCOME_LABEL) as CaseOutcome[]).map((o) => `<li><b>${OUTCOME_LABEL[o]}</b><p>${esc(OUTCOME_HELP[o])}</p></li>`).join("")}
    </ul>
    <h4 class="lg-h">I motivi della cancellazione</h4>
    <p>${(Object.keys(CANCEL_LABEL) as CancelReason[]).map((r) => CANCEL_LABEL[r]).join(" · ")}. Il motivo serve per capire dove intervenire: molte «carta non valida» significano che conviene chiedere una garanzia valida alla prenotazione; molte «doppia prenotazione» confermano che l'allerta della Guida strategica va usata prima, non dopo.</p>
    <h4 class="lg-h">Come leggere i numeri</h4>
    <ul class="info-tips">
      <li><b>Risolte in casa</b>: quota chiusa con ${esc(soft)}. È l'indicatore più importante: più è alta, meno ospiti avete disturbato.</li>
      <li><b>Costo medio per posizione chiusa</b>: confrontalo con il «costo di un overbooking per camera» impostato per ogni casa (oggi ${s.hotels.map((h) => `${h.name} ${eur(h.walkCost)}`).join(", ")}). Se il costo reale è più alto, alza quel valore in Impostazioni: la soglia di overbooking diventerà più prudente da sola.</li>
      <li><b>Valore trattenuto</b> contro <b>valore perso</b>: quanto fatturato avete salvato e quanto è uscito dalla porta.</li>
      <li><b>Hotel partner usati</b>: chi vi ha aiutato e quanto è costato. Utile per negoziare tariffe di reciprocità.</li>
    </ul>
    <p class="muted"><small>Il registro è condiviso con tutta la reception e si esporta in Excel. Le posizioni chiuse da oltre 24 mesi si possono eliminare con il pulsante in alto.</small></p>
  </aside>`;
}
