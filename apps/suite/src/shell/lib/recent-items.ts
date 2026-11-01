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
export const recentItemsKey = (accountId: string) => `suite.recent.v1.${accountId}`;

/** Pages that are not "something you've viewed": sign-in, the fallback itself, fixtures. */
const EXCLUDED = ["/offline", "/signin", "/signup", "/welcome", "/onboarding", "/auth", "/dev"];

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
