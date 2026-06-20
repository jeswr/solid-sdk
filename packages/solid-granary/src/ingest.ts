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

import type { CanonicalMessage } from "@jeswr/solid-chat-interop";
import { serializeAs2, serializeLongChat } from "@jeswr/solid-chat-interop";
import type { GranaryAs2 } from "./granary.js";
import { iterateObjects } from "./granary.js";
import { granaryObjectToCanonical } from "./map.js";

/** The on-pod write shape for imported messages. */
export type IngestFormat = "as2" | "longchat";

/** Options for {@link ingestGranary}. */
export interface IngestGranaryOptions {
  /**
   * The authed `fetch` used to PUT each message resource. Injectable so the import
   * is unit-testable with a stubbed fetch (no live server) and so the caller wires
   * in its own DPoP/WebID-authenticated fetch. Defaults to `globalThis.fetch`
   * (which is almost never what a real caller wants — pass an authed one).
   */
  readonly writeFetch?: typeof globalThis.fetch;
  /**
   * The container URL each message resource is written under (MUST end with `/`).
   * The container MUST already be owner-private — written resources inherit its
   * ACL; this module never broadens access (the owner-privacy contract).
   */
  readonly container: string;
  /**
   * The on-pod RDF shape to write — `"as2"` (the canonical ActivityStreams 2.0
   * write model, the default) or `"longchat"` (SolidOS `meeting:LongChat`, for the
   * SolidOS installed base). Both go through solid-chat-interop's typed serialisers.
   */
  readonly format?: IngestFormat;
  /**
   * Mint the resource SLUG for a message — returns the file name (relative to the
   * container, no leading slash). Defaults to a stable slug derived from the
   * message's source provenance / content (see {@link defaultSlug}) so re-syncing
   * the same source post overwrites the same resource (idempotent import + honours
   * source EDITS). Override to control naming.
   */
  readonly slug?: (msg: CanonicalMessage, index: number) => string;
  /**
   * Cap on the number of items imported from a Collection (default unbounded). Set
   * it to bound a hostile/huge feed so the import cannot be coerced into an
   * unbounded write loop.
   */
  readonly maxItems?: number;
  /**
   * When `true`, a per-item write failure is recorded and the import CONTINUES;
   * when `false` (the default — fail-closed) the import stops on the first write
   * error and rethrows it after recording the partial report.
   */
  readonly continueOnError?: boolean;
  /**
   * Conditional-write header for each PUT — `"if-none-match"` writes with
   * `If-None-Match: *` (create-only; a re-sync of an existing resource 412s and is
   * reported, never silently overwritten), `"overwrite"` writes unconditionally
   * (honour source edits on re-sync), `"none"` adds no conditional header. Default
   * `"overwrite"` (re-sync reflects source edits — the documented behaviour).
   */
  readonly conditional?: "if-none-match" | "overwrite" | "none";
}

/** The outcome of writing one message during an import. */
export interface IngestItemResult {
  /** Zero-based index of the message within the granary payload. */
  readonly index: number;
  /** The full resource URL written (or attempted). */
  readonly url: string;
  /** `true` if the PUT returned a 2xx status. */
  readonly written: boolean;
  /** The HTTP status, when a response was received. */
  readonly status?: number;
  /** A short error message when the write failed. */
  readonly error?: string;
}

/** The aggregate report returned by {@link ingestGranary}. */
export interface IngestGranaryResult {
  /** How many messages were extracted from the payload. */
  readonly total: number;
  /** How many were written successfully (2xx). */
  readonly written: number;
  /** How many failed. */
  readonly failed: number;
  /** Per-message outcome, in payload order. */
  readonly items: IngestItemResult[];
}

/** Characters not safe in a resource slug, collapsed to `-`. */
const UNSAFE_SLUG = /[^a-zA-Z0-9._-]+/g;

/**
 * A stable, filesystem-safe slug for a message, derived from its source provenance
 * (`provenance.derivedFrom` — the source permalink/id) when present, else its
 * content, hashed to a short token. Stability means a re-sync of the SAME source
 * post targets the SAME resource — so source EDITS overwrite in place and the import
 * is idempotent rather than duplicating. The `index` disambiguates collisions.
 */
export function defaultSlug(msg: CanonicalMessage, index: number): string {
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
function resourceUrl(container: string, slug: string): string {
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
function serialize(msg: CanonicalMessage, subject: string, format: IngestFormat): Promise<string> {
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
export async function ingestGranary(
  payload: GranaryAs2,
  options: IngestGranaryOptions,
): Promise<IngestGranaryResult> {
  const {
    writeFetch = globalThis.fetch,
    container,
    format = "as2",
    slug = defaultSlug,
    maxItems = Number.POSITIVE_INFINITY,
    continueOnError = false,
    conditional = "overwrite",
  } = options;

  if (typeof container !== "string" || container.length === 0) {
    throw new TypeError("ingestGranary: `container` is required");
  }
  const base = container.endsWith("/") ? container : `${container}/`;

  const items: IngestItemResult[] = [];
  let written = 0;
  let failed = 0;
  let index = 0;

  for (const obj of iterateObjects(payload, maxItems)) {
    const msg = granaryObjectToCanonical(obj);
    const url = resourceUrl(base, slug(msg, index));
    const subject = `${url}#it`;

    try {
      const body = await serialize(msg, subject, format);
      const headers: Record<string, string> = { "content-type": "text/turtle" };
      if (conditional === "if-none-match") headers["if-none-match"] = "*";

      const res = await writeFetch(url, { method: "PUT", headers, body });
      const ok = res.status >= 200 && res.status < 300;
      items.push({ index, url, written: ok, status: res.status });
      if (ok) {
        written++;
      } else {
        failed++;
        if (!continueOnError) {
          return { total: index + 1, written, failed, items };
        }
      }
    } catch (err) {
      failed++;
      const error = err instanceof Error ? err.message : String(err);
      items.push({ index, url, written: false, error });
      if (!continueOnError) {
        // Fail-closed: surface the partial report by throwing with it attached.
        throw Object.assign(new Error(`ingestGranary: write failed at item ${index}: ${error}`), {
          result: { total: index + 1, written, failed, items } satisfies IngestGranaryResult,
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
export function granaryToCanonical(payload: GranaryAs2, maxItems?: number): CanonicalMessage[] {
  const out: CanonicalMessage[] = [];
  for (const obj of iterateObjects(payload, maxItems ?? Number.POSITIVE_INFINITY)) {
    out.push(granaryObjectToCanonical(obj));
  }
  return out;
}
