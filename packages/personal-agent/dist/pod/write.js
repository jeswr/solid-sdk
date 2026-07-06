// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The ONE hardened pod-write primitive shared by the ACL writer, the Actor's
 * proposal writes, and the outbox executor's receipt/mark-executed writes. Every
 * write is trust-bearing (it can create or overwrite owner-private data), so it:
 *
 *  - refuses a 3xx REDIRECT before reading the status (`assertNoRedirect`, the
 *    bridge's own guard — no divergent copy), so a poisoned resource cannot bounce
 *    a credentialed write to another origin;
 *  - is optionally SCOPE-GUARDED strictly within a base container (`isWithinBase`),
 *    so a write can never escape its configured container;
 *  - goes through the caller's INJECTED authed `fetch` (the pod is the owner's own
 *    trusted origin — NOT the SSRF guard).
 *
 * It returns the raw `Response` so a caller can inspect a conditional-write status
 * (`412` on a failed `If-Match`/`If-None-Match`); {@link throwIfNotWritten} is the
 * "a write failure THROWS" helper for unconditional writes.
 */
import { isWithinBase } from "@jeswr/agentic-legacy-bridge";
/**
 * Fail CLOSED on any HTTP redirect on a trust-bearing request. Call BEFORE reading `res.ok`.
 * (The bridge enforces the same on its own writes but does not re-export its guard, so this
 * is the ONE local copy every pod request in this package shares.)
 */
export function refuseRedirect(res, method, url) {
    if (res.status >= 300 && res.status < 400) {
        throw new Error(`${method} ${url}: refused HTTP ${res.status} redirect on a trust-bearing request`);
    }
}
/** Validate a pod write target is a safe absolute http(s) URL with no embedded creds. */
function assertSafeTarget(url, base) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        throw new Error(`pod write: not an absolute URL: ${url}`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error(`pod write: non-http(s) URL refused: ${url}`);
    }
    if (parsed.username !== "" || parsed.password !== "") {
        throw new Error("pod write: URL with embedded credentials refused");
    }
    if (base !== undefined && !isWithinBase(url, base)) {
        throw new Error(`pod write: target ${url} escapes its container ${base}`);
    }
}
/**
 * PUT `body` to `url` through the injected authed `fetch`, refusing redirects and
 * (optionally) enforcing the container scope. Returns the `Response` (inspect its
 * `.status` for a conditional-write `412`).
 */
export async function putResource(fetchFn, url, body, options) {
    assertSafeTarget(url, options.base);
    const headers = { "content-type": options.contentType };
    if (options.ifNoneMatch)
        headers["if-none-match"] = options.ifNoneMatch;
    if (options.ifMatch)
        headers["if-match"] = options.ifMatch;
    const res = await fetchFn(url, { method: "PUT", headers, body, redirect: "manual" });
    refuseRedirect(res, "PUT", url);
    return res;
}
/** Throw unless the response is a 2xx — the "a write failure THROWS" contract. */
export function throwIfNotWritten(res, url) {
    if (!res.ok) {
        throw new Error(`pod write to ${url} failed: HTTP ${res.status}`);
    }
    return res;
}
//# sourceMappingURL=write.js.map