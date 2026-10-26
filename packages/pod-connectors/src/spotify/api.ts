// AUTHORED-BY Codex GPT-6.1-Sol
import { RunBudget, readJson } from "../core/budget.js";
import { IntegrationSyncError, RateLimitedError } from "../core/errors.js";
import type { ImportContext } from "../core/types.js";

export const API = "https://api.spotify.com/v1";
export interface Page<T> {
  items: (T | null)[];
  next?: string | null;
  cursors?: { before?: string; after?: string };
}

/** Bound retries; never retry forbidden or failed requests using another identity. */
export async function spotifyJson<T>(
  api: typeof fetch,
  url: string,
  budget = new RunBudget("spotify"),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    budget.request();
    const res = await api(url, { redirect: "error" });
    if (res.status === 429) {
      const header = res.headers.get("retry-after");
      const seconds =
        header && /^\d+$/.test(header)
          ? Number(header)
          : header && /GMT$/.test(header)
            ? Math.max(0, (Date.parse(header) - Date.now()) / 1000)
            : Number.NaN;
      const delay = Number.isFinite(seconds) ? seconds : undefined;
      await res.body?.cancel();
      if (attempt >= 3 || delay === undefined || delay * 1000 > 2_147_483_647)
        throw new RateLimitedError("spotify", url, delay);
      await new Promise((resolve) => setTimeout(resolve, delay * 1000));
      continue;
    }
    if (!res.ok)
      throw new IntegrationSyncError("spotify", `Spotify answered ${res.status}.`, {
        url,
        status: res.status,
      });
    return (await readJson(res, "spotify", url)) as T;
  }
}

/** Follow only same-resource HTTPS next links, including cursor-paged artists/history. */
export async function* pages<T>(
  ctx: ImportContext,
  initial: string,
  budget = new RunBudget("spotify"),
  unwrap: (json: Page<T> & { artists?: Page<T> }) => Page<T> | undefined = (json) => json,
): AsyncGenerator<Page<T>> {
  let next: string | undefined = initial;
  const root = new URL(initial);
  const seen = new Set<string>();
  while (next) {
    const url = new URL(next);
    if (
      url.origin !== root.origin ||
      url.pathname !== root.pathname ||
      url.username ||
      url.password ||
      url.hash ||
      seen.has(url.href)
    )
      throw new IntegrationSyncError("spotify", "Unsafe or repeated Spotify pagination link.");
    seen.add(url.href);
    const json = await spotifyJson<Page<T> & { artists?: Page<T> }>(ctx.api, url.href, budget);
    if (!json || typeof json !== "object")
      throw new IntegrationSyncError("spotify", "Invalid Spotify page.");
    const page = unwrap(json);
    if (
      !page ||
      typeof page !== "object" ||
      !Array.isArray(page.items) ||
      (page.next !== undefined && page.next !== null && typeof page.next !== "string")
    )
      throw new IntegrationSyncError("spotify", "Invalid Spotify page.");
    budget.items(page.items.length);
    yield page;
    next = page.next ?? undefined;
  }
}
