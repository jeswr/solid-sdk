<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Money model integration (MON-00)

The shared RDF model is generated in [`@jeswr/solid-money`](../../../../../../../packages/solid-money/README.md). This directory keeps only app storage and statement-import orchestration, plus a compatibility re-export for the original tests. The package README lists exact divergences and generator gaps.

Hook-free finance integration for MON-01. No React, shell or suite-sdk imports, and no ambient fetch. Ported from Pod Money's typed finance wrappers, vocabulary migration and latest-balance helper; reuses the suite's MON-L1 CSV mapping / OFX parsers rather than PM's older schema:Invoice projection. All new RDF is built by the shared generated model and its documented compatibility views and serialised with @jeswr/rdf-serialize. The tests include the existing synthetic CSV, SGML OFX and XML OFX fixtures.

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

`saveTransactions` merges each affected shard while retaining unrelated RDF. Existing transaction IDs must stay in their posting month's shard. Cross-month moves are explicit delete/create operations, not an implicit two-document transaction. `deleteTransaction(fragment, postingTime)` removes the record and its unreferenced monetary amount. It accepts complete generated fragments, including format/index suffixes beyond the 128-character limit on caller-supplied statement/transaction keys; fragments still require the same alphanumeric, hyphen and underscore syntax. `transfer` writes two fin:Transfer subjects, `<id>-debit` / `<id>-credit`, with equal opposing amounts and both `fin:debitAccount` / `fin:creditAccount`, in one conditional shard PUT. Existing pair IDs are rejected. Generic mutations refuse to edit/delete one transfer leg; paired editing is outside MON-00.

`importStatement(store, importId, accountId, currency, statement)` accepts mapped CSV, OFX/QFX text, or `{ format: "pdf", file, adapter }` with an injected `PdfStatementAdapter`. The referenced PM adapter has no PDF parser: the injected adapter must extract inert MON-L1 `ImportedTransaction` rows. All rows validate before writes. The original is stored under `statements/<importId>.<format>` before any shard writes, and every transaction receives `prov:wasDerivedFrom` pointing to it. Row IDs derive from the caller's stable import ID, statement format and row index, so distinct originals cannot overwrite each other's rows. Currency mismatches fail before storage. Account ID selection is explicit; OFX account numbers are not treated as pod IRIs. Imports containing multiple source account IDs, including a known ID mixed with unidentified rows, fail before any request; export each account separately. Repeated statement sections for the same source account are accepted. Category label resolution and duplicate-review UI stay in MON-01; the importer does not guess category IRIs or automatically drop duplicate purchases.

A statement import can span several shards. Solid has no cross-document transaction: a later conflict propagates and leaves the original plus already saved shards intact. Reusing an existing statement ID fails its create precondition instead of replacing provenance. The caller can inspect the original and deterministic row IDs to review/recover partial imports; no automatic retry or rollback is claimed.

## Monthly budgets

`budget.ts` adds typed wrapper accessors for `money/budgets/YYYY-MM.ttl`. Each shard has one
`fin:Budget` at `#budget`, `schema:temporalCoverage` naming its month, and `schema:hasPart`
links to assignment nodes. Each assignment uses `schema:about` for the existing
`fin:BudgetCategory` IRI and the existing `fin:hasMonetaryAmount` accessor for a
`fin:MonetaryAmount` (`schema:value` decimal and `schema:currency`). The finance sector
has no assignment membership/category predicates, so these standard schema.org terms
express those links without adding vocabulary. Assignments are unique by category/currency.
Unknown RDF is retained. Writes upsert assignments by category/currency, updating existing
nodes in place regardless of which program created them. Unmentioned assignment links are
retained, so no assignment nodes are orphaned; clear an assignment by setting its amount to
zero. Amount nodes use the shared-money protection described above.

The data adapter discovers shards from `budgets/`, or loads an explicit inclusive month range
(404 means no assignments). It runs the existing envelope engine from the earliest recorded
budget or transaction month (or the selected month if earlier) through the later of the selected
month and the latest stored budget month, inserting empty months. Income is counted only in its
own month. Ready to assign is the minimum unassigned pool per currency over the selected month
and every later computed month, while envelopes retain the selected month's values. Later
assignments reduce an earlier month's pool only to the extent that later income cannot cover
them; later income or releases cannot hide an earlier shortfall. This applies to both the budget
page and Overview; negative pools show over-assignment. Selection extends from 12 months before
the earlier of today and the earliest recorded budget/transaction month through 12 months after
the later of today and the latest recorded month. Today stays within the bounds even when all
records are future-dated. Out-of-range links show this month with an explanation.
Opening pools and envelopes are zero; point-in-time account balance snapshots are not treated
as income.
Both positive and negative envelope balances roll forward. Transfers are excluded. Categories
named Income (case insensitive) and their descendants are income categories; their signed
activity represents income/reversals. All other category IRIs, including deleted categories,
receive signed spending/refunds in their own envelopes. Retained income-category assignments
and removed categories are visible and editable in the other/removed section.
Uncategorised positive amounts are income; uncategorised outflows are flagged for categorisation
and excluded from envelope totals until assigned a category. Currencies supported by the budget
engine stay separate; unsupported currencies or inexact stored amounts produce an explicit error.
Patches compare the edited envelopes with their displayed values, retain other assignments,
and use strong ETags/create preconditions. On 412 only an already fulfilled intent succeeds;
other changes are surfaced without overwriting them. Copying a month requires a target whose
assignments are absent or all zero; any concurrent nonzero assignment still prevents copying.
