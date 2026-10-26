# AUTHORED-BY Codex GPT-6
"""Generate MCP-04H review oracles using RDFlib 7.1.4 and np_builder.py."""
import importlib.util
import json
import sys
from pathlib import Path

import rdflib

if rdflib.__version__ != "7.1.4":
    raise RuntimeError("Review fixtures require rdflib==7.1.4")

spec = importlib.util.spec_from_file_location("reference_builder", sys.argv[1])
reference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)

languages = []
for tags in [["en-US", "en-us", "EN-US"], ["en-us", "EN-US", "en-US"],
             ["EN-US", "en-US", "en-us"]]:
    for subject in ["<https://example.org/subject>", "_:label"]:
        single = f'{subject} schema:name "Hello"@{tags[0]} .'
        assertion = " ".join(f'{subject} schema:name "Hello"@{tag} .' for tag in tags)
        parsed = reference.parse_assertion(assertion)
        assert len(parsed) == 1
        assert next(parsed.objects()).language == tags[0]
        identifier, graph = reference.canonicalise(parsed)
        assert identifier == reference.canonicalise(reference.parse_assertion(single))[0]
        languages.append({"tags": tags, "single": single, "assertion": assertion,
                          "id": str(identifier), "graph": graph.serialize(format="nt")})

source_dates = []
for kind in ["document", "email"]:
    for value in ["2026-01-01", "2026-01-01Z", "2026-01-01z", "2026-01-01+00:00",
                  "2026-01-01-00:00", "2026-01-01+05:30", "2026-01-01-03:30",
                  "2026-01-01+14:00", "2026-01-01-14:00", "2000-02-29Z",
                  "0001-01-01Z", "0000-02-29Z", "2026-02-30Z", "-2026-01-01Z"]:
        builder = reference.Builder({
            "batch_id": "source-dates",
            "worker": {"agent_id": "https://example.org/agent", "agent_label": "Synthetic"},
            "sources": [{"id": "source", "kind": kind,
                         "url": "https://example.org/source", "date": value}],
            "claims": [],
        })
        builder.build_sources()
        dates = list(builder.sources_g.objects(rdflib.URIRef("https://example.org/source"),
                                               reference.SCHEMA.dateCreated))
        assert len(dates) == 1
        literal = dates[0]
        source_dates.append({"kind": kind, "value": value, "normalized": str(literal),
                             "datatype": str(literal.datatype)})

output = Path(__file__).parent / "fixtures" / "review-parity.json"
output.write_text(json.dumps({"$comment": "AUTHORED-BY Codex GPT-6; generated using RDFlib 7.1.4",
                              "languages": languages, "sourceDates": source_dates}, indent=2) + "\n")
