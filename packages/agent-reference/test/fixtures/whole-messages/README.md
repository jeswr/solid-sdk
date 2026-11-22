<!-- AUTHORED-BY Codex GPT-6 -->

These six JSON-LD documents are synthetic mortgage-core main-path packets converted
through the complete message model. Each propose, deliver with evidence, and invoke
has a JWS/JCS and an eddsa-rdfc-2022 version. `manifest.json` retains the original
objects and public verification material; no private key is stored here. Test keys
are deterministically reproducible through `src/reference/keys.ts`.

Tests rerun the scenario to check the source packets, reproduce every signature,
verify with pinned keys, validate the graph shapes, test tampering and unknown keys,
and preserve the Data Integrity proof graphs through TriG. The runtime does not yet
send these documents; that switch belongs to Brief 22d. Named proof graphs require
TriG or N-Quads for lossless RDF transport.
