<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# T-004 / sst-8xm.30 — API compatibility decision

1. **Which `fetchRdf` result contract must the import preserve?** ADR-001 §D2 says
   “API unchanged”; T-004 says to keep the API, and the dispatcher explicitly selects
   upstream `main` at `a8359a3764cb6b3c763e09ea211542a5dc7edc33`. That commit exports
   `FetchedRdf = { dataset: Store; headers: Headers }`, deliberately removing parallel
   metadata fields. Existing workspace consumers instead read `etag`, `url`,
   `contentType`, and/or `response`, and some injected readers return only that older
   shape. Switching their manifests to `workspace:*` produces TypeScript and runtime
   test failures. In particular, callers retaining the final URL after redirects cannot
   recover it from the imported `headers` result alone.

   Options:

   - Preserve the selected upstream contract and authorize migration of consumer code,
     tests, and injected-reader contracts. Specify how callers should retain final
     response URLs where required.
   - Preserve compatibility with existing callers by restoring the legacy result fields
     alongside `headers` in the imported package, with regression tests. This extends the
     selected upstream API and needs an explicit compatibility decision.
   - Keep the history import and dependency changes as staged lane work, and resolve
     compatibility in another task before this lane is merged.

   This lane conservatively retains the selected upstream API. It has stopped without
   choosing either migration or an API extension, as required by the brief's ambiguity
   rule. The dependant gate is not green; see `STATUS.md` for validation and additional
   integration failures.
