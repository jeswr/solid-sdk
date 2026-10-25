<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DOC-00 interpretation questions

1. **05-docs §5 — retry count:** Does “retry (max 3)” mean three total PUTs or three retries after the initial PUT? This lane uses three retries (four total PUTs), with 2/4/8-second backoff, matching the three stated delays. Exhaustion throws the typed write error for the later hook to schedule another save.
2. **05-docs §4.11 / DOC-00 boundary — live editor state:** Should DOC-00 import Yjs or accept an adapter? The model-first amendment excludes editor integration. This lane requires injected snapshot/asset-reference rewriting and `persistFullState` callbacks for `makeCopy`; DOC-05 will provide the live editor adapter. Referenced assets are copied by injected fetch; historical revisions, comments and grants are not copied.
3. **05-docs §2.1 — legacy discovery:** List every legacy container or only registered ones? This lane lists `pod-docs/` only when registered for canonical or legacy `pd:Document`, allows direct legacy reads, and rejects legacy mutations. New resources always use `docs/`.

4. **05-docs §2.2 / §4.11 — copy title length:** The editor limits titles to 200 characters, while “Copy of ” can extend a valid title to 208. This lane truncates the copy title to 200 characters; its URL retains the source slug plus `-copy` (and collision suffixes). Should the title cap instead exclude the generated prefix?
