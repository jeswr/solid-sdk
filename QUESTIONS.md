<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# T-004 / sst-8xm.30 — API compatibility decision

The fix-round-1 brief resolves the API question raised at `474c1be6`: restore
backwards-compatible result metadata alongside the imported `headers` field.

Implemented in `37a63a7c`:

- `etag`: the unmodified response header, or `null`.
- `url`: the final response URL after redirects, falling back to the requested URL.
- `contentType`: the lowercase media type without parameters, or `null` when absent.
- `response`: the original response, whose body has been consumed by parsing.

These semantics match the imported package's earlier result contract. No consumer
migration or redirect-handling redesign was made.

The fix-round-2 brief resolves the remaining consumer-contract question: Pod Money
now declares a minimal injected-reader function returning only `DatasetCore`, `etag`,
and `url`, the fields its store consumes. The public fetch-rdf result contract stays
as imported. All 48 consumers converted to `workspace:*` pass typecheck.

The same brief resolves known-context handling: solid-vc and solid-chat-interop own
bundled context JSON and explicit offline loaders. Unknown contexts are refused,
including nested ones. The generic fetch-rdf parser still refuses remote contexts by
default. Existing round-trip tests pass again.

No open API or design questions remain for this fix brief. Wider validation results
and limitations are recorded in [STATUS.md](STATUS.md).
