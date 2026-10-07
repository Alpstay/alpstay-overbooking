// Email all'ospite per la gestione dell'overbooking e della lista d'attesa.
// Tono AlpStay: caldo, elegante, preciso. Struttura: oggetto, introduzione, corpo, condizioni, chiusura.
// Tutti i testi dicono il vero: nessun guasto inventato, nessun finto rifiuto della carta.

export type MailLang = "it" | "de" | "en";
export type MailTemplate = "flessibilita" | "riprotezione" | "ricollocamento" | "attesa-conferma" | "attesa-disponibile" | "garanzia-sollecito" | "garanzia-annullo" | "caparra-sollecito" | "caparra-annullo" | "tecnico-camera";

export interface MailFields {
  /** Il fatto che giustifica la cancellazione, scritto per esteso. Non si inventa mai. */
  motivo: string;
  ospite: string;
  casa: string;
  arrivo: string;      // già formattata nella lingua
  partenza: string;
  notti: number;
  alternativa: string; // struttura proposta
  tipologia: string;
  vantaggio: string;
  scadenza: string;
  firma: string;
  rientro: boolean;    // attesa-disponibile per un ospite ricollocato
  anticipo: boolean;   // arrivo ad almeno 3 giorni: si può dire "con anticipo"
}

export const TEMPLATE_LABEL: Record<MailTemplate, string> = {
  flessibilita: "Proposta volontaria (prima di spostare)",
  riprotezione: "Spostamento in un'altra casa AlpStay",
  ricollocamento: "Ricollocamento in hotel partner",
  "attesa-conferma": "Conferma lista d'attesa",
  "attesa-disponibile": "Camera disponibile dalla lista d'attesa",
  "garanzia-sollecito": "Garanzia non valida — richiesta di una carta valida",
  "garanzia-annullo": "Garanzia non fornita — annullamento",
  "caparra-sollecito": "Caparra non pervenuta — sollecito",
  "caparra-annullo": "Caparra non pervenuta — annullamento",
  "tecnico-camera": "Camera inagibile — alternativa o rimborso",
};

export const TEMPLATE_HELP: Record<MailTemplate, string> = {
  flessibilita: "Da inviare per primo, con anticipo: chiede all'ospite se è disposto a cambiare casa o date in cambio di un vantaggio. Nessun obbligo: se rifiuta la prenotazione resta com'è. Ogni sì evita un overbooking.",
  riprotezione: "Quando il piano sposta l'ospite in un'altra casa del gruppo alle stesse condizioni.",
  ricollocamento: "Overbooking: nessuna camera nelle tre case. Spiega la situazione con onestà, propone l'hotel partner e le condizioni, lascia la scelta di annullare con rimborso completo.",
  "attesa-conferma": "Conferma a chi ha chiesto una camera non disponibile che è in lista d'attesa, senza impegno.",
  "attesa-disponibile": "Avvisa che si è liberata una camera, con una scadenza per confermare.",
  "garanzia-sollecito": "DA MANDARE PER PRIMO. La carta dell'ospite è stata rifiutata o è scaduta: si chiede una carta valida entro una data. Nessuna prenotazione viene annullata prima di questo avviso.",
  "garanzia-annullo": "Solo dopo il sollecito e solo se la garanzia non è arrivata entro la data indicata. Conferma l'annullamento citando la richiesta rimasta senza risposta.",
  "caparra-sollecito": "DA MANDARE PER PRIMO. La caparra non risulta pervenuta entro la scadenza: si chiede il pagamento entro una nuova data.",
  "caparra-annullo": "Solo dopo il sollecito e solo se il pagamento non è arrivato. Conferma l'annullamento citando la scadenza non rispettata.",
  "tecnico-camera": "La camera è dichiarata inagibile da noi: si spiega la situazione, si propone un'alternativa e si lascia all'ospite la scelta di annullare con rimborso completo.",
};

export const DEFAULT_VANTAGGIO: Record<MailTemplate, Record<MailLang, string>> = {
  flessibilita: { it: "un upgrade di categoria senza supplemento", de: "ein kostenloses Upgrade in die nächsthöhere Kategorie", en: "a complimentary room upgrade" },
  riprotezione: { it: "un aperitivo di benvenuto offerto da noi", de: "einen Begrüßungsaperitif auf unsere Kosten", en: "a welcome aperitif on us" },
  ricollocamento: { it: "la prima notte offerta da noi", de: "die erste Nacht auf unsere Kosten", en: "your first night on us" },
  "attesa-conferma": { it: "", de: "", en: "" },
  "attesa-disponibile": { it: "", de: "", en: "" },
  "garanzia-sollecito": { it: "", de: "", en: "" },
  "garanzia-annullo": { it: "", de: "", en: "" },
  "caparra-sollecito": { it: "", de: "", en: "" },
  "caparra-annullo": { it: "", de: "", en: "" },
  "tecnico-camera": { it: "la prima notte offerta da noi", de: "die erste Nacht auf unsere Kosten", en: "your first night on us" },
};

export const DEFAULT_SCADENZA: Record<MailLang, string> = { it: "48 ore", de: "48 Stunden", en: "48 hours" };

const MONTHS: Record<MailLang, string[]> = {
  it: ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"],
  de: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

export function longDate(iso: string, lang: MailLang): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (lang === "de") return `${d}. ${MONTHS.de[m - 1]} ${y}`;
  if (lang === "en") return `${d} ${MONTHS.en[m - 1]} ${y}`;
  return `${d} ${MONTHS.it[m - 1]} ${y}`;
}

export interface Mail { subject: string; body: string; }

export function renderMail(t: MailTemplate, lang: MailLang, f: MailFields): Mail {
  const v = f.vantaggio.trim();
  const alt = f.alternativa.trim() || (lang === "de" ? "[Name des Hotels]" : lang === "en" ? "[hotel name]" : "[nome della struttura]");
  const tip = f.tipologia.trim();

  if (lang === "de") {
    const hi = `Guten Tag ${f.ospite},`;
    const bye = `Mit herzlichen Grüßen\n${f.firma}`;
    switch (t) {
      case "flessibilita":
        return {
          subject: `Ein persönliches Angebot für Ihren Aufenthalt ab ${f.arrivo}`,
          body: `${hi}\n\nvielen Dank, dass Sie sich für das ${f.casa} entschieden haben. Wir freuen uns auf Ihren Aufenthalt vom ${f.arrivo} bis ${f.partenza}.\n\nFür Ihre Reisedaten ist die Nachfrage außergewöhnlich hoch. Sollten Sie flexibel sein, würden wir Ihnen gerne einen Aufenthalt im ${alt}${tip ? ` (${tip})` : ""} anbieten${v ? ` – mit ${v}` : ""}.\n\nIhre Buchung bleibt selbstverständlich unverändert bestätigt, wenn Sie keine Änderung wünschen. Eine kurze Antwort auf diese E-Mail genügt, falls Sie unser Angebot annehmen möchten.\n\n${bye}`,
        };
      case "riprotezione":
        return {
          subject: `Ihr Aufenthalt ab ${f.arrivo}: ein Hauswechsel innerhalb von AlpStay`,
          body: `${hi}\n\nherzlichen Dank für Ihre Buchung im ${f.casa} vom ${f.arrivo} bis ${f.partenza}.\n\nFür Ihre Reisedaten übersteigen die eingegangenen Buchungen leider die verfügbaren Zimmer in diesem Haus. Wir bitten dafür aufrichtig um Entschuldigung. Gerne empfangen wir Sie im ${alt}, einem Haus unserer AlpStay-Gruppe in Gröden${tip ? `, in einem Zimmer der Kategorie ${tip}` : ""}.\n\nIhre Konditionen:\n– gleicher Preis und gleiche Leistungen wie gebucht\n${v ? `– ${v}\n` : ""}– sollte im ${f.casa} ein Zimmer frei werden, informieren wir Sie umgehend\n\nFalls Ihnen der Wechsel nicht zusagt, antworten Sie bitte auf diese E-Mail: Wir finden gemeinsam die beste Lösung. Um Ihre Bestätigung bitten wir innerhalb von ${f.scadenza}.\n\n${bye}`,
        };
      case "ricollocamento":
        return {
          subject: `Wichtige Information zu Ihrer Buchung ab ${f.arrivo} – ${f.casa}`,
          body: `${hi}\n\nvielen Dank, dass Sie das ${f.casa} für Ihren Aufenthalt in Gröden vom ${f.arrivo} bis ${f.partenza} gewählt haben.\n\nWir schreiben Ihnen ${f.anticipo ? "frühzeitig " : ""}mit einer wichtigen Mitteilung: Für Ihre Reisedaten übersteigen die eingegangenen Buchungen die verfügbaren Zimmer, daher können wir Ihnen das gebuchte Zimmer leider nicht garantieren. Dafür entschuldigen wir uns aufrichtig.\n\nDamit Ihr Aufenthalt dennoch so angenehm wird, wie Sie es sich wünschen, haben wir für Sie ein Zimmer im ${alt} reserviert, einem Haus gleicher oder höherer Kategorie.\n\nIhre Konditionen:\n– eine eventuelle Preisdifferenz übernehmen wir\n– den Transfer übernehmen wir\n${v ? `– ${v}\n` : ""}– wird während Ihres Aufenthalts bei uns ein Zimmer frei, begrüßen wir Sie gerne bei uns (vorrangige Rückkehrliste)\n\nMöchten Sie die alternative Unterkunft nicht annehmen, können Sie Ihre Buchung kostenfrei stornieren und erhalten eine eventuell geleistete Zahlung vollständig zurück.\n\nBitte teilen Sie uns Ihre Entscheidung innerhalb von ${f.scadenza} mit. Für Fragen sind wir auch telefonisch gerne für Sie da.\n\n${bye}`,
        };
      case "attesa-conferma":
        return {
          subject: `Warteliste – ${f.casa}, ${f.arrivo} bis ${f.partenza}`,
          body: `${hi}\n\nvielen Dank für Ihre Anfrage für den Zeitraum vom ${f.arrivo} bis ${f.partenza}.\n\nFür diese Daten ist derzeit leider kein Zimmer verfügbar. Wir haben Sie unverbindlich auf unsere Warteliste gesetzt: Sobald ein Zimmer frei wird, melden wir uns umgehend bei Ihnen.\n\nBedingungen:\n– die Warteliste ist für Sie und für uns unverbindlich\n– es ist keine Zahlung erforderlich\n– ein freiwerdendes Zimmer halten wir für den in unserer Nachricht genannten Zeitraum für Sie reserviert\n\n${bye}`,
        };
      case "garanzia-sollecito":
        return {
          subject: `Ihre Buchung ab ${f.arrivo}: gültige Kreditkarte erforderlich`,
          body: `${hi}\n\nvielen Dank für Ihre Buchung im ${f.casa} vom ${f.arrivo} bis ${f.partenza}.\n\nBei der Überprüfung Ihrer Zahlungsgarantie ist ein Problem aufgetreten: ${f.motivo}\n\nDamit Ihre Buchung bestehen bleibt, bitten wir Sie, uns bis zum ${f.scadenza} eine gültige Karte zu hinterlegen. Sie können einfach auf diese E-Mail antworten oder uns anrufen; senden Sie uns die Kartendaten bitte niemals per E-Mail.\n\nSollten wir bis dahin nichts von Ihnen hören, müssen wir die Buchung leider stornieren und das Zimmer wieder freigeben. Es wird Ihnen dafür nichts berechnet.\n\n${bye}`,
        };
      case "garanzia-annullo":
        return {
          subject: `Stornierung Ihrer Buchung ab ${f.arrivo} – ${f.casa}`,
          body: `${hi}\n\nwir hatten Sie gebeten, bis zum ${f.scadenza} eine gültige Kreditkarte zu hinterlegen: ${f.motivo}\n\nDa wir bis zu diesem Termin keine gültige Garantie erhalten haben, mussten wir Ihre Buchung vom ${f.arrivo} bis ${f.partenza} stornieren. Es wird Ihnen nichts berechnet.\n\nSollte es sich um ein Versehen handeln, melden Sie sich bitte: wir prüfen gerne, ob das Zimmer noch verfügbar ist.\n\n${bye}`,
        };
      case "caparra-sollecito":
        return {
          subject: `Ihre Buchung ab ${f.arrivo}: Anzahlung noch offen`,
          body: `${hi}\n\nvielen Dank für Ihre Buchung im ${f.casa} vom ${f.arrivo} bis ${f.partenza}.\n\n${f.motivo}\n\nWir bitten Sie, die Anzahlung bis zum ${f.scadenza} vorzunehmen, damit Ihr Zimmer reserviert bleibt. Für Fragen zur Zahlung sind wir gerne für Sie da.\n\nSollte die Zahlung bis dahin nicht eingehen, müssen wir die Buchung stornieren und das Zimmer wieder freigeben.\n\n${bye}`,
        };
      case "caparra-annullo":
        return {
          subject: `Stornierung Ihrer Buchung ab ${f.arrivo} – ${f.casa}`,
          body: `${hi}\n\n${f.motivo}\n\nDa die Anzahlung auch bis zum ${f.scadenza} nicht eingegangen ist, mussten wir Ihre Buchung vom ${f.arrivo} bis ${f.partenza} gemäß den Buchungsbedingungen stornieren.\n\nSollte die Zahlung inzwischen erfolgt sein, senden Sie uns bitte den Beleg: wir prüfen umgehend, ob das Zimmer noch verfügbar ist.\n\n${bye}`,
        };
      case "tecnico-camera":
        return {
          subject: `Wichtige Information zu Ihrem Zimmer ab ${f.arrivo} – ${f.casa}`,
          body: `${hi}\n\nwir schreiben Ihnen mit einer wichtigen Mitteilung zu Ihrem Aufenthalt vom ${f.arrivo} bis ${f.partenza}.\n\n${f.motivo}\n\nWir können Ihnen dieses Zimmer daher nicht wie gebucht zur Verfügung stellen und bitten aufrichtig um Entschuldigung. Gerne bieten wir Ihnen an:\n– ein anderes Zimmer${f.alternativa ? ` im ${f.alternativa}` : " in unserem Haus"}${f.tipologia ? ` (${f.tipologia})` : ""}, zu den gebuchten Konditionen${v ? `, mit ${v}` : ""}\n– oder die kostenfreie Stornierung mit vollständiger Rückerstattung bereits geleisteter Zahlungen\n\nBitte teilen Sie uns Ihre Entscheidung bis zum ${f.scadenza} mit. Für Fragen sind wir auch telefonisch gerne für Sie da.\n\n${bye}`,
        };
      case "attesa-disponibile":
        return {
          subject: `Gute Nachricht: ein Zimmer für Ihren Aufenthalt ab ${f.arrivo}`,
          body: `${hi}\n\n${f.rientro ? `wir freuen uns sehr, Ihnen mitteilen zu können, dass im ${f.casa} wieder ein Zimmer für Sie frei ist. Gerne empfangen wir Sie wie ursprünglich gebucht bei uns` : `für Ihren gewünschten Aufenthalt ist im ${f.casa} ein Zimmer frei geworden`}: vom ${f.arrivo} bis ${f.partenza}${tip ? `, Kategorie ${tip}` : ""}.\n\nWir halten das Zimmer bis ${f.scadenza} für Sie reserviert.${v ? ` ${v}.` : ""}\n\nZur Bestätigung genügt eine kurze Antwort auf diese E-Mail.\n\n${bye}`,
        };
    }
  }

  if (lang === "en") {
    const hi = `Dear ${f.ospite},`;
    const bye = `Kind regards,\n${f.firma}`;
    switch (t) {
      case "flessibilita":
        return {
          subject: `A personal offer for your stay from ${f.arrivo}`,
          body: `${hi}\n\nthank you for choosing ${f.casa}. We are looking forward to welcoming you from ${f.arrivo} to ${f.partenza}.\n\nDemand for your dates is exceptionally high. If your plans are flexible, we would be delighted to offer you a stay at ${alt}${tip ? ` (${tip})` : ""}${v ? `, with ${v}` : ""}.\n\nYour booking of course remains confirmed as it is if you prefer not to change anything. A short reply to this email is all we need should you wish to accept.\n\n${bye}`,
        };
      case "riprotezione":
        return {
          subject: `Your stay from ${f.arrivo}: a change of house within AlpStay`,
          body: `${hi}\n\nthank you for booking ${f.casa} from ${f.arrivo} to ${f.partenza}.\n\nFor your dates, bookings at this house have unfortunately exceeded the rooms available, and we sincerely apologise. We would be pleased to welcome you at ${alt}, another AlpStay house in Val Gardena${tip ? `, in a ${tip}` : ""}.\n\nYour conditions:\n– same price and same services as booked\n${v ? `– ${v}\n` : ""}– should a room become available at ${f.casa}, we will let you know straight away\n\nIf the change does not suit you, simply reply to this email and we will find the best solution together. We kindly ask for your confirmation within ${f.scadenza}.\n\n${bye}`,
        };
      case "ricollocamento":
        return {
          subject: `Important information about your booking from ${f.arrivo} – ${f.casa}`,
          body: `${hi}\n\nthank you for choosing ${f.casa} for your stay in Val Gardena from ${f.arrivo} to ${f.partenza}.\n\nWe are writing ${f.anticipo ? "well in advance " : ""}with an important message: bookings for your dates have exceeded the rooms available, so we are unable to guarantee the room you reserved. Please accept our sincere apologies.\n\nTo make sure you still enjoy the stay you deserve, we have reserved a room for you at ${alt}, a property of the same or a higher category.\n\nYour conditions:\n– any difference in price is covered by us\n– your transfer is covered by us\n${v ? `– ${v}\n` : ""}– if a room becomes available with us during your stay, we will gladly welcome you back (priority return list)\n\nShould you prefer not to accept the alternative, you may cancel free of charge and receive a full refund of any amount already paid.\n\nPlease let us know your decision within ${f.scadenza}. We are also happy to speak with you by phone.\n\n${bye}`,
        };
      case "attesa-conferma":
        return {
          subject: `Waiting list – ${f.casa}, ${f.arrivo} to ${f.partenza}`,
          body: `${hi}\n\nthank you for your request for ${f.arrivo} to ${f.partenza}.\n\nUnfortunately no room is available for these dates at the moment. We have added you to our waiting list without any commitment, and we will contact you as soon as a room becomes available.\n\nConditions:\n– the waiting list is non-binding for both you and us\n– no payment is required\n– any room that becomes available will be held for you for the time stated in our message\n\n${bye}`,
        };
      case "garanzia-sollecito":
        return {
          subject: `Your booking from ${f.arrivo}: a valid card is needed`,
          body: `${hi}\n\nthank you for booking ${f.casa} from ${f.arrivo} to ${f.partenza}.\n\nWe ran into a problem with the guarantee for your booking: ${f.motivo}\n\nTo keep your reservation, please provide a valid card by ${f.scadenza}. Simply reply to this email or call us; please never send card details by email.\n\nIf we do not hear from you by then, we will unfortunately have to cancel the booking and release the room. Nothing will be charged to you.\n\n${bye}`,
        };
      case "garanzia-annullo":
        return {
          subject: `Cancellation of your booking from ${f.arrivo} – ${f.casa}`,
          body: `${hi}\n\nwe asked you to provide a valid card by ${f.scadenza}: ${f.motivo}\n\nAs no valid guarantee reached us by that date, we have had to cancel your booking from ${f.arrivo} to ${f.partenza}. Nothing has been charged to you.\n\nIf this was an oversight, please get in touch: we will gladly check whether the room is still available.\n\n${bye}`,
        };
      case "caparra-sollecito":
        return {
          subject: `Your booking from ${f.arrivo}: deposit still outstanding`,
          body: `${hi}\n\nthank you for booking ${f.casa} from ${f.arrivo} to ${f.partenza}.\n\n${f.motivo}\n\nPlease arrange the deposit by ${f.scadenza} so that your room stays reserved. We are happy to help with any question about the payment.\n\nIf the payment does not reach us by then, we will have to cancel the booking and release the room.\n\n${bye}`,
        };
      case "caparra-annullo":
        return {
          subject: `Cancellation of your booking from ${f.arrivo} – ${f.casa}`,
          body: `${hi}\n\n${f.motivo}\n\nAs the deposit had still not reached us by ${f.scadenza}, we have had to cancel your booking from ${f.arrivo} to ${f.partenza}, in line with the booking conditions.\n\nIf the payment has since been made, please send us the receipt: we will check straight away whether the room is still available.\n\n${bye}`,
        };
      case "tecnico-camera":
        return {
          subject: `Important information about your room from ${f.arrivo} – ${f.casa}`,
          body: `${hi}\n\nwe are writing with an important message about your stay from ${f.arrivo} to ${f.partenza}.\n\n${f.motivo}\n\nWe are therefore unable to provide the room as booked, and we sincerely apologise. We would be glad to offer you:\n– another room${f.alternativa ? ` at ${f.alternativa}` : " in our house"}${f.tipologia ? ` (${f.tipologia})` : ""}, on the conditions you booked${v ? `, with ${v}` : ""}\n– or a free cancellation with a full refund of anything already paid\n\nPlease let us know your decision by ${f.scadenza}. We are also happy to speak with you by phone.\n\n${bye}`,
        };
      case "attesa-disponibile":
        return {
          subject: `Good news: a room for your stay from ${f.arrivo}`,
          body: `${hi}\n\n${f.rientro ? `we are delighted to let you know that a room has become available again at ${f.casa}, and we would be happy to welcome you as originally booked` : `a room has become available at ${f.casa} for the stay you requested`}: ${f.arrivo} to ${f.partenza}${tip ? `, ${tip}` : ""}.\n\nWe are holding the room for you for ${f.scadenza}.${v ? ` ${v}.` : ""}\n\nA short reply to this email is all we need to confirm.\n\n${bye}`,
        };
    }
  }

  // italiano
  const hi = `Gentile ${f.ospite},`;
  const bye = `Con i nostri più cordiali saluti,\n${f.firma}`;
  switch (t) {
    case "flessibilita":
      return {
        subject: `Una proposta dedicata per il Suo soggiorno dal ${f.arrivo}`,
        body: `${hi}\n\nLa ringraziamo per aver scelto ${f.casa}: La aspettiamo con piacere dal ${f.arrivo} al ${f.partenza}.\n\nPer le Sue date la richiesta è particolarmente elevata. Se il Suo programma è flessibile, saremmo lieti di riservarLe un soggiorno presso ${alt}${tip ? ` (${tip})` : ""}${v ? `, con ${v}` : ""}.\n\nLa Sua prenotazione resta naturalmente confermata così com'è se non desidera modifiche. Se la proposta Le interessa, è sufficiente rispondere a questa email.\n\n${bye}`,
      };
    case "riprotezione":
      return {
        subject: `Il Suo soggiorno dal ${f.arrivo}: un cambio di casa all'interno di AlpStay`,
        body: `${hi}\n\nLa ringraziamo per la Sua prenotazione presso ${f.casa} dal ${f.arrivo} al ${f.partenza}.\n\nPer le Sue date le prenotazioni ricevute hanno purtroppo superato le camere disponibili in questa casa e ce ne scusiamo sinceramente. Saremo lieti di accoglierLa presso ${alt}, casa del nostro gruppo AlpStay in Val Gardena${tip ? `, in camera ${tip}` : ""}.\n\nCondizioni:\n– stesso prezzo e stessi servizi della prenotazione originale\n${v ? `– ${v}\n` : ""}– se a ${f.casa} si libera una camera, La avviseremo subito\n\nSe il cambio non fosse di Suo gradimento, Le chiediamo di rispondere a questa email: troveremo insieme la soluzione migliore. La preghiamo di darci conferma entro ${f.scadenza}.\n\n${bye}`,
      };
    case "ricollocamento":
      return {
        subject: `Informazione importante sulla Sua prenotazione dal ${f.arrivo} – ${f.casa}`,
        body: `${hi}\n\nLa ringraziamo per aver scelto ${f.casa} per il Suo soggiorno in Val Gardena dal ${f.arrivo} al ${f.partenza}.\n\nLe scriviamo ${f.anticipo ? "con anticipo " : ""}per una comunicazione importante: per le Sue date le prenotazioni ricevute hanno superato le camere disponibili e per questo non siamo in grado di garantirLe la camera prenotata. Ce ne scusiamo sinceramente.\n\nPer offrirLe comunque il soggiorno che merita, abbiamo riservato per Lei una camera presso ${alt}, struttura di pari o superiore categoria.\n\nCondizioni:\n– l'eventuale differenza di prezzo è a nostro carico\n– il trasferimento è a nostro carico\n${v ? `– ${v}\n` : ""}– se durante il Suo soggiorno si libera una camera da noi, saremo felici di accoglierLa (lista di rientro prioritaria)\n\nSe preferisce non accettare la sistemazione alternativa, potrà annullare la prenotazione senza alcun costo e riceverà il rimborso completo di quanto eventualmente già versato.\n\nLa preghiamo di comunicarci la Sua scelta entro ${f.scadenza}. Siamo a disposizione anche telefonicamente per qualsiasi domanda.\n\n${bye}`,
      };
    case "attesa-conferma":
      return {
        subject: `Lista d'attesa – ${f.casa}, dal ${f.arrivo} al ${f.partenza}`,
        body: `${hi}\n\nLa ringraziamo per la Sua richiesta per il periodo dal ${f.arrivo} al ${f.partenza}.\n\nAl momento non abbiamo camere disponibili per queste date. L'abbiamo inserita nella nostra lista d'attesa, senza alcun impegno: appena si libera una camera La contatteremo per primi.\n\nCondizioni:\n– l'inserimento in lista d'attesa non è vincolante né per Lei né per noi\n– non è richiesto alcun pagamento\n– la camera che si libera resta riservata per Lei per il tempo indicato nella nostra comunicazione\n\n${bye}`,
      };
    case "garanzia-sollecito":
      return {
        subject: `La Sua prenotazione dal ${f.arrivo}: serve una carta valida`,
        body: `${hi}\n\nLa ringraziamo per la Sua prenotazione presso ${f.casa} dal ${f.arrivo} al ${f.partenza}.\n\nNel verificare la garanzia della prenotazione abbiamo riscontrato un problema: ${f.motivo}\n\nPer mantenere la prenotazione Le chiediamo di fornirci una carta valida entro il ${f.scadenza}. È sufficiente rispondere a questa email o telefonarci; La preghiamo di non inviare mai i dati della carta via email.\n\nSe non riceveremo Sue notizie entro tale data, saremo purtroppo costretti ad annullare la prenotazione e a rimettere la camera in vendita. Non Le verrà addebitato nulla.\n\n${bye}`,
      };
    case "garanzia-annullo":
      return {
        subject: `Annullamento della Sua prenotazione dal ${f.arrivo} – ${f.casa}`,
        body: `${hi}\n\nLe avevamo chiesto di fornirci una carta valida entro il ${f.scadenza}: ${f.motivo}\n\nNon avendo ricevuto una garanzia valida entro tale data, abbiamo dovuto annullare la Sua prenotazione dal ${f.arrivo} al ${f.partenza}. Non Le è stato addebitato nulla.\n\nSe si è trattato di una dimenticanza, ci contatti pure: verificheremo volentieri se la camera è ancora disponibile.\n\n${bye}`,
      };
    case "caparra-sollecito":
      return {
        subject: `La Sua prenotazione dal ${f.arrivo}: caparra ancora da ricevere`,
        body: `${hi}\n\nLa ringraziamo per la Sua prenotazione presso ${f.casa} dal ${f.arrivo} al ${f.partenza}.\n\n${f.motivo}\n\nLe chiediamo di provvedere al versamento entro il ${f.scadenza}, così da mantenere la camera riservata. Restiamo a disposizione per qualsiasi domanda sul pagamento.\n\nSe il pagamento non ci perverrà entro tale data, saremo costretti ad annullare la prenotazione e a rimettere la camera in vendita.\n\n${bye}`,
      };
    case "caparra-annullo":
      return {
        subject: `Annullamento della Sua prenotazione dal ${f.arrivo} – ${f.casa}`,
        body: `${hi}\n\n${f.motivo}\n\nNon avendo ricevuto la caparra nemmeno entro il ${f.scadenza}, abbiamo dovuto annullare la Sua prenotazione dal ${f.arrivo} al ${f.partenza}, come previsto dalle condizioni di prenotazione.\n\nSe nel frattempo il pagamento fosse stato effettuato, ci invii la contabile: verificheremo subito se la camera è ancora disponibile.\n\n${bye}`,
      };
    case "tecnico-camera":
      return {
        subject: `Informazione importante sulla Sua camera dal ${f.arrivo} – ${f.casa}`,
        body: `${hi}\n\nLe scriviamo per una comunicazione importante sul Suo soggiorno dal ${f.arrivo} al ${f.partenza}.\n\n${f.motivo}\n\nNon siamo quindi in grado di metterLe a disposizione la camera prenotata e ce ne scusiamo sinceramente. Siamo lieti di proporLe:\n– un'altra camera${f.alternativa ? ` presso ${f.alternativa}` : " nella nostra casa"}${f.tipologia ? ` (${f.tipologia})` : ""}, alle condizioni prenotate${v ? `, con ${v}` : ""}\n– oppure l'annullamento senza alcun costo, con rimborso completo di quanto eventualmente già versato\n\nLa preghiamo di comunicarci la Sua scelta entro il ${f.scadenza}. Siamo a disposizione anche telefonicamente.\n\n${bye}`,
      };
    case "attesa-disponibile":
      return {
        subject: `Una buona notizia: una camera per il Suo soggiorno dal ${f.arrivo}`,
        body: `${hi}\n\n${f.rientro ? `siamo lieti di comunicarLe che presso ${f.casa} si è liberata nuovamente una camera per Lei: saremo felici di accoglierLa come da prenotazione originale` : `per il soggiorno che ci aveva richiesto si è liberata una camera presso ${f.casa}`}, dal ${f.arrivo} al ${f.partenza}${tip ? `, ${tip}` : ""}.\n\nLa teniamo riservata per Lei per ${f.scadenza}.${v ? ` ${v}.` : ""}\n\nPer confermare è sufficiente rispondere a questa email.\n\n${bye}`,
      };
  }
}
