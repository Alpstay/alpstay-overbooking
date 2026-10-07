// File di esempio: mostra esattamente il formato che la piattaforma si aspetta.
// Serve per capire quali colonne servono e per fare una prova di importazione
// prima di avere l'export vero di Slope.
import type { Settings } from "./types";
import { addDays, todayISO } from "./util";

/** Intestazioni riconosciute in automatico dall'importazione. */
export const SAMPLE_HEADERS = [
  "Nr. Prenotazione", "Struttura", "Data prenotazione", "Arrivo", "Partenza", "Notti",
  "Stato", "Data cancellazione", "Canale", "Tipologia camera", "Camera", "Numero camere",
  "Adulti", "Bambini", "Totale prenotazione", "Intestatario", "ID cliente", "Gruppo",
  "Tag", "Note", "Tariffa", "Tipo pagamento", "Stato pagamento", "Scadenza pagamento",
  "Ospite abituale", "Check-in effettuato",
];

export const SAMPLE_LEGEND: [string, string, string, string, string][] = [
  // colonna, obbligatoria, a cosa serve, formato, esempio
  ["Nr. Prenotazione", "Sì", "Identificativo della prenotazione in Slope. Non viene mai modificato: serve per aggiornare senza duplicare.", "Testo o numero", "SAS-100045"],
  ["Struttura", "No", "La casa. Se l'export è di una casa sola, si sceglie a mano al momento dell'importazione.", "Testo che contiene il nome", "Smart Hotel Saslong"],
  ["Data prenotazione", "Sì", "Quando la prenotazione è stata fatta. Serve per la curva di cancellazione per anticipo.", "GG/MM/AAAA", "12/07/2026"],
  ["Arrivo", "Sì", "Prima notte del soggiorno.", "GG/MM/AAAA", "02/10/2026"],
  ["Partenza", "Sì", "Giorno di partenza, non l'ultima notte.", "GG/MM/AAAA", "06/10/2026"],
  ["Notti", "No", "Alternativa alla partenza: se manca la partenza, si calcola da qui.", "Numero intero", "4"],
  ["Stato", "Sì", "Confermata, Cancellata, No-show, Opzione. Servono anche le cancellate: senza, la previsione non funziona.", "Testo", "Confermata"],
  ["Data cancellazione", "No", "Quando è stata cancellata. Molto utile: dice quanto prima dell'arrivo si cancella.", "GG/MM/AAAA", "28/09/2026"],
  ["Canale", "Sì", "Da dove arriva. Da qui nascono commissioni, affidabilità e classifica dei canali.", "Testo", "Booking.com"],
  ["Tipologia camera", "Sì", "Deve corrispondere alle tipologie impostate nella piattaforma.", "Testo o codice", "DBL"],
  ["Camera", "No", "Numero di camera assegnato. Senza, la piattaforma propone le camere ma non può dire «da quale a quale».", "Testo", "204"],
  ["Numero camere", "No", "Camere della stessa prenotazione. Se manca, ogni riga vale 1 camera. Attenzione a non collegarla alla colonna sbagliata.", "Numero intero", "2"],
  ["Adulti", "No", "Adulti in totale sulla prenotazione.", "Numero intero", "2"],
  ["Bambini", "No", "Bambini in totale. Serve per non riprotegge le famiglie in una casa solo adulti.", "Numero intero", "2"],
  ["Totale prenotazione", "Sì", "Importo lordo del soggiorno. Senza importo la prenotazione viene considerata di valore medio.", "1.250,50 € oppure 1250,5", "1.250,50 €"],
  ["Intestatario", "Sì", "Cognome e nome, come li esporta Slope.", "Testo", "Moroder Elena"],
  ["ID cliente", "No", "Codice anagrafica. Serve per riconoscere gli ospiti abituali e le doppie prenotazioni.", "Testo o numero", "C10234"],
  ["Gruppo", "No", "Riferimento del gruppo. Se compilato, la prenotazione è sempre protetta.", "Testo", "SCI CLUB VAL GARDENA"],
  ["Tag", "No", "Qui il receptionist scrive NO OVERBOOKING per rendere intoccabile la prenotazione.", "Testo", "NO OVERBOOKING"],
  ["Note", "No", "Il tag viene cercato anche qui, se in Slope non c'è un campo tag.", "Testo", "Camera lato sole, richiesta culla"],
  ["Tariffa", "No", "Piano tariffario. Se contiene «non rimborsabile» la prenotazione diventa intoccabile.", "Testo", "Non rimborsabile"],
  ["Tipo pagamento", "No", "Serve per distinguere Expedia Collect da Hotel Collect.", "Testo", "Expedia Collect"],
  ["Stato pagamento", "No", "Esito della garanzia o della caparra. Da qui nasce la proposta di cancellazione per motivo valido: carta rifiutata, garanzia mancante, caparra non pervenuta, oppure pagato.", "Testo", "Carta rifiutata"],
  ["Scadenza pagamento", "No", "Entro quando deve arrivare la caparra. Se manca, si usa la data di prenotazione più i giorni impostati.", "GG/MM/AAAA", "20/09/2026"],
  ["Ospite abituale", "No", "Se Slope lo segnala già. Altrimenti lo calcola la piattaforma dallo storico.", "Sì / No", "Sì"],
  ["Check-in effettuato", "No", "Chi è già in casa non viene mai spostato.", "Sì / No", "No"],
];

const NOMI: [string, string][] = [
  ["Moroder", "Elena"], ["Demetz", "Thomas"], ["Senoner", "Marta"], ["Insam", "Paolo"],
  ["Müller", "Katharina"], ["Schmidt", "Andreas"], ["Weber", "Lena"], ["Hofer", "Stefan"],
  ["Rossi", "Giulia"], ["Ferrari", "Marco"], ["Conti", "Sara"], ["Greco", "Luca"],
  ["Smith", "Emily"], ["Brown", "Oliver"], ["Taylor", "Hannah"], ["Wilson", "James"],
  ["Dubois", "Camille"], ["Lefèvre", "Pierre"], ["de Vries", "Eva"], ["Janssen", "Jan"],
  ["Nowak", "Agnieszka"], ["Kowalski", "Tomasz"], ["García", "Lucía"], ["Fernández", "Pablo"],
  ["Nielsen", "Mia"], ["Andersson", "Noah"], ["Horvat", "Petra"], ["Novák", "Filip"],
];

const CANALI: [string, string][] = [
  ["Booking.com", ""], ["Sito web", ""], ["Expedia", "Expedia Collect"], ["Expedia", "Hotel Collect"],
  ["Telefono", ""], ["Email", ""], ["Agenzia", ""],
];

function it(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function euro(n: number): string {
  return n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

interface Riga { [k: string]: string | number; }

/** Righe di esempio: coprono tutti i casi che la piattaforma sa riconoscere. */
export function buildSampleRows(s: Settings): unknown[][] {
  const t = todayISO();
  const case_ = s.hotels.length ? s.hotels : [{ id: "saslong", name: "Smart Hotel Saslong", roomTypes: [{ code: "DBL", label: "Doppia", count: 30, maxPax: 2, rank: 1 }] } as Settings["hotels"][number]];
  const righe: Riga[] = [];
  let n = 0;

  const push = (o: Partial<Riga> & { casa: string; tipo: string; arrivo: string; notti: number; prezzoNotte: number }): void => {
    n++;
    const [cog, nome] = NOMI[n % NOMI.length];
    const arr = o.arrivo;
    const part = addDays(arr, o.notti);
    const camere = Number(o["Numero camere"] ?? 1);
    const canale = (o["Canale"] as string) ?? CANALI[n % CANALI.length][0];
    const pagamento = (o["Tipo pagamento"] as string) ?? (canale === "Expedia" ? CANALI[n % CANALI.length][1] : "");
    righe.push({
      "Nr. Prenotazione": `${o.casa.slice(0, 3).toUpperCase()}-${100000 + n}`,
      "Struttura": o.casa,
      "Data prenotazione": it(addDays(arr, -(10 + (n * 7) % 120))),
      "Arrivo": it(arr),
      "Partenza": it(part),
      "Notti": o.notti,
      "Stato": (o["Stato"] as string) ?? "Confermata",
      "Data cancellazione": (o["Data cancellazione"] as string) ?? "",
      "Canale": canale,
      "Tipologia camera": o.tipo,
      "Camera": (o["Camera"] as string) ?? "",
      "Numero camere": camere,
      "Adulti": Number(o["Adulti"] ?? 2 * camere),
      "Bambini": Number(o["Bambini"] ?? 0),
      "Totale prenotazione": euro(o.prezzoNotte * o.notti * camere),
      "Intestatario": (o["Intestatario"] as string) ?? `${cog} ${nome}`,
      "ID cliente": (o["ID cliente"] as string) ?? `C${20000 + n}`,
      "Gruppo": (o["Gruppo"] as string) ?? "",
      "Tag": (o["Tag"] as string) ?? "",
      "Note": (o["Note"] as string) ?? "",
      "Tariffa": (o["Tariffa"] as string) ?? "Flessibile",
      "Tipo pagamento": pagamento,
      "Stato pagamento": (o["Stato pagamento"] as string) ?? (pagamento === "Prepagata" || pagamento === "Expedia Collect" ? "Pagato" : "Garanzia valida"),
      "Scadenza pagamento": (o["Scadenza pagamento"] as string) ?? "",
      "Ospite abituale": (o["Ospite abituale"] as string) ?? "No",
      "Check-in effettuato": (o["Check-in effettuato"] as string) ?? "No",
    });
  };

  // 1) Storico degli ultimi 12 mesi, con cancellazioni: serve alla previsione
  for (let g = 360; g > 0; g -= 5) {
    const h = case_[g % case_.length];
    const tipo = h.roomTypes[g % h.roomTypes.length];
    const cancellata = g % 4 === 0;
    const arr = addDays(t, -g);
    push({
      casa: h.name, tipo: tipo.code, arrivo: arr, notti: 2 + (g % 5), prezzoNotte: 120 + (g % 9) * 20,
      Stato: cancellata ? "Cancellata" : "Confermata",
      "Data cancellazione": cancellata ? it(addDays(arr, -(1 + (g % 20)))) : "",
    });
  }

  // 2) Ospiti già in casa: non si spostano mai
  const h0 = case_[0];
  push({ casa: h0.name, tipo: h0.roomTypes[0].code, arrivo: addDays(t, -2), notti: 5, prezzoNotte: 160,
    Camera: "101", "Check-in effettuato": "Sì", Intestatario: "Prinoth Anna", "ID cliente": "C777" });

  // 3) Settimana sovravenduta fra 5 giorni, con tutte le categorie protette
  const inizio = addDays(t, 5);
  case_.forEach((h, hi) => {
    h.roomTypes.forEach((tipo, ti) => {
      const quante = tipo.count + 2;  // due camere oltre la capienza: il file mostra anche un overbooking vero
      for (let i = 0; i < quante; i++) {
        const base = { casa: h.name, tipo: tipo.code, arrivo: addDays(inizio, i % 2), notti: 3 + (i % 4), prezzoNotte: 95 + ((i * 31) % 190) };
        if (i === 0) push({ ...base, Tag: "NO OVERBOOKING", Note: "Camera promessa dal direttore" });
        else if (i === 1) push({ ...base, Canale: "Expedia", "Tipo pagamento": "Expedia Collect" });
        else if (i === 2) push({ ...base, Tariffa: "Non rimborsabile", "Tipo pagamento": "Prepagata" });
        else if (i === 3 && ti === 0) push({ ...base, Intestatario: "Kostner Georg", "ID cliente": "C888", "Ospite abituale": "Sì" });
        else if (i === 4 && ti === 0 && hi === 0) push({ ...base, "Numero camere": 2, Gruppo: "SCI CLUB VAL GARDENA", Canale: "Agenzia", Intestatario: "Sci Club Val Gardena" });
        else if (i === 5 && ti === 1) push({ ...base, Bambini: 2, Adulti: 2, Intestatario: "Familie Berger" });
        else if (i === 6 && ti === 0) push({ ...base, "Stato pagamento": "Carta rifiutata", Canale: "Sito web", Note: "Tentativo di addebito non andato a buon fine" });
        else if (i === 7 && ti === 0) push({ ...base, "Stato pagamento": "Caparra non pervenuta", "Scadenza pagamento": it(addDays(t, -6)), Canale: "Diretto" });
        else push(base);
      }
    });
  });

  // 4) Doppie prenotazioni: stesso ID cliente, stesse notti in due case
  if (case_.length > 1) {
    const [a, b] = case_;
    for (const h of [a, b]) {
      push({ casa: h.name, tipo: h.roomTypes[0].code, arrivo: addDays(inizio, 1), notti: 4, prezzoNotte: 210,
        Intestatario: "Bianchi Riccardo", "ID cliente": "C999", Canale: "Sito web" });
    }
  }
  // due periodi diversi nella stessa casa
  for (const g of [8, 45]) {
    push({ casa: h0.name, tipo: h0.roomTypes[0].code, arrivo: addDays(t, g), notti: 3, prezzoNotte: 180,
      Intestatario: "Keller Sabine", "ID cliente": "C1000", Canale: "Booking.com" });
  }

  // 5) Qualche prenotazione futura normale, per riempire il calendario
  for (let g = 20; g < 120; g += 3) {
    const h = case_[g % case_.length];
    const tipo = h.roomTypes[g % h.roomTypes.length];
    push({ casa: h.name, tipo: tipo.code, arrivo: addDays(t, g), notti: 2 + (g % 6), prezzoNotte: 110 + (g % 8) * 25 });
  }

  return [SAMPLE_HEADERS, ...righe.map((r) => SAMPLE_HEADERS.map((k) => r[k] ?? ""))];
}

export function buildLegendRows(): unknown[][] {
  return [
    ["FILE DI ESEMPIO — formato atteso dalla piattaforma Overbooking AlpStay"],
    [],
    ["Il foglio «Prenotazioni» contiene dati inventati nel formato che la piattaforma riconosce da sola."],
    ["Confronta queste colonne con quelle dell'export di Slope: i nomi non devono coincidere,"],
    ["perché all'importazione puoi collegare ogni colonna a mano. Contano il contenuto e il formato."],
    [],
    ["Colonna", "Obbligatoria", "A cosa serve", "Formato", "Esempio"],
    ...SAMPLE_LEGEND,
    [],
    ["NOTE IMPORTANTI"],
    ["1", "Servono anche le prenotazioni CANCELLATE: senza, la piattaforma non può prevedere quante camere si libereranno."],
    ["2", "Esporta almeno 12 mesi di storico e tutte le prenotazioni future."],
    ["3", "Una riga per prenotazione. Se una prenotazione ha più camere, usa la colonna «Numero camere»."],
    ["4", "Le date in formato GG/MM/AAAA vanno bene, come pure AAAA-MM-GG. Gli importi con la virgola decimale vanno bene."],
    ["5", "L'identificativo della prenotazione non viene mai modificato: reimportando lo stesso file i dati si aggiornano senza duplicarsi."],
    ["6", "Questo file contiene circa 200 prenotazioni: bastano per capire il formato e per provare l'importazione, non per avere statistiche realistiche. Per quelle usa il pulsante «Scenario di prova completo» dentro la piattaforma."],
    [],
    ["COSA TROVI NEL FOGLIO PRENOTAZIONI"],
    ["", "Uno storico di 12 mesi con una cancellazione ogni quattro, completa di data di cancellazione."],
    ["", "Un ospite già in casa, con la camera assegnata: non viene mai spostato."],
    ["", "Una settimana sovravenduta fra cinque giorni in tutte le case: due camere oltre la capienza per tipologia."],
    ["", "Dentro quella settimana: una prenotazione con tag NO OVERBOOKING, una Expedia Collect, una non rimborsabile, un ospite abituale, un gruppo da due camere e una famiglia con bambini."],
    ["", "Tre casi di doppia prenotazione: lo stesso ID cliente su due case nelle stesse notti, e lo stesso ospite su due periodi diversi."],
  ];
}
