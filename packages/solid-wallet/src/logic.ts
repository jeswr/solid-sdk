// AUTHORED-BY Codex (GPT-6.1 Sol)
import { ITEM_KINDS, type ItemKind, type WalletItemData } from "./model.js";
export type ExpiryStatus = "valid" | "expiring-soon" | "expired" | "no-expiry";
function calendarDay(value: Date): number {
  if (!Number.isFinite(value.getTime())) throw new TypeError("Enter a real date");
  const midnight = new Date(value);
  midnight.setUTCHours(0, 0, 0, 0);
  return midnight.getTime();
}
/** Inclusive calendar dates: a document remains valid throughout its expiry day. */
export function expiryStatus(
  item: Pick<WalletItemData, "expires">,
  today: Date,
  days = 30,
): ExpiryStatus {
  if (!Number.isSafeInteger(days) || days < 0)
    throw new TypeError("Expiry window must be whole days");
  const day = calendarDay(today);
  if (!item.expires) return "no-expiry";
  const difference = (calendarDay(item.expires) - day) / 86_400_000;
  return difference < 0 ? "expired" : difference <= days ? "expiring-soon" : "valid";
}
export function sortItems<T extends WalletItemData>(
  items: readonly T[],
  by: "name" | "expiry" = "name",
): T[] {
  return [...items].sort((a, b) => {
    if (by === "expiry") {
      const difference = (a.expires?.getTime() ?? Infinity) - (b.expires?.getTime() ?? Infinity);
      if (difference && !Number.isNaN(difference)) return difference;
    }
    return Number(!!b.favourite) - Number(!!a.favourite) || a.name.localeCompare(b.name, "en-GB");
  });
}
export function groupItems<T extends WalletItemData>(
  items: readonly T[],
): { kind: ItemKind; items: T[] }[] {
  return ITEM_KINDS.map((kind) => ({
    kind,
    items: sortItems(items.filter((item) => item.kind === kind)),
  })).filter((group) => group.items.length > 0);
}
export function filterItems<T extends WalletItemData>(
  items: readonly T[],
  query: string,
  kind = "all",
): T[] {
  const needle = query.trim().toLocaleLowerCase("en-GB");
  return items.filter(
    (item) =>
      (kind === "all" || item.kind === kind) &&
      [
        item.name,
        item.identifier,
        item.issuerName,
        item.holderName,
        item.notes,
        ...(item.tags ?? []),
      ].some((value) => value?.toLocaleLowerCase("en-GB").includes(needle)),
  );
}
/** Date input policy is stricter than Date.parse (which silently rolls impossible days). */
export function inputDate(value: string): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError("Enter a date as YYYY-MM-DD");
  const result = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value)
    throw new TypeError("Enter a real calendar date");
  return result;
}
