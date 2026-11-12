// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { iri } from "@jeswr/solid-money";
import { NS } from "@jeswr/suite-vocab";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
} from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { type Allocation, calculateBudget, formatMoney, parseMoney } from "../budget";
import { type MoneyDocument, MoneyNode, putMoney } from "./rdf";

export const BUDGET = {
  type: `${NS.FINANCE}Budget`,
  parts: `${NS.SCHEMA}hasPart`,
  category: `${NS.SCHEMA}about`,
  month: `${NS.SCHEMA}temporalCoverage`,
} as const;

/** A month's Budget and its assignment nodes share the existing MonetaryAmount accessors. */
export class BudgetNode extends MoneyNode {
  get assignments(): Set<string> {
    return SetFrom.subjectPredicate(this, BUDGET.parts, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get budgetCategory(): string | undefined {
    return OptionalFrom.subjectPredicate(this, BUDGET.category, NamedNodeAs.string);
  }
  set budgetCategory(value: string | undefined) {
    OptionalAs.object(this, BUDGET.category, value, NamedNodeFrom.string);
  }
  get month(): string | undefined {
    return OptionalFrom.subjectPredicate(this, BUDGET.month, LiteralAs.string);
  }
  set month(value: string | undefined) {
    OptionalAs.object(this, BUDGET.month, value, LiteralFrom.string);
  }
}
const nodeOf = (document: MoneyDocument, id: string) =>
  new BudgetNode(DataFactory.namedNode(id), document.dataset, DataFactory);

export function validateBudget(month: string, assignments: readonly Allocation[]) {
  calculateBudget([{ month, assignments, income: [], activity: [] }], {
    availableToBudget: [],
    envelopes: [],
  });
  for (const row of assignments) iri(row.categoryId);
}

export function readBudget(document: MoneyDocument, url: string, month: string): Allocation[] {
  validateBudget(month, []);
  const roots = document.nodes(BUDGET.type);
  if (!roots.length) return [];
  const root = nodeOf(document, `${iri(url)}#budget`);
  if (roots.length !== 1 || roots[0]?.value !== root.value || root.month !== month)
    throw new TypeError("Invalid monthly budget record");
  const assignments = [...root.assignments].map((id) => {
    const assignment = nodeOf(document, id);
    if (assignment.budgetCategory === undefined) throw new TypeError("Missing budget category");
    const value = document.money(assignment);
    // RDF decimal producers may retain insignificant trailing zeros.
    const decimal = value.amount.includes(".")
      ? value.amount.replace(/0+$/, "").replace(/\.$/, "")
      : value.amount;
    return { categoryId: assignment.budgetCategory, amount: parseMoney(value.currency, decimal) };
  });
  validateBudget(month, assignments);
  return assignments;
}

/** Upsert by category/currency, retaining existing node identities and unmentioned memberships. */
export function putBudget(
  document: MoneyDocument,
  url: string,
  month: string,
  assignments: readonly Allocation[],
) {
  iri(url);
  validateBudget(month, assignments);
  const root = nodeOf(document, `${url}#budget`);
  root.types.add(BUDGET.type);
  root.month = month;
  const existing = [...root.assignments].map((id) => nodeOf(document, id));
  for (const row of assignments) {
    const id =
      existing.find(
        (node) =>
          node.budgetCategory === row.categoryId &&
          document.money(node).currency === row.amount.currency,
      )?.value ?? `${url}#assignment-${encodeURIComponent(row.categoryId)}-${row.amount.currency}`;
    const assignment = nodeOf(document, id);
    assignment.budgetCategory = row.categoryId;
    assignment.amountNode = putMoney(document, id, {
      amount: formatMoney(row.amount),
      currency: row.amount.currency,
    });
    root.assignments.add(id);
  }
}
