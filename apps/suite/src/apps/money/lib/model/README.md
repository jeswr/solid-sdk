<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Money model (MON-00)

Hook-free finance model for MON-01. No React, shell or suite-sdk imports, and no ambient fetch. Ported from Pod Money's typed finance wrappers, vocabulary migration and latest-balance helper; reuses the suite's MON-L1 CSV mapping / OFX parsers rather than PM's older schema:Invoice projection. All new RDF is built with @rdfjs/wrapper and serialised with @jeswr/rdf-serialize. The tests include the existing synthetic CSV, SGML OFX and XML OFX fixtures.

Import from `./index`. `MoneyDocument` wraps an RDF dataset; `parseMoney` reads Turtle with relative IRIs resolved against its document URL; `serialiseMoney` writes it. Store reads also accept TriG and JSON-LD, retaining their graph names in memory. Serialization and store writes reject datasets containing named graphs before sending any PUT, because the write format is Turtle. `putAccount`, `putBalance`, `putTransaction` and `putCategories` validate records before mutation. The document exposes typed `accounts()`, `balances()`, `transactions()` and `categories()` snapshots. `MoneyNode` is the lower-level typed accessor for partial document edits. Unknown RDF is preserved. Malformed/incomplete required data throws, rather than inventing a zero amount. Monetary amount references accept named and blank nodes.

Writers use canonical suite namespaces, `fin:MonetaryAmount` with decimal `schema:value` and `schema:currency`, `fin:BudgetCategory` and `skos:broader`. Readers also accept the older `fin:amount` / `fin:currency`, finance namespace aliases, `pm:Category` and `pm:parent`. Migration changes vocabulary in memory and on the next explicit save; resource IDs, literal content and graph names are preserved. Existing account/transaction/point-in-time-balance associations retain Pod Money's canonical `pm:` predicates because the sector does not supply replacements. Category trees reject duplicate IDs, orphan parents and cycles. `putCategories` upserts a complete validated tree; to replace/delete categories, build a new category document and conditionally write it.

New monetary amounts use blank nodes to avoid collisions with record IRIs. Updates reuse an existing amount only when it belongs exclusively to that record; editing a shared amount assigns a separate node. Deleting a legacy transaction that also serves as another record's amount preserves the monetary predicates still in use.

Money amounts are decimal strings, with exact arbitrary-precision addition. Currency is an explicit uppercase three-letter code, without currency inference or exchange conversion. Timestamps are UTC ISO dates or instants; range endpoints are inclusive. `monthKey` and `monthKeys` route `transactions/<yyyy-mm>.ttl`. `runningBalance` sorts by posting time then ID, selects one account, includes earlier supplied transactions when computing the displayed range and rejects mixed currencies. Its opening amount precedes all supplied rows. `latestBalance` prefers dated balances, keeps the first on equal timestamps and uses an undated balance only until a dated one is available.

```ts
const store = createMoneyStore(authenticatedFetch, "https://pod.example/money/");
const accounts = await store.accounts(); // accounts/ listing; latest Balance across its documents
const ledger = await store.transactions(accountId, {
  start: "2026-10-10", end: "2026-10-31T23:59:59Z",
}, { amount: "100", currency: "GBP" });
// Opening amount above is immediately before October's shard, including Oct 1–9.
const categories = await store.read("categories.ttl");
putCategories(categories.document, categoryRecords);
await store.write("categories.ttl", categories.document, categories.condition);
```

The caller provisions the money container and its accounts/, transactions/ and statements/ children with the intended access controls. This model does not discover Type Index entries or bootstrap sharing. Store I/O is restricted to that configured container, refuses redirects and uses injected fetch for both reads and writes. Only 404 means absent. Existing documents require a strong ETag (`If-Match`); creation uses `If-None-Match: *`. Missing/weak validators, network errors and server conflicts propagate. `MoneyIoError.status` preserves write failures; reads preserve fetch-rdf's typed errors for later hook adapters.

`saveTransactions` merges each affected shard while retaining unrelated RDF. Existing transaction IDs must stay in their posting month's shard. Cross-month moves are explicit delete/create operations, not an implicit two-document transaction. `deleteTransaction` removes the record and its unreferenced monetary amount. `transfer` writes two fin:Transfer subjects, `<id>-debit` / `<id>-credit`, with equal opposing amounts and both `fin:debitAccount` / `fin:creditAccount`, in one conditional shard PUT. Existing pair IDs are rejected. Generic mutations refuse to edit/delete one transfer leg; paired editing is outside MON-00.

`importStatement(store, importId, accountId, currency, statement)` accepts mapped CSV, OFX/QFX text, or `{ format: "pdf", file, adapter }` with an injected `PdfStatementAdapter`. The referenced PM adapter has no PDF parser: the injected adapter must extract inert MON-L1 `ImportedTransaction` rows. All rows validate before writes. The original is stored under `statements/<importId>.<format>` before any shard writes, and every transaction receives `prov:wasDerivedFrom` pointing to it. Row IDs derive from the caller's stable import ID, statement format and row index, so distinct originals cannot overwrite each other's rows. Currency mismatches fail before storage. Account ID selection is explicit; OFX account numbers are not treated as pod IRIs. Category label resolution and duplicate-review UI stay in MON-01; the importer does not guess category IRIs or automatically drop duplicate purchases.

A statement import can span several shards. Solid has no cross-document transaction: a later conflict propagates and leaves the original plus already saved shards intact. Reusing an existing statement ID fails its create precondition instead of replacing provenance. The caller can inspect the original and deterministic row IDs to review/recover partial imports; no automatic retry or rollback is claimed.
