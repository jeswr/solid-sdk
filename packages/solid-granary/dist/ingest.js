// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `ingestGranary` — write granary `format=as2` social posts/feeds into a Solid pod
 * as owner-private canonical chat messages.
 *
 * The flow is a THIN adapter over `@jeswr/solid-chat-interop`:
 *   granary AS2 (single object OR a Collection of items)
 *     → {@link granaryObjectToCanonical} (map.ts) → {@link CanonicalMessage}
 *     → `serializeAs2` / `serializeLongChat` (solid-chat-interop typed-accessor
 *       SERIALISERS — never hand-built triples)
 *     → PUT under the caller's container via an injectable authed `fetch`.
 *
 * OWNER-PRIVACY CONTRACT (load-bearing — see SECURITY in the README). Imported
 * third-party data lands in the user's pod and MUST default to owner-only; this
 * module NEVER writes an ACL/ACR that broadens access and never auto-shares. The
 * effective access of each written resource is whatever the TARGET CONTAINER's ACL
 * grants — so the caller MUST pass a container that is already owner-private (a
 * freshly-provisioned private container inherits owner-only access). The module
 * fails CLOSED on a write error (it stops on the first failure unless
 * `continueOnError` is set) and returns a per-item report so the caller can audit
 * exactly what was written.
 *
 * The optional remote fetch-from-granary helper lives in `remote.ts` and is the
 * ONLY place a user-configured URL is dereferenced — always through
 * `@jeswr/guarded-fetch` (SSRF-safe). This module takes an already-parsed payload.
 */
import { serializeAs2, serializeLongChat } from "@jeswr/solid-chat-interop";
import { iterateObjects } from "./granary.js";
import { granaryObjectToCanonical, safeHttpIri } from "./map.js";
/** Characters not safe in a resource slug, collapsed to `-`. */
const UNSAFE_SLUG = /[^a-zA-Z0-9._-]+/g;
/**
 * A stable, filesystem-safe slug for a message, derived from its source provenance
 * (`provenance.derivedFrom` — the source permalink/id) when present, else its
 * content, hashed to a short token. Stability means a re-sync of the SAME source
 * post targets the SAME resource — so source EDITS overwrite in place and the import
 * is idempotent rather than duplicating. The `index` disambiguates collisions.
 */
export function defaultSlug(msg, index) {
    const seed = msg.provenance?.derivedFrom ?? msg.id ?? msg.content ?? String(index);
    // A small, dependency-free FNV-1a hash — deterministic, no crypto needed (this is
    // a naming token, not a security primitive).
    let h = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    const token = h.toString(16).padStart(8, "0");
    return `granary-${token}.ttl`;
}
/**
 * Redact any userinfo (`user:pass@`) from a URL string so credentials NEVER reach an
 * error message / log. Deliberately regex-based (not `new URL()`) so it also redacts a
 * MALFORMED / non-absolute value — the exact case whose error path echoes the raw
 * string. Only the authority userinfo (between `//` and the first `@`, before any path)
 * is stripped.
 */
function redactUrl(raw) {
    return raw.replace(/(\/\/)[^/@\s]*@/g, "$1***@");
}
/**
 * Validate the caller-configured target container: it MUST be an absolute http(s) URL,
 * with NO embedded credentials and NO IRIREF-illegal characters. A scheme-relative /
 * non-absolute value would make `new URL(slug, base)` throw unpredictably; a
 * `file:`/`javascript:` base is not a pod; a `https://user:pass@…` base would embed
 * credentials in every write URL (a credential-in-URL leak — SECURITY check 5); and a
 * container path carrying `|`/`^`/backtick etc. would flow UNENCODED into the RDF
 * SUBJECT `<container…#it>` (the slug is already sanitised, so the container is the only
 * remaining source), yielding malformed Turtle a strict downstream parser rejects. Fail
 * closed on any of these — and every error message REDACTS userinfo first, so a bad
 * `user:pass@` value can never leak its credentials into a thrown error / log.
 */
function assertValidContainer(container) {
    const safe = redactUrl(container);
    let u;
    try {
        u = new URL(container);
    }
    catch {
        throw new TypeError(`ingestGranary: \`container\` must be an absolute URL: ${safe}`);
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
        throw new TypeError(`ingestGranary: \`container\` must be an http(s) URL: ${safe}`);
    }
    if (u.username !== "" || u.password !== "") {
        throw new TypeError("ingestGranary: `container` must not embed credentials (user:pass@)");
    }
    // `safeHttpIri` canonicalises then percent-encodes the residual IRIREF-illegal chars.
    // If it differs from the plain canonical `href`, the container carries such a char —
    // which would land UNENCODED in the RDF subject (the subject is built from the raw
    // write URL, never re-encoded). Reject rather than silently rewrite the write target.
    if (safeHttpIri(container) !== u.href) {
        throw new TypeError(`ingestGranary: \`container\` contains characters illegal in an RDF IRI: ${safe}`);
    }
}
/** Join a container URL (ending `/`) and a slug into a resource URL, safely. */
function resourceUrl(container, slug) {
    const base = container.endsWith("/") ? container : `${container}/`;
    // Resolve relative to the container so a slug cannot escape it (`..`/absolute);
    // strip any leading `/` to keep it container-relative.
    const cleaned = slug.replace(/^\/+/, "").replace(UNSAFE_SLUG, "-");
    if (cleaned.length === 0) {
        throw new Error(`slug "${slug}" is empty after sanitisation (would target the container)`);
    }
    const resolved = new URL(cleaned, base).toString();
    // Defence-in-depth: the resolved URL MUST stay STRICTLY under the container — a
    // slug of "" / "." / "/" / "./" resolves to the container URL itself, which would
    // PUT to the container rather than a child resource; reject it.
    if (!resolved.startsWith(base) || resolved === base) {
        throw new Error(`slug "${slug}" does not resolve to a child of the container ${base}`);
    }
    return resolved;
}
/** Serialise a canonical message into the requested on-pod RDF shape (Turtle). */
function serialize(msg, subject, format) {
    return format === "longchat" ? serializeLongChat(msg, subject) : serializeAs2(msg, subject);
}
/**
 * Ingest a granary `format=as2` payload (a single AS2 object OR an AS2 Collection
 * of items) into a Solid pod, writing each message as an owner-private resource
 * under `options.container`. Returns a per-item report.
 *
 * The container MUST already be owner-private — this never broadens access and never
 * auto-shares (the owner-privacy contract). Pass an authed `writeFetch`.
 */
export async function ingestGranary(payload, options) {
    const { writeFetch = globalThis.fetch, container, format = "as2", slug = defaultSlug, maxItems = Number.POSITIVE_INFINITY, continueOnError = false, conditional = "overwrite", } = options;
    if (typeof container !== "string" || container.length === 0) {
        throw new TypeError("ingestGranary: `container` is required");
    }
    assertValidContainer(container);
    // Use the WHATWG-normalised form as the base so the write URL AND the RDF subject are
    // byte-consistent with what `fetch` will actually request (path residual chars like
    // `^`/`` ` ``/`{`/`}` are percent-encoded identically). This also keeps `resourceUrl`'s
    // containment check from tripping on a raw-vs-normalised mismatch. (`|` — the one char
    // the URL parser leaves literal — is already rejected by `assertValidContainer`.)
    const canonical = new URL(container).href;
    const base = canonical.endsWith("/") ? canonical : `${canonical}/`;
    const items = [];
    let written = 0;
    let failed = 0;
    let index = 0;
    for (const obj of iterateObjects(payload, maxItems)) {
        const msg = granaryObjectToCanonical(obj);
        const url = resourceUrl(base, slug(msg, index));
        const subject = `${url}#it`;
        try {
            const body = await serialize(msg, subject, format);
            const headers = { "content-type": "text/turtle" };
            if (conditional === "if-none-match")
                headers["if-none-match"] = "*";
            // `redirect: "manual"` is load-bearing, not cosmetic: `writeFetch` is a
            // DPoP/WebID-authenticated fetch, so if the pod (or a hostile intermediary)
            // answers a PUT with a 3xx, the default `redirect: "follow"` would re-send the
            // authorization + DPoP proof AND the message body to the redirect target — a
            // cross-origin credential + data leak. Forcing "manual" makes the authed fetch
            // return the redirect WITHOUT following it; we then treat any 3xx / opaque
            // redirect as a FAILED write (fail-closed), never a success.
            const res = await writeFetch(url, { method: "PUT", headers, body, redirect: "manual" });
            const redirected = res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);
            const ok = !redirected && res.status >= 200 && res.status < 300;
            if (ok) {
                items.push({ index, url, written: true, status: res.status });
                written++;
            }
            else {
                failed++;
                items.push(redirected
                    ? {
                        index,
                        url,
                        written: false,
                        status: res.status || undefined,
                        error: `write refused a redirect (${res.type || res.status}); not followed to protect DPoP/WebID credentials`,
                    }
                    : { index, url, written: false, status: res.status });
                if (!continueOnError) {
                    return { total: index + 1, written, failed, items };
                }
            }
        }
        catch (err) {
            failed++;
            const error = err instanceof Error ? err.message : String(err);
            items.push({ index, url, written: false, error });
            if (!continueOnError) {
                // Fail-closed: surface the partial report by throwing with it attached.
                throw Object.assign(new Error(`ingestGranary: write failed at item ${index}: ${error}`), {
                    result: { total: index + 1, written, failed, items },
                    cause: err,
                });
            }
        }
        index++;
    }
    return { total: index, written, failed, items };
}
/**
 * Map a granary payload to canonical messages WITHOUT writing — the pure-transform
 * half of {@link ingestGranary}, for callers that want to inspect / batch the
 * messages before persisting. Same extraction + untrusted-input hardening.
 */
export function granaryToCanonical(payload, maxItems) {
    const out = [];
    for (const obj of iterateObjects(payload, maxItems ?? Number.POSITIVE_INFINITY)) {
        out.push(granaryObjectToCanonical(obj));
    }
    return out;
}
//# sourceMappingURL=ingest.js.map