<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# VOC-03 questions and conservative readings

1. ADR-001 D4 requires every new package to export `./testing` fakes, while DECISIONS V11
   limits suite-vocab to IRI constants and helpers without RDF or I/O. Options: invent a fake
   surface, or omit it where nothing needs faking. Taken: omit `./testing`; tests use public
   constants and the alias map. No new runtime or test dependencies.
2. VOC-03's namespace list omits Pod Health's existing `ph:` workout namespace, but requires
   constants for every namespace written and no legacy literals in these app sources. Options:
   leave workout writes legacy, or give the existing namespace the same V1 canonical root.
   Taken: `NS.POD_HEALTH` at `https://jeswr.org/ns/pod-health#`, with a read alias; no new terms.
   Health normalizes vocabulary in memory before typed access/save. HLT-01's persisted batch
   migration remains outside this lane (DECISIONS V6).
3. DECISIONS V2 describes first-open Type Index re-registration, while VOC-03 explicitly asks
   for dual-IRI lookups and the current Drive/Health layers expose registration builders, not
   an index-opening lifecycle. Options: add new I/O lifecycle, or keep existing API boundaries.
   Taken: dual-IRI discovery and canonical explicit registration; Docs' existing ensure call
   adds a canonical registration alongside the legacy one. Drive/Health callers keep control
   of persistence; no new implicit network writes.
