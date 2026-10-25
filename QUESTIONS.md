<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-41b9 implementation questions

1. **Root bootstrap adapter (04-drive §5.2; 08-model-first).** DRV-01 names SDK StorageClient / Type Index hooks; the model-first amendment forbids assuming their APIs. Options: invent a future SDK adapter, or expose injected-fetch RDF I/O with an explicit existing private Type Index URL. Implemented the latter. Creating/linking absent private indexes and adapting LWS are left to SDK-APP-10 / DRV-01; unreadable or missing indexes fail without writes.
2. **Naming boundaries (04-drive §4.1.3; §5.2).** The spec does not define empty/reserved path names, the meaning of “chars”, or extension chains that alone exceed 180 chars. Options: silently invent fallback names/truncate extensions, or reject impossible names. Implemented rejection of empty, `.`/`..`, and an extension+suffix leaving no basename room; count Unicode code points and preserve the full chain. Preference defaults are list view, name ascending, and empty collections (rather than requiring callers to invent them).
