<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# SHT-00 questions

1. **Type Index boundary** (07-parity-backlog, Sheets storage; 00-sdk-assumptions A-20;
   08-model-first). Should this model bootstrap/link a missing index, or should SHT-01 use
   the forthcoming SDK Type Index service? Conservative implementation: register the
   spreadsheet's `index.ttl#it` as `solid:instance` in a caller-selected existing index,
   preserving its full dataset and using its ETag. Discovery, index creation/linking,
   container creation and bounded conflict retry remain with the SDK/hook integration.
2. **Column descriptor predicates** (07-parity-backlog, Sheets data mapping). The spec
   names column name, inferred type and format but does not select predicates for type
   and format. Options include CSVW terms or existing schema.org terms. Conservative
   implementation uses `schema:PropertyValue`, `schema:name`, `schema:additionalType`
   (XSD string/double/dateTime), `schema:encodingFormat` (text/number/date-time), and
   `schema:position` (one-based order), linked with `schema:variableMeasured`. No new
   vocabulary or engine schema is introduced. Confirm this mapping for SHT-01.
