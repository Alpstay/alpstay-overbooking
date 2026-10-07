import type { AppState, HotelId, Reservation, Settings, ImportLog, SeasonEvent, MappingField, MailLogEntry } from "./types";
import { Store, takeRepaired } from "./storage";
import { defaultSettings, emptyMeta, SETTINGS_VERSION } from "./defaults";
import { autoMap, normalize, readFile, resKey } from "./importer";
import { Protector } from "./protect";
import { buildWashModel, hotelStats } from "./analytics";
import { forecastGroup, forecastHotel } from "./forecast";
import { solve } from "./solver";
import { detectSpeculative } from "./speculative";
import { detectCancellable } from "./cancellable";
import { demoReservations } from "./demo";
import { buildScenario } from "./scenario";
import { buildSampleRows, buildLegendRows } from "./sample";
import { bindTables, exportTable } from "./table";
import { addDays, diffDays, todayISO, uid, esc } from "./util";
import { detailSheet, legendSheet } from "./board";
import { movesInfoSheet, nightsInfoSheet, channelsInfoSheet, roomsInfoSheet, specInfoSheet, weightsInfoSheet, azioniInfoSheet, cancelInfoSheet } from "./info";
import type { InfoKey } from "./info";
import { daySheet } from "./dayplan";
import { viewWaitlist, mailSheet, waitInfoSheet, readWaitForm, entryFromReservation } from "./waitlist";
import { viewRegister, caseSheet, registerInfoSheet } from "./register";
import { viewManual } from "./manual";
import { viewLogin, viewLoginKo, loginVuoto } from "./login";
import type { LoginState } from "./login";
import { accedi, esci, initFirebase, attendiAuth, messaggioAuth, reimpostaPassword, utenteCorrente } from "./firebase";
import { firebaseConfigurato } from "./firebase-config";
import { caseFromMove, caseFromReservation, CLOSED_OUTCOMES } from "./cases";
import type { CaseOutcome, CancelReason, ObCase } from "./cases";
import { netValue } from "./analytics";
import type { MailState } from "./waitlist";
import type { MailTemplate, MailLang } from "./emails";
import { MAX_SOLVE_NIGHTS } from "./views";
import { appFooter, busyOverlay, header, viewGuide, viewHistory, viewImport, viewReservations, viewSettings, viewSolve, IMPORT_ATTIVO } from "./views";
import type { Ctx, Derived, Tab, UIState } from "./views";

declare const XLSX: {
  utils: { aoa_to_sheet(a: unknown[][]): unknown; book_new(): unknown; book_append_sheet(wb: unknown, ws: unknown, name: string): void };
  write(wb: unknown, o: Record<string, unknown>): ArrayBuffer;
};

const store = new Store();
const root = document.getElementById("app")!;

const app: AppState = {
  settings: defaultSettings(),
  meta: emptyMeta(),
  reservations: new Map(),
  locks: {},
  done: {},
  waitlist: [],
  cases: [],
  mails: [],
  storage: "locale",
  canWrite: true,
};
let savedMapping: Record<string, string> = {};
let rev = 0;
let login: LoginState = loginVuoto();
let loginKo = "";          // Firebase configurato ma irraggiungibile
let soloLocale = false;    // l'utente ha scelto di continuare senza accesso
let derived: Derived | null = null;

const ui: UIState = {
  tab: "guida",
  roomsFixed: 0,
  hotel: "saslong",
  solveFrom: todayISO(),
  solveDays: 14,
  solveTo: addDays(todayISO(), 13),
  solve: null,
  gridHotel: "saslong",
  detail: null,
  day: null,
  info: null,
  mail: null,
  caseId: null,
  regHotel: "gruppo",
  resFutureOnly: true,
  imp: { sheet: null, mapping: {}, fixedHotel: "", replace: false },
  draft: null,
  busy: null,
};

// ------------------------------------------------------------ calcoli
function derive(): Derived {
  if (derived && derived.rev === rev) return derived;
  const list = [...app.reservations.values()];
  const s = app.settings;
  const protector = new Protector(list, s.rules, app.locks);
  const model = buildWashModel(list, s);
  const fc = new Map<HotelId | "gruppo", ReturnType<typeof forecastHotel>>();
  const per = s.hotels.map((h) => {
    const f = forecastHotel(list, s, model, h, protector, s.horizonDays);
    fc.set(h.id, f);
    return f;
  });
  fc.set("gruppo", forecastGroup(per));
  const stats = new Map(s.hotels.map((h) => [h.id, hotelStats(list, s, h.id)]));
  const spec = detectSpeculative(list, s);
  const canc = detectCancellable(list, s, (r) => protector.reasons(r).length > 0);
  derived = { rev, list, protector, model, fc, stats, spec, canc };
  return derived;
}

function invalidate(): void {
  rev++;
  ui.solve = null;
}

// ------------------------------------------------------------ render
/** Vero quando Firebase è configurato, nessuno è collegato e non si è scelto il solo locale. */
function serveAccesso(): boolean {
  return firebaseConfigurato() && !soloLocale && !utenteCorrente();
}

function render(): void {
  const d = derive();
  const c: Ctx = { app, d, ui };
  if (loginKo && !soloLocale) { root.innerHTML = viewLoginKo(loginKo); return; }
  if (serveAccesso()) { root.innerHTML = viewLogin(login); (document.getElementById(login.email ? "login-pass" : "login-email") as HTMLInputElement | null)?.focus(); return; }
  if (!IMPORT_ATTIVO && ui.tab === "import") ui.tab = "guida";
  const views: Record<Tab, (c: Ctx) => string> = {
    manuale: viewManual,
    guida: viewGuide,
    solve: viewSolve,
    attesa: viewWaitlist,
    registro: viewRegister,
    pren: viewReservations,
    storico: viewHistory,
    import: viewImport,
    settings: viewSettings,
  };
  if (ui.tab === "settings" && !ui.draft) ui.draft = structuredClone(app.settings);
  const scrollY = window.scrollY;
  if (typeof hideTip === "function") hideTip();
  root.innerHTML = header(c) + `<main>${views[ui.tab](c)}</main>` + appFooter() + (ui.caseId ? caseSheet(c, ui.caseId) : ui.mail ? mailSheet(c, ui.mail) : ui.detail ? detailSheet(c, ui.detail) : ui.day ? daySheet(c, ui.day) : ui.info === "legend" ? legendSheet(c) : ui.info === "moves" ? movesInfoSheet(c) : ui.info === "nights" ? nightsInfoSheet(c) : ui.info === "channels" ? channelsInfoSheet(c) : ui.info === "rooms" ? roomsInfoSheet(c) : ui.info === "waitlist" ? waitInfoSheet() : ui.info === "spec" ? specInfoSheet(c) : ui.info === "registro" ? registerInfoSheet(c) : ui.info === "pesi" ? weightsInfoSheet(c) : ui.info === "azioni" ? azioniInfoSheet(c) : ui.info === "cancellazioni" ? cancelInfoSheet(c) : "") + busyOverlay(ui.busy) + `<div id="toast" role="status" aria-live="polite"></div>`;
  window.scrollTo(0, scrollY);
}

function setBusy(msg: string): void {
  ui.busy = msg;
  const el = document.querySelector(".busy div");
  if (el) el.textContent = msg;
  else render();
}

/** Segna nel registro l'email appena preparata: resta traccia della corrispondenza. */
async function logMail(via: MailLogEntry["via"]): Promise<void> {
  const m = ui.mail;
  if (!m) return;
  const subject = (document.getElementById("mail-subject") as HTMLInputElement | null)?.value ?? "";
  const motivo = (document.querySelector('[data-mailf="motivo"]') as HTMLTextAreaElement | null)?.value ?? "";
  const res = m.resKey ? app.reservations.get(m.resKey) : null;
  const w = m.waitId ? app.waitlist.find((x) => x.id === m.waitId) : null;
  const entry: MailLogEntry = {
    id: `ML${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    key: m.resKey ?? "",
    resId: res?.id ?? w?.slopeId ?? "",
    hotelId: res?.hotelId ?? w?.fromHotel ?? "",
    guest: res?.guest ?? w?.guest ?? "",
    waitId: m.waitId,
    template: m.template,
    lang: m.lang,
    subject,
    motivo,
    sentAt: new Date().toISOString(),
    via,
    note: "",
  };
  if (!entry.key && !entry.waitId) return;   // anteprima senza prenotazione: non si registra
  app.mails = [...app.mails, entry];
  try { await store.saveMails(app.mails); } catch { toast("La corrispondenza non è stata salvata: riprova.", "err"); }
  render();
}

function toast(msg: string, kind: "ok" | "err" = "ok"): void {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = "show " + kind;
  setTimeout(() => { t.className = ""; }, 4200);
}

async function busy<T>(msg: string, fn: () => Promise<T>): Promise<T | null> {
  ui.busy = msg;
  render();
  try {
    return await fn();
  } catch (e) {
    const m = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? "Operazione non riuscita");
    toast(m, "err");
    return null;
  } finally {
    ui.busy = null;
    render();
  }
}

// ------------------------------------------------------------ persistenza
async function persistHotels(hotelIds: Iterable<HotelId>): Promise<void> {
  const case_ = [...new Set(hotelIds)];
  let i = 0;
  for (const h of case_) {
    i++;
    const nome = app.settings.hotels.find((x) => x.id === h)?.name ?? h;
    const list = [...app.reservations.values()].filter((r) => r.hotelId === h);
    app.meta.chunks[h] = await store.saveHotelReservations(h, list, app.meta.chunks[h] ?? 0,
      (fatto, totale) => setBusy(`Salvo ${nome} (${i} di ${case_.length}): blocco ${fatto} di ${totale}…`));
  }
}

async function saveCases(): Promise<void> {
  app.meta.caseChunks = await store.saveCases(app.cases, app.meta.caseChunks ?? 0);
  await store.saveMeta(app.meta);
}

async function saveMeta(log: ImportLog | null): Promise<void> {
  if (log) {
    app.meta.lastImport = log;
    app.meta.history = [log, ...app.meta.history].slice(0, 20);
  }
  app.meta.revision = (app.meta.revision ?? 0) + 1;
  await store.saveMeta(app.meta);
}

function mergeSettings(s: Settings | null): Settings {
  const d = defaultSettings();
  if (!s) return d;
  return {
    ...d,
    ...s,
    rules: { ...d.rules, ...(s.rules ?? {}) },
    weights: { ...d.weights, ...(s.weights ?? {}) },
    channelCommission: { ...d.channelCommission, ...(s.channelCommission ?? {}) },
    version: SETTINGS_VERSION,
  };
}

async function loadAll(): Promise<void> {
  app.settings = mergeSettings(await store.loadSettings());
  app.meta = (await store.loadMeta()) ?? emptyMeta();
  app.locks = await store.loadLocks();
  app.done = await store.loadDone();
  app.waitlist = await store.loadWaitlist();
  app.mails = await store.loadMails();
  app.cases = await store.loadCases(app.meta);
  savedMapping = await store.loadMapping();
  const list = await store.loadReservations(app.meta);
  app.reservations = new Map(list.map((r) => [resKey(r), r]));
  // Import vecchi possono aver salvato un numero di camere impossibile (colonna sbagliata):
  // la riparazione è già avvenuta in lettura, qui la si rende definitiva.
  const rip = takeRepaired();
  if (rip > 0) {
    ui.roomsFixed = rip;
    if (app.canWrite) {
      try {
        await persistHotels(new Set([...app.reservations.values()].map((r) => r.hotelId)));
        await saveMeta(null);
      } catch { /* la correzione vale comunque per questa sessione */ }
    }
  }
  invalidate();
}

// ------------------------------------------------------------ azioni
async function doImport(): Promise<void> {
  const sh = ui.imp.sheet;
  if (!sh) return;
  const res = normalize(sh, ui.imp.mapping, app.settings.hotels, ui.imp.fixedHotel || null);
  await busy(`Salvo ${res.records.length} prenotazioni…`, async () => {
    const touched = new Set(res.records.map((r) => r.hotelId));
    if (ui.imp.replace) {
      for (const [k, r] of app.reservations) if (touched.has(r.hotelId)) app.reservations.delete(k);
    }
    let ins = 0, upd = 0;
    for (const r of res.records) {
      const k = resKey(r);
      if (app.reservations.has(k)) upd++; else ins++;
      app.reservations.set(k, r); // upsert per ID Slope: nessun duplicato, ID invariato
    }
    await persistHotels(touched);
    savedMapping = { ...savedMapping, ...(ui.imp.mapping as Record<string, string>) };
    await store.saveMapping(savedMapping);
    await saveMeta({
      at: new Date().toISOString(),
      hotelId: touched.size === 1 ? [...touched][0] : "multi",
      file: sh.fileName,
      rows: sh.rows.length,
      inserted: ins,
      updated: upd,
      skipped: res.skipped,
      warnings: res.warnings,
    });
    invalidate();
    ui.imp = { sheet: null, mapping: {}, fixedHotel: ui.imp.fixedHotel, replace: false };
    ui.tab = "guida";
    setTimeout(() => toast(`Import completato: ${ins} nuove, ${upd} aggiornate.`), 50);
  });
}

async function loadDemo(): Promise<void> {
  await busy("Genero i dati dimostrativi…", async () => {
    const list = demoReservations(app.settings);
    for (const r of list) app.reservations.set(resKey(r), r);
    await persistHotels(app.settings.hotels.map((h) => h.id));
    await saveMeta({ at: new Date().toISOString(), hotelId: "multi", file: "dati dimostrativi", rows: list.length, inserted: list.length, updated: 0, skipped: 0, warnings: [] });
    invalidate();
    ui.tab = "guida";
  });
}

async function loadScenario(): Promise<void> {
  const ok = await busy("Preparo lo scenario di prova…", async () => {
    const base = demoReservations(app.settings);
    const sc = buildScenario(base, app.settings);
    for (const r of [...base, ...sc.reservations]) app.reservations.set(resKey(r), r);
    app.waitlist = [...app.waitlist.filter((w) => !w.id.startsWith("WSC")), ...sc.waitlist];
    app.cases = [...app.cases.filter((k) => !k.resId.startsWith("DEMO-SC-OLD")), ...sc.cases];
    await persistHotels(app.settings.hotels.map((h) => h.id));
    setBusy("Salvo lista d'attesa e registro…");
    await store.saveWaitlist(app.waitlist);
    await saveCases();
    await saveMeta({ at: new Date().toISOString(), hotelId: "multi", file: "scenario di prova", rows: base.length + sc.reservations.length,
      inserted: base.length + sc.reservations.length, updated: 0, skipped: 0, warnings: [] });
    invalidate();
    return sc.attese;
  });
  if (ok) {
    ui.tab = "guida";
    ui.hotel = app.settings.hotels[0]?.id ?? "gruppo";
    render();
    toast("Scenario pronto: parti dalla Guida strategica, poi Problem solving.");
  }
}

async function clearDemo(): Promise<void> {
  await busy("Elimino i dati dimostrativi…", async () => {
    const touched = new Set<HotelId>();
    for (const [k, r] of app.reservations) if (r.id.startsWith("DEMO-")) { app.reservations.delete(k); touched.add(r.hotelId); }
    await persistHotels(touched);
    app.waitlist = app.waitlist.filter((w) => !w.id.startsWith("WSC") && !(w.slopeId ?? "").startsWith("DEMO-"));
    app.cases = app.cases.filter((k) => !k.resId.startsWith("DEMO-"));
    app.mails = app.mails.filter((m) => !m.resId.startsWith("DEMO-"));
    await store.saveWaitlist(app.waitlist);
    await store.saveMails(app.mails);
    await saveCases();
    await saveMeta(null);
    invalidate();
  });
}

function setPath(obj: unknown, path: string, value: unknown): void {
  const parts = path.split(".");
  let o = obj as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] as Record<string, unknown>;
  o[parts[parts.length - 1]] = value;
}

function readInput(el: HTMLInputElement | HTMLSelectElement): unknown {
  const t = el.dataset.type;
  if (t === "bool") return (el as HTMLInputElement).checked;
  if (t === "num") return el.value === "" ? null : Number(el.value);
  if (t === "list") return el.value.split(",").map((x) => x.trim()).filter(Boolean);
  return el.value;
}

function validateSettings(s: Settings): string | null {
  for (const h of s.hotels) {
    if (!h.roomTypes.length) return `${h.name}: serve almeno una tipologia di camera.`;
    const codes = new Set<string>();
    for (const t of h.roomTypes) {
      if (!t.code) return `${h.name}: una tipologia non ha il codice.`;
      if (codes.has(t.code)) return `${h.name}: codice “${t.code}” ripetuto.`;
      codes.add(t.code);
      if (!(t.count >= 0) || !(t.maxPax >= 1)) return `${h.name}: controlla camere e ospiti di “${t.code}”.`;
    }
    if (h.walkCost === null || h.maxOverbookPct === null || h.category === null) return `${h.name}: compila costo overbooking, tetto e categoria.`;
  }
  for (const e of s.events) if (!e.from || !e.to || e.to < e.from) return `Periodo “${e.name || "senza nome"}”: date non valide.`;
  return null;
}

// ------------------------------------------------------------ eventi
root.addEventListener("click", async (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!b || b.tagName === "INPUT") return;
  const act = b.dataset.act!;
  const v = b.dataset.v ?? "";
  const dr = ui.draft;
  switch (act) {
    case "tab":
      if (ui.tab === "settings" && v !== "settings") ui.draft = null;
      ui.mail = null;
      ui.tab = v === "import" && !IMPORT_ATTIVO ? "guida" : (v as Tab);
      window.scrollTo(0, 0);
      render();
      return;
    case "hotel":
      ui.hotel = v as HotelId | "gruppo";
      render();
      return;
    case "solve-from":
      ui.solveFrom = v < todayISO() ? todayISO() : addDays(v, -1) < todayISO() ? todayISO() : addDays(v, -1);
      ui.solveTo = addDays(ui.solveFrom, ui.solveDays - 1);
      ui.tab = "solve";
      runSolve();
      return;
    case "solve-preset":
      ui.solveDays = Number(v);
      ui.solveTo = addDays(ui.solveFrom, ui.solveDays - 1);
      render();
      return;
    case "solve":
      runSolve();
      return;
    case "grid-hotel":
      ui.gridHotel = v as HotelId | "tutte";
      render();
      return;
    case "detail":
      ui.detail = v;
      render();
      return;
    case "day":
      ui.day = v;
      ui.detail = null;
      render();
      return;
    case "mail-res":
      ui.mail = { template: b.dataset.t as MailTemplate, lang: "it", resKey: v, waitId: null, over: {} };
      render();
      return;
    case "mail-wait": {
      const e = app.waitlist.find((x) => x.id === v);
      ui.mail = { template: b.dataset.t as MailTemplate, lang: e?.lang ?? "it", resKey: null, waitId: v, over: {} };
      render();
      return;
    }
    case "reg-hotel":
      ui.regHotel = v;
      render();
      return;
    case "case-open":
      ui.caseId = v;
      render();
      return;
    case "case-close":
      ui.caseId = null;
      render();
      return;
    case "case-from-res": {
      const res = app.reservations.get(v);
      if (!res) return;
      let k = app.cases.find((x) => x.key === v && x.outcome === "aperto") ?? app.cases.find((x) => x.key === v);
      if (!k) {
        k = caseFromReservation(res, derive().spec.byRes.has(v), netValue(app.settings, res));
        app.cases = [...app.cases, k];
        await saveCases();
      }
      ui.caseId = k.id;
      render();
      return;
    }
    case "case-new": {
      ui.tab = "pren";
      render();
      toast("Apri la prenotazione dal tabellone o dall'elenco e usa «Registra esito».");
      return;
    }
    case "case-bulk": {
      const r = ui.solve;
      if (!r) { toast("Calcola prima il piano.", "err"); return; }
      const nuovi: ObCase[] = [];
      for (const m of r.moves) {
        const key = `${m.res.hotelId}::${m.res.id}`;
        if (app.cases.some((x) => x.key === key && x.outcome === "aperto")) continue;
        nuovi.push(caseFromMove(m, netValue(app.settings, m.res), derive().spec.byRes.has(key)));
      }
      if (!nuovi.length) { toast("Sono già tutte nel registro."); return; }
      app.cases = [...app.cases, ...nuovi];
      await busy("Salvo nel registro…", saveCases);
      toast(`${nuovi.length} ${nuovi.length === 1 ? "posizione portata" : "posizioni portate"} nel registro.`);
      return;
    }
    case "case-save": {
      const k = app.cases.find((x) => x.id === v);
      if (!k) return;
      if (k.outcome === "riprotetta-alpstay" && !k.targetHotel) { toast("Indica in quale casa è stata accolta.", "err"); return; }
      if (k.outcome === "ricollocata-partner" && !k.partnerName.trim()) { toast("Indica l'hotel partner.", "err"); return; }
      if (k.outcome === "cancellata" && !k.cancelReason) { toast("Indica il motivo della cancellazione.", "err"); return; }
      k.closedAt = CLOSED_OUTCOMES.includes(k.outcome) ? new Date().toISOString() : null;
      k.updatedAt = new Date().toISOString();
      const ok = await busy("Salvo…", async () => { await saveCases(); return true; });
      if (ok) { ui.caseId = null; render(); toast("Esito registrato."); }
      return;
    }
    case "case-del":
      app.cases = app.cases.filter((x) => x.id !== v);
      ui.caseId = null;
      await busy("Elimino…", saveCases);
      return;
    case "case-purge": {
      const limite = addDays(todayISO(), -730);
      const prima = app.cases.length;
      app.cases = app.cases.filter((x) => x.outcome === "aperto" || (x.closedAt ?? x.openedAt).slice(0, 10) > limite);
      if (prima === app.cases.length) { toast("Non c'è nulla da eliminare."); return; }
      await busy("Elimino…", saveCases);
      toast(`${prima - app.cases.length} posizioni eliminate.`);
      return;
    }
    case "mail-log": {
      await logMail(b.dataset.t === "programma-email" ? "programma-email" : b.dataset.t === "manuale" ? "manuale" : "copiata");
      return;
    }
    case "mail-log-del": {
      app.mails = app.mails.filter((x) => x.id !== v);
      await busy("Salvo…", () => store.saveMails(app.mails));
      render();
      return;
    }
    case "login-reset": {
      const em = (document.getElementById("login-email") as HTMLInputElement | null)?.value?.trim() ?? "";
      if (!em) { login = { ...login, errore: "Scrivi prima il tuo indirizzo email, poi premi di nuovo." }; render(); return; }
      try {
        await reimpostaPassword(em);
        login = { ...login, email: em, errore: "", avviso: `Ti ho mandato un'email a ${em} con il link per rifare la password. Controlla anche la posta indesiderata.` };
      } catch (e) {
        login = { ...login, errore: messaggioAuth(e) };
      }
      render();
      return;
    }
    case "login-locale":
      soloLocale = true;
      loginKo = "";
      await avvia();
      return;
    case "login-riprova":
      location.reload();
      return;
    case "logout":
      await esci();
      location.reload();
      return;
    case "scroll": {
      const el = document.getElementById(v);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    case "fixed-ok":
      ui.roomsFixed = 0;
      render();
      return;
    case "mail-close":
      ui.mail = null;
      render();
      return;
    case "mail-copy": {
      const subj = (document.getElementById("mail-subject") as HTMLInputElement | null)?.value ?? "";
      const body = (document.getElementById("mail-body") as HTMLTextAreaElement | null)?.value ?? "";
      const text = `${subj}\n\n${body}`;
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch { /* iframe senza permesso */ }
      if (!ok) {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { ok = document.execCommand("copy"); } catch { ok = false; }
        ta.remove();
      }
      if (ok) await logMail("copiata");
      toast(ok ? "Copiati. Segnata nel registro della corrispondenza." : "Copia non riuscita: seleziona il testo e copialo a mano.", ok ? "ok" : "err");
      return;
    }
    case "mail-open": {
      const subj = (document.getElementById("mail-subject") as HTMLInputElement | null)?.value ?? "";
      const body = (document.getElementById("mail-body") as HTMLTextAreaElement | null)?.value ?? "";
      const url = `mailto:${encodeURIComponent(v)}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
      const w = window.open(url, "_blank");
      if (!w) window.location.href = url;
      await logMail("programma-email");
      toast("Segnata nel registro della corrispondenza. Se il programma email non si apre, usa «Copia oggetto e testo».");
      return;
    }
    case "wait-from-res": {
      const res = app.reservations.get(v);
      if (!res) return;
      if (app.waitlist.some((w) => w.slopeId === res.id && w.status !== "rinuncia")) { toast("È già in lista d'attesa."); return; }
      const src = b.dataset.t === "richiesta" ? "richiesta" : "rientro";
      const daDoppia = derive().spec.byRes.has(v);
      const nota = src === "richiesta" && daDoppia ? "Doppia prenotazione giudicata indesiderata: camera rimessa in vendita" : undefined;
      app.waitlist = [...app.waitlist, entryFromReservation(res, src, nota)];
      await busy("Salvo…", () => store.saveWaitlist(app.waitlist));
      toast(src === "rientro"
        ? "Aggiunta alla lista di rientro: avrà la precedenza appena si libera una camera."
        : daDoppia
          ? "Messa in lista d'attesa: non compare più tra le doppie prenotazioni."
          : "Aggiunta alla lista d'attesa: la trovi nella pagina «Lista d'attesa».");
      return;
    }
    case "wait-add": {
      const e = readWaitForm(root);
      if (typeof e === "string") { toast(e, "err"); return; }
      app.waitlist = [...app.waitlist, e];
      await busy("Salvo…", () => store.saveWaitlist(app.waitlist));
      toast("Aggiunta alla lista d'attesa.");
      return;
    }
    case "wait-del":
      app.waitlist = app.waitlist.filter((x) => x.id !== v);
      await busy("Salvo…", () => store.saveWaitlist(app.waitlist));
      return;
    case "info":
      ui.info = v as InfoKey;
      render();
      return;
    case "info-close":
      ui.info = null;
      render();
      return;
    case "day-close":
      ui.day = null;
      render();
      return;
    case "step-done": {
      if (app.done[v]) delete app.done[v];
      else app.done[v] = new Date().toISOString();
      render();
      try { await store.saveDone(app.done); } catch { toast("Non sono riuscito a salvare lo stato del passo.", "err"); }
      return;
    }
    case "detail-close":
      ui.detail = null;
      render();
      return;
    case "lock": {
      if (app.locks[v]) delete app.locks[v];
      else app.locks[v] = { at: new Date().toISOString(), note: "" };
      await busy("Salvo…", () => store.saveLocks(app.locks));
      const hadPlan = !!ui.solve;
      invalidate();
      if (hadPlan) { runSolve(); return; }
      render();
      return;
    }
    case "do-import": await doImport(); return;
    case "imp-reset": ui.imp.sheet = null; render(); return;
    case "demo-load": await loadDemo(); return;
    case "demo-scenario": await loadScenario(); return;
    case "sample-xlsx": {
      await busy("Preparo il file di esempio…", async () => {
        const wb = XLSX.utils.book_new();
        const dati = XLSX.utils.aoa_to_sheet(buildSampleRows(app.settings));
        XLSX.utils.book_append_sheet(wb, dati, "Prenotazioni");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildLegendRows()), "Legenda colonne");
        const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
        const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const r = await store.saveFile(`esempio-export-slope-${todayISO()}.xlsx`, blob);
        if (r === "declined") toast("Download annullato.");
        return true;
      });
      return;
    }
    case "demo-clear": await clearDemo(); return;
    case "settings-save": {
      if (!dr) return;
      const err = validateSettings(dr);
      if (err) { toast(err, "err"); return; }
      const ok = await busy("Salvo le impostazioni…", async () => { await store.saveSettings(dr); return true; });
      if (ok) {
        app.settings = structuredClone(dr);
        invalidate();
        render();
        toast("Impostazioni salvate.");
      }
      return;
    }
    case "settings-discard": ui.draft = structuredClone(app.settings); render(); return;
    case "settings-reset": ui.draft = defaultSettings(); render(); toast("Valori iniziali caricati: salva per confermare."); return;
    case "rt-add": dr?.hotels[+b.dataset.h!].roomTypes.push({ code: "", label: "", count: 0, maxPax: 2, rank: 1 }); render(); return;
    case "rt-del": dr?.hotels[+b.dataset.h!].roomTypes.splice(+b.dataset.t!, 1); render(); return;
    case "ev-add": {
      const y = todayISO().slice(0, 4);
      const e: SeasonEvent = { id: uid(), name: "", kind: "altissima", from: `${y}-12-20`, to: `${+y + 1}-01-06`, hotels: [], washMultiplier: null, maxOverbookPct: null, recurringYearly: true };
      dr?.events.push(e);
      render();
      return;
    }
    case "ev-del": dr?.events.splice(+b.dataset.i!, 1); render(); return;
    case "oo-add": {
      if (!dr) return;
      const t = todayISO();
      dr.rules.outOfOrder.push({ id: uid(), hotelId: dr.hotels[0].id, room: "", from: t, to: addDays(t, 14), motivo: "" });
      render();
      return;
    }
    case "oo-del": dr?.rules.outOfOrder.splice(+b.dataset.i!, 1); render(); return;
    case "ord-up":
    case "ord-down": {
      if (!dr) return;
      const i = +b.dataset.i!, j = act === "ord-up" ? i - 1 : i + 1;
      [dr.reprotectionOrder[i], dr.reprotectionOrder[j]] = [dr.reprotectionOrder[j], dr.reprotectionOrder[i]];
      render();
      return;
    }
  }
});

root.addEventListener("change", async (ev) => {
  const el = ev.target as HTMLInputElement | HTMLSelectElement;
  if (el instanceof HTMLInputElement && el.type === "file" && el.files?.[0]) {
    const f = el.files[0];
    await busy("Leggo il file…", async () => {
      const sheet = await readFile(f);
      ui.imp.sheet = sheet;
      ui.imp.mapping = autoMap(sheet.headers, savedMapping).mapping;
      if (!sheet.rows.length) throw new Error("Il file non contiene righe di dati.");
    });
    return;
  }
  if (el.dataset.case && ui.caseId) {
    const k = app.cases.find((x) => x.id === ui.caseId);
    if (k) {
      const f = el.dataset.case;
      if (f === "cost") k.cost = Math.max(0, Number(el.value) || 0);
      else if (f === "outcome") { k.outcome = el.value as CaseOutcome; render(); return; }
      else if (f === "cancelReason") k.cancelReason = (el.value || null) as CancelReason | null;
      else if (f === "targetHotel") k.targetHotel = el.value || null;
      else if (f === "partnerName") k.partnerName = el.value;
      else if (f === "compensation") k.compensation = el.value;
      else if (f === "note") k.note = el.value;
    }
    return;
  }
  if (el.dataset.wstatus) {
    const e = app.waitlist.find((x) => x.id === el.dataset.wstatus);
    if (e) {
      e.status = el.value as typeof e.status;
      e.updatedAt = new Date().toISOString();
      await busy("Salvo…", () => store.saveWaitlist(app.waitlist));
    }
    return;
  }
  if (el.dataset.mailf && ui.mail) {
    ui.mail.over[el.dataset.mailf as keyof MailState["over"]] = el.value;
    render();
    return;
  }
  if (el.dataset.mailsel && ui.mail) {
    const keep = { ospite: ui.mail.over.ospite, alternativa: ui.mail.over.alternativa, tipologia: ui.mail.over.tipologia };
    if (el.dataset.mailsel === "template") ui.mail.template = el.value as MailTemplate;
    else ui.mail.lang = el.value as MailLang;
    ui.mail.over = Object.fromEntries(Object.entries(keep).filter(([, x]) => x !== undefined));
    render();
    return;
  }
  if (el.dataset.map) {
    const f = el.dataset.map as MappingField;
    if (el.value) ui.imp.mapping[f] = el.value; else delete ui.imp.mapping[f];
    render();
    return;
  }
  const bind = el.dataset.bind;
  if (bind) {
    if (bind === "solveFrom") {
      ui.solveFrom = el.value && el.value >= todayISO() ? el.value : todayISO();
      if (ui.solveTo < ui.solveFrom) ui.solveTo = addDays(ui.solveFrom, ui.solveDays - 1);
      syncSolveDays();
    }
    if (bind === "solveTo") {
      if (!el.value || el.value < ui.solveFrom) { toast("La data finale deve essere uguale o successiva a quella iniziale.", "err"); render(); return; }
      ui.solveTo = el.value;
      syncSolveDays();
    }
    if (bind === "resFutureOnly") ui.resFutureOnly = (el as HTMLInputElement).checked;
    if (bind === "impHotel") ui.imp.fixedHotel = el.value;
    if (bind === "impReplace") ui.imp.replace = (el as HTMLInputElement).checked;
    render();
    return;
  }
  const dr = ui.draft;
  if (!dr) return;
  if (el.dataset.path) {
    setPath(dr, el.dataset.path, readInput(el));
    if (el.dataset.type === "bool" || el.type === "range" || el.dataset.path.endsWith(".count")) render();
    return;
  }
  if (el.dataset.comm !== undefined) {
    dr.channelCommission[el.dataset.comm] = Number(el.value) || 0;
    return;
  }
  if (el.dataset.evhotel !== undefined) {
    const i = +el.dataset.evhotel;
    const boxes = [...root.querySelectorAll<HTMLInputElement>(`[data-evhotel="${i}"]`)];
    const on = boxes.filter((x) => x.checked).map((x) => x.value);
    dr.events[i].hotels = on.length === boxes.length ? [] : on;
  }
});

// Riquadro informativo sulle barre del profilo (mouse e tocco)
const tip = document.createElement("div");
tip.id = "sktip";
tip.setAttribute("role", "tooltip");
document.body.appendChild(tip);
let tipFor: Element | null = null;
function placeTip(x: number, y: number): void {
  const r = tip.getBoundingClientRect();
  let left = x + 16, top = y + 16;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 16;
  if (left < 8) left = 8;
  if (top + r.height > window.innerHeight - 8) top = y - r.height - 16;
  if (top < 8) top = 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
function showTip(el: Element, x: number, y: number): void {
  if (tipFor !== el) {
    tip.innerHTML = el.getAttribute("data-tip") ?? "";
    root.querySelectorAll(".sk-b.hl").forEach((b) => b.classList.remove("hl"));
    root.querySelector(`.sk-b[data-sk="${el.getAttribute("data-sk")}"]`)?.classList.add("hl");
    tipFor = el;
  }
  tip.classList.add("show");
  placeTip(x, y);
}
function hideTip(): void {
  tip.classList.remove("show");
  root.querySelectorAll(".sk-b.hl").forEach((b) => b.classList.remove("hl"));
  tipFor = null;
}
root.addEventListener("mousemove", (e) => {
  const el = (e.target as Element).closest?.("[data-tip]");
  if (el) showTip(el, e.clientX, e.clientY);
  else if (tipFor) hideTip();
});
root.addEventListener("mouseleave", hideTip);
root.addEventListener("touchstart", (e) => {
  const el = (e.target as Element).closest?.("[data-tip]");
  if (el) { const t = e.touches[0]; showTip(el, t.clientX, t.clientY); }
  else hideTip();
}, { passive: true });
window.addEventListener("scroll", hideTip, { passive: true });

document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (ui.caseId || ui.mail || ui.detail || ui.day || ui.info)) { if (ui.caseId) ui.caseId = null; else if (ui.mail) ui.mail = null; else if (ui.detail) ui.detail = null; else if (ui.day) ui.day = null; else ui.info = null; render(); } });

root.addEventListener("dragover", (e) => { if ((e.target as HTMLElement).closest(".drop")) e.preventDefault(); });
root.addEventListener("drop", (e) => {
  const zone = (e.target as HTMLElement).closest(".drop");
  if (!zone || !e.dataTransfer?.files[0]) return;
  e.preventDefault();
  const input = zone.querySelector<HTMLInputElement>("input[type=file]")!;
  const dt = new DataTransfer();
  dt.items.add(e.dataTransfer.files[0]);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
});

bindTables(root, async (id, fmt) => {
  const f = exportTable(id, fmt);
  if (!f) return;
  const r = await store.saveFile(f.name, f.blob);
  if (r === "declined") toast("Download annullato.");
});

function syncSolveDays(): void {
  let n = diffDays(ui.solveTo, ui.solveFrom) + 1;
  if (n > MAX_SOLVE_NIGHTS) {
    n = MAX_SOLVE_NIGHTS;
    ui.solveTo = addDays(ui.solveFrom, n - 1);
    toast(`Il piano copre al massimo ${MAX_SOLVE_NIGHTS} notti.`, "err");
  }
  ui.solveDays = Math.max(1, n);
}

function runSolve(): void {
  const d = derive();
  ui.solve = solve(d.list, app.settings, d.protector, ui.solveFrom, ui.solveDays, d.spec, d.canc);
  if (ui.gridHotel !== "tutte" && !app.settings.hotels.some((h) => h.id === ui.gridHotel)) ui.gridHotel = app.settings.hotels[0].id;
  const withConflict = app.settings.hotels.find((h) => (ui.solve!.conflictsBefore[h.id] ?? 0) > 0);
  if (withConflict) ui.gridHotel = withConflict.id;
  render();
}

// ------------------------------------------------------------ avvio

/** Carica i dati e disegna la piattaforma. Si richiama dopo l'accesso. */
async function avvia(): Promise<void> {
  root.innerHTML = `<div class="boot">Carico i dati…</div>`;
  await store.init();
  app.storage = store.mode;
  app.canWrite = store.canWrite;
  try {
    await loadAll();
  } catch (e) {
    toast("Impossibile leggere i dati salvati: " + (e instanceof Error ? esc(e.message) : ""), "err");
  }
  render();
  store.watchMeta(async (m) => {
    if ((m.revision ?? 0) > (app.meta.revision ?? 0)) {
      await loadAll();
      render();
      toast("Dati aggiornati da un collega.");
    }
  });
}

// Modulo di accesso: invio del form.
root.addEventListener("submit", async (ev) => {
  const f = ev.target as HTMLElement;
  if (!(f instanceof HTMLFormElement) || f.id !== "login-form") return;
  ev.preventDefault();
  const em = (document.getElementById("login-email") as HTMLInputElement).value;
  const pw = (document.getElementById("login-pass") as HTMLInputElement).value;
  login = { ...login, email: em, errore: "", avviso: "", attesa: true };
  render();
  try {
    await accedi(em, pw);
    login = loginVuoto();
    await avvia();
  } catch (e) {
    login = { ...login, attesa: false, errore: messaggioAuth(e) };
    render();
  }
});

(async () => {
  root.innerHTML = `<div class="boot">Avvio…</div>`;
  if (firebaseConfigurato()) {
    try {
      await initFirebase();
      await attendiAuth();
    } catch (e) {
      loginKo = e instanceof Error ? e.message : "Non riesco a raggiungere il servizio di accesso.";
      render();
      return;
    }
    if (!utenteCorrente()) { render(); return; }
  }
  await avvia();
})();
