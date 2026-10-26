<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

1. MON-01 requests a PDF statement adapter (07-parity-backlog, Money / Existing data layer and imports), but the referenced PM adapter only accepts CSV/OFX/QFX. Options: add a PDF extraction dependency, or inject an extraction adapter. MON-00 takes the conservative dependency-free option: inject a PDF adapter returning validated import rows; no PDF layout/OCR implementation is invented.
2. Money / Open points leaves the currency default undecided. Options: locale inference or explicit account/import currency. MON-00 requires explicit currency and rejects mixed-currency ledgers/transfers.
3. MON-01 names transfer pairs without specifying pair identifiers. Options: introduce a new predicate or use two fin:Transfer subjects with the same fin:debitAccount/creditAccount and opposite signed amounts. MON-00 uses the existing finance predicates, stable caller-provided IDs and one monthly-shard PUT for both legs.
