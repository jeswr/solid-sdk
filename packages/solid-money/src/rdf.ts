// AUTHORED-BY Codex (GPT-6.1 Sol)
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import { NS } from "@jeswr/suite-vocab";
import type { Term } from "@rdfjs/types";
import { DataFactory, type Store } from "n3";
import { MoneyDocument } from "./document.js";
import model, { entities } from "./generated/model.js";
import { categoryTree } from "./helpers.js";
import { migrateMoney } from "./migration.js";
import { MoneyNode } from "./node.js";
import { required } from "./records.js";
import type { Account, Balance, Category, Money, Transaction } from "./types.js";
import { hasText, instant, iri, validateMoney, validateTransaction } from "./validation.js";
import { V } from "./vocab.js";

export { MoneyDocument, MoneyNode, migrateMoney, V };

/** Upsert generated fields only; retain unknown predicates, types and other subjects.
 * Build in a small Store so the runtime migration budget is independent of shard size.
 */
function writeCore(document: MoneyDocument, id: string, name: keyof typeof entities, built: Store) {
  const entity = required(model.manifest.entities.find((entity) => entity.name === name));
  if (entity.kind === "composite") throw new TypeError("Money core must remain flat");
  for (const field of entity.fields)
    for (const quad of document.dataset.match(
      DataFactory.namedNode(id),
      DataFactory.namedNode(field.predicate),
    ))
      document.dataset.delete(quad);
  for (const quad of built) document.dataset.add(quad);
}
export function putAccount(document: MoneyDocument, value: Account): void {
  iri(value.id);
  if (!hasText(value.label)) throw new TypeError("Account label is required");
  writeCore(document, value.id, "Account", entities.Account.build(value.id, value));
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
    // Blank nodes cannot overlap record IRIs; the document reserves existing labels too.
    amountId = document.allocateAmountNode();
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
  writeCore(
    document,
    value.id,
    "Balance",
    entities.Balance.build(value.id, { balanceAccount: value.account }),
  );
  node.asOf = value.asOf;
  node.amountNode = putMoney(document, value.id, value);
}
export function putTransaction(document: MoneyDocument, value: Transaction): void {
  validateTransaction(value);
  const node = document.node(value.id);
  if (node.types.has(V.transferClass))
    throw new TypeError("Transfer legs must be changed together");
  writeCore(document, value.id, "Transaction", entities.Transaction.build(value.id, value));
  node.postingTime = value.postingTime;
  node.amountNode = putMoney(document, value.id, value);
}
export function putCategories(document: MoneyDocument, values: readonly Category[]): void {
  categoryTree(values);
  for (const value of values) {
    writeCore(document, value.id, "Category", entities.Category.build(value.id, value));
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
