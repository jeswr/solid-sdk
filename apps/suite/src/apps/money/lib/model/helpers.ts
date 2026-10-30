// AUTHORED-BY Codex GPT-6.1-Sol
import { parseAmount } from "../import/values";
import type { Balance, Category, Money, Range, Transaction } from "./types";
import { instant, iri, validateMoney, validateRange, validateTransaction } from "./validation";

export function monthKey(at: string): string {
  return new Date(instant(at)).toISOString().slice(0, 7);
}
export function monthKeys(range: Range): string[] {
  validateRange(range);
  const index = (at: string) => {
    const key = monthKey(at);
    return Number(key.slice(0, 4)) * 12 + Number(key.slice(5)) - 1;
  };
  const end = index(range.end);
  const keys: string[] = [];
  for (let cursor = index(range.start); cursor <= end; cursor++) {
    keys.push(
      `${String(Math.floor(cursor / 12)).padStart(4, "0")}-${String((cursor % 12) + 1).padStart(2, "0")}`,
    );
  }
  return keys;
}
/** Exact decimal addition, retaining arbitrary statement precision. */
export function addAmounts(a: string, b: string): string {
  const left = parseAmount(a);
  const right = parseAmount(b);
  const scale = Math.max((left.split(".")[1] ?? "").length, (right.split(".")[1] ?? "").length);
  const integer = (value: string) => {
    const [whole, fraction = ""] = value.replace("-", "").split(".");
    const absolute = BigInt(whole + fraction.padEnd(scale, "0"));
    return value.startsWith("-") ? -absolute : absolute;
  };
  const total = integer(left) + integer(right);
  const digits = (total < BigInt(0) ? -total : total).toString().padStart(scale + 1, "0");
  const unsigned = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return parseAmount(total < BigInt(0) ? `-${unsigned}` : unsigned);
}
export function latestBalance(balances: readonly Balance[], account: string): Balance | undefined {
  iri(account);
  let latest: Balance | undefined;
  for (const balance of balances) {
    validateMoney(balance);
    if (balance.asOf !== undefined) instant(balance.asOf);
    if (balance.account !== account) continue;
    if (
      latest === undefined ||
      (balance.asOf !== undefined &&
        (latest.asOf === undefined || instant(balance.asOf) > instant(latest.asOf)))
    )
      latest = balance;
  }
  return latest;
}
/** Opening amount is immediately before the supplied transactions, including filtered-out rows. */
export function runningBalance(
  transactions: readonly Transaction[],
  account: string,
  opening: Money,
  range: Range,
) {
  iri(account);
  validateMoney(opening);
  validateRange(range);
  let amount = opening.amount;
  return [...transactions]
    .map((value) => {
      validateTransaction(value);
      return value;
    })
    .filter((value) => value.account === account)
    .sort((a, b) => instant(a.postingTime) - instant(b.postingTime) || a.id.localeCompare(b.id))
    .flatMap((value) => {
      if (value.currency !== opening.currency) throw new TypeError("Currency mismatch");
      amount = addAmounts(amount, value.amount);
      const time = instant(value.postingTime);
      return time >= instant(range.start) && time <= instant(range.end)
        ? [{ ...value, runningBalance: amount }]
        : [];
    });
}
export interface CategoryNode extends Category {
  readonly children: CategoryNode[];
}
export function categoryTree(categories: readonly Category[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>();
  for (const category of categories) {
    iri(category.id);
    if (!category.label.trim() || nodes.has(category.id)) throw new TypeError("Invalid category");
    nodes.set(category.id, { ...category, children: [] });
  }
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const visited = new Set([node.id]);
    let parent = node.parent;
    while (parent !== undefined) {
      iri(parent);
      if (visited.has(parent) || !nodes.has(parent))
        throw new TypeError("Invalid category hierarchy");
      visited.add(parent);
      parent = (nodes.get(parent) as CategoryNode).parent;
    }
    if (node.parent === undefined) roots.push(node);
    else (nodes.get(node.parent) as CategoryNode).children.push(node);
  }
  return roots;
}
