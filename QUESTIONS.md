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

The explicit consumer checks found one remaining compatibility limit: Pod Money's
injected test readers return the older shape without `headers` and with a
`DatasetCore`-typed dataset. The imported result requires `headers` and an N3
`Store`. This round conservatively preserves those imported type requirements;
restoring metadata fixes production reads but does not make these test doubles
assignable to `typeof fetchRdf`.

Dispatcher question: should subsequent work adapt the consumer's injected-reader
contract/test doubles, or authorize relaxing the additional public result types?
The latter changes more than the named metadata fields. This lane chose neither
additional migration nor type redesign. Validation and other remaining failures
are in [STATUS.md](STATUS.md).
