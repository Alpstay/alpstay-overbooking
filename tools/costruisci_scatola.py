"""Costruisce scatola.json per la piattaforma Overbooking, dai risultati grezzi di La Scatola.

Ingressi: i file che l'attività pianificata ha salvato interrogando La Scatola via MCP.
Ogni file è il risultato così com'è, `{"data":[...], "freshness":..., "page":...}`, oppure
`{"rows":[...]}` se la pagina è arrivata nel messaggio e l'hai salvata a mano.

  python3 tools/costruisci_scatola.py \
      --disponibilita disp1.json,disp2.json \
      --prenotazioni pren1.json,pren2.json \
      [--saldi saldi.json] \
      [--contatti c1.json,c2.json --password "PASSWORD RECEPTION"] \
      [--etichette etichette.json] \
      --da 2026-10-24 --a 2027-05-02 > scatola.json

Viste usate, e perché queste:
- `curated_availability_daily` → capienza, chiusure e occupazione per notte. Già calcolate.
- `curated_reservations` → le prenotazioni complete, cancellate comprese, **con canale,
  importo e data di prenotazione**. Sostituisce `curated_operational_stays`, che è un
  sottoinsieme senza canale né importo.
- `curated_order_balances` → saldo aperto per ordine, per riconoscere la caparra non pagata.
- `curated_reservation_contacts` → nome dell'intestatario della prenotazione. È questa la
  vista giusta per il nome: `curated_guest_stays` contiene solo gli ospiti già registrati,
  cioè quelli che hanno fatto il check-in, e sulle prenotazioni future è quasi sempre vuota.

Regole che questo script non viola:
- Gli ID di Slope si copiano identici: non vengono riscritti, accorciati o rinumerati.
- Nomi, email e telefoni non finiscono mai in chiaro nell'uscita. Il nome, in forma breve,
  finisce nel blocco cifrato; **email e telefoni non vengono pubblicati affatto**: su un
  repository pubblico una rubrica cifrata con una password di reception è un rischio che non
  vale la comodità. L'indirizzo si prende da Slope al momento di scrivere.
- Quello che La Scatola non dà resta vuoto e viene elencato in `mancanti`.

Esce con errore se lo scatto sarebbe inutilizzabile. In quel caso **non si pubblica**: la
pagina online ha ancora lo scatto di ieri, che è meglio di uno sbagliato.
"""
import argparse, base64, collections, datetime, json, os, re, sys

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ITER = 250_000
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
GIORNO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
b64 = lambda b: base64.b64encode(b).decode()

# property_id di Slope -> casa nelle impostazioni della piattaforma. Sovrascrivibile con --case.
CASE = {
    "11111111-1111-4111-8111-111111111111": ("acadia", "Hotel Acadia"),
    "22222222-2222-4222-8222-222222222222": ("hartmann", "Chalet Hartmann"),
    "33333333-3333-4333-8333-333333333333": ("saslong", "Smart Hotel Saslong"),
}

# Quello che La Scatola non espone, verificato il 23 ottobre 2026.
MANCANTI = [
    "pianoTariffario",        # `reservation_rate_plan` esiste: da collegare, poi si toglie
    "tag",                    # il tag NO OVERBOOKING della reception non arriva
    "storicoCancellazioni",   # le cancellate ci sono ma sono l'1,9%: troppo poche per una curva
]

SUPPORTED = {"it", "de", "en", "fr", "es", "nl", "pt", "pl", "cs", "ru", "zh", "ko", "ar", "he"}


def carica(percorsi):
    """Unisce le righe di uno o più file grezzi di La Scatola."""
    righe = []
    for p in [x for x in (percorsi or "").split(",") if x]:
        with open(p, encoding="utf-8") as f:
            j = json.load(f)
        righe += j.get("data") or j.get("rows") or []
    return righe


def freschezza(percorsi):
    """Stato e ultimo successo, dal blocco `freshness` del primo file che ce l'ha."""
    for p in [x for x in (percorsi or "").split(",") if x]:
        with open(p, encoding="utf-8") as f:
            fr = (json.load(f) or {}).get("freshness") or {}
        stato = ((fr.get("overall") or {}).get("status") or "").lower()
        successi = [s.get("last_success_at") for s in (fr.get("sources") or []) if s.get("last_success_at")]
        if stato or successi:
            ultimo = min(successi) if successi else None
            eta = None
            if ultimo:
                t = datetime.datetime.fromisoformat(ultimo.replace("Z", "+00:00"))
                eta = round((datetime.datetime.now(datetime.timezone.utc) - t).total_seconds() / 3600, 1)
            return {"stato": "ok" if stato == "ok" else ("failing" if stato else "sconosciuta"),
                    "ultimoSuccesso": ultimo, "etaOre": eta}
    return {"stato": "sconosciuta", "ultimoSuccesso": None, "etaOre": None}


def tit(s):
    return " ".join(w.capitalize() if (w.isupper() or w.islower()) else w for w in (s or "").split())


def nome_breve(c):
    """"Cognome N." per le persone, ragione sociale per le aziende: alla reception basta."""
    if not c:
        return None
    az = tit(c.get("organization_name"))
    if az:
        return az[:40]
    cogn, nom = tit(c.get("last_name")), tit(c.get("first_name"))
    return (cogn + (" " + nom[0] + "." if nom else "")).strip() or None


def cifra(nomi, password, aad):
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(password.encode())
    ct = AESGCM(key).encrypt(iv, json.dumps(nomi, ensure_ascii=False).encode(), aad.encode())
    return {"alg": "AES-GCM/PBKDF2-SHA256", "iter": ITER, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}


def stato_di(r):
    if r.get("is_canceled"):
        return "cancellata"
    bs = (r.get("booking_status") or "").upper()
    if "NO_SHOW" in bs or "NOSHOW" in bs:
        return "noshow"
    if r.get("is_option"):
        return "opzione"
    return "confermata"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--disponibilita", required=True, help="file di curated_availability_daily")
    ap.add_argument("--prenotazioni", required=True, help="file di curated_reservations")
    ap.add_argument("--saldi", default="", help="file di curated_order_balances")
    ap.add_argument("--contatti", default="", help="file di curated_reservation_contacts (dati personali)")
    ap.add_argument("--password", default="", help="password della reception per cifrare i nomi")
    ap.add_argument("--etichette", default="", help='JSON {"<lodging_type_id>": "Doppia", ...}')
    ap.add_argument("--case", default="", help='JSON {"<property_id>": ["hotelId", "Nome"], ...}')
    ap.add_argument("--da", required=True)
    ap.add_argument("--a", required=True)
    a = ap.parse_args()

    for g in (a.da, a.a):
        assert GIORNO.match(g), ("periodo non valido", g)
    assert a.da < a.a, "il periodo finisce prima di cominciare"

    case = dict(CASE)
    if a.case:
        case.update({k: tuple(v) for k, v in json.load(open(a.case, encoding="utf-8")).items()})
    etichette = json.load(open(a.etichette, encoding="utf-8")) if a.etichette else {}

    disp = carica(a.disponibilita)
    pren_righe = carica(a.prenotazioni)
    assert disp, "nessuna riga di disponibilità: non pubblicare"
    assert pren_righe, "nessuna prenotazione: non pubblicare"

    sconosciute = {r["property_id"] for r in disp + pren_righe if r.get("property_id") not in case}
    assert not sconosciute, ("strutture non mappate su una casa della piattaforma: %s" % sorted(sconosciute))

    # --- capienza per notte, tenuta solo nel periodo richiesto
    capienza, camere = [], collections.defaultdict(int)
    for r in disp:
        g = r["day"]
        if not (a.da <= g <= a.a):
            continue
        capienza.append([g, r["property_id"], r["lodging_type_id"],
                         int(r["physical_rooms"]), int(r["closure_count"]),
                         int(r["confirmed_occupied"]), int(r["option_occupied"])])
        k = (r["property_id"], r["lodging_type_id"])
        camere[k] = max(camere[k], int(r["physical_rooms"]))
    assert capienza, "nessuna riga di disponibilità nel periodo richiesto: non pubblicare"
    capienza.sort()

    # --- saldi per ordine
    saldi = {}
    for r in carica(a.saldi):
        saldi[r["order_id"]] = r.get("open_balance")

    # --- contatti: solo il nome, e solo per le prenotazioni dello scatto
    contatti = {}
    for r in carica(a.contatti):
        rid = r.get("reservation_id")
        if rid and rid not in contatti:
            contatti[rid] = r

    # --- prenotazioni
    pren, visti = [], set()
    for r in pren_righe:
        rid = r["reservation_id"]
        assert UUID.fullmatch(rid), ("reservation_id non valido", rid)
        if rid in visti:
            continue   # la stessa prenotazione può tornare in più pagine
        visti.add(rid)
        arr, dep = r["arrival"], r["departure"]
        assert GIORNO.match(arr) and GIORNO.match(dep) and arr < dep, ("date non valide", rid, arr, dep)
        if dep <= a.da or arr >= a.a:
            continue   # fuori dal periodo coperto dallo scatto
        tipo = r.get("lodging_type_id") or ""
        if tipo:
            k = (r["property_id"], tipo)
            if k not in camere:
                camere[k] = 0   # tipologia vista solo nelle prenotazioni: camere fisiche ignote
        c = contatti.get(rid) or {}
        lingua = (c.get("language") or "").lower()
        notti = r.get("room_nights") or 0
        pren.append({
            "id": rid,
            "hotelId": case[r["property_id"]][0],
            "scatolaTypeId": tipo,
            "arrival": arr,
            "departure": dep,
            "room": r.get("room_name") or None,
            "adults": int(r.get("adults") or 0),
            "children": int(r.get("children") or 0),
            "isOption": bool(r.get("is_option")),
            "isOverbooking": bool(r.get("is_overbooking")),
            "orderId": r.get("order_id"),
            "createdAt": (r.get("creation_date") or None),
            # room_amount è l'importo della singola prenotazione: non va ripartito, è già suo.
            "total": r.get("room_amount"),
            "notti": int(notti) if notti else None,
            "openBalance": saldi.get(r.get("order_id")),
            "checkedIn": bool(r.get("check_in_at")) and not r.get("check_out_at"),
            "stato": stato_di(r),
            "cancelledAt": (r.get("cancellation_date") or None),
            "canale": (r.get("channel") or r.get("ota_channel") or r.get("sale_source") or ""),
            "agenzia": r.get("agency_name") or "",
            "lingua": lingua if lingua in SUPPORTED else "",
            # l'azienda intestataria conta per i gruppi: si pubblica solo il fatto che ci sia
            "azienda": bool(c.get("organization_name")),
            "haNome": bool(nome_breve(c)),
        })
    assert pren, "nessuna prenotazione nel periodo richiesto: non pubblicare"
    pren.sort(key=lambda p: (p["arrival"], p["hotelId"], p["id"]))

    # --- case e tipologie
    generato = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    elenco_case = []
    for pid in sorted({p for p, _ in camere}):
        hid, nome = case[pid]
        tip = [{"id": t, "camere": camere[(p, t)], "etichetta": etichette.get(t)}
               for (p, t) in sorted(camere) if p == pid]
        elenco_case.append({"scatolaId": pid, "hotelId": hid, "nome": nome, "tipologie": tip})
    senza_camere = [t["id"] for c in elenco_case for t in c["tipologie"] if t["camere"] == 0]
    if senza_camere:
        print("ATTENZIONE: tipologie senza camere fisiche note: %s" % senza_camere, file=sys.stderr)

    # --- nomi cifrati
    ospiti_enc, n_nomi = None, 0
    if contatti:
        assert a.password, "--contatti richiede --password: i nomi non si pubblicano in chiaro"
        nomi = {}
        for rid in visti:
            n = nome_breve(contatti.get(rid))
            if n:
                nomi[rid] = n
        if nomi:
            ospiti_enc, n_nomi = cifra(nomi, a.password, generato), len(nomi)

    out = {
        "fonte": "La Scatola",
        "generato": generato,
        "finestra": {"da": a.da, "a": a.a},
        "freschezza": freschezza(a.disponibilita + "," + a.prenotazioni),
        "mancanti": MANCANTI,
        "case": elenco_case,
        "capienza": capienza,
        "prenotazioni": pren,
        "ospitiEnc": ospiti_enc,
    }
    json.dump(out, sys.stdout, ensure_ascii=False, separators=(",", ":"))

    per_casa = collections.Counter(p["hotelId"] for p in pren)
    stati = collections.Counter(p["stato"] for p in pren)
    canali = collections.Counter(p["canale"] or "(vuoto)" for p in pren)
    fr = out["freschezza"]
    print("scatto %s — %s → %s" % (generato, a.da, a.a), file=sys.stderr)
    print("prenotazioni %d (%s)" % (len(pren), ", ".join("%s %d" % kv for kv in sorted(per_casa.items()))), file=sys.stderr)
    print("stati: %s" % dict(stati), file=sys.stderr)
    print("canali piu' frequenti: %s" % dict(canali.most_common(6)), file=sys.stderr)
    print("con importo: %d · con data di prenotazione: %d · con camera: %d"
          % (sum(1 for p in pren if p["total"]), sum(1 for p in pren if p["createdAt"]),
             sum(1 for p in pren if p["room"])), file=sys.stderr)
    print("capienza: %d righe giorno×tipologia; tipologie %s"
          % (len(capienza), {c["hotelId"]: len(c["tipologie"]) for c in elenco_case}), file=sys.stderr)
    print("nomi cifrati: %d su %d prenotazioni" % (n_nomi, len(pren)), file=sys.stderr)
    if n_nomi and n_nomi < len(pren) * 0.8:
        print("ATTENZIONE: meno dell'80%% delle prenotazioni ha un nome. Controlla di aver "
              "scaricato tutte le pagine di curated_reservation_contacts.", file=sys.stderr)
    print("freschezza La Scatola: %s, ultimo successo %s (%s ore)"
          % (fr["stato"], fr["ultimoSuccesso"], fr["etaOre"]), file=sys.stderr)
    if fr["stato"] != "ok":
        print("ATTENZIONE: La Scatola non era aggiornata. Lo scatto si può pubblicare, ma dillo "
              "nel riepilogo: la pagina lo mostrerà all'utente.", file=sys.stderr)


if __name__ == "__main__":
    main()
