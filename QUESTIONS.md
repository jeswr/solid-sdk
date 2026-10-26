<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CON-L2 conservative readings

1. **Winner precedence and field shape** — `10-pure-libraries-2.md` / tasks.json CON-L2
   requires deterministic field winners but specifies neither a ranking nor an input schema.
   Options: newest/richest record, caller priority, or stable contact ID. Use ascending UTF-16
   contact ID and the first supplied value per field, without guessing timestamps or quality.
   Accept an explicit string projection (`fields`, `multiFields`, `webIds`, `emails`, `phones`);
   reject unsupported shapes/unknown top-level fields instead of dropping data. Scalar conflicts
   retain every exact spelling and its source IDs for UI review. No writes or deletions occur.

2. **Phone country handling** — CON-L2 names a default country calling code without supplying
   a region or numbering-plan metadata. Options: infer trunk/IDD prefixes, add a phone parser,
   or accept a documented subset. Preserve digits (and a leading `+`); strip only recognised
   formatting. The optional default code is 1–3 digits without `+`, applied only to national
   significant numbers. Reject national leading zero when a default is supplied, optional `(0)`
   notation, extensions, vanity numbers, and dialling/URI parameters. Without a default, national
   digits remain national and do not match international numbers. Callers must resolve unsupported
   national conventions before invoking this library; no country inference or trunk stripping.

3. **Identity and name equivalence** — `07-parity-backlog.md`, Contacts / Merge duplicates,
   and CON-L2 specify email/phone/WebID matches, with no fuzzy matching rule. Options: names as
   another identity signal or only the specified identities. Use only those identities; names
   have a standalone NFKC + Unicode default full case-fold helper and never join clusters.
   WebIDs compare as exact validated HTTP(S) identifiers (including fragments and path case),
   with no URL serialisation that might merge distinct RDF identifiers. Email supports bare ASCII
   dot-atom addresses with DNS domains, case-insensitive by the task's explicit rule; preserve
   dots and plus-tags. Reject quoted/EAI/domain-literal/URI forms instead of reinterpreting them.

4. **Cluster membership** — CON-L2 says a plan per cluster without specifying singletons.
   Options: return only duplicates or the complete partition. Return every cluster, including
   singletons, in ID order; a duplicate UI can filter on `contactIds.length > 1`.
