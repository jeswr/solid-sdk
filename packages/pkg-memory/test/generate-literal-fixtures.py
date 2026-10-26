# AUTHORED-BY Codex GPT-6
"""Generate literal parity oracles with RDFlib 7.1.4 and the reference builder."""
import importlib.util
import json
import sys
from pathlib import Path

import rdflib

if rdflib.__version__ != "7.1.4":
    raise RuntimeError("Literal fixtures require rdflib==7.1.4")

spec = importlib.util.spec_from_file_location("reference_builder", sys.argv[1])
reference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)

languages = []
for language in ["EN-US", "en-US", "en-us", "zh-Hant-TW"]:
    for subject in ["<https://example.org/subject>", "_:label"]:
        assertion = f'{subject} schema:name "Hello"@{language} .'
        parsed = reference.parse_assertion(assertion)
        identifier, graph = reference.canonicalise(parsed)
        assert next(parsed.objects()).language == language
        languages.append({"language": language, "assertion": assertion,
                          "id": str(identifier), "graph": graph.serialize(format="nt")})

output = Path(__file__).parent / "fixtures" / "literal-parity.json"
output.write_text(json.dumps({"$comment": "AUTHORED-BY Codex GPT-6; generated using RDFlib 7.1.4",
                              "languages": languages}, indent=2) + "\n")
