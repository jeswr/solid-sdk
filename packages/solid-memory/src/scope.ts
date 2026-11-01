// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { assertWithinPodScope, PodScopeError } from "@jeswr/guarded-fetch";

/**
 * Container-scope guard for `MemoryStore` (see `./store.ts`).
 *
 * The store's container is its primary SECURITY surface: every URL the store
 * issues an authenticated request to MUST lie under that container. This module
 * is the one reviewed home for normalising the container and asserting that a
 * target URL is `container` itself or a strict descendant of it — a defence-in-
 * depth check applied to every CRUD target and every listed member, so a hostile
 * / buggy server cannot make the store touch a foreign origin or escape the
 * container sub-tree. (Adapted from `@jeswr/unstorage-solid`'s `keys.ts`.)
 *
 * **Pure core, no platform.** Only the WHATWG `URL` global — no `node:*`, no RDF.
 */

/**
 * Normalise a container URL to exactly one trailing slash. Throws if it is not an
 * absolute http(s) URL. A container must not carry a query or fragment.
 */
export function normalizeContainer(container: string): string {
  let url: URL;
  try {
    url = new URL(container);
  } catch {
    throw new Error(`[solid-memory] \`container\` must be an absolute URL, got: ${container}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `[solid-memory] \`container\` must be an http(s) URL, got protocol: ${url.protocol}`,
    );
  }
  // Refuse embedded credentials (https://user:pass@host/…): a credential does not
  // belong in an address (it leaks into logs/errors), and `fetch` rejects such URLs
  // anyway — fail here, clearly, at construction (suite convention, cf.
  // n8n-nodes-solid's pod-scope guard).
  if (url.username !== "" || url.password !== "") {
    throw new Error("[solid-memory] `container` must not embed credentials (userinfo refused)");
  }
  // Collapse the path to a single trailing slash; preserve everything else.
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  // A container is an address, not a query/fragment target.
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * Fail-closed assertion that `url` is within the store's container sub-tree:
 * same origin and a path prefixed by the container path.
 *
 * **The container ROOT itself is rejected by default.** A `MemoryStore`'s CRUD
 * operations (`get`/`update`/`delete`/`forget`/`unforget` and the minted `create`
 * URL) act on individual `mem:MemoryItem` RESOURCES — the container root is never
 * one of them. A caller (or a bug) that passes the store's own container root must
 * NOT be allowed to PUT/DELETE/GET it as if it were a managed resource (a footgun
 * that could clobber or read the container itself), so by default `url === container`
 * (after trailing-slash normalisation) is REFUSED. Pass `{ allowRoot: true }` for
 * the one legitimate case — validating a member URL that may *be* the container in a
 * listing — where the caller skips/handles the root separately.
 *
 * Guards against any encoding/normalisation trick producing a URL outside the pod
 * sub-tree the store owns.
 * @deprecated Use `assertWithinPodScope` from `@jeswr/guarded-fetch` for new callers.
 */
export function assertWithinBase(
  container: string,
  url: string,
  opts?: { allowRoot?: boolean },
): void {
  // The legacy API accepts ABSOLUTE targets only; the shared primitive also
  // accepts relative references, so parse without a base before delegating.
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new Error("[solid-memory] target URL is invalid");
  }
  try {
    assertWithinPodScope(container, target.href, {
      // The shared primitive aliases `/alice` to `/alice/`. The old API rejects
      // that alias, including `/alice/` for `/alice//`, even for container operations.
      allowRoot: opts?.allowRoot === true && target.pathname === new URL(container).pathname,
    });
  } catch (error) {
    if (!(error instanceof PodScopeError)) throw error;
    // Retain the existing diagnostic vocabulary without copying scope logic.
    throw new Error(
      `[solid-memory] ${error.message
        .replace("escapes pod", "escapes container")
        .replace(
          "is the pod base itself",
          "is the container root (escapes container path for resource operations)",
        )
        .replace(
          "must not embed credentials (user:pass@)",
          "embeds credentials (userinfo refused)",
        )}`,
      { cause: error },
    );
  }
}

/** True iff `url` is a container (LDP convention: a trailing slash on the path). */
export function isContainerUrl(url: string): boolean {
  // Compare on the path so a query/fragment (which a container address never has)
  // cannot fool the check.
  try {
    return new URL(url).pathname.endsWith("/");
  } catch {
    return url.endsWith("/");
  }
}
