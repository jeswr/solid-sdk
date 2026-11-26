// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { NS } from "@jeswr/suite-vocab";
import type { BlankNode, DatasetCore, Term } from "@rdfjs/types";
import { LiteralAs, OptionalFrom, TermAs } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { entities } from "./generated/model.js";
import { categoryTree } from "./helpers.js";
import { migrateMoney } from "./migration.js";
import { MoneyNode, rdfAmount, singleValue } from "./node.js";
import { optionalLinks, required } from "./records.js";
import type { Account, Balance, Category, Money, Transaction, TransactionLink } from "./types.js";
import { instant, validateMoney, validateTransaction } from "./validation.js";
import { V } from "./vocab.js";

const OPTIONAL_LINKS: readonly TransactionLink[] = [
  "category",
  "payee",
  "derivedFrom",
  "debitAccount",
  "creditAccount",
];

export class MoneyDocument {
  readonly dataset: DatasetCore;
  private readonly blankLabels = new Set<string>();
  private nextBlankLabel = 0;
  constructor(dataset: DatasetCore = new Store()) {
    this.dataset = migrateMoney(dataset);
    for (const quad of this.dataset)
      for (const term of [quad.subject, quad.object, quad.graph])
        if (term.termType === "BlankNode") this.blankLabels.add(term.value);
  }
  allocateAmountNode(): BlankNode {
    let node: BlankNode;
    do {
      node = DataFactory.blankNode(`b${this.nextBlankLabel++}`);
      // The public dataset/accessors may introduce labels after construction.
    } while (
      this.blankLabels.has(node.value) ||
      this.dataset.match(node, null, null).size > 0 ||
      this.dataset.match(null, null, node).size > 0 ||
      this.dataset.match(null, null, null, node).size > 0
    );
    this.blankLabels.add(node.value);
    return node;
  }
  node(id: string | Term): MoneyNode {
    return new MoneyNode(
      typeof id === "string" ? DataFactory.namedNode(id) : id,
      this.dataset,
      DataFactory,
    );
  }
  nodes(type: string): MoneyNode[] {
    const subjects = new Set<string>();
    const nodes: MoneyNode[] = [];
    for (const quad of this.dataset.match(
      null,
      DataFactory.namedNode(V.type),
      DataFactory.namedNode(type),
    )) {
      if (subjects.has(quad.subject.value)) continue;
      subjects.add(quad.subject.value);
      nodes.push(this.node(quad.subject));
    }
    return nodes;
  }
  accounts(): Account[] {
    return this.nodes(V.accountClass).map((node) => ({
      id: node.value,
      label: required(entities.Account.parse(node.value, this.dataset)).label,
    }));
  }
  money(node: MoneyNode): Money {
    const amount = this.node(required(node.amountNode));
    // Pod Money's previous fin:amount/fin:currency remain readable.
    const value = {
      amount: required(amount.amount ?? singleValue(amount, `${NS.FINANCE}amount`, rdfAmount)),
      currency: required(
        this.dataset.match(TermAs.term(amount), DataFactory.namedNode(V.currency)).size
          ? amount.currency
          : OptionalFrom.subjectPredicate(amount, `${NS.FINANCE}currency`, LiteralAs.string),
      ),
    };
    validateMoney(value);
    return value;
  }
  balances(): Balance[] {
    return this.nodes(V.balanceClass).map((node) => {
      const asOf = node.asOf;
      if (asOf !== undefined) instant(asOf);
      return {
        id: node.value,
        account: required(entities.Balance.parse(node.value, this.dataset)).balanceAccount,
        ...this.money(node),
        ...(asOf === undefined ? {} : { asOf }),
      };
    });
  }
  transactions(): Transaction[] {
    // Standalone Transfer/Payment classes occur in older finance producers.
    const nodes = new Map<string, MoneyNode>();
    for (const type of [
      V.transactionClass,
      V.transferClass,
      `${NS.FINANCE}Payment`,
      `${NS.FINANCE}CardPayment`,
    ])
      for (const node of this.nodes(type)) nodes.set(node.value, node);
    return [...nodes.values()].map((node) => {
      const entity = [
        entities.Transaction,
        entities.Transfer,
        entities.Payment,
        entities.CardPayment,
      ].find((entity) => node.types.has(entity.typeIri));
      const core = required(required(entity).parse(node.value, this.dataset));
      const unreadableLinks = this.unreadableLinks(node, core);
      const result: Transaction = {
        id: node.value,
        account: core.account,
        postingTime: required(node.postingTime),
        description: core.description ?? "Transaction",
        ...this.money(node),
        ...optionalLinks(core),
        ...(unreadableLinks.length ? { unreadableLinks } : {}),
      };
      validateTransaction(result);
      return result;
    });
  }
  /**
   * A present optional link that does not project would be erased by the next save, so a
   * save of that record is refused. Reads still list the record without the link: one bad
   * link must not make the rest of the ledger unreadable.
   */
  assertLinksReadable(node: MoneyNode, core: Partial<Transaction>): void {
    if (this.unreadableLinks(node, core).length) throw new TypeError("Invalid transaction link");
  }
  /** The present optional links of `node` that `core` (its projection) does not carry. */
  unreadableLinks(node: MoneyNode, core: Partial<Transaction>): TransactionLink[] {
    return OPTIONAL_LINKS.filter(
      (key) =>
        core[key] === undefined &&
        this.dataset.match(TermAs.term(node), DataFactory.namedNode(V[key])).size > 0,
    );
  }
  /**
   * Refuse any write that would replace or remove the stored record `id`: a transfer leg
   * (legs change together) or a record holding an unreadable optional link. Check the
   * record's own document before writing a copy elsewhere, such as a move to another shard.
   */
  assertTransactionWritable(id: string): void {
    const node = this.node(id);
    if (node.types.has(V.transferClass))
      throw new TypeError("Transfer legs must be changed together");
    this.assertLinksReadable(node, node);
  }
  /** Every IRI stored under an optional link of `id`, including values the read left out. */
  linkIris(id: string, key: TransactionLink): string[] {
    return [...this.dataset.match(DataFactory.namedNode(id), DataFactory.namedNode(V[key]))]
      .filter((quad) => quad.object.termType === "NamedNode")
      .map((quad) => quad.object.value);
  }
  categories(): Category[] {
    const categories = this.nodes(V.categoryClass).map((node) => {
      const category = required(entities.Category.parse(node.value, this.dataset));
      if (
        category.parent === undefined &&
        this.dataset.match(TermAs.term(node), DataFactory.namedNode(V.parent)).size
      )
        throw new TypeError("Invalid category parent");
      return { id: node.value, ...category };
    });
    categoryTree(categories);
    return categories;
  }
}
