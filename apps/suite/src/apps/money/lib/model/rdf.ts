// AUTHORED-BY Codex GPT-6.1-Sol
// Typed finance accessors and legacy migration ported from apps/pod-money/src.
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import { canonicalize, NS } from "@jeswr/suite-vocab";
import type { DatasetCore, Term } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedGraphDataset,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermAs,
  TermFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { categoryTree } from "./helpers";
import type { Account, Balance, Category, Money, Transaction } from "./types";
import { instant, iri, validateMoney, validateTransaction } from "./validation";

export const V = {
  type: `${NS.RDF}type`,
  accountClass: `${NS.FINANCE}FinancialAccount`,
  transactionClass: `${NS.FINANCE}Transaction`,
  transferClass: `${NS.FINANCE}Transfer`,
  balanceClass: `${NS.FINANCE}Balance`,
  categoryClass: `${NS.FINANCE}BudgetCategory`,
  amountClass: `${NS.FINANCE}MonetaryAmount`,
  amountNode: `${NS.FINANCE}hasMonetaryAmount`,
  amount: `${NS.SCHEMA}value`,
  currency: `${NS.SCHEMA}currency`,
  label: `${NS.SKOS}prefLabel`,
  parent: `${NS.SKOS}broader`,
  account: `${NS.POD_MONEY}account`,
  balanceAccount: `${NS.POD_MONEY}ofAccount`,
  asOf: `${NS.POD_MONEY}asOf`,
  postingTime: `${NS.FINANCE}postingTime`,
  category: `${NS.POD_MONEY}category`,
  payee: `${NS.FINANCE}hasCounterparty`,
  description: `${NS.SCHEMA}description`,
  derivedFrom: `${NS.PROV}wasDerivedFrom`,
  debitAccount: `${NS.FINANCE}debitAccount`,
  creditAccount: `${NS.FINANCE}creditAccount`,
} as const;

/** Canonicalise vocabulary only, preserving resource IDs, literals and graph names. */
export function migrateMoney(dataset: DatasetCore): DatasetCore {
  for (const quad of [...dataset]) {
    let predicate = canonicalize(quad.predicate.value);
    if (predicate === `${NS.POD_MONEY}parent`) predicate = V.parent;
    let object = quad.object;
    if (predicate === V.type && object.termType === "NamedNode") {
      let type = canonicalize(object.value);
      if (type === `${NS.POD_MONEY}Category`) type = V.categoryClass;
      object = DataFactory.namedNode(type);
    }
    if (predicate === quad.predicate.value && object.equals(quad.object)) continue;
    const graph =
      quad.graph.termType === "DefaultGraph"
        ? dataset
        : new NamedGraphDataset(quad.graph, dataset, DataFactory);
    const node = new TermWrapper(quad.subject, graph, DataFactory);
    SetFrom.subjectPredicate(node, predicate, TermAs.term, TermFrom.itself).add(object);
    dataset.delete(quad);
  }
  return dataset;
}

export class MoneyNode extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, V.type, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get amountNode(): Term | undefined {
    return OptionalFrom.subjectPredicate(this, V.amountNode, TermAs.term);
  }
  set amountNode(value: string | Term | undefined) {
    OptionalAs.object(this, V.amountNode, value, (reference, factory) =>
      typeof reference === "string" ? factory.namedNode(reference) : reference,
    );
  }
  get parent(): string | undefined {
    return OptionalFrom.subjectPredicate(this, V.parent, NamedNodeAs.string);
  }
  set parent(value: string | undefined) {
    OptionalAs.object(this, V.parent, value, NamedNodeFrom.string);
  }
  get account(): string | undefined {
    return OptionalFrom.subjectPredicate(this, V.account, NamedNodeAs.string);
  }
  set account(value: string | undefined) {
    OptionalAs.object(this, V.account, value, NamedNodeFrom.string);
  }
  get balanceAccount(): string | undefined {
    return OptionalFrom.subjectPredicate(this, V.balanceAccount, NamedNodeAs.string);
  }
  set balanceAccount(value: string | undefined) {
    OptionalAs.object(this, V.balanceAccount, value, NamedNodeFrom.string);
  }
  get category(): string | undefined {
    return OptionalFrom.subjectPredicate(this, V.category, NamedNodeAs.string);
  }
  set category(value: string | undefined) {
    OptionalAs.object(this, V.category, value, NamedNodeFrom.string);
  }
  get payee(): string | undefined {
    return OptionalFrom.subjectPredicate(this, V.payee, NamedNodeAs.string);
  }
  set payee(value: string | undefined) {
    OptionalAs.object(this, V.payee, value, NamedNodeFrom.string);
  }
  get derivedFrom(): string | undefined {
    return OptionalFrom.subjectPredicate(this, V.derivedFrom, NamedNodeAs.string);
  }
  set derivedFrom(value: string | undefined) {
    OptionalAs.object(this, V.derivedFrom, value, NamedNodeFrom.string);
  }
  get debitAccount(): string | undefined {
    return OptionalFrom.subjectPredicate(this, V.debitAccount, NamedNodeAs.string);
  }
  set debitAccount(value: string | undefined) {
    OptionalAs.object(this, V.debitAccount, value, NamedNodeFrom.string);
  }
  get creditAccount(): string | undefined {
    return OptionalFrom.subjectPredicate(this, V.creditAccount, NamedNodeAs.string);
  }
  set creditAccount(value: string | undefined) {
    OptionalAs.object(this, V.creditAccount, value, NamedNodeFrom.string);
  }
  get label(): string | undefined {
    return OptionalFrom.subjectPredicate(this, V.label, LiteralAs.string);
  }
  set label(value: string | undefined) {
    OptionalAs.object(this, V.label, value, LiteralFrom.string);
  }
  get asOf(): string | undefined {
    return OptionalFrom.subjectPredicate(this, V.asOf, LiteralAs.string);
  }
  set asOf(value: string | undefined) {
    OptionalAs.object(this, V.asOf, value, (text, factory) =>
      LiteralFrom.datatypeTuple(
        [`${NS.XSD}${text.length === 10 ? "date" : "dateTime"}`, text],
        factory,
      ),
    );
  }
  get postingTime(): string | undefined {
    return OptionalFrom.subjectPredicate(this, V.postingTime, LiteralAs.string);
  }
  set postingTime(value: string | undefined) {
    OptionalAs.object(this, V.postingTime, value, (text, factory) =>
      LiteralFrom.datatypeTuple(
        [`${NS.XSD}${text.length === 10 ? "date" : "dateTime"}`, text],
        factory,
      ),
    );
  }
  get description(): string | undefined {
    return OptionalFrom.subjectPredicate(this, V.description, LiteralAs.string);
  }
  set description(value: string | undefined) {
    OptionalAs.object(this, V.description, value, LiteralFrom.string);
  }
  get currency(): string | undefined {
    return OptionalFrom.subjectPredicate(this, V.currency, LiteralAs.string);
  }
  set currency(value: string | undefined) {
    OptionalAs.object(this, V.currency, value, LiteralFrom.string);
  }
  get amount(): string | undefined {
    return OptionalFrom.subjectPredicate(this, V.amount, LiteralAs.string);
  }
  set amount(value: string | undefined) {
    OptionalAs.object(this, V.amount, value, (text, factory) =>
      LiteralFrom.datatypeTuple([`${NS.XSD}decimal`, text], factory),
    );
  }
}
export class MoneyDocument {
  readonly dataset: DatasetCore;
  constructor(dataset: DatasetCore = new Store()) {
    this.dataset = migrateMoney(dataset);
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
      label: required(node.label),
    }));
  }
  money(node: MoneyNode): Money {
    const amount = this.node(required(node.amountNode));
    // Pod Money's previous fin:amount/fin:currency remain readable.
    const value = {
      amount: required(
        amount.amount ??
          OptionalFrom.subjectPredicate(amount, `${NS.FINANCE}amount`, LiteralAs.string),
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
        account: required(node.balanceAccount),
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
      const result: Transaction = {
        id: node.value,
        account: required(node.account),
        postingTime: required(node.postingTime),
        description: node.description ?? "Transaction",
        ...this.money(node),
        ...optionalLinks(node),
      };
      validateTransaction(result);
      return result;
    });
  }
  categories(): Category[] {
    const categories = this.nodes(V.categoryClass).map((node) => ({
      id: node.value,
      label: required(node.label),
      ...(node.parent === undefined ? {} : { parent: node.parent }),
    }));
    categoryTree(categories);
    return categories;
  }
}
function optionalLinks(node: MoneyNode) {
  const result: Partial<
    Record<"category" | "payee" | "derivedFrom" | "debitAccount" | "creditAccount", string>
  > = {};
  for (const key of [
    "category",
    "payee",
    "derivedFrom",
    "debitAccount",
    "creditAccount",
  ] as const) {
    const value = node[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new TypeError("Incomplete money RDF record");
  return value;
}
export function putAccount(document: MoneyDocument, value: Account): void {
  iri(value.id);
  if (!value.label.trim()) throw new TypeError("Account label is required");
  const node = document.node(value.id);
  node.types.add(V.accountClass);
  node.label = value.label;
}
function putMoney(document: MoneyDocument, id: string, value: Money): Term {
  const owner = DataFactory.namedNode(id);
  let amountId = document.node(id).amountNode;
  if (
    amountId === undefined ||
    amountId.equals(owner) ||
    document.node(amountId).amountNode !== undefined ||
    [...document.dataset.match(null, null, amountId)].some(
      (quad) => !quad.subject.equals(owner) || quad.predicate.value !== V.amountNode,
    )
  ) {
    // Blank nodes cannot overlap record IRIs; the store reserves existing blank labels too.
    amountId = new Store([...document.dataset]).createBlankNode();
  }
  const amount = document.node(amountId);
  amount.types.add(V.amountClass);
  amount.amount = value.amount;
  amount.currency = value.currency;
  return amountId;
}
export function putBalance(document: MoneyDocument, value: Balance): void {
  iri(value.id);
  iri(value.account);
  validateMoney(value);
  if (value.asOf !== undefined) instant(value.asOf);
  const node = document.node(value.id);
  node.types.add(V.balanceClass);
  node.balanceAccount = value.account;
  node.asOf = value.asOf;
  node.amountNode = putMoney(document, value.id, value);
}
export function putTransaction(document: MoneyDocument, value: Transaction): void {
  validateTransaction(value);
  const node = document.node(value.id);
  node.types.add(V.transactionClass);
  node.account = value.account;
  node.postingTime = value.postingTime;
  node.description = value.description;
  for (const key of ["category", "payee", "derivedFrom", "debitAccount", "creditAccount"] as const)
    node[key] = value[key];
  node.amountNode = putMoney(document, value.id, value);
}
export function putCategories(document: MoneyDocument, values: readonly Category[]): void {
  categoryTree(values);
  for (const value of values) {
    const node = document.node(value.id);
    node.types.add(V.categoryClass);
    node.label = value.label;
    node.parent = value.parent;
  }
}
export async function parseMoney(source: string, url: string): Promise<MoneyDocument> {
  return new MoneyDocument(await parseRdf(source, "text/turtle", { baseIRI: iri(url) }));
}
export async function serialiseMoney(document: MoneyDocument): Promise<string> {
  for (const quad of document.dataset)
    if (quad.graph.termType !== "DefaultGraph")
      throw new TypeError("Money Turtle documents cannot contain named graphs");
  return serialize([...migrateMoney(document.dataset)], {
    format: "text/turtle",
    prefixes: {
      fin: NS.FINANCE,
      pm: NS.POD_MONEY,
      schema: NS.SCHEMA,
      skos: NS.SKOS,
      prov: NS.PROV,
    },
  });
}
