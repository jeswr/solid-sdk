// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * A typed fake fetch built from recorded fixture routes. Powers demo mode in
 * the UI and the adapter contract tests — **no live network ever**: an
 * unmatched request throws instead of hitting the wire.
 */

import { type RunBudget, readJson } from "./budget.js";
import { IntegrationSyncError, RateLimitedError } from "./errors.js";
import { matchingFixtureRoute } from "./fixture-route.js";
import type { FixtureRoute } from "./types.js";

/** Build a `fetch`-shaped function answering from fixture routes.
 * Repeated method/prefix keys replay in array order and fail when exhausted.
 * Single entries remain reusable for existing demo fixtures.
 */
export function fixtureFetch(adapterId: string, routes: readonly FixtureRoute[]): typeof fetch {
  const groups = new Map<string, { routes: FixtureRoute[]; next: number }>();
  const key = (route: FixtureRoute) =>
    JSON.stringify([(route.method ?? "GET").toUpperCase(), route.url]);
  for (const route of routes) {
    const routeKey = key(route);
    let group = groups.get(routeKey);
    if (!group) {
      group = { routes: [], next: 0 };
      groups.set(routeKey, group);
    }
    group.routes.push(route);
  }
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();

    const match = matchingFixtureRoute(
      new URL(url),
      routes.filter((r) => (r.method ?? "GET").toUpperCase() === method),
    );
    const group = match ? groups.get(key(match)) : undefined;
    const route = group?.routes[group.routes.length === 1 ? 0 : group.next++];
    if (!route) {
      throw new IntegrationSyncError(
        adapterId,
        `No fixture recorded for ${method} ${url} — fixtures must cover every call an import makes.`,
        { url },
      );
    }
    return new Response(JSON.stringify(route.json), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return impl as typeof fetch;
}

/**
 * `GET`/parse JSON with adapter-grade error mapping (429 → RateLimitedError); the body is
 * read through the `MAX_JSON_BYTES` cap and charged to the optional per-run budget.
 */
export async function getJson<T>(
  adapterId: string,
  api: typeof fetch,
  url: string,
  init?: RequestInit,
  budget?: RunBudget,
): Promise<T> {
  const res = await api(url, init);
  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after");
    throw new RateLimitedError(
      adapterId,
      url,
      retryAfter ? Number.parseInt(retryAfter, 10) || undefined : undefined,
    );
  }
  if (!res.ok) {
    throw new IntegrationSyncError(adapterId, `The platform answered ${res.status} for ${url}.`, {
      url,
      status: res.status,
    });
  }
  return (await readJson(res, adapterId, url, undefined, budget)) as T;
}

/** `POST` JSON and parse the JSON answer, with the same error mapping. */
export async function postJson<T>(
  adapterId: string,
  api: typeof fetch,
  url: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  return getJson<T>(adapterId, api, url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
