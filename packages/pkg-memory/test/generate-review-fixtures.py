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

output = Path(__file__).parent / "fixtures" / "review-parity.json"
output.write_text(json.dumps({"$comment": "AUTHORED-BY Codex GPT-6; generated using RDFlib 7.1.4",
                              "languages": languages}, indent=2) + "\n")
