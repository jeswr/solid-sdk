// AUTHORED-BY Claude Opus 5.5
import { type CategoryRule, categoriseTransactions } from "../import";
import { type Category, MoneyIoError, putTransaction, type Transaction } from "../model";
import { type MoneyClient, storeOf } from "./container";
import { allTransactions, categorised } from "./ledger";
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
  readonly exists: boolean;
}
/** The rules file is there but its contents can't be used (as opposed to a failed read). */
export class RulesFileError extends Error {
  constructor() {
    super("Your saved rules couldn't be read.");
  }
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
  if (response.status === 404) return { rules: [], etag: null, exists: false };
  if (!response.ok) throw new MoneyIoError(response.status);
  // A body cut off mid-read is a failed read, not an unusable file.
  const text = await response.text();
  let rules: SavedRule[];
  try {
    rules = parseRules(JSON.parse(text));
  } catch {
    throw new RulesFileError();
  }
  return { rules, etag: response.headers.get("etag"), exists: true };
}

/** Without a version tag a write can't be made safely against other devices' edits. */
function condition(file: { etag: string | null; exists: boolean }) {
  if (!file.exists) return { create: true } as const;
  // A weak tag can't guard a write either.
  if (!file.etag || file.etag.startsWith("W/"))
    throw new Error("Your pod didn't say which version of your rules it has.");
  return { etag: file.etag };
}

/**
 * Replaces the rules file with an empty one, but only if it still can't be read:
 * a file that has since become readable (repaired elsewhere) is left alone.
 * Resolves true when it reset the file.
 */
export async function resetRules(client: MoneyClient): Promise<boolean> {
  const store = storeOf(client);
  const response = await client.fetch(store.resolve(RULES_FILE), {
    redirect: "error",
    headers: { accept: "application/json", "cache-control": "no-cache" },
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new MoneyIoError(response.status);
  try {
    parseRules(JSON.parse(await response.text()));
    return false;
  } catch {
    // Still unreadable: replace exactly the version that was just read.
  }
  await store.put(
    RULES_FILE,
    JSON.stringify({ rules: [] }),
    "application/json",
    condition({ etag: response.headers.get("etag"), exists: true }),
  );
  return true;
}

/** Edits must not bring back a rule another device deleted. */
export function replaceRule(rules: readonly SavedRule[], rule: SavedRule): SavedRule[] {
  if (!rules.some((value) => value.id === rule.id)) throw new MoneyIoError(412);
  return rules.map((value) => (value.id === rule.id ? rule : value));
}
/**
 * Adding is keyed by the rule's id, so retrying after a lost response adds it once
 * (with the latest text, if it was changed before the retry).
 */
export function addRule(rules: readonly SavedRule[], rule: SavedRule): SavedRule[] {
  return rules.some((value) => value.id === rule.id)
    ? rules.map((value) => (value.id === rule.id ? rule : value))
    : [...rules, rule];
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
        condition(loaded),
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

/** True while a row is still there, uncategorised and not a transfer leg. */
export function stillUncategorised(row: Transaction | undefined): row is Transaction {
  return !!row && !row.category && !row.debitAccount && !row.creditAccount;
}

/**
 * Files the uncategorised transactions the saved rules match, reading the latest
 * ledger first and skipping any row that gained a category or became a transfer
 * leg meanwhile. One conditional write per month; a partial failure says how many
 * were saved (running it again finishes the rest).
 */
export async function categoriseByRules(
  client: MoneyClient,
  saved: readonly SavedRule[],
  categories: readonly Category[],
): Promise<number> {
  const wanted = new Map<string, string>();
  for (const [category, ids] of ruleMatches(saved, categories, await allTransactions(client)))
    for (const id of ids) wanted.set(id, category);
  const months = new Map<string, string[]>();
  for (const id of wanted.keys()) {
    const key = id.slice(0, id.indexOf("#"));
    months.set(key, [...(months.get(key) ?? []), id]);
  }
  const store = storeOf(client);
  let filed = 0;
  for (const [url, ids] of months) {
    try {
      const loaded = await store.read(url);
      let changed = 0;
      for (const id of ids) {
        const latest = loaded.document.transactions().find((value) => value.id === id);
        if (!stillUncategorised(latest)) continue;
        putTransaction(loaded.document, categorised(latest, wanted.get(id)));
        changed += 1;
      }
      if (changed) await store.write(loaded.url, loaded.document, loaded.condition);
      filed += changed;
    } catch (error) {
      if (!filed) throw error;
      throw new Error(
        `Categorised ${filed} of ${wanted.size} transactions. The rest couldn't be saved; try again.`,
      );
    }
  }
  return filed;
}
