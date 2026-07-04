// AUTHORED-BY Claude Fable 5
//
// WebID-based verification-method key PUBLISH + RESOLVE (runtime Phase-1 G4/G5).
//
// The `resolveKey` / `isControlledBy` seams in `verifyCredential` previously had
// no reference implementation: nothing PUBLISHED a public key into a WebID /
// controller document, and nothing RESOLVED `verificationMethod → CryptoKey`
// from one — so every verifying party carried an in-memory key ring and a
// same-origin controller heuristic the agent-authorization-credential note
// itself flags as unsafe. This module is that reference implementation:
//
//   • {@link publishVerificationMethod} (G5, the WRITE side) — the RDF a WebID /
//     controller document must expose so a verifier can find the agent's public
//     key: a standard `sec:Multikey` verification method (multibase-multicodec
//     `sec:publicKeyMultibase`) with `sec:controller` back to the WebID, listed
//     from the WebID under BOTH `sec:verificationMethod` (the general listing)
//     and `sec:assertionMethod` (the verification relationship a VC
//     `assertionMethod` proof purpose requires).
//
//   • {@link resolveWebIdKey} (G4, the READ side) — fetch the WebID document
//     over `@jeswr/guarded-fetch` (SSRF-safe: DNS-pinned node path, redirects
//     REFUSED), parse it with `@jeswr/fetch-rdf` + typed `@rdfjs/wrapper`
//     accessors (never hand-parsed), and return the verification method only
//     when the documents DOCUMENT-RESOLVE the control claim in BOTH directions:
//
//       (a) the WebID's own document lists the key id under
//           `sec:assertionMethod` (the WebID authorises the key), AND
//       (b) the key id's own document asserts `sec:controller` = the WebID and
//           NOTHING ELSE (the key binds back to exactly that WebID).
//
//     Fail-closed everywhere: a missing listing, a foreign/extra controller, an
//     absent key id, a redirect, a fetch/parse failure, a malformed multikey —
//     every one returns `undefined` (the seam's fail-closed contract), never a
//     throw and never a permissive fallback. This closes the trust hole where a
//     credential names a verification method the WebID never authorised.
//
//   • {@link createWebIdKeyResolver} — the `verifyCredential` wiring: a
//     `{ resolveKey, isControlledBy }` pair backed by the document resolution
//     above (with a per-instance document cache so one verification does not
//     re-fetch the same profile document for each seam).
//
// SECURITY NOTES (the load-bearing decisions):
//   - AUTHORITATIVE-DOCUMENT discipline: the assertion-method listing is read
//     ONLY from the document fetched at the WebID's own (fragment-stripped) URL,
//     and the key material + controller ONLY from the document at the key id's
//     own URL. A hostile document cannot inject statements about identities it
//     does not host, because we never query a store for a subject whose
//     document it is not.
//   - REDIRECTS REFUSED: a redirect re-homes the "authoritative document" to an
//     attacker-influenced location, so the default guarded fetch is built with
//     `maxRedirects: 0`, the request carries `redirect: "manual"`, and — for an
//     INJECTED fetch that might silently follow — a `redirected` response or a
//     final `res.url` that differs from the requested document URL is refused.
//   - No hand-rolled crypto: multikey bytes go through `multiformats` base58btc
//     and jose/WebCrypto import (`importPublicKey` / `subtle.importKey`) only.
//   - Browser-safe module: `@jeswr/guarded-fetch/node` (undici) is imported
//     LAZILY and only when no fetch is injected, so bundling this module for
//     the browser (with an injected fetch) pulls in no `node:` builtins.

import { parseRdf } from "@jeswr/fetch-rdf";
import type { DataFactory as DataFactoryType, DatasetCore, Quad } from "@rdfjs/types";
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { base64url, exportJWK } from "jose";
import { DataFactory } from "n3";
import { safeHttpIri } from "./iri.js";
import { importPublicKey, type SuiteKeyType } from "./keys.js";
import { base58btcDecode, base58btcEncode } from "./multibase.js";
import { serialize } from "./serialize.js";
import type { KeyPair } from "./types.js";
import {
  RDF_TYPE,
  SEC_ASSERTION_METHOD,
  SEC_CONTROLLER,
  SEC_MULTIBASE,
  SEC_MULTIKEY,
  SEC_PUBLIC_KEY_MULTIBASE,
  SEC_VERIFICATION_METHOD,
} from "./vocab.js";
import { GraphBuilder, type TermWrapperType } from "./wrappers.js";

// --- multikey codec (multibase base58btc over multicodec-prefixed key bytes) --

/** multicodec `ed25519-pub` (0xed) varint prefix. */
const ED25519_PUB_PREFIX = Uint8Array.from([0xed, 0x01]);
/** multicodec `p256-pub` (0x1200) varint prefix. */
const P256_PUB_PREFIX = Uint8Array.from([0x80, 0x24]);

/** A decoded Multikey: the imported WebCrypto public key + its suite key type. */
export interface DecodedMultikey {
  readonly publicKey: CryptoKey;
  readonly keyType: SuiteKeyType;
}

/**
 * Encode a public `CryptoKey` as a `sec:publicKeyMultibase` Multikey value:
 * multibase(base58btc) over the multicodec-prefixed raw key bytes —
 * `ed25519-pub` + the 32 raw Ed25519 bytes, or `p256-pub` + the 33-byte
 * COMPRESSED SEC1 point (per the W3C Controlled Identifiers Multikey spec).
 * Throws on a non-Ed25519/P-256 key — the write side fails LOUD, never
 * publishing a key the suite cannot verify against.
 */
export async function encodeMultikey(publicKey: CryptoKey): Promise<string> {
  return (await multikeyOf(publicKey)).publicKeyMultibase;
}

/** Encode a public key AND report the suite key type it encodes. */
async function multikeyOf(
  publicKey: CryptoKey,
): Promise<{ publicKeyMultibase: string; keyType: SuiteKeyType }> {
  const jwk = await exportJWK(publicKey);
  if (jwk.kty === "OKP" && jwk.crv === "Ed25519" && typeof jwk.x === "string") {
    const raw = base64url.decode(jwk.x);
    if (raw.length !== 32) {
      throw new Error(`@jeswr/solid-vc: Ed25519 public key must be 32 bytes, got ${raw.length}`);
    }
    return {
      publicKeyMultibase: base58btcEncode(concatBytes(ED25519_PUB_PREFIX, raw)),
      keyType: "Ed25519",
    };
  }
  if (
    jwk.kty === "EC" &&
    jwk.crv === "P-256" &&
    typeof jwk.x === "string" &&
    typeof jwk.y === "string"
  ) {
    const x = base64url.decode(jwk.x);
    const y = base64url.decode(jwk.y);
    if (x.length !== 32 || y.length !== 32) {
      throw new Error(
        `@jeswr/solid-vc: P-256 coordinates must be 32 bytes each, got x=${x.length} y=${y.length}`,
      );
    }
    // Compressed SEC1 point: 0x02 for even y, 0x03 for odd y, then the x bytes.
    const parity = Uint8Array.from([0x02 + ((y[31] as number) & 1)]);
    return {
      publicKeyMultibase: base58btcEncode(concatBytes(P256_PUB_PREFIX, parity, x)),
      keyType: "P-256",
    };
  }
  throw new Error(
    `@jeswr/solid-vc: unsupported public key for Multikey encoding (kty=${jwk.kty} crv=${jwk.crv ?? "?"}) — only Ed25519 and P-256 are supported`,
  );
}

/**
 * Decode a `sec:publicKeyMultibase` Multikey value back to a WebCrypto public
 * key. FAIL-CLOSED: returns `undefined` (never throws) on a non-`z` multibase,
 * an unknown multicodec prefix, wrong key length, an invalid point — anything
 * that is not exactly an `ed25519-pub` or `p256-pub` Multikey this suite can
 * verify against.
 */
export async function decodeMultikey(
  publicKeyMultibase: string,
): Promise<DecodedMultikey | undefined> {
  let bytes: Uint8Array;
  try {
    bytes = base58btcDecode(publicKeyMultibase);
  } catch {
    return undefined;
  }
  try {
    if (hasPrefix(bytes, ED25519_PUB_PREFIX)) {
      const raw = bytes.subarray(ED25519_PUB_PREFIX.length);
      if (raw.length !== 32) return undefined;
      const publicKey = await importPublicKey({
        kty: "OKP",
        crv: "Ed25519",
        x: base64url.encode(raw),
      });
      return { publicKey, keyType: "Ed25519" };
    }
    if (hasPrefix(bytes, P256_PUB_PREFIX)) {
      const point = bytes.subarray(P256_PUB_PREFIX.length);
      if (point.length !== 33 || ((point[0] as number) !== 0x02 && (point[0] as number) !== 0x03)) {
        return undefined;
      }
      // WebCrypto (Node 24 / browsers) imports a compressed SEC1 point directly —
      // decompression stays inside the platform crypto, never hand-rolled here.
      const publicKey = await globalThis.crypto.subtle.importKey(
        "raw",
        point as BufferSource,
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["verify"],
      );
      return { publicKey, keyType: "P-256" };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Concatenate byte arrays. */
function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Whether `bytes` starts with `prefix`. */
function hasPrefix(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

// --- typed accessors over a controller / verification-method document -------

/** Read a property as the set of its OBJECT TERMS (term type preserved). */
function objectTerms(node: TermWrapper, predicate: string): Set<TermWrapperType> {
  return SetFrom.subjectPredicate(node, predicate, TermAs.instance(TermWrapper), TermFrom.instance);
}

/** A typed view of a controller (WebID) node in ITS OWN profile document. */
class ControllerNode extends TermWrapper {
  get assertionMethods(): Set<TermWrapperType> {
    return objectTerms(this, SEC_ASSERTION_METHOD);
  }
}

/** A typed view of a `sec:Multikey` verification-method node in ITS OWN document. */
class VerificationMethodNode extends TermWrapper {
  get types(): Set<TermWrapperType> {
    return objectTerms(this, RDF_TYPE);
  }
  get controllers(): Set<TermWrapperType> {
    return objectTerms(this, SEC_CONTROLLER);
  }
  get publicKeyMultibases(): Set<TermWrapperType> {
    return objectTerms(this, SEC_PUBLIC_KEY_MULTIBASE);
  }
}

// --- publishVerificationMethod (G5 — the write side) ------------------------

/** Input to {@link publishVerificationMethod}. */
export interface PublishVerificationMethodInput {
  /** The controlling identity — the WebID the key belongs to. */
  readonly controller: string;
  /**
   * The key to publish: a {@link KeyPair} (its `verificationMethod` names the
   * key id) or a bare public `CryptoKey` (then `verificationMethod` is required).
   * Only the PUBLIC key is ever read — a private key never enters the graph.
   */
  readonly key: KeyPair | CryptoKey;
  /** The verification-method (key id) IRI; defaults to `key.verificationMethod`. */
  readonly verificationMethod?: string;
}

/** The published verification method: the RDF + the values it asserts. */
export interface PublishedVerificationMethod {
  /** The canonicalised controller (WebID) IRI. */
  readonly controller: string;
  /** The canonicalised verification-method (key id) IRI. */
  readonly verificationMethod: string;
  /** The `sec:publicKeyMultibase` Multikey value. */
  readonly publicKeyMultibase: string;
  /** The key type the multikey encodes. */
  readonly keyType: SuiteKeyType;
  /** The RDF quads to merge into the WebID / controller document. */
  readonly quads: readonly Quad[];
  /** The same graph serialised as Turtle (ready to PUT/PATCH into the document). */
  readonly turtle: string;
}

/**
 * Produce the RDF a WebID / controller document must expose so a verifier can
 * find (and {@link resolveWebIdKey} will accept) the agent's public key:
 *
 * ```turtle
 * <controller> sec:verificationMethod <keyId> ;
 *              sec:assertionMethod   <keyId> .
 * <keyId> a sec:Multikey ;
 *         sec:controller <controller> ;
 *         sec:publicKeyMultibase "z…"^^sec:multibase .
 * ```
 *
 * The write side fails LOUD (throws) on a non-http(s) controller / key id or an
 * unsupported key type — a caller must never silently publish an unusable or
 * unsafe verification method. All IRIs go through the safe helpers (canonicalise
 * + IRIREF hardening); the graph is built through the typed {@link GraphBuilder}
 * write path and serialised with `n3.Writer` (never hand-concatenated).
 */
export async function publishVerificationMethod(
  input: PublishVerificationMethodInput,
): Promise<PublishedVerificationMethod> {
  const controller = safeHttpIri(input.controller);
  if (controller === undefined) {
    throw new Error(
      `@jeswr/solid-vc: publishVerificationMethod controller must be an absolute http(s) IRI, got ${JSON.stringify(input.controller)}`,
    );
  }
  const isPair = isKeyPair(input.key);
  const vmInput =
    input.verificationMethod ?? (isPair ? (input.key as KeyPair).verificationMethod : undefined);
  if (vmInput === undefined) {
    throw new Error(
      "@jeswr/solid-vc: publishVerificationMethod requires a verificationMethod IRI (explicit, or via a KeyPair)",
    );
  }
  const verificationMethod = safeHttpIri(vmInput);
  if (verificationMethod === undefined) {
    throw new Error(
      `@jeswr/solid-vc: publishVerificationMethod verificationMethod must be an absolute http(s) IRI, got ${JSON.stringify(vmInput)}`,
    );
  }
  const publicKey = isPair ? (input.key as KeyPair).publicKey : (input.key as CryptoKey);
  const { publicKeyMultibase, keyType } = await multikeyOf(publicKey);

  const g = new GraphBuilder();
  g.addIri(controller, SEC_VERIFICATION_METHOD, verificationMethod);
  g.addIri(controller, SEC_ASSERTION_METHOD, verificationMethod);
  g.addType(verificationMethod, SEC_MULTIKEY);
  g.addIri(verificationMethod, SEC_CONTROLLER, controller);
  g.addLiteral(verificationMethod, SEC_PUBLIC_KEY_MULTIBASE, publicKeyMultibase, SEC_MULTIBASE);
  const quads = g.quads();
  const turtle = await serialize(quads);
  return { controller, verificationMethod, publicKeyMultibase, keyType, quads, turtle };
}

/** Narrow a {@link PublishVerificationMethodInput.key} to a {@link KeyPair}. */
function isKeyPair(key: KeyPair | CryptoKey): key is KeyPair {
  return (
    typeof key === "object" &&
    key !== null &&
    "publicKey" in key &&
    "verificationMethod" in key &&
    typeof (key as KeyPair).verificationMethod === "string"
  );
}

// --- resolveWebIdKey (G4 — the read side) ------------------------------------

/** Options for {@link resolveWebIdKey} / {@link createWebIdKeyResolver}. */
export interface ResolveWebIdKeyOptions {
  /**
   * The `fetch` used to dereference the WebID / key documents. DEFAULT: a
   * strict `@jeswr/guarded-fetch/node` DNS-pinned SSRF-guarded fetch with
   * redirects REFUSED (`maxRedirects: 0`), lazily imported so browser bundles
   * (which MUST inject a fetch) never pull in undici. Inject for tests (offline
   * fixtures) or for a browser / pre-authed fetch — the resolver still refuses
   * any redirected or cross-URL response an injected fetch lets through.
   */
  readonly fetch?: typeof globalThis.fetch;
}

/** A WebID-document-resolved verification method (see {@link resolveWebIdKey}). */
export interface ResolvedWebIdKey {
  /** The canonicalised WebID that the documents prove controls the key. */
  readonly controller: string;
  /** The canonicalised verification-method (key id) IRI. */
  readonly verificationMethod: string;
  /** The `sec:publicKeyMultibase` value the key document carries. */
  readonly publicKeyMultibase: string;
  /** The imported WebCrypto public key (what `resolveKey` feeds the suite). */
  readonly publicKey: CryptoKey;
  /** The key type the multikey encodes. */
  readonly keyType: SuiteKeyType;
}

/** A document-fetch memo: URL → the parsed store (or `undefined` = failed). */
type DocumentCache = Map<string, Promise<DatasetCore | undefined>>;

/** The lazily-built default guarded fetch (node path, redirects refused).
 * Package-internal (also consumed by `src/status.ts`) — NOT re-exported from
 * the package index. */
let defaultGuardedFetch: Promise<typeof globalThis.fetch> | undefined;
export function guardedFetchDefault(): Promise<typeof globalThis.fetch> {
  defaultGuardedFetch ??= import("@jeswr/guarded-fetch/node").then((m) =>
    m.createNodeGuardedFetch({ maxRedirects: 0 }),
  );
  return defaultGuardedFetch;
}

/** The RDF content types we ask a profile server for. */
const RDF_ACCEPT =
  "text/turtle, application/ld+json;q=0.9, application/n-triples;q=0.8, application/n-quads;q=0.7";

/** Strip the fragment of an already-canonical IRI → its document URL. */
function documentUrlOf(iri: string): string {
  const u = new URL(iri);
  u.hash = "";
  return u.href;
}

/**
 * Fetch + parse ONE document, fail-closed to `undefined` on ANY anomaly:
 * a thrown fetch (incl. an SSRF refusal), a non-2xx status, a REDIRECTED
 * response, a final URL that differs from the requested one (an injected fetch
 * that silently followed a redirect), or an unparseable body.
 */
async function fetchDocument(
  docUrl: string,
  fetchImpl: typeof globalThis.fetch,
  cache?: DocumentCache,
): Promise<DatasetCore | undefined> {
  const cached = cache?.get(docUrl);
  if (cached !== undefined) return cached;
  const load = (async (): Promise<DatasetCore | undefined> => {
    try {
      const res = await fetchImpl(docUrl, {
        redirect: "manual",
        headers: { accept: RDF_ACCEPT },
      });
      if (!res.ok) return undefined;
      // Refuse a response that did not come from EXACTLY the requested document:
      // a `redirected` response, or a final URL that differs (when reported).
      if (res.redirected === true) return undefined;
      if (typeof res.url === "string" && res.url.length > 0) {
        let finalUrl: string;
        try {
          finalUrl = new URL(res.url).href;
        } catch {
          return undefined;
        }
        if (finalUrl !== docUrl) return undefined;
      }
      const body = await res.text();
      const store = await parseRdf(body, res.headers.get("content-type"), { baseIRI: docUrl });
      return store as unknown as DatasetCore;
    } catch {
      return undefined;
    }
  })();
  cache?.set(docUrl, load);
  return load;
}

/** The named-node factory shared by the typed reads. */
const factory = DataFactory as unknown as DataFactoryType;

/** Whether a term set contains the NamedNode `iri`. */
function containsIri(terms: ReadonlySet<TermWrapperType>, iri: string): boolean {
  for (const term of terms) {
    if (term.termType === "NamedNode" && term.value === iri) return true;
  }
  return false;
}

/** The distinct Literal VALUES in a term set. */
function literalValues(terms: ReadonlySet<TermWrapperType>): Set<string> {
  const out = new Set<string>();
  for (const term of terms) {
    if (term.termType === "Literal") out.add(term.value);
  }
  return out;
}

/**
 * The shared, cache-aware core of {@link resolveWebIdKey} (see its doc for the
 * exact fail-closed contract).
 */
async function resolveWebIdKeyInternal(
  webId: string,
  keyId: string,
  fetchImpl: typeof globalThis.fetch,
  cache?: DocumentCache,
): Promise<ResolvedWebIdKey | undefined> {
  // 0. Both identities must be absolute http(s) IRIs — anything else (did:,
  //    file:, javascript:, relative) is refused BEFORE any request is issued.
  const controller = safeHttpIri(webId);
  const verificationMethod = safeHttpIri(keyId);
  if (controller === undefined || verificationMethod === undefined) return undefined;

  // 1. The WebID's OWN document must list the key id under sec:assertionMethod —
  //    the controller-side authorisation. Read ONLY from the document at the
  //    WebID's fragment-stripped URL (authoritative-document discipline).
  const controllerDocUrl = documentUrlOf(controller);
  const controllerDoc = await fetchDocument(controllerDocUrl, fetchImpl, cache);
  if (controllerDoc === undefined) return undefined;
  const controllerNode = new ControllerNode(controller, controllerDoc, factory);
  if (!containsIri(controllerNode.assertionMethods, verificationMethod)) return undefined;

  // 2. The key id's OWN document must bind the key back: `a sec:Multikey`,
  //    `sec:controller` = EXACTLY the WebID (no foreign / extra controller),
  //    and exactly ONE publicKeyMultibase value. Same-document WebIDs reuse the
  //    already-fetched store (one request in the common layout).
  const keyDocUrl = documentUrlOf(verificationMethod);
  const keyDoc =
    keyDocUrl === controllerDocUrl
      ? controllerDoc
      : await fetchDocument(keyDocUrl, fetchImpl, cache);
  if (keyDoc === undefined) return undefined;
  const vmNode = new VerificationMethodNode(verificationMethod, keyDoc, factory);
  if (!containsIri(vmNode.types, SEC_MULTIKEY)) return undefined;
  const controllers = vmNode.controllers;
  if (controllers.size !== 1 || !containsIri(controllers, controller)) return undefined;
  const multibases = literalValues(vmNode.publicKeyMultibases);
  if (multibases.size !== 1) return undefined;
  const [publicKeyMultibase] = multibases;
  if (publicKeyMultibase === undefined) return undefined;

  // 3. Decode + import the multikey (fail-closed on any malformed value).
  const decoded = await decodeMultikey(publicKeyMultibase);
  if (decoded === undefined) return undefined;
  return {
    controller,
    verificationMethod,
    publicKeyMultibase,
    publicKey: decoded.publicKey,
    keyType: decoded.keyType,
  };
}

/**
 * Resolve a verification method (key id) from a WebID, DOCUMENT-RESOLVED and
 * FAIL-CLOSED (G4): returns the key ONLY when
 *
 *   1. the WebID's own document lists `keyId` under `sec:assertionMethod`
 *      (the WebID actually authorises this key for assertion proofs), AND
 *   2. the key id's own document types it `sec:Multikey` and asserts
 *      `sec:controller` = exactly that WebID (the key binds back — no foreign
 *      or ambiguous controller), AND
 *   3. its single `sec:publicKeyMultibase` decodes to an Ed25519 / P-256 key.
 *
 * Every other outcome — an unlisted key, an absent key id, a controller
 * mismatch, extra controllers, conflicting multibase values, a redirect, any
 * fetch/parse failure, a malformed multikey — returns `undefined` (never
 * throws), so a credential naming a key the WebID never authorised can never
 * verify. Fetches ride `@jeswr/guarded-fetch/node` by default (DNS-pinned,
 * redirects refused); see {@link ResolveWebIdKeyOptions.fetch}.
 */
export async function resolveWebIdKey(
  webId: string,
  keyId: string,
  options: ResolveWebIdKeyOptions = {},
): Promise<ResolvedWebIdKey | undefined> {
  try {
    const fetchImpl = options.fetch ?? (await guardedFetchDefault());
    return await resolveWebIdKeyInternal(webId, keyId, fetchImpl);
  } catch {
    return undefined;
  }
}

// --- the verifyCredential wiring ---------------------------------------------

/** The `verifyCredential`-shaped seam pair a WebID key resolver provides. */
export interface WebIdKeyResolver {
  /**
   * `VerifyCredentialOptions.resolveKey`: verification-method IRI → the
   * document-resolved public key, or `undefined` (fail-closed). The controller
   * is discovered FROM the key document (`sec:controller`, required unique) and
   * the full two-directional control check then runs against that controller's
   * own document.
   */
  readonly resolveKey: (verificationMethod: string) => Promise<CryptoKey | undefined>;
  /**
   * `VerifyCredentialOptions.isControlledBy`: whether the ISSUER's own WebID
   * document authorises the verification method AND the key document binds back
   * to the issuer — the document-resolved replacement for the default prefix
   * heuristic. Fail-closed `false` on any anomaly.
   */
  readonly isControlledBy: (verificationMethod: string, issuer: string) => Promise<boolean>;
}

/**
 * Build the `{ resolveKey, isControlledBy }` pair {@link verifyCredential | the
 * verify pipeline} consumes, backed by WebID-document resolution
 * ({@link resolveWebIdKey}) over the SSRF-guarded fetch. Documents are cached
 * for the LIFETIME OF THE RESOLVER INSTANCE (so one verification never
 * re-fetches the same profile for the two seams) — create a fresh resolver per
 * verification session to pick up rotated keys.
 */
export function createWebIdKeyResolver(options: ResolveWebIdKeyOptions = {}): WebIdKeyResolver {
  const cache: DocumentCache = new Map();
  const fetchOf = async (): Promise<typeof globalThis.fetch> =>
    options.fetch ?? (await guardedFetchDefault());

  const resolveKey = async (verificationMethod: string): Promise<CryptoKey | undefined> => {
    try {
      const fetchImpl = await fetchOf();
      const vm = safeHttpIri(verificationMethod);
      if (vm === undefined) return undefined;
      // Discover the (unique) controller from the key's OWN document, then run
      // the full two-directional check against that controller's document.
      const keyDoc = await fetchDocument(documentUrlOf(vm), fetchImpl, cache);
      if (keyDoc === undefined) return undefined;
      const vmNode = new VerificationMethodNode(vm, keyDoc, factory);
      const controllers = [...vmNode.controllers].filter((t) => t.termType === "NamedNode");
      if (controllers.length !== 1) return undefined;
      const controller = (controllers[0] as TermWrapperType).value;
      const resolved = await resolveWebIdKeyInternal(controller, vm, fetchImpl, cache);
      return resolved?.publicKey;
    } catch {
      return undefined;
    }
  };

  const isControlledBy = async (verificationMethod: string, issuer: string): Promise<boolean> => {
    try {
      const fetchImpl = await fetchOf();
      const resolved = await resolveWebIdKeyInternal(issuer, verificationMethod, fetchImpl, cache);
      return resolved !== undefined;
    } catch {
      return false;
    }
  };

  return { resolveKey, isControlledBy };
}
