# AUTHORED-BY Codex GPT-6.1-Sol
"""Generate temporal lexical/ID oracles with RDFlib 7.1.4 and np_builder.py.

Run with the reference builder path. No pilot data or TypeScript code is used.
"""
import importlib.util
import json
import sys
from pathlib import Path

import rdflib
from rdflib.namespace import XSD

if rdflib.__version__ != "7.1.4":
    raise RuntimeError("Temporal fixtures require rdflib==7.1.4")

spec = importlib.util.spec_from_file_location("reference_builder", sys.argv[1])
reference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)

cases = []

def add(name, datatype, values):
    rows = []
    for value in values:
        assertion = f'<https://example.org/residence> schema:validFrom "{value}"^^xsd:{datatype} .'
        parsed = reference.parse_assertion(assertion)
        identifier, graph = reference.canonicalise(parsed)
        literal = next(parsed.objects())
        assert literal.datatype == XSD[datatype]
        rows.append((str(literal), str(identifier), graph.serialize(format="nt")))
    assert all(row == rows[0] for row in rows), name
    normalized, identifier, graph = rows[0]
    cases.append({"name": name, "datatype": datatype, "values": values,
                  "normalized": normalized, "id": identifier, "graph": graph})

for fraction, name in [("", "seconds"), (".1", "short-fraction"),
                       (".000000", "zero-fraction"), (".0000009", "truncated-zero"),
                       (".123456789", "truncated-fraction"), (".000001", "microsecond")]:
    base = "2026-01-01T12:00:00"
    normalized = str(rdflib.Literal(base + fraction, datatype=XSD.dateTime))
    add("local-" + name, "dateTime", list(dict.fromkeys([base + fraction, normalized])))
    add("utc-" + name, "dateTime", list(dict.fromkeys(
        [base + fraction + zone for zone in ["Z", "+00:00", "-00:00"]]
        + [normalized + "+00:00"])))

for zone in ["+05:30", "-03:30", "+14:00", "-14:00"]:
    add("offset-" + zone, "dateTime", ["2026-01-01T12:00:00.1" + zone,
                                      "2026-01-01T12:00:00.1000009" + zone])
add("early-dateTime", "dateTime", ["0001-01-01T00:00:00.1Z", "0001-01-01T00:00:00.100000+00:00"])

for datatype, base in [("date", "2026-01-01"), ("gYear", "2026"), ("gYearMonth", "2026-01")]:
    add(datatype + "-zones", datatype,
        [base + zone for zone in ["", "Z", "z", "+00:00", "-00:00", "+05:30", "-03:30", "+14:00", "-14:00"]])
    early = {"date": "0001-01-01", "gYear": "0001", "gYearMonth": "0001-01"}[datatype]
    add(datatype + "-early-year", datatype, [early, early + "Z"])
add("gYear-leading-zeroes", "gYear", ["02026Z", "+2026+05:30", "2026"])
add("gYearMonth-leading-zeroes", "gYearMonth", ["02026-001Z", "+2026-01-03:30", "2026-01"])
add("date-leap-day", "date", ["2000-02-29", "2000-02-29-14:00"])

# RDFlib keeps the original lexical form if Python cannot represent the value.
import logging
logging.disable(logging.CRITICAL)
for datatype, values in [
    ("dateTime", ["0000-01-01T00:00:00.1Z", "2026-01-31T24:00:00Z",
                  "2026-01-31T24:00:00.000Z", "2026-01-31T24:00:00.000"]),
    ("date", ["0000-02-29Z", "2026-02-30Z", "-2026-01-01Z"]),
    ("gYear", ["0000Z", "12026Z", "-2026Z"]),
    ("gYearMonth", ["0000-01Z", "12026-01Z", "2026-13Z", "-2026-01Z"]),
]:
    for index, value in enumerate(values):
        add(f"{datatype}-unparsed-{index}", datatype, [value])

output = Path(__file__).parent / "fixtures" / "temporal.json"
output.write_text(json.dumps({"$comment": "AUTHORED-BY Codex GPT-6.1-Sol; generated using RDFlib 7.1.4",
                              "cases": cases}, indent=2) + "\n")
