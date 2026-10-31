// AUTHORED-BY Codex GPT-6.1-Sol
import {
  AutomaticCredentialBoundary,
  type Boundary,
  type ContextKey,
  CredentialBoundary,
  type HttpOptions,
  isWithin,
} from "@jeswr/reactive-authentication";
import { isLoopback } from "./options.js";
import type { PodAuthOptions } from "./types.js";

/** Static roots plus verified automatic roots, using the same context for every provider. */
export function createBoundary(
  options: PodAuthOptions,
  http: HttpOptions,
): Boundary & { contextKey: ContextKey; roots(): readonly string[] } {
  const insecure = options.allowInsecureLoopback === true;
  const eligible = (value: string | URL) => {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || (insecure && url.protocol === "http:" && isLoopback(url))) &&
      (options.boundary?.eligible?.(url) ?? true)
    );
  };
  const fixed = new CredentialBoundary(options.boundary?.roots, { allowInsecureHttp: insecure });
  const automatic =
    options.boundary?.automatic === false
      ? undefined
      : new AutomaticCredentialBoundary({ http, allowInsecureHttp: insecure, eligible });
  const roots = () => [...new Set([...fixed.entries, ...(automatic?.roots ?? [])])];
  return {
    roots,
    allows: (url) => eligible(url) && (fixed.allows(url) || automatic?.allows(url) === true),
    isCandidate: (url) => eligible(url) && automatic?.isCandidate(url) === true,
    ...(automatic === undefined
      ? {}
      : {
          discover: async (
            url: string,
            response: Response,
            context: { method: string; signal: AbortSignal },
          ) => await automatic.discover(url, response, context),
        }),
    contextKey: async (request) => {
      const url = new URL(request.url);
      url.hash = "";
      return (
        roots()
          .filter((r) =>
            r.endsWith("/")
              ? isWithin(url, r)
              : new URL(r).origin === url.origin && new URL(r).pathname === url.pathname,
          )
          .sort((a, b) => b.length - a.length)[0] ?? url.href
      );
    },
  };
}
