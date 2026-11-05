#!/usr/bin/env python3
"""Costruisce radar.json dai documenti del Radar prezzi su claude.ai.

Il Radar prezzi vive in un artifact Claude: lì lo staff carica gli screenshot di Booking e
Claude li legge. Questa pagina, su GitHub Pages, non può parlare con Claude né con il database
dell'artifact, quindi ogni mattina l'attività pianificata scarica le due collezioni del Radar
e questo script le impacchetta in radar.json, che la pagina legge accanto a scatola.json.

Ingresso: una cartella con le sottocartelle `rilevazioni/` e `barometro/`, un file JSON per
documento, chiamato `<doc_id>.json`. È esattamente la forma che produce ArtifactData con
`out_dir` (`<out_dir>/<collezione>/<doc_id>.json`). Le due sottocartelle si possono anche
indicare a parte con --rilevazioni e --barometro.

Regole:
- l'ID di ogni documento è il nome del file, copiato identico nel campo `id`. Non si modifica,
  non si rigenera, non si normalizza;
- ogni campo del documento è copiato così com'è: niente conversioni, niente arrotondamenti,
  niente campi aggiunti oltre a `id`;
- se un documento ha già un campo `id` diverso dal nome del file, lo script si ferma invece di
  scegliere quale dei due tenere.

Uso:
    python3 tools/costruisci_radar.py CARTELLA > radar.json
    python3 tools/costruisci_radar.py --rilevazioni R/ --barometro B/ -o radar.json
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Campi senza i quali una riga non si può mostrare. Una riga che non li ha viene comunque
# copiata (non si butta via un dato), ma lo si dice su stderr.
OBBLIGATORI = {
    "rilevazioni": ("casa", "struttura", "checkIn", "checkOut", "notti", "totale", "rilevatoIl"),
    "barometro": ("localita", "checkIn", "checkOut", "nonDisponibiliPct", "rilevatoIl"),
}


def leggi_cartella(cartella: Path, nome: str) -> list[dict]:
    if not cartella.is_dir():
        sys.exit(f"ERRORE: la cartella {cartella} non esiste")
    docs = []
    for f in sorted(cartella.glob("*.json")):
        doc_id = f.stem
        try:
            dati = json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            sys.exit(f"ERRORE: {f} non è un JSON valido ({e})")
        if not isinstance(dati, dict):
            sys.exit(f"ERRORE: {f} non contiene un oggetto")
        if "id" in dati and dati["id"] != doc_id:
            sys.exit(f"ERRORE: {f} ha id {dati['id']!r} diverso dal nome del file: non scelgo io quale tenere")
        mancano = [k for k in OBBLIGATORI[nome] if k not in dati]
        if mancano:
            print(f"ATTENZIONE: {nome}/{doc_id} senza {', '.join(mancano)}", file=sys.stderr)
        docs.append({"id": doc_id, **{k: v for k, v in dati.items() if k != "id"}})
    return docs


def main() -> None:
    p = argparse.ArgumentParser(description="Costruisce radar.json dai documenti del Radar prezzi.")
    p.add_argument("cartella", nargs="?", help="cartella con le sottocartelle rilevazioni/ e barometro/")
    p.add_argument("--rilevazioni", help="cartella dei documenti della collezione rilevazioni")
    p.add_argument("--barometro", help="cartella dei documenti della collezione barometro")
    p.add_argument("-o", "--output", help="file da scrivere (predefinito: stdout)")
    a = p.parse_args()

    base = Path(a.cartella) if a.cartella else None
    r_dir = Path(a.rilevazioni) if a.rilevazioni else (base / "rilevazioni" if base else None)
    b_dir = Path(a.barometro) if a.barometro else (base / "barometro" if base else None)
    if not r_dir or not b_dir:
        p.error("indica CARTELLA oppure sia --rilevazioni sia --barometro")

    ril = leggi_cartella(r_dir, "rilevazioni")
    bar = leggi_cartella(b_dir, "barometro")
    if not ril:
        sys.exit("ERRORE: nessuna rilevazione: non scrivo un radar.json vuoto")

    out = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "rilevazioni": ril,
        "barometro": bar,
    }
    testo = json.dumps(out, ensure_ascii=False, indent=1) + "\n"
    if a.output:
        Path(a.output).write_text(testo, encoding="utf-8")
    else:
        sys.stdout.write(testo)

    ultima = max((d.get("rilevatoIl") or "" for d in ril), default="")
    print(f"radar.json: {len(ril)} rilevazioni, {len(bar)} dati di mercato, ultima rilevazione {ultima}", file=sys.stderr)


if __name__ == "__main__":
    main()
