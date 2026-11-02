// AUTHORED-BY Claude Opus 5.5
import { type CategoryRule, categoriseTransactions } from "../import";
import { type Category, MoneyIoError, type Transaction } from "../model";
import { type MoneyClient, storeOf } from "./container";
import { reconcileMutation } from "./mutations";

export const RULE_MATCHES = ["contains", "startsWith", "endsWith", "equals"] as const;
export type RuleMatch = (typeof RULE_MATCHES)[number];
/** "When the description <match> <value>, file it under <category>." */
export interface SavedRule {
  readonly id: string;
  readonly match: RuleMatch;
  readonly value: string;
  readonly category: string;
}
export interface RuleFile {
  readonly rules: SavedRule[];
  readonly etag: string | null;
}
/** Rules are a preference, kept as JSON beside the money data. */
export const RULES_FILE = "rules.json";
const MAX_VALUE = 200;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Validates a rule for saving; returns it trimmed. */
export function checkRule(rule: SavedRule): SavedRule {
  const value = rule.value.trim();
  if (!value) throw new TypeError("Enter the text to look for.");
  if (value.length > MAX_VALUE) throw new TypeError("Keep the text under 200 characters.");
  if (!rule.category) throw new TypeError("Choose a category.");
  if (!RULE_MATCHES.includes(rule.match)) throw new TypeError("Choose how the text matches.");
  return { ...rule, value };
}

/** Reads a stored rules file; anything malformed is refused rather than half-read. */
export function parseRules(value: unknown): SavedRule[] {
  if (!isRecord(value) || !Array.isArray(value.rules)) throw new TypeError("Invalid rules file");
  const ids = new Set<string>();
  return value.rules.map((rule: unknown) => {
    if (
      !isRecord(rule) ||
      typeof rule.id !== "string" ||
      !rule.id ||
      ids.has(rule.id) ||
      typeof rule.match !== "string" ||
      typeof rule.value !== "string" ||
      typeof rule.category !== "string"
    )
      throw new TypeError("Invalid rules file");
    ids.add(rule.id);
    return checkRule({
      id: rule.id,
      match: rule.match as RuleMatch,
      value: rule.value,
      category: rule.category,
    });
  });
}

export async function loadRules(client: MoneyClient): Promise<RuleFile> {
  const url = storeOf(client).resolve(RULES_FILE);
  const response = await client.fetch(url, {
    redirect: "error",
    headers: { accept: "application/json", "cache-control": "no-cache" },
  });
  if (response.status === 404) return { rules: [], etag: null };
  if (!response.ok) throw new MoneyIoError(response.status);
  return { rules: parseRules(await response.json()), etag: response.headers.get("etag") };
}

const same = (a: readonly SavedRule[], b: readonly SavedRule[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Applies `change` to the latest rules and saves them with a conditional write.
 * A conflict whose outcome already matches (a retry, or the same edit elsewhere)
 * counts as saved; any other conflict is reported.
 */
export async function saveRules(
  client: MoneyClient,
  change: (rules: SavedRule[]) => SavedRule[],
): Promise<SavedRule[]> {
  const loaded = await loadRules(client);
  const next = change([...loaded.rules]).map(checkRule);
  const ids = new Set(next.map((rule) => rule.id));
  if (ids.size !== next.length) throw new TypeError("Duplicate rule");
  await reconcileMutation(
    loaded,
    (value) => same(value.rules, next),
    () =>
      storeOf(client).put(
        RULES_FILE,
        JSON.stringify({ rules: next }),
        "application/json",
        loaded.etag ? { etag: loaded.etag } : { create: true },
      ),
    () => loadRules(client),
  );
  return next;
}

/**
 * The rules an import applies, first match wins: the user's rules in order (skipping
 * any whose category was deleted), then a leaf category's name found in the description.
 */
function ownRules(saved: readonly SavedRule[], categories: readonly Category[]): CategoryRule[] {
  const known = new Set(categories.map((category) => category.id));
  return saved
    .filter((rule) => known.has(rule.category))
    .map((rule) => ({
      category: rule.category,
      description: { match: rule.match, value: rule.value },
    }));
}

export function importRules(
  saved: readonly SavedRule[],
  categories: readonly Category[],
): CategoryRule[] {
  const leaves = categories.filter(
    (category) => !categories.some((child) => child.parent === category.id),
  );
  return [
    ...ownRules(saved, categories),
    ...leaves.map((category) => ({
      category: category.id,
      description: { match: "contains" as const, value: category.label },
    })),
  ];
}

/**
 * Uncategorised, non-transfer transactions the saved rules would file, grouped by
 * category. Only the user's own rules apply here, not category-name guesses.
 */
export function ruleMatches(
  saved: readonly SavedRule[],
  categories: readonly Category[],
  transactions: readonly Transaction[],
): Map<string, string[]> {
  const rules = ownRules(saved, categories);
  const candidates = transactions.filter(
    (row) => !row.category && !row.debitAccount && !row.creditAccount,
  );
  const filed = categoriseTransactions(
    candidates.map((row) => ({
      date: row.postingTime.slice(0, 10),
      amount: row.amount,
      description: row.description,
    })),
    rules,
  );
  const groups = new Map<string, string[]>();
  filed.forEach((row, index) => {
    if (!row.category) return;
    const ids = groups.get(row.category) ?? [];
    ids.push((candidates[index] as Transaction).id);
    groups.set(row.category, ids);
  });
  return groups;
}
