<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# TSK-L3 interpretation questions

1. Should columns/order follow Tasks §2.5/§4.4 (sections and numeric positions), or
   TSK-L3 (status grouping and `src/lib/order` fractional strings)? Options: adapt
   numeric section positions, or expose a pure status/key projection. The lane takes
   the latter, as explicitly required by its brief. Callers supply ordered status
   identifiers; the library does no RDF mapping or numeric conversion.
2. What is the filter persistence schema (Tasks §5.8 names sorts but does not define
   a URL format)? Options: encode arbitrary queries, or a closed, versioned schema.
   The lane takes the latter: optional query, statuses, labels, priorities (1–4),
   and project, plus required manual/due/priority/name sort. No filter execution is
   added. Only canonical encoded states are decoded; unknown fields are rejected.
3. Does “WIP counts” imply enforced limits (Tasks §1 lists WIP limits as parity)?
   Options: count each status column, or introduce workflow-specific limits and
   completion semantics. The lane counts every task in each configured status,
   including empty columns; it adds no limits or implicit terminal statuses.
