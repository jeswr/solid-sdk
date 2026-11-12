// AUTHORED-BY Claude Opus 5.5
/**
 * Known-bank CSV imports write Suite Money's generated wire format (`@jeswr/solid-money`)
 * inside the connector container, sharded per account and month under a per-document budget:
 *
 *   finance/bank/<bank>-<account-slug>/account.ttl          #it  fin:FinancialAccount
 *   finance/bank/<bank>-<account-slug>/<YYYY-MM>.ttl        #txn-<sha256>  fin:Transaction
 *   finance/bank/<bank>-<account-slug>/<YYYY-MM>-part-<n>.ttl   (overflow, n ≥ 2)
 *
 * Each written document is read first, edited through MoneyDocument/putAccount/putTransaction
 * (upserting by deterministic subject, so re-imports are idempotent) and replaced under the
 * read's precondition. Every document is planned and measured before the first write.
 */
import {
  MoneyDocument,
  type Transaction as MoneyTransaction,
  monthKey,
  putAccount,
  putTransaction,
  V,
} from "@jeswr/solid-money";
import type { BlankNode, DatasetCore, Quad, Term } from "@rdfjs/types";
import { DataFactory, Store, Writer } from "n3";
import type { FileImportContext } from "../core/file-import.js";
import { Provenance } from "../core/provenance.js";

/** fetch-rdf's DEFAULT_MAX_BYTES (16 MiB) bounds every reader of these documents. */
const READER_MAX_BYTES = 16 * 1024 * 1024;
export interface BankDocumentBudget {
  /** Transactions per month document. */
  readonly transactions: number;
  /** Upper bound on the serialised document, measured as N-Triples plus provenance. */
  readonly bytes: number;
  /** Month documents per account and month (the first plus overflow parts). */
  readonly parts: number;
  /** Distinct accounts per import. */
  readonly accounts: number;
  /** Documents read per import: account documents, month documents and their parts. */
  readonly documents: number;
}
export const BANK_DOCUMENT_BUDGET: BankDocumentBudget = Object.freeze({
  transactions: 2_000,
  bytes: READER_MAX_BYTES / 4,
  parts: 1_000,
  accounts: 50,
  documents: 600,
});

export interface BankMoneyRecord {
  /** `<bank>-<sha256(account key)>`: one directory per account. */
  readonly accountSlug: string;
  readonly accountLabel: string;
  /** SHA-256 of the transaction key; the fragment of the transaction subject. */
  readonly identity: string;
  readonly postingTime: string;
  readonly description: string;
  readonly amount: string;
  readonly currency: string;
}

export class BankDocumentBudgetError extends Error {
  constructor(detail: string) {
    super(`Bank statement exceeds the document budget: ${detail}. Nothing was saved.`);
  }
}

interface Part {
  readonly slug: string;
  readonly url: string;
  readonly document: MoneyDocument;
  readonly existed: boolean;
  /** Subjects this run wrote: everything else in the document is carried forward. */
  readonly touched: Set<string>;
  count: number;
  bytes: number;
}
/** One account-month: its stored parts, plus the absent part probed after the last one. */
interface Month {
  readonly parts: Part[];
  absent?: Part;
}
interface PlannedDocument {
  readonly slug: string;
  readonly forClass: string;
  readonly document: MoneyDocument;
  readonly existed: boolean;
  readonly touched: Set<string>;
  readonly sourceUrl: string;
}

const RUNS = "_provenance.ttl";
const ROOT = "finance/bank/";

/** N-Triples is line-per-quad, so sizes add up; Turtle output is never larger (plus prefixes). */
const encoder = new TextEncoder();
function nTriplesBytes(quads: Iterable<Quad>): number {
  const writer = new Writer({ format: "N-Triples" });
  let bytes = 0;
  for (const quad of quads)
    bytes += encoder.encode(
      writer.quadToString(quad.subject, quad.predicate, quad.object, quad.graph),
    ).byteLength;
  return bytes;
}

/** A transaction's own quads plus its (blank) monetary amount node. */
function closure(dataset: DatasetCore, document: MoneyDocument, id: string): Quad[] {
  const subject = DataFactory.namedNode(id);
  const amount: Term | undefined = document.node(id).amountNode;
  return [
    ...dataset.match(subject),
    ...(amount?.termType === "BlankNode" ? dataset.match(amount) : []),
  ];
}

export class BankMoneyPlan {
  private readonly accounts = new Map<
    string,
    { label: string; months: Map<string, Map<string, BankMoneyRecord>> }
  >();
  /** Account plus account-month documents so far: a lower bound on the documents read. */
  private documents = 0;
  private loaded = 0;
  constructor(private readonly budget: BankDocumentBudget = BANK_DOCUMENT_BUDGET) {}

  /**
   * Later rows with the same identity replace earlier ones, as on re-import. The per-import
   * account and document budgets fail here, while parsing, before any Pod read.
   */
  add(record: BankMoneyRecord): void {
    let account = this.accounts.get(record.accountSlug);
    if (!account) {
      if (this.accounts.size >= this.budget.accounts)
        throw new BankDocumentBudgetError(
          `more than ${this.budget.accounts} accounts in one import`,
        );
      this.count();
      account = { label: record.accountLabel, months: new Map() };
      this.accounts.set(record.accountSlug, account);
    }
    const month = monthKey(record.postingTime);
    let rows = account.months.get(month);
    if (!rows) {
      this.count();
      rows = new Map();
      account.months.set(month, rows);
    }
    rows.delete(record.identity);
    rows.set(record.identity, record);
  }

  private count(): void {
    if (++this.documents > this.budget.documents)
      throw new BankDocumentBudgetError(
        `more than ${this.budget.documents} account and month documents in one import`,
      );
  }

  /**
   * Read and plan every document, check every budget, then write. A budget error is raised
   * before the first write; a write failure (e.g. 412) leaves earlier documents written, and
   * re-running the import converges because every write is an idempotent upsert.
   */
  async write(ctx: FileImportContext): Promise<void> {
    this.loaded = 0;
    const planned: PlannedDocument[] = [];
    const runs = ctx.resolve(RUNS).length;
    // Session provenance adds wasDerivedFrom/wasGeneratedBy to each new subject.
    const provenance = (subject: string) => 2 * subject.length + runs + 256;
    for (const [accountSlug, { label, months }] of this.accounts) {
      const directory = `${ROOT}${accountSlug}/`;
      const accountDocSlug = `${directory}account.ttl`;
      const sourceUrl = ctx.resolve(accountDocSlug);
      const account = `${sourceUrl}#it`;
      const accountPart = await this.load(ctx, accountDocSlug);
      putAccount(accountPart.document, { id: account, label });
      accountPart.touched.add(account);
      planned.push({ ...accountPart, forClass: V.accountClass, sourceUrl });
      for (const [month, rows] of [...months].sort(([a], [b]) => a.localeCompare(b))) {
        const state = await this.month(ctx, directory, month);
        const { parts } = state;
        const index = new Map<string, Part>();
        for (const part of parts)
          for (const node of part.document.nodes(V.transactionClass))
            if (node.value.startsWith(`${part.url}#txn-`))
              index.set(node.value.slice(part.url.length + 5), part);
        for (const record of rows.values()) {
          ctx.signal?.throwIfAborted();
          const existing = index.get(record.identity);
          let part = existing ?? (parts.at(-1) as Part);
          if (!existing && part.count >= this.budget.transactions)
            part = await this.extend(ctx, directory, month, state, index);
          const value = (target: Part): MoneyTransaction => ({
            id: `${target.url}#txn-${record.identity}`,
            account,
            derivedFrom: sourceUrl,
            postingTime: record.postingTime,
            description: record.description,
            amount: record.amount,
            currency: record.currency,
          });
          const put = (target: Part, isNew: boolean) => {
            const id = `${target.url}#txn-${record.identity}`;
            const before = isNew
              ? 0
              : nTriplesBytes(closure(target.document.dataset, target.document, id));
            putTransaction(target.document, value(target));
            const quads = closure(target.document.dataset, target.document, id);
            target.bytes += nTriplesBytes(quads) - before + (isNew ? provenance(id) : 0);
            if (isNew) target.count++;
            target.touched.add(id);
            return quads;
          };
          if (existing) {
            put(existing, false);
            if (existing.bytes > this.budget.bytes)
              throw new BankDocumentBudgetError(
                `updating ${existing.slug} would exceed ${this.budget.bytes} bytes`,
              );
            continue;
          }
          const quads = put(part, true);
          if (part.bytes > this.budget.bytes && part.count > 1) {
            // Split safely: undo this new subject and start the next part with it.
            const id = `${part.url}#txn-${record.identity}`;
            part.bytes -= nTriplesBytes(quads) + provenance(id);
            for (const quad of quads) part.document.dataset.delete(quad);
            part.count--;
            part.touched.delete(id);
            part = await this.extend(ctx, directory, month, state, index);
            put(part, true);
          }
          if (part.bytes > this.budget.bytes)
            throw new BankDocumentBudgetError(
              `one transaction in ${part.slug} exceeds ${this.budget.bytes} bytes`,
            );
          index.set(record.identity, part);
        }
        for (const part of parts)
          if (part.touched.size) planned.push({ ...part, forClass: V.transactionClass, sourceUrl });
      }
    }
    // Authoritative check of each whole document before the first write.
    for (const doc of planned) {
      const newSubjects = [...doc.touched].filter(
        (subject) => !doc.existed || !hasProvenance(doc.document.dataset, subject),
      );
      const bytes =
        nTriplesBytes(doc.document.dataset) +
        newSubjects.reduce((total, subject) => total + provenance(subject), 0) +
        provenance(ctx.resolve(doc.slug));
      if (bytes > this.budget.bytes)
        throw new BankDocumentBudgetError(`${doc.slug} would exceed ${this.budget.bytes} bytes`);
    }
    for (const doc of planned) {
      ctx.signal?.throwIfAborted();
      const subjects = new Set<string>();
      for (const quad of doc.document.dataset)
        if (quad.subject.termType === "NamedNode") subjects.add(quad.subject.value);
      ctx.progress({ label: "Saving to your pod…", done: 1, total: 1 });
      await ctx.write({
        slug: doc.slug,
        category: "finance",
        forClass: doc.forClass,
        dataset: doc.document.dataset,
        writeMode: "replace",
        registrationContainer: ROOT,
        // Suite Money validates wasDerivedFrom as an http(s) IRI: name the account document
        // rather than the session's file-export URN.
        sourceUrl: doc.sourceUrl,
        carriedForward: [...subjects].filter(
          (subject) => !doc.touched.has(subject) && subject !== ctx.resolve(doc.slug),
        ),
      });
    }
  }

  private async load(ctx: FileImportContext, slug: string): Promise<Part> {
    ctx.signal?.throwIfAborted();
    if (++this.loaded > this.budget.documents)
      throw new BankDocumentBudgetError(
        `more than ${this.budget.documents} documents to read in one import`,
      );
    const stored = await ctx.read(slug);
    ctx.signal?.throwIfAborted();
    const document = new MoneyDocument(stored ? compactBlankNodes(stored) : undefined);
    const url = ctx.resolve(slug);
    return {
      slug,
      url,
      document,
      existed: stored !== undefined,
      touched: new Set(),
      count: document.nodes(V.transactionClass).length,
      bytes:
        nTriplesBytes(document.dataset) +
        (stored ? 0 : 2 * url.length + ctx.resolve(RUNS).length + 256),
    };
  }

  /** Read the month's first document and each overflow part until one is absent. */
  private async month(ctx: FileImportContext, directory: string, month: string): Promise<Month> {
    const parts = [await this.load(ctx, partSlug(directory, month, 1))];
    while ((parts.at(-1) as Part).existed) {
      if (parts.length >= this.budget.parts)
        throw new BankDocumentBudgetError(`${month} has more than ${this.budget.parts} parts`);
      const next = await this.load(ctx, partSlug(directory, month, parts.length + 1));
      // Keep the absent probe: extend() opens it without reading it again.
      if (!next.existed) return { parts, absent: next };
      parts.push(next);
    }
    return { parts };
  }

  /** Open the next overflow part; an unexpected stored part keeps its records. */
  private async extend(
    ctx: FileImportContext,
    directory: string,
    month: string,
    state: Month,
    index: Map<string, Part>,
  ): Promise<Part> {
    const { parts } = state;
    for (;;) {
      if (parts.length >= this.budget.parts)
        throw new BankDocumentBudgetError(`${month} needs more than ${this.budget.parts} parts`);
      const part =
        state.absent ?? (await this.load(ctx, partSlug(directory, month, parts.length + 1)));
      state.absent = undefined;
      parts.push(part);
      for (const node of part.document.nodes(V.transactionClass))
        if (node.value.startsWith(`${part.url}#txn-`))
          index.set(node.value.slice(part.url.length + 5), part);
      if (part.count < this.budget.transactions && part.bytes < this.budget.bytes) return part;
    }
  }
}

function partSlug(directory: string, month: string, part: number): string {
  return `${directory}${month}${part === 1 ? "" : `-part-${part}`}.ttl`;
}

/**
 * Turtle parsers prefix stored blank-node labels on every read (`_:b0` → `_:b3_b0`), so a
 * read-modify-write would lengthen each amount node's label per import. Relabel them to
 * short document-local labels, preserving every quad's structure.
 */
function compactBlankNodes(dataset: DatasetCore): Store {
  const labels = new Map<string, BlankNode>();
  const relabel = <T extends Term>(term: T): T => {
    if (term.termType !== "BlankNode") return term;
    let node = labels.get(term.value);
    if (!node) {
      node = DataFactory.blankNode(`l${labels.size}`);
      labels.set(term.value, node);
    }
    return node as unknown as T;
  };
  const result = new Store();
  for (const quad of dataset)
    result.add(
      DataFactory.quad(
        relabel(quad.subject),
        quad.predicate,
        relabel(quad.object),
        relabel(quad.graph),
      ),
    );
  return result;
}

function hasProvenance(dataset: DatasetCore, subject: string): boolean {
  return new Provenance(subject, dataset, DataFactory).generatedBy.size > 0;
}
