// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Shared configuration types for the personal agent (NOW-PERSONAL-AGENT.md §2).
 *
 * The four halves — Reader, pod, Actor, outbox — meet ONLY at the pod. This module
 * holds the pod-container layout and owner identity they share, plus the credential
 * SEAMS. Every credential (a Gmail OAuth token, the pod's authenticated `fetch`, the
 * per-channel send tokens, the billed Anthropic API key) is an INJECTED seam — this
 * package never reads a secret from disk, an env var, or a URL, and never logs one.
 *
 * @packageDocumentation
 */
/** Assert that `container` is a syntactically safe owner-private container IRI. */
export function isSafeContainer(container) {
    if (typeof container !== "string" || container.length === 0)
        return false;
    let url;
    try {
        url = new URL(container);
    }
    catch {
        return false;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:")
        return false;
    if (url.search !== "" || url.hash !== "")
        return false;
    if (url.username !== "" || url.password !== "")
        return false;
    return url.pathname.endsWith("/");
}
//# sourceMappingURL=config.js.map