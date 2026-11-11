<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
# @jeswr/solid-money

Shared, browser-safe finance RDF model extracted from Suite Money. Account, category,
transaction (including standalone Transfer, Payment and CardPayment), balance association,
and currency fields are generated from the ontology and finance-sector compatibility
profile in `codegen/`, using `@jeswr/federation-codegen` and `@jeswr/model-runtime`.
Vocabulary constants come from `@jeswr/suite-vocab`; every existing written IRI is retained.

```ts
import { MoneyDocument, putTransaction, serialiseMoney, parseMoney } from "@jeswr/solid-money";
const document = new MoneyDocument();
putTransaction(document, {
  id: "https://pod.example/money/transactions/2026-10.ttl#one",
  account: "https://pod.example/money/accounts/current.ttl#it",
  amount: "-12.50", currency: "GBP", postingTime: "2026-10-24", description: "Market",
});
const turtle = await serialiseMoney(document);
const back = await parseMoney(turtle, "https://pod.example/money/transactions/2026-10.ttl");
```

Depend on `"@jeswr/solid-money": "workspace:*"`. `MoneyDocument` exposes `accounts()`,
`balances()`, `transactions()` and `categories()`. `putAccount`, `putBalance`,
`putTransaction`, `putCategories` and `createTransfer` validate domain policy before writes.
`MoneyNode` preserves the public partial-edit API using generated property descriptors;
it implements only the representation gaps below locally. `addAmounts`, `runningBalance`,
`latestBalance`, category-tree validation, month routing and statement value parsers are
pure shared helpers. Fetch, storage preconditions, statement imports, React and UI remain
in `apps/suite`; the package has no network I/O.

Build/parse of generated fields delegates to `entities.*`; writes upsert just their
manifest-declared predicates, preserving other subjects, types and unknown data. Partial
setters invoke the generated descriptors on an outgoing-subject Store before applying the
patch, so appending a shard does not scan all its records or exhaust the runtime migration
budget. This profile has no generated aliases or composite links. Namespace migration is
the existing vocabulary-only operation (preserving IDs, literals and graph identities).
Serialization retains the existing `@jeswr/rdf-serialize`/`n3.Writer` document boundary,
including unknown and unprofiled literals; named graphs are rejected for Turtle writes.

## Generator gaps and profile scope

`codegen/money.shapes.ttl` documents every omission and narrowing from
`solid-federation-vocab/sectors/finance/finance.shacl.ttl`. This package preserves the app's
wire format; it does not claim full sector conformance or invent absent account holders,
payers, allocations, instruments or ledger records.

- **Blank nodes** (sst-ild.4.11): generated wrappers and composite links require named subjects/IRIs.
  Existing `fin:hasMonetaryAmount` objects and new amount subjects are blank nodes.
  `MoneyNode.amountNode` keeps a typed RDF term; generated currency/label descriptors also
  work on the compatibility view's blank subjects. Allocation reserves existing subject,
  object and graph blank labels; updates isolate shared or self-referencing amount nodes.
- **Exact numbers:** runtime decimal projection is a JS number. Money uses arbitrary
  precision decimal strings and preserves trailing zeros. `MoneyNode.amount` uses typed
  decimal writes and the original lexical numeric reader, including legacy integer,
  decimal, float, double and plain-string values; no significand passes through Number.
- **Dates** (logical datatype unions: sst-ild.4.3.2): closed admission cannot express the date/dateTime/plain-string union with
  exact lexical string projection. `postingTime`/`asOf` stay typed view accessors;
  timestamp validation preserves date-only values and exact UTC instant spellings.
- **Currency pattern** (sst-ild.4.11): admission accepts only a small fixed pattern inventory, excluding
  `^[A-Z]{3}$`. The existing `validateMoney` enforces the uppercase three-letter code.
- **Aliases across shared predicates:** generated alias ownership cannot cover this app's
  global suite namespace migration or co-typed/shared field predicates. `migrateMoney`
  retains the existing vocabulary-only mapping, including pm:Category/pm:parent and
  graph names. The amount view preserves fin:amount/fin:currency reads and clears those
  legacy predicates on explicit setters.

Category cycles/orphans, exact arithmetic, transfer pair policy, amount ownership and
inclusive UTC ranges are domain policy outside SHACL and stay in the package facade.

## Exact divergences

Pinned in `test/compatibility.test.ts`; the copied 43-case model oracle passes verbatim
apart from import paths. The app oracle remains untouched.

- Generated required labels accept exactly one `xsd:string`; language-tagged, numeric or
  ambiguous labels now reject the snapshot instead of projecting the first literal's text.
- Malformed or ambiguous optional descriptions drop, using the existing `Transaction`
  default. Optional IRI fields (including category parents) drop instead of throwing or
  choosing the first term. Ambiguous required account links reject the record.
- Canonical `schema:currency` must be one `xsd:string`; language-tagged currencies no longer
  project. Existing `fin:currency` fallback reads still use their historical literal view.
- Generated text builds/setters strip control characters. Public `types.add` rejects an
  unsafe type IRI immediately, before changing the dataset.
- Generated record snapshots require safe absolute named subject IDs. The public partial
  view still supports blank subjects (including monetary nodes), but a blank account
  or balance root that previously projected now rejects its snapshot.

Exact amounts, blank-node money, lexical dates, standalone transaction subclasses,
namespace migration, original resource IDs and unknown RDF retain their oracle behavior.

## Regeneration and validation

```sh
export PATH=/opt/node24/bin:$PATH
pnpm --filter @jeswr/federation-codegen... run build
pnpm --filter @jeswr/solid-money run codegen --update-lock
pnpm exec turbo run lint build typecheck test --filter=@jeswr/solid-money --filter=@jeswr/app-suite
pnpm run lint:root
```

Never edit `src/generated/`. `test/codegen.test.ts` regenerates every artifact, including
its input/output lock, and compares bytes. Build copies the generated JS and declarations
into `dist/generated/`. `dist/` is never committed. This new package has no mirror configured.
