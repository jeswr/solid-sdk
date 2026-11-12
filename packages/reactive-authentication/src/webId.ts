// AUTHORED-BY Codex GPT-6.1-Sol
import type { Quad } from "@rdfjs/types";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Parser } from "n3";
import { ReactiveAuthenticationError } from "./ReactiveAuthenticationError.js";
import { SimpleDataset } from "./SimpleDataset.js";
import { type HttpOptions, secureDocumentFetch } from "./transport.js";
import { parseHttpUrl } from "./url.js";

const solid = "http://www.w3.org/ns/solid/terms#";
const pim = "http://www.w3.org/ns/pim/space#";
const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

export class WebIdAgent extends TermWrapper {
  get oidcIssuers(): Set<URL> {
    return SetFrom.subjectPredicate(this, `${solid}oidcIssuer`, NamedNodeAs.url, NamedNodeFrom.url);
  }

  get storages(): Set<URL> {
    return SetFrom.subjectPredicate(this, `${pim}storage`, NamedNodeAs.url, NamedNodeFrom.url);
  }
}

const PROFILE_MAX_BYTES = 256 * 1024;
const PROFILE_TIMEOUT_MS = 8_000;

/** Fetches Turtle only, with a byte cap, deadline and scheme-checked redirects. */
export async function fetchTurtle(
  url: URL,
  signal: AbortSignal | undefined,
  http?: HttpOptions,
): Promise<{ quads: Quad[]; base: string }> {
  const timeout = AbortSignal.timeout(PROFILE_TIMEOUT_MS);
  const boundedSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  const { response, url: finalUrl } = await secureDocumentFetch(
    url,
    "text/turtle",
    boundedSignal,
    http,
  );
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new ReactiveAuthenticationError(
      `${url.href} could not be retrieved (${response.status})`,
    );
  }

  const text = await readProfile(response, boundedSignal);
  const base = finalUrl.href;
  try {
    return { quads: new Parser({ baseIRI: base }).parse(text), base };
  } catch (error) {
    throw new ReactiveAuthenticationError(`${url.href} could not be parsed as Turtle`, error);
  }
}

/** Count received bytes rather than trusting Content-Length, and cancel stalled/oversized bodies. */
async function readProfile(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  const abort = () => {
    void reader?.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    if (Number(response.headers.get("content-length")) > PROFILE_MAX_BYTES)
      throw new Error(`WebID profile exceeds ${PROFILE_MAX_BYTES} byte limit`);
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > PROFILE_MAX_BYTES)
        throw new Error(`WebID profile exceeds ${PROFILE_MAX_BYTES} byte limit`);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  } catch (error) {
    // Cancellation is best effort: a misbehaving source must not hold up the rejection.
    void reader?.cancel(error).catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    reader?.releaseLock();
  }
}

/**
 * The issuers a WebID profile trusts (`solid:oidcIssuer`), per Solid-OIDC §6.1. The RDF body is
 * canonical; Link headers are not consulted.
 */
export async function issuersFromWebId(
  webId: URL,
  signal?: AbortSignal,
  http?: HttpOptions,
): Promise<URL[]> {
  const { quads } = await fetchTurtle(webId, signal, http);
  // Redirects locate the document; trust statements must still describe the original WebID.
  const agent = new WebIdAgent(webId.href, new SimpleDataset(quads), DataFactory);
  return [...agent.oidcIssuers];
}

/** Whether `issuer` is listed by the WebID profile (exact issuer identifier match, see {@link sameIssuer}). */
export async function webIdTrustsIssuer(
  webId: URL,
  issuer: string,
  signal?: AbortSignal,
  http?: HttpOptions,
): Promise<boolean> {
  const issuers = await issuersFromWebId(webId, signal, http);
  return issuers.some((i) => sameIssuer(i.href, issuer));
}

/**
 * OpenID issuer identifiers are compared exactly (OIDC Core §3.1.3.7, RFC 9207). The only equivalence
 * applied is for origin-only issuers, because RDF/URL parsing turns `https://op.example` into
 * `https://op.example/`; `https://op.example/tenant` and `https://op.example/tenant/` stay distinct.
 */
export function sameIssuer(a: string, b: string): boolean {
  return a === b || (isOriginOnly(a) && isOriginOnly(b) && new URL(a).origin === new URL(b).origin);
}

function isOriginOnly(issuer: string): boolean {
  const url = parseHttpUrl(issuer);
  return (
    url !== undefined &&
    url.search === "" &&
    url.hash === "" &&
    (issuer === url.origin || issuer === `${url.origin}/`)
  );
}

/** Finds `pim:Storage` subjects in a parsed Solid storage description. */
export function storagesFromDescription(quads: Quad[]): string[] {
  return quads
    .filter(
      (q) =>
        q.predicate.value === rdfType &&
        q.object.value === `${pim}Storage` &&
        q.subject.termType === "NamedNode",
    )
    .map((q) => q.subject.value);
}

/** Validates a `webid` claim value: an absolute HTTPS URL (Solid-OIDC §6 requires a secure protocol). */
export function parseWebId(value: unknown, allowInsecure = false): URL | undefined {
  if (typeof value !== "string") return undefined;
  const url = parseHttpUrl(value);
  if (url === undefined) return undefined;
  if (url.protocol !== "https:" && !allowInsecure) return undefined;
  return url;
}
