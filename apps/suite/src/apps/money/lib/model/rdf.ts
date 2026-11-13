// AUTHORED-BY Codex GPT-6
// Compatibility exports for app callers; model ownership is in the SDK.
import { type Money, type MoneyDocument, V } from "@jeswr/solid-money";
import type { Term } from "@rdfjs/types";
import { DataFactory } from "n3";

export * from "@jeswr/solid-money";

// Budget assignments share the generated model's amount-node collision checks.
export function putMoney(document: MoneyDocument, id: string, value: Money): Term {
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
