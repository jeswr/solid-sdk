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
import { granaryObjectToCanonical } from "./map.js";
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
/** Join a container URL (ending `/`) and a slug into a resource URL, safely. */
function resourceUrl(container, slug) {
    const base = container.endsWith("/") ? container : `${container}/`;
    // Resolve relative to the container so a slug cannot escape it (`..`/absolute);
    // strip any leading `/` to keep it container-relative.
    const cleaned = slug.replace(/^\/+/, "").replace(UNSAFE_SLUG, "-");
    const resolved = new URL(cleaned, base);
    // Defence-in-depth: the resolved URL MUST stay under the container.
    if (!resolved.toString().startsWith(base)) {
        throw new Error(`slug "${slug}" resolves outside the container ${base}`);
    }
    return resolved.toString();
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
    const base = container.endsWith("/") ? container : `${container}/`;
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
            const res = await writeFetch(url, { method: "PUT", headers, body });
            const ok = res.status >= 200 && res.status < 300;
            items.push({ index, url, written: ok, status: res.status });
            if (ok) {
                written++;
            }
            else {
                failed++;
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