// AUTHORED-BY Codex GPT-6.1-Sol
import type { CategoryRule, ImportedTransaction } from "./types";
import { compareAmounts, parseAmount } from "./values";

function matchesDescription(
  value: string,
  matcher: NonNullable<CategoryRule["description"]>,
): boolean {
  const haystack = matcher.caseSensitive ? value : value.toLowerCase();
  const needle = matcher.caseSensitive ? matcher.value : matcher.value.toLowerCase();
  switch (matcher.match) {
    case "contains":
      return haystack.includes(needle);
    case "equals":
      return haystack === needle;
    case "startsWith":
      return haystack.startsWith(needle);
    case "endsWith":
      return haystack.endsWith(needle);
  }
}

/** First match wins; preserve existing categories; all predicates are ANDed. No mutation. */
export function categoriseTransactions(
  transactions: readonly ImportedTransaction[],
  rules: readonly CategoryRule[],
): ImportedTransaction[] {
  for (const rule of rules) {
    if (
      !rule.category.trim() ||
      (!rule.description && !rule.amount) ||
      rule.description?.value === ""
    ) {
      throw new Error("A category rule needs a category and nonempty conditions");
    }
    const bounds = rule.amount;
    if (bounds) {
      if (bounds.min === undefined && bounds.max === undefined)
        throw new Error("Empty amount range");
      if (bounds.min !== undefined) parseAmount(bounds.min);
      if (bounds.max !== undefined) parseAmount(bounds.max);
      if (
        bounds.min !== undefined &&
        bounds.max !== undefined &&
        compareAmounts(bounds.min, bounds.max) > 0
      ) {
        throw new Error("Reversed amount range");
      }
    }
  }
  return transactions.map((transaction) => {
    if (transaction.category !== undefined) return { ...transaction };
    const rule = rules.find((rule) => {
      if (rule.description && !matchesDescription(transaction.description, rule.description))
        return false;
      if (rule.amount?.min !== undefined && compareAmounts(transaction.amount, rule.amount.min) < 0)
        return false;
      if (rule.amount?.max !== undefined && compareAmounts(transaction.amount, rule.amount.max) > 0)
        return false;
      return true;
    });
    return rule ? { ...transaction, category: rule.category } : { ...transaction };
  });
}
