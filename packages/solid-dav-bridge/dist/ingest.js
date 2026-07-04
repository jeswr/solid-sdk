// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `importCalendar` / `importAddressBook` — read CalDAV iCalendar VEVENTs / CardDAV
 * vCards and write them into a Solid pod as owner-private RDF resources.
 *
 * The flow mirrors the suite's granary-ingest pattern:
 *   DAV text (`icsText` / `vcfText`, OR a `davUrl` routed through the SSRF guard)
 *     → parse components (`ical.ts`)
 *     → {@link veventToEvent} / {@link vcardToContact} (pure mappers, map.ts)
 *     → serialise (n3.Writer for events; `@jeswr/solid-task-model`'s buildPerson +
 *       storeToTurtle for contacts — never hand-built triples)
 *     → PUT under the caller's container via an injectable authed `writeFetch`.
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
 * The optional remote fetch-from-DAV helper lives in `remote.ts` and is the ONLY
 * place a user-configured URL is dereferenced — always through `@jeswr/guarded-fetch`
 * (SSRF-safe). When a caller passes `icsText` / `vcfText` directly, NO network is
 * touched (the unit-testable path).
 */
import { assertWithinPodScope, normalizePodBase } from "@jeswr/guarded-fetch";
import { serializePerson } from "@jeswr/solid-task-model/contacts";
import { Store, Writer } from "n3";
import { findComponents, parseComponents } from "./ical.js";
import { vcardToContact, veventToEvent } from "./map.js";
import { fetchDav } from "./remote.js";
import { EVENT_PREFIXES } from "./vocab.js";
/** Characters not safe in a resource slug, collapsed to `-`. */
const UNSAFE_SLUG = /[^a-zA-Z0-9._-]+/g;
/**
 * A small, dependency-free FNV-1a hash → a short hex token. Deterministic; this is
 * a NAMING token, not a security primitive.
 */
function fnv1a(seed) {
    let h = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
}
/**
 * A stable, filesystem-safe slug for an event, derived from its `UID` (so a
 * re-sync of the SAME source event targets the SAME resource — idempotent + honours
 * edits), else its subject, hashed to a short token.
 */
export function defaultEventSlug(event, index) {
    const seed = event.uid ?? event.subject ?? String(index);
    return `event-${fnv1a(seed)}.ttl`;
}
/** A stable, filesystem-safe slug for a contact, derived from its `UID`. */
export function defaultContactSlug(contact, index) {
    const seed = contact.uid ?? contact.data.name ?? String(index);
    return `contact-${fnv1a(seed)}.ttl`;
}
/**
 * Join a container URL (a POD-SCOPE base — already normalised by
 * {@link resolveContainer}) and a slug into a resource URL, SAFELY. The slug is
 * sanitised (path separators / traversal collapse to `-`) and the resolved URL MUST
 * stay STRICTLY under the container: containment is decided by
 * `@jeswr/guarded-fetch`'s {@link assertWithinPodScope} (`allowRoot: false`) —
 * the suite's ONE reviewed pod-scope primitive — not a bespoke raw-string prefix
 * check. It parses via `new URL()`, resolves the (already-sanitised) slug against
 * the container with real dot-segment collapsing, and rejects query/fragment
 * smuggling, encoded path delimiters, scheme confusion, and a slug of "" / "." /
 * "/" that would resolve to the container itself (these defences are load-bearing).
 */
function resourceUrl(container, slug) {
    const cleaned = slug.replace(/^\/+/, "").replace(UNSAFE_SLUG, "-");
    if (cleaned.length === 0) {
        throw new Error(`slug "${slug}" is empty after sanitisation (would target the container)`);
    }
    try {
        return assertWithinPodScope(container, cleaned, { allowRoot: false });
    }
    catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`slug "${slug}" does not resolve to a child of the container ${container}: ${reason}`, { cause: err });
    }
}
/** Serialise event quads to Turtle via n3.Writer (typed quads — never hand-built strings). */
function eventToTurtle(quads) {
    const writer = new Writer({ prefixes: { ...EVENT_PREFIXES } });
    // Use a fresh Store so blank nodes are emitted as `[ … ]` where appropriate.
    const store = new Store(quads);
    writer.addQuads([...store]);
    return new Promise((resolve, reject) => {
        writer.end((error, result) => (error ? reject(error) : resolve(result)));
    });
}
/**
 * Resolve the base container to `@jeswr/guarded-fetch`'s canonical pod-scope base
 * form: an absolute http(s) URL, exactly one trailing `/`, no query/fragment, no
 * embedded credentials, no encoded path delimiter (`normalizePodBase`). This closes
 * the raw-string smuggling class a bespoke `container.endsWith("/")` check missed —
 * e.g. a container URL whose PATH lacks a trailing slash but whose QUERY/FRAGMENT
 * happens to end in "/" (`https://pod.example/other?x=/`) used to fool the textual
 * check into treating `/other` as already-slash-terminated, so a resolved child
 * would land as a SIBLING of `/other` instead of nested under it. `normalizePodBase`
 * parses the URL properly, decides the trailing slash from the PATH alone, and
 * discards any query/fragment — the container can never be misread this way again.
 */
function resolveContainer(container) {
    if (typeof container !== "string" || container.length === 0) {
        throw new TypeError("import: `container` is required");
    }
    try {
        return normalizePodBase(container);
    }
    catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new TypeError(`import: \`container\` is invalid: ${reason}`, { cause: err });
    }
}
/**
 * Import iCalendar VEVENTs into a Solid pod as `schema:Event` Turtle resources.
 *
 * Pass EITHER `icsText` (already-fetched, no network) OR `davUrl` (routed through
 * the SSRF guard). Each VEVENT becomes one owner-private resource under
 * `options.container`. Returns a per-item report.
 */
export async function importCalendar(options) {
    const { writeFetch = globalThis.fetch, maxItems = Number.POSITIVE_INFINITY, continueOnError = false, conditional = "overwrite", slug = defaultEventSlug, } = options;
    const base = resolveContainer(options.container);
    const text = await sourceText(options.icsText, options.davUrl, {
        davAuth: options.davAuth,
        davFetch: options.davFetch,
        accept: "text/calendar",
    });
    const roots = parseComponents(text);
    const vevents = findComponents(roots, "VEVENT");
    const prepared = [];
    let count = 0;
    for (const vevent of vevents) {
        if (count >= maxItems)
            break;
        // The subject is the resource `#it` — but we need the slug (from the UID) to
        // mint the URL, so map first with a placeholder subject, then re-key.
        const tmp = veventToEvent(vevent, { subject: "urn:placeholder" });
        const url = resourceUrl(base, slug(tmp, count));
        const subject = `${url}#it`;
        const mapped = veventToEvent(vevent, { subject });
        prepared.push({ url, serialise: () => eventToTurtle(mapped.quads) });
        count++;
    }
    return runWrite(prepared, writeFetch, conditional, continueOnError);
}
/**
 * Import vCards into a Solid pod as SolidOS-readable `vcard:Individual` Turtle
 * resources (via `@jeswr/solid-task-model`'s `buildPerson` — never hand-built
 * triples).
 *
 * Pass EITHER `vcfText` (already-fetched, no network) OR `davUrl` (routed through
 * the SSRF guard). Each vCard becomes one owner-private resource under
 * `options.container`. Returns a per-item report.
 */
export async function importAddressBook(options) {
    const { writeFetch = globalThis.fetch, maxItems = Number.POSITIVE_INFINITY, continueOnError = false, conditional = "overwrite", slug = defaultContactSlug, } = options;
    const base = resolveContainer(options.container);
    const text = await sourceText(options.vcfText, options.davUrl, {
        davAuth: options.davAuth,
        davFetch: options.davFetch,
        accept: "text/vcard",
    });
    const roots = parseComponents(text);
    const vcards = findComponents(roots, "VCARD");
    const prepared = [];
    let count = 0;
    for (const vcard of vcards) {
        if (count >= maxItems)
            break;
        const mapped = vcardToContact(vcard, { inAddressBook: options.inAddressBook });
        const url = resourceUrl(base, slug(mapped, count));
        const personDoc = url;
        // serializePerson(personDoc, data) builds <personDoc>#this via the task-model's
        // buildPerson (structured vcard:hasEmail nodes) and serialises it to Turtle —
        // never hand-built triples.
        prepared.push({ url, serialise: () => serializePerson(personDoc, mapped.data) });
        count++;
    }
    return runWrite(prepared, writeFetch, conditional, continueOnError);
}
/**
 * Resolve the source text: the directly-passed text if present, else fetch the
 * `davUrl` through the SSRF guard. Exactly one of the two MUST be supplied.
 */
async function sourceText(directText, davUrl, davOpts) {
    if (typeof directText === "string")
        return directText;
    if (typeof davUrl === "string" && davUrl.length > 0) {
        return fetchDav(davUrl, {
            davAuth: davOpts.davAuth,
            ...(davOpts.davFetch ? { fetch: davOpts.davFetch } : {}),
            accept: davOpts.accept,
        });
    }
    throw new TypeError("import: pass either the source text (icsText/vcfText) or a davUrl");
}
/**
 * Run the prepared writes with the fail-closed / continue-on-error discipline.
 * Kept as the single, audited write loop (the inline closure in an earlier draft
 * was hard to review; this is the canonical implementation).
 */
async function runWrite(prepared, writeFetch, conditional, continueOnError) {
    const items = [];
    let written = 0;
    let failed = 0;
    for (let index = 0; index < prepared.length; index++) {
        const item = prepared[index];
        if (!item)
            continue;
        const { url } = item;
        try {
            const body = await item.serialise();
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
                throw Object.assign(new Error(`import: write failed at item ${index}: ${error}`), {
                    result: { total: index + 1, written, failed, items },
                    cause: err,
                });
            }
        }
    }
    return { total: prepared.length, written, failed, items };
}
//# sourceMappingURL=ingest.js.map