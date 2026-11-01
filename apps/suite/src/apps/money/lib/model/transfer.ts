// AUTHORED-BY Codex GPT-6.1-Sol
import { compareAmounts } from "../import/values";
import { type MoneyDocument, putTransaction, V } from "./rdf";
import type { Money } from "./types";
import { instant, iri, validateMoney } from "./validation";

/** One shard contains both signed legs; no cross-document transfer transaction is needed. */
export function createTransfer(
  document: MoneyDocument,
  id: string,
  from: string,
  to: string,
  postingTime: string,
  money: Money,
) {
  iri(id);
  iri(from);
  iri(to);
  instant(postingTime);
  validateMoney(money);
  if (from === to || compareAmounts(money.amount, "0") <= 0)
    throw new TypeError("Invalid transfer");
  const shared = {
    currency: money.currency,
    postingTime,
    description: "Transfer",
    debitAccount: from,
    creditAccount: to,
  };
  const debit = { ...shared, id: `${id}-debit`, account: from, amount: `-${money.amount}` };
  const credit = { ...shared, id: `${id}-credit`, account: to, amount: money.amount };
  if (document.node(debit.id).types.size || document.node(credit.id).types.size)
    throw new TypeError("Transfer already exists");
  for (const value of [debit, credit]) {
    putTransaction(document, value);
    document.node(value.id).types.add(V.transferClass);
  }
  return [debit, credit];
}
