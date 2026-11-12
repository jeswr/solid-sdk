// AUTHORED-BY Claude Opus 5.5
/**
 * The local recent-items index behind `/offline` (02-suite-shell §10): the pages an account
 * opened in this browser, newest first. Titles and same-origin paths only — never document
 * contents, query strings or fragments.
 */
import { z } from "zod";

export interface RecentItem {
  title: string;
  href: string;
  viewedAt: string;
}

export const RECENT_LIMIT = 20;
export const RECENT_ITEMS_PREFIX = "suite.recent.v1.";
export const recentItemsKey = (accountId: string) => `${RECENT_ITEMS_PREFIX}${accountId}`;

/** Forget only browsing history; pending changes are the account's only unsent copy. */
export function clearRecentItems(
  storage: Pick<Storage, "length" | "key" | "removeItem">,
  accountId?: string,
): void {
  if (accountId !== undefined) {
    storage.removeItem(recentItemsKey(accountId));
    return;
  }
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (key?.startsWith(RECENT_ITEMS_PREFIX)) storage.removeItem(key);
  }
}

/** Only offer navigation when this device can actually answer it from a page cache. */
export async function savedRecentItems(
  items: RecentItem[],
  cacheStorage: Pick<CacheStorage, "keys" | "match">,
): Promise<RecentItem[]> {
  try {
    const names = (await cacheStorage.keys()).filter(
      (name) => name.startsWith("suite-pages-") || name.startsWith("app-shell-"),
    );
    const saved = await Promise.all(
      items.map(async (item) =>
        (
          await Promise.all(names.map((cacheName) => cacheStorage.match(item.href, { cacheName })))
        ).some(Boolean),
      ),
    );
    return items.filter((_, index) => saved[index]);
  } catch {
    return [];
  }
}

/** Pages that are not "something you've viewed": sign-in, the fallback itself, fixtures. */
const EXCLUDED = [
  "/offline",
  "/signin",
  "/signup",
  "/welcome",
  "/onboarding",
  "/auth",
  "/dev",
  "/settings/move-pod/callback",
];

/** A same-origin path with no query, fragment, backslash, control character or `//`. */
export function isRecordablePath(href: string): boolean {
  if (!href.startsWith("/") || href.includes("//") || /[?#\\\s\p{Cc}]/u.test(href)) return false;
  if (href.startsWith("/_next/") || href.startsWith("/api/")) return false;
  return !EXCLUDED.some((prefix) => href === prefix || href.startsWith(`${prefix}/`));
}

const itemSchema = z.object({
  title: z.string().trim().min(1).max(120),
  href: z.string().refine(isRecordablePath),
  viewedAt: z.iso.datetime({ offset: true }),
});

export function parseRecentItems(raw: string | null): RecentItem[] {
  let values: unknown;
  try {
    values = JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  return values
    .flatMap((value) => {
      const parsed = itemSchema.safeParse(value);
      if (!parsed.success || seen.has(parsed.data.href)) return [];
      seen.add(parsed.data.href);
      return [parsed.data];
    })
    .slice(0, RECENT_LIMIT);
}

/** Move (or add) the page to the front; unrecordable pages leave the list unchanged. */
export function recordRecentItem(
  list: readonly RecentItem[],
  page: { title: string; href: string },
  now: Date,
  limit = RECENT_LIMIT,
): RecentItem[] {
  const title = page.title.trim().slice(0, 120);
  if (!title || !isRecordablePath(page.href)) return [...list];
  return [
    { title, href: page.href, viewedAt: now.toISOString() },
    ...list.filter((item) => item.href !== page.href),
  ].slice(0, limit);
}
