"""Generate literal parity oracles with RDFlib 7.1.4 and the reference builder."""
import importlib.util
import json
import logging
import sys
import warnings
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

logging.disable(logging.CRITICAL)
warnings.filterwarnings("ignore", category=UserWarning)
scalars = []
for datatype, accepted, rejected in [
    ("string", ["", "  Synthetic text  ", "TRUE", "line\nreturn\rtab\t"], []),
    ("integer", ["0", "1", "-1", "9007199254740993", "-9007199254740993"],
     ["", "00", "-0", "+1", "001", "-001", " 1", "1 ", "1\n", "1\r", "1\t",
      " +0009007199254740993 ", "1.2", "1E3", "invalid", "١"]),
    ("decimal", ["0", "-0", "1", "-1", "0.00", "-0.00", "2.00", "-0.50", "0.00500",
                 "12345678901234567890.123456789000"],
     ["", "00", "-00", "+1", "1.", ".5", "-.50", "+1.00", "01.00", "-000.00",
      " 1", "1 ", "1\n", "1\r", "1\t", "1E3", "1e-3", "NaN", "INF", "Infinity",
      "-Infinity", "invalid", "1_000", "１"]),
    ("boolean", ["true", "false"],
     ["", "TRUE", "FALSE", "True", "False", "1", "0", "yes", " true", "false ",
      "true\n", "false\r", "true\t"]),
]:
    for value in accepted + rejected:
        # RDF/JS represents plain literals as xsd:string; use the existing
        # plain-string parity contract rather than RDFlib's explicit datatype.
        suffix = "" if datatype == "string" else f"^^xsd:{datatype}"
        assertion = (f'<https://example.org/subject> schema:value '
                     f'{json.dumps(value, ensure_ascii=False)}{suffix} .')
        parsed = reference.parse_assertion(assertion)
        identifier, graph = reference.canonicalise(parsed)
        normalized = str(next(parsed.objects()))
        if value in accepted:
            assert normalized == value, (datatype, value, normalized)
        scalars.append({"datatype": datatype, "value": value, "accepted": value in accepted,
                        "assertion": assertion, "normalized": normalized,
                        "id": str(identifier), "graph": graph.serialize(format="nt")})

output = Path(__file__).parent / "fixtures" / "literal-parity.json"
output.write_text(json.dumps({"$comment": "AUTHORED-BY Codex GPT-6; generated using RDFlib 7.1.4",
                              "languages": languages, "scalars": scalars}, indent=2) + "\n")
