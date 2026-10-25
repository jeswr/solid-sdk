<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# T-004 import questions — sst-8xm.30

1. Where is the history-bearing `jeswr/fetch-rdf` source at
   `a8359a3764cb6b3c763e09ea211542a5dc7edc33` in this environment?
   The dispatcher's `/Users/jesght/Documents/GitHub/jeswr/solid-sdk-lanes/_sources/fetch-rdf`
   path is absent, no equivalent local clone or bundle was found, and that commit is
   absent from this checkout's object database. The installed GitHub dependency cache
   contains only `package.json` and `README.md`, without source, tests, or Git history.
   Options: supply an equivalent local clone/bundle, or authorize obtaining a temporary
   source clone from GitHub. ADR-001 §D2 requires importing the standalone package;
   a manifest-only reconstruction would not satisfy the task's history requirement.

2. Is the source-history import an exception to the lane's prohibition on fetch and
   merge operations? The dispatcher prescribes filtering a temporary source clone,
   fetching it, and merging with `--allow-unrelated-histories`, while the lane rules say
   “Do not merge, push, fetch”. Options: explicitly permit the source-only fetch/import
   merge, or provide the filtered history already attached to this lane's base so only
   ordinary implementation commits are needed. ADR-001 §D2 and STATUS J3 establish the
   import decision; this question concerns the authorized import procedure.
