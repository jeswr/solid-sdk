// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// MoneyStore — the pod-shaped read / write / list layer. Wires:
//   - @jeswr/fetch-rdf  → GET + content-type-dispatched parse (read)
//   - the typed wrappers → extract entities from the parsed dataset
//   - n3.Writer          → serialise on the write path
//   - conditional PUT    → If-Match on the ETag from the read (lost-update-safe)
//
// Pod-shaped: finance resources live in a container under the pod
// (`<base>finance/`); the app's primary class (fin:Transaction) is registered
// in the public type index so peers can discover the data.
//
// The HTTP surface (`fetch`) and the RDF reader (`fetchRdf`) are injectable so
// the whole store is unit-testable without a live pod; auth is the ambient
// `globalThis.fetch` patched by @solid/reactive-authentication in production.

import { fetchRdf as defaultFetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { Store } from "n3";
import {
  type AccountKind,
  type AccountStatus,
  FinanceDocument,
  type TransactionKind,
} from "./model.js";
import { DataFactory, serialiseTurtle } from "./serialise.js";
import { TypeIndexDataset } from "./typeIndex.js";
import { FinClass, SolidTerm } from "./vocab.js";

/** The slot under the pod root where Pod Money keeps its finance container. */
export const FINANCE_PATH = "finance/" as const;
/** The resource (inside the finance container) that holds the account ledger. */
export const LEDGER_RESOURCE = "ledger.ttl" as const;
/** Conventional public type-index location relative to the pod root. */
export const PUBLIC_TYPE_INDEX_PATH = "settings/publicTypeIndex.ttl" as const;

/** The narrow shape of `@jeswr/fetch-rdf`'s `fetchRdf` the store depends on. */
export type FetchRdf = typeof defaultFetchRdf;

export interface MoneyStoreOptions {
  /** The pod root URL (must end in `/`), e.g. "https://alice.pod.example/". */
  podRoot: string;
  /** The RDF reader. Defaults to the published `@jeswr/fetch-rdf` `fetchRdf`. */
  fetchRdf?: FetchRdf;
  /** The HTTP `fetch` used for PUTs. Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
}

/** A read result: the typed document view plus the ETag for a conditional write. */
export interface LoadedDocument {
  document: FinanceDocument;
  /** The underlying mutable dataset (n3.Store). */
  dataset: DatasetCore;
  /** Strong validator for a lost-update-safe write; `null` if the server sent none. */
  etag: string | null;
  /**
   * Whether the resource existed at read time. Tracked SEPARATELY from `etag`
   * because a degraded server (e.g. legacy NSS) returns an existing resource
   * with NO ETag — `etag === null` alone cannot distinguish "absent" from
   * "exists but un-validatable". The write path needs this to avoid sending
   * `If-None-Match: *` (a create precondition) against an existing resource,
   * which such a server would reject with 412 forever.
   */
  exists: boolean;
  /** The resource URL the document was read from. */
  url: string;
}

/**
 * The read state a conditional write is made against — the ETag and whether the
 * resource existed. These are independent: a degraded server can return an
 * existing resource with no ETag.
 */
export interface WriteCondition {
  /** The strong validator from the read, or `null` if the server sent none. */
  etag: string | null;
  /** Whether the resource existed at read time. */
  exists: boolean;
}

/** Inputs for minting a new account. */
export interface NewAccount {
  /** Account IRI (absolute, or a fragment to mint under the ledger). */
  iri: string;
  kind: AccountKind;
  label?: string;
  status?: AccountStatus;
}

/** Inputs for minting a new transaction. */
export interface NewTransaction {
  iri: string;
  kind: TransactionKind;
  /** The owning account IRI. */
  account: string;
  amount: number;
  currency: string;
  /** The monetary-amount node IRI (a sibling subject). */
  amountIri: string;
  postingTime: Date;
  category?: string;
  counterparty?: string;
}

/**
 * The pod-shaped data access object for Pod Money. One instance per pod root.
 */
export class MoneyStore {
  readonly podRoot: string;
  readonly #fetchRdf: FetchRdf;
  readonly #fetch: typeof fetch;

  constructor(options: MoneyStoreOptions) {
    if (!options.podRoot.endsWith("/")) {
      throw new TypeError(`podRoot must end with '/': ${options.podRoot}`);
    }
    this.podRoot = options.podRoot;
    this.#fetchRdf = options.fetchRdf ?? defaultFetchRdf;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  /** The finance container URL (`<podRoot>finance/`). */
  get financeContainer(): string {
    return new URL(FINANCE_PATH, this.podRoot).toString();
  }

  /** The ledger resource URL (`<podRoot>finance/ledger.ttl`). */
  get ledgerUrl(): string {
    return new URL(LEDGER_RESOURCE, this.financeContainer).toString();
  }

  /** The public type-index URL (`<podRoot>settings/publicTypeIndex.ttl`). */
  get publicTypeIndexUrl(): string {
    return new URL(PUBLIC_TYPE_INDEX_PATH, this.podRoot).toString();
  }

  /**
   * Read an RDF resource into a typed `FinanceDocument`. A 404 yields an EMPTY
   * document (`exists: false`, `etag: null`) so a caller can mint into it and
   * PUT to create. An existing resource reports `exists: true` regardless of
   * whether the server supplied an ETag. Any other failure re-throws.
   */
  async load(url: string): Promise<LoadedDocument> {
    try {
      const { dataset, etag, url: finalUrl } = await this.#fetchRdf(url);
      return {
        document: new FinanceDocument(dataset, DataFactory),
        dataset,
        etag,
        exists: true,
        url: finalUrl,
      };
    } catch (error) {
      if (error instanceof RdfFetchError && error.status === 404) {
        const empty = new Store();
        return {
          document: new FinanceDocument(empty, DataFactory),
          dataset: empty,
          etag: null,
          exists: false,
          url,
        };
      }
      throw error;
    }
  }

  /** Read the account ledger. */
  loadLedger(): Promise<LoadedDocument> {
    return this.load(this.ledgerUrl);
  }

  /**
   * Conditionally write a dataset back to `url` as Turtle. The precondition is
   * chosen from the read state, NOT the ETag alone:
   *
   *   - ETag present              → `If-Match: <etag>` (lost-update-safe update).
   *   - existed, but no ETag      → unconditional PUT (degraded server, e.g.
   *                                 legacy NSS, that omits ETags — sending
   *                                 `If-None-Match: *` here would 412 forever).
   *   - did NOT exist             → `If-None-Match: *` (create that never
   *                                 clobbers a concurrently-created resource).
   *
   * A 412 surfaces as a `PreconditionFailedError` for the caller to re-read and
   * retry. `condition` defaults to a create when omitted.
   */
  async save(
    url: string,
    dataset: DatasetCore,
    condition: WriteCondition = { etag: null, exists: false },
  ): Promise<Response> {
    const body = await serialiseTurtle(dataset);
    const headers: Record<string, string> = { "content-type": "text/turtle" };
    if (condition.etag) headers["if-match"] = condition.etag;
    else if (!condition.exists) headers["if-none-match"] = "*";
    // existed but no ETag → unconditional PUT (no precondition header).

    const response = await this.#fetch(url, { method: "PUT", headers, body });
    if (response.status === 412) {
      throw new PreconditionFailedError(url, condition.etag);
    }
    if (!response.ok) {
      throw new WriteError(url, response.status);
    }
    return response;
  }

  /**
   * List every account in the ledger as a plain projection (id + kind + status
   * + label). Pure read; resolves to an empty array if the ledger is absent.
   */
  async listAccounts(): Promise<
    {
      id: string;
      kind: AccountKind | undefined;
      status: AccountStatus | undefined;
      label: string | undefined;
    }[]
  > {
    const { document } = await this.loadLedger();
    const out = [];
    for (const acc of document.accounts) {
      out.push({ id: acc.value, kind: acc.kind, status: acc.status, label: acc.label });
    }
    return out;
  }

  /**
   * List every transaction in the ledger as a plain projection, resolving the
   * monetary amount node into `{ amount, currency }`.
   */
  async listTransactions(): Promise<
    {
      id: string;
      kind: TransactionKind | undefined;
      account: string | undefined;
      category: string | undefined;
      postingTime: Date | undefined;
      amount: number | undefined;
      currency: string | undefined;
    }[]
  > {
    const { document } = await this.loadLedger();
    const out = [];
    for (const txn of document.transactions) {
      const money = document.resolveAmount(txn.monetaryAmount);
      out.push({
        id: txn.value,
        kind: txn.kind,
        account: txn.account,
        category: txn.category,
        postingTime: txn.postingTime,
        amount: money?.amount,
        currency: money?.currency,
      });
    }
    return out;
  }

  /**
   * Read-modify-write a new account into the ledger and PUT it back.
   * Conditional on the read state (ETag / existence). Returns the write `Response`.
   */
  async addAccount(account: NewAccount): Promise<Response> {
    const { document, dataset, etag, exists } = await this.loadLedger();
    const acc = document.mintAccount(account.iri);
    acc.kind = account.kind;
    if (account.label !== undefined) acc.label = account.label;
    acc.status = account.status ?? "Active";
    return this.save(this.ledgerUrl, dataset, { etag, exists });
  }

  /**
   * Read-modify-write a new transaction (and its monetary-amount node) into the
   * ledger and PUT it back. Conditional on the read state (ETag / existence).
   */
  async addTransaction(txn: NewTransaction): Promise<Response> {
    const { document, dataset, etag, exists } = await this.loadLedger();
    const money = document.mintMonetaryAmount(txn.amountIri);
    money.amount = txn.amount;
    money.currency = txn.currency;

    const t = document.mintTransaction(txn.iri);
    t.kind = txn.kind;
    t.account = txn.account;
    t.monetaryAmount = txn.amountIri;
    t.postingTime = txn.postingTime;
    if (txn.category !== undefined) t.category = txn.category;
    if (txn.counterparty !== undefined) t.counterparty = txn.counterparty;

    return this.save(this.ledgerUrl, dataset, { etag, exists });
  }

  /**
   * Ensure Pod Money's primary class (fin:Transaction) is registered in the
   * public type index, pointing at the finance container. Read-modify-write:
   * reads the index (creating an empty one if absent), marks the document a
   * type index, adds an idempotent registration, and PUTs it back conditional
   * on the read state.
   */
  async registerInTypeIndex(): Promise<Response> {
    const url = this.publicTypeIndexUrl;
    const { dataset, etag, exists } = await this.load(url);
    const index = new TypeIndexDataset(dataset, DataFactory);
    index.markIndex(url, "public");
    index.register(url, "#registration-pod-money-transactions", FinClass.Transaction, {
      container: this.financeContainer,
    });
    return this.save(url, dataset, { etag, exists });
  }

  /**
   * Discover where a class is stored in this pod via the public type index.
   * Returns the registered locations (empty if the index or class is absent).
   * Discovery is a HINT, not a grant — the caller must still GET the resource.
   */
  async discover(classIri: string): Promise<{ instance?: string; container?: string }[]> {
    const { dataset } = await this.load(this.publicTypeIndexUrl);
    return new TypeIndexDataset(dataset, DataFactory).locate(classIri);
  }

  /** The IRI of Pod Money's primary class (for federation declarations). */
  static get primaryClass(): string {
    return FinClass.Transaction;
  }

  /** The solid:forClass IRI used when registering. */
  static get typeIndexForClass(): string {
    return SolidTerm.forClass;
  }
}

/** A conditional write failed its precondition (concurrent modification). */
export class PreconditionFailedError extends Error {
  readonly url: string;
  readonly etag: string | null;
  constructor(url: string, etag: string | null) {
    super(`Precondition failed writing ${url} (etag ${etag ?? "<none>"}); re-read and retry.`);
    this.name = "PreconditionFailedError";
    this.url = url;
    this.etag = etag;
  }
}

/** A non-2xx, non-412 write response. */
export class WriteError extends Error {
  readonly url: string;
  readonly status: number;
  constructor(url: string, status: number) {
    super(`Write to ${url} failed with status ${status}.`);
    this.name = "WriteError";
    this.url = url;
    this.status = status;
  }
}
