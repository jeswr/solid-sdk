// AUTHORED-BY Codex (GPT-6.1 Sol)
import { NS } from "@jeswr/suite-vocab";
import type { BlankNode, DatasetCore, Term } from "@rdfjs/types";
import { LiteralAs, OptionalFrom } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { entities } from "./generated/model.js";
import { categoryTree } from "./helpers.js";
import { migrateMoney } from "./migration.js";
import { MoneyNode, rdfAmount } from "./node.js";
import { optionalLinks, required } from "./records.js";
import type { Account, Balance, Category, Money, Transaction } from "./types.js";
import { instant, validateMoney, validateTransaction } from "./validation.js";
import { V } from "./vocab.js";

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
      amount: required(
        amount.amount ?? OptionalFrom.subjectPredicate(amount, `${NS.FINANCE}amount`, rdfAmount),
      ),
      currency: required(
        amount.currency ??
          OptionalFrom.subjectPredicate(amount, `${NS.FINANCE}currency`, LiteralAs.string),
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
      const result: Transaction = {
        id: node.value,
        account: core.account,
        postingTime: required(node.postingTime),
        description: core.description ?? "Transaction",
        ...this.money(node),
        ...optionalLinks(core),
      };
      validateTransaction(result);
      return result;
    });
  }
  categories(): Category[] {
    const categories = this.nodes(V.categoryClass).map((node) => ({
      id: node.value,
      ...required(entities.Category.parse(node.value, this.dataset)),
    }));
    categoryTree(categories);
    return categories;
  }
}
