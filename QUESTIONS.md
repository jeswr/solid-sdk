<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MAI-L2 conservative readings

1. **Input boundary** — 10-pure-libraries-2.md and MAI-L2 require threading headers but
   do not define an importer API. Options: parse raw RFC 822 headers here, or accept an
   already decoded message snapshot. Use the latter: unique resource `id`, numeric
   timestamp, decoded subject/plain text, exact participant identities, optional single
   angle-bracket dot-atom Message-ID/In-Reply-To, and an ordered References array.
   Unsupported header syntax (including quoted IDs, comments, raw encoded subjects and
   multiple In-Reply-To IDs) fails with a typed error; absent IDs remain supported.
2. **Conflicting ancestry and duplicate IDs** — MAI-L2 says to handle these without
   specifying a policy. Options: reject the whole mailbox, or apply JWZ container rules.
   Use JWZ: retain every message, give duplicate IDs independent containers, target the
   first canonical occurrence, and skip links that create cycles. Process messages by
   timestamp then unique resource ID so results do not depend on input order. Explicit
   References take precedence over In-Reply-To; subject merging only joins thread roots.
3. **Summary and fallback boundaries** — 07-parity-backlog.md Mail and MAI-L2 do not
   specify snippet length, participant identity equivalence or tie ordering. Options:
   infer identities/body formats or require decoded values. Preserve exact participant
   identities; union sender, To and Cc; use the latest message's plain text collapsed to
   160 Unicode code points. Sort threads by latest timestamp descending, ties by the
   smallest resource ID; messages ascending by timestamp/ID. Empty normalized subjects
   never merge. Support the named prefixes and leading list tags; this is not a raw
   MIME parser or a promise of every localized subject convention.
