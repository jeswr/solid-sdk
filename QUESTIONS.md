<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CHT-L2 boundary questions

1. **Grouping window** (10-pure-libraries-2 / CHT-L2; 07 Chat timeline): should N
   measure adjacent gaps or total group duration, and is the boundary inclusive?
   Conservative implementation: caller supplies N explicitly; adjacent gaps ≤ N
   minutes group, with hard breaks at local day boundaries and the unread marker.
2. **Unread receipts** (07 Chat room list; CHT-L2): exclude the viewer's own
   messages or count all messages after last-read? What does a missing receipt mean?
   Conservative timestamp-only implementation: count every message strictly newer
   than the receipt; equality is read. Explicit `null` means never read. No inferred
   receipt, sender exclusion, or advancing the receipt from the available page.
3. **Reactions** (07 Chat reactions; CHT-L2): count reaction records or distinct
   people, and normalise emoji variants? Implementation counts distinct actors per
   exact emoji token in a single message's active-reaction snapshot. Duplicate
   actor/token pairs are idempotent; no Unicode folding or reaction-event replay.
   Emoji tokens are nonblank opaque strings supplied by the typed data layer.
4. **Timestamp and identity representation** (10 fail-closed rule; CHT-L2): no
   concrete library signature is specified. Implementation requires integer Unix
   milliseconds (UTC years 0001–9999, local years also 0001–9999 for day dividers),
   explicit Intl-supported viewer time zone and opaque nonblank IDs. Strings and
   Date objects are rejected; adapters must parse their timestamps explicitly.

These choices allow implementation to proceed without adding UI, I/O, defaults,
or a data-model dependency. Counts cover only the supplied messages; callers must
provide complete room snapshots for complete unread counts.
