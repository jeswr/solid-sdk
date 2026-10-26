// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { FixtureRoute } from "./types.js";

const REDACTED = "[REDACTED]";
const FORBIDDEN =
  /authorization|token|cookie|secret|password|credential|apikey|email|phone|address|birth|name|login|account|user|contact|ssn|cardnumber|cvv|session|location|latitude|longitude|message|content|description|bio|avatar|photo/i;

export interface RecorderRoute {
  /** Public, static fixture prefix. No credentials, query or fragment. Never derived from a request. */
  readonly url: string;
  /** Explicit non-personal scalar paths, e.g. ["items.*.id", "total"]. No blanket wildcards. */
  readonly safeFields?: readonly string[];
}

/** Fail closed: unlisted fields are omitted, and sensitive keys cannot be allowlisted.
 * Only explicit structural paths survive, so personal data used as object keys is removed too.
 */
export function redactFixture(value: unknown, safeFields: readonly string[] = []): unknown {
  const paths = safeFields.map((path) => {
    const parts = path.split(".");
    if (parts.at(-1) === "*" || parts.some((part) => part.length === 0))
      throw new Error("Recorder safe fields must name scalar fields, not blanket wildcards.");
    return parts;
  });
  function visit(input: unknown, candidates: readonly string[][]): unknown {
    if (Array.isArray(input)) {
      const next = candidates.filter((p) => p[0] === "*").map((p) => p.slice(1));
      return input.map((item) => visit(item, next));
    }
    if (input !== null && typeof input === "object") {
      const result: Record<string, unknown> = Object.create(null);
      for (const [key, item] of Object.entries(input)) {
        if (FORBIDDEN.test(key.replace(/[^a-z]/gi, ""))) continue;
        const next = candidates.filter((p) => p[0] === key).map((p) => p.slice(1));
        if (next.length) result[key] = visit(item, next);
      }
      return result;
    }
    // Scalars, including numeric IDs, require the host to declare them non-personal.
    return candidates.some((p) => p.length === 0) ? input : REDACTED;
  }
  return visit(value, paths);
}

/** Wrap an injected source transport. Only redacted response JSON is exposed for saving.
 * Request/response headers, request bodies and dynamic request URLs are never recorded.
 * The original Response remains available to the adapter, with its body unconsumed.
 */
export function createFixtureRecorder(options: {
  readonly fetch: typeof fetch;
  readonly routes: readonly RecorderRoute[];
}) {
  const routes = options.routes.map((route) => {
    const url = new URL(route.url);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
      throw new Error("Recorder routes must be public HTTPS prefixes without query or fragment.");
    return { ...route, url: url.href };
  });
  const recorded = new Map<number, FixtureRoute>();
  let nextRequest = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    // Constructing a new Request from a POST Request transfers its body stream.
    // Read only URL/method metadata so the source transport receives the original body.
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const route = routes.find((r) => {
      const prefix = new URL(r.url);
      return (
        url.origin === prefix.origin &&
        (url.pathname === prefix.pathname ||
          url.pathname.startsWith(
            prefix.pathname.endsWith("/") ? prefix.pathname : `${prefix.pathname}/`,
          ))
      );
    });
    if (!route) throw new Error("Request has no configured public recorder route.");
    const sequence = nextRequest++;
    const response = await options.fetch(input, init);
    let body: unknown;
    try {
      body = await response.clone().json();
    } catch {
      throw new Error("Fixture recorder accepts JSON responses only.");
    }
    recorded.set(sequence, {
      url: route.url,
      method,
      status: response.status,
      json: redactFixture(body, route.safeFields),
    });
    return response;
  };
  return {
    fetch: fetchImpl,
    /** Detached serialisable snapshots; host chooses the save destination. */
    fixtures: (): FixtureRoute[] =>
      structuredClone([...recorded].sort(([a], [b]) => a - b).map(([, route]) => route)),
  };
}
