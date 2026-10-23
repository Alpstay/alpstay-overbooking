"""Controlli su scatola.json prima di pubblicarlo. Esce con errore se qualcosa non va.

  python3 tools/verifica_scatola.py scatola.json [ospiti1.json,ospiti2.json] [PASSWORD]

1. la forma del file è quella che `scatola.ts` si aspetta;
2. nessun nome, email o telefono degli ospiti compare in chiaro;
3. i numeri stanno in piedi: date valide, ID di Slope intatti, capienza coerente;
4. se arrivano password e file degli ospiti, il blocco cifrato si riapre davvero e i nomi
   dentro sono quelli giusti — un blocco che non si apre è peggio di nessun blocco.

Un errore qui vuol dire **non pubblicare**. Online resta lo scatto di ieri, che è utilizzabile.
"""
import base64, json, re, sys

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
GIORNO = re.compile(r"^\d{4}-\d{2}-\d{2}$")

percorso = sys.argv[1]
ospiti_p = sys.argv[2] if len(sys.argv) > 2 else ""
password = sys.argv[3] if len(sys.argv) > 3 else ""

testo = open(percorso, encoding="utf-8").read()
s = json.loads(testo)

# --- 1. forma
for campo in ("fonte", "generato", "finestra", "freschezza", "mancanti", "case", "capienza", "prenotazioni"):
    assert campo in s, "manca il campo " + campo
da, a = s["finestra"]["da"], s["finestra"]["a"]
assert GIORNO.match(da) and GIORNO.match(a) and da < a, ("periodo non valido", da, a)
assert s["case"], "nessuna casa"
assert s["prenotazioni"], "nessuna prenotazione"
assert s["capienza"], "nessuna riga di capienza"

case = {c["scatolaId"]: c for c in s["case"]}
hotel = {c["hotelId"] for c in s["case"]}
tipi = {t["id"] for c in s["case"] for t in c["tipologie"]}
for c in s["case"]:
    assert UUID.match(c["scatolaId"]), ("property_id non valido", c["scatolaId"])
    assert c["tipologie"], ("casa senza tipologie", c["hotelId"])
    for t in c["tipologie"]:
        assert UUID.match(t["id"]), ("lodging_type_id non valido", t["id"])
        assert isinstance(t["camere"], int) and 0 <= t["camere"] <= 200, ("camere non plausibili", t)

# --- 3. numeri
ids = set()
for p in s["prenotazioni"]:
    assert UUID.match(p["id"]), ("reservation_id non valido o riscritto", p["id"])
    assert p["id"] not in ids, ("prenotazione doppia", p["id"])
    ids.add(p["id"])
    assert p["hotelId"] in hotel, ("casa sconosciuta", p)
    assert GIORNO.match(p["arrival"]) and GIORNO.match(p["departure"]), ("date non valide", p["id"])
    assert p["arrival"] < p["departure"], ("date invertite", p["id"])
    assert 0 <= p["adults"] + p["children"] <= 20, ("persone non plausibili", p["id"])
    if p.get("scatolaTypeId"):
        assert p["scatolaTypeId"] in tipi, ("tipologia non dichiarata fra le case", p["id"])

for r in s["capienza"]:
    assert len(r) == 7, ("riga di capienza malformata", r)
    g, pid, tid, fis, chi, con, opz = r
    assert GIORNO.match(g) and da <= g <= a, ("giorno fuori periodo", g)
    assert pid in case, ("struttura sconosciuta nella capienza", pid)
    assert tid in tipi, ("tipologia sconosciuta nella capienza", tid)
    for v in (fis, chi, con, opz):
        assert isinstance(v, int) and v >= 0, ("numero non valido nella capienza", r)
    assert chi <= fis, ("più chiusure che camere", r)
    # Il confronto con le camere dichiarate per la tipologia: se non torna, la tabella delle
    # tipologie e le righe del giorno vengono da due letture diverse e una delle due è vecchia.
    atteso = next(t["camere"] for t in case[pid]["tipologie"] if t["id"] == tid)
    assert fis == atteso or atteso == 0, ("camere fisiche discordanti", r, atteso)

# --- 2. niente dati personali in chiaro

def testi(v):
    """Tutte le stringhe dentro un valore di La Scatola.

    I campi del catalogo sono dichiarati stringa, ma `identity_document` arriva come
    oggetto: senza appiattirlo il controllo andava in errore e non girava affatto.
    """
    if isinstance(v, str):
        return [v]
    if isinstance(v, dict):
        return [x for y in v.values() for x in testi(y)]
    if isinstance(v, (list, tuple)):
        return [x for y in v for x in testi(y)]
    if v is None or isinstance(v, bool):
        return []
    return [str(v)]

parole = set()
righe = []
for f in [x for x in ospiti_p.split(",") if x]:
    j = json.load(open(f, encoding="utf-8"))
    righe += j.get("data") or j.get("rows") or []
for r in righe:
    for k in ("last_name", "first_name", "organization_name",
              "order_customer_last_name", "order_customer_first_name"):
        for w in re.split(r"[\s,]+", r.get(k) or ""):
            if len(w) >= 5:
                parole.add(w.lower())
    for k in ("primary_email", "primary_phone_number", "identity_document", "vat_number",
              "company_email", "company_phone", "email", "phone", "mobile_phone",
              "document_number", "order_customer_email"):
        for v in testi(r.get(k)):
            v = v.strip().lower()
            if len(v) >= 6:
                parole.add(v)
basso = testo.lower()
trovate = sorted(w for w in parole
                 if re.search(r"(?<![a-zà-ÿ0-9+/@.])" + re.escape(w) + r"(?![a-zà-ÿ0-9+/=])", basso))
assert not trovate, "possibili dati personali in chiaro in %s: %d (non pubblicare)" % (percorso, len(trovate))

# email e telefoni non devono comparire nemmeno in forme che non vengono dai file letti
assert not re.search(r"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}", basso), \
    "c'è un indirizzo email in scatola.json: non pubblicare"

# --- 4. il blocco cifrato si riapre
enc = s.get("ospitiEnc")
if enc and password:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    d = lambda x: base64.b64decode(x)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=d(enc["salt"]),
                     iterations=enc["iter"]).derive(password.encode())
    nomi = json.loads(AESGCM(key).decrypt(d(enc["iv"]), d(enc["ct"]), s["generato"].encode()))
    assert nomi, "il blocco dei nomi è vuoto"
    fuori = set(nomi) - ids
    assert not fuori, ("nomi di prenotazioni che non sono nello scatto", sorted(fuori)[:3])
    print("blocco nomi: %d nomi, si riapre con la password data" % len(nomi))
elif enc:
    print("blocco nomi presente ma non verificato: password non fornita")

per_casa = {}
for p in s["prenotazioni"]:
    per_casa[p["hotelId"]] = per_casa.get(p["hotelId"], 0) + 1
print("verifica OK: %s → %s, %d prenotazioni %s, %d righe di capienza, freschezza %s"
      % (da, a, len(ids), per_casa, len(s["capienza"]), s["freschezza"]["stato"]))
