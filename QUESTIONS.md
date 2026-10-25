<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MCP-04 / sst-jhl3 questions

1. Where are the local knowledge-graph sources required by MCP-04?
   - References: `specs/mcp/tasks.json` MCP-04; `specs/mcp/DESIGN.md` §§2, 4, 8;
     `knowledge-graph/DESIGN.md` §§2–3 (especially §2.2).
   - Required files: `pipeline/np_builder.py`, `DESIGN.md`, `shapes.ttl`,
     `context/pkg.ttl`, and the five reference nanopublications in `pilot/`.
   - Option A (preferred): provide an existing local source directory containing these files.
   - Option B: make a reviewed, redacted copy of the required sources and pilot fixtures
     available inside this checkout.
   - Conservative disposition: implementation is blocked until these sources are available.
     The mounted planning repository contains `specs/` but no `knowledge-graph/` directory.
     The MCP design names templates but does not specify their RDF assertion structures,
     the UUIDv5 namespace, or the exact UUID name construction. Inventing those details
     would violate the port/parity requirement. No placeholder implementation or fabricated
     parity fixtures have been added.
