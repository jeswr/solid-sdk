// AUTHORED-BY Claude Fable 5
//
// W3C Bitstring Status List v1.0 — credential revocation / suspension status
// (runtime Phase-1 G2; the successor to StatusList2021).
//
// ISSUE SIDE: {@link bitstringStatusListEntry} builds the validated
// `credentialStatus` entry a credential carries (assign at issuance via the
// `credentialStatus` field of `Credential` / `AgentAuthorization`);
// {@link buildBitstringStatusListCredential} builds the hosted
// `BitstringStatusListCredential` (sign it with `issue()`); the bit itself
// lives in `src/bitstring.ts` (`createStatusBitstring` / `setStatusBit`), and
// {@link withStatusBit} flips one bit of an existing (unsigned) list
// credential for re-issuance.
//
// VERIFY SIDE (Phase C): {@link resolveBitstringStatus} — fetch the status
// list credential (SSRF-guarded: `@jeswr/guarded-fetch` DNS-pinned node fetch
// by default, redirects REFUSED, response body BYTE-BOUNDED), verify ITS
// signature (same suite registry / key resolver as the credential itself;
// issuer pinned to the credential's issuer unless the caller widens it),
// decode the bitstring (zip-bomb-capped), and read the bit at
// `statusListIndex`. FAIL-CLOSED THROUGHOUT:
//
//   - bit SET     → `revoked` / `suspended` (a definitive verification failure);
//   - CANNOT CONFIRM (fetch failed, redirected, over-size, unparseable, list
//     signature invalid, wrong shape/type/purpose/id, bitstring undecodable,
//     index out of range, unsupported entry) → `unreachable` — a DISTINCT
//     verification failure, NEVER a silent pass;
//   - only an ABSENT `credentialStatus` (no revocation mechanism at all) lets
//     verification proceed without a status gate.
//
// `createBitstringStatusResolver` packages this as the `resolveStatus` seam
// `verifyCredential` consumes (→ `STATUS_REVOKED` / `STATUS_SUSPENDED` /
// `STATUS_UNREACHABLE` structured errors).

import {
  createStatusBitstring,
  decodeStatusList,
  encodeStatusList,
  getStatusBit,
  setStatusBit,
} from "./bitstring.js";
import type { SuiteRegistry } from "./proof.js";
import type {
  BitstringStatusListEntry,
  Credential,
  CredentialStatusCheck,
  CredentialSubject,
  DataIntegrityProof,
  JsonValue,
  VerifiableCredential,
} from "./types.js";
import { type VerifyCredentialOptions, verifyCredential } from "./verify.js";
import { guardedFetchDefault } from "./webid.js";

/** The status purposes this implementation can act on (spec §statusPurpose). */
const SUPPORTED_PURPOSES = new Set(["revocation", "suspension"]);

/** statusListIndex must be a base-10 non-negative integer STRING (per spec). */
const INDEX_PATTERN = /^(0|[1-9][0-9]*)$/;

/** The default ceiling on a fetched status-list-credential body: 32 MiB. */
const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024;

/**
 * The most `credentialStatus` entries a single credential may carry before the
 * check fails closed. Each entry costs the verifier an outbound fetch, so an
 * UNBOUNDED entry list on a (possibly forged) credential is a request-
 * amplification lever pointed at whatever URLs it names; real deployments
 * carry one entry per purpose. Exceeding the cap → `unreachable`, never a
 * partial/silent check.
 */
const MAX_STATUS_ENTRIES = 8;

/** The content types we ask a status-list host for. */
const STATUS_ACCEPT = "application/vc+ld+json, application/ld+json;q=0.9, application/json;q=0.8";

// --- issue side --------------------------------------------------------------

/** Input to {@link bitstringStatusListEntry}. */
export interface BitstringStatusListEntryInput {
  /** What a set bit means: `"revocation"` or `"suspension"`. */
  readonly statusPurpose: "revocation" | "suspension";
  /** The credential's bit position (non-negative integer, number or string). */
  readonly statusListIndex: number | string;
  /** The URL the signed `BitstringStatusListCredential` is hosted at (http(s)). */
  readonly statusListCredential: string;
  /** Optional entry IRI (an anonymous entry node when omitted). */
  readonly id?: string;
}

/**
 * Build a VALIDATED `credentialStatus` entry to place on a credential at
 * issuance (the issue-side param): pass the result as the `credentialStatus`
 * field of a {@link Credential} / `AgentAuthorization`, and `issue()` signs it
 * into the claim graph. Throws (fail-closed) on a non-integer index, an
 * unsupported purpose, or a non-http(s) list URL — a credential must never be
 * signed over a status entry its verifier cannot resolve.
 */
export function bitstringStatusListEntry(
  input: BitstringStatusListEntryInput,
): BitstringStatusListEntry {
  if (!SUPPORTED_PURPOSES.has(input.statusPurpose)) {
    throw new Error(
      `@jeswr/solid-vc: unsupported statusPurpose ${JSON.stringify(
        input.statusPurpose,
      )} — this implementation supports "revocation" and "suspension"`,
    );
  }
  const index =
    typeof input.statusListIndex === "number"
      ? String(input.statusListIndex)
      : input.statusListIndex;
  if (
    !INDEX_PATTERN.test(index) ||
    (typeof input.statusListIndex === "number" && !Number.isInteger(input.statusListIndex))
  ) {
    throw new Error(
      `@jeswr/solid-vc: statusListIndex must be a non-negative integer, got ${JSON.stringify(
        input.statusListIndex,
      )}`,
    );
  }
  const listUrl = requireHttpUrl(input.statusListCredential, "statusListCredential");
  return {
    ...(input.id !== undefined ? { id: input.id } : {}),
    type: "BitstringStatusListEntry",
    statusPurpose: input.statusPurpose,
    statusListIndex: index,
    statusListCredential: listUrl,
  };
}

/** Input to {@link buildBitstringStatusListCredential}. */
export interface BitstringStatusListCredentialInput {
  /**
   * The credential id — the URL the signed list will be HOSTED at (the same
   * URL credentials reference as `statusListCredential`; verifiers check the
   * fetched list's `id` equals the URL they fetched, so these MUST agree).
   */
  readonly id: string;
  /** The issuing party (normally the same issuer as the credentials listed). */
  readonly issuer: string;
  /** What a set bit means for this list. */
  readonly statusPurpose: "revocation" | "suspension";
  /**
   * The raw status bitstring (default: a fresh all-clear
   * `createStatusBitstring()` — the spec-minimum 131,072 entries / 16KB).
   */
  readonly bits?: Uint8Array;
  /** Validity start (optional). */
  readonly validFrom?: string;
  /** Expiry (optional — bounds how long a cached list can be replayed). */
  readonly validUntil?: string;
}

/**
 * Build the UNSIGNED `BitstringStatusListCredential` hosting a status list —
 * sign it with `issue()` and host the result at `input.id`. The subject is
 * `<id>#list`, a `BitstringStatusList` carrying the GZIP'd base64url
 * `encodedList`.
 */
export function buildBitstringStatusListCredential(
  input: BitstringStatusListCredentialInput,
): Credential {
  const id = requireHttpUrl(input.id, "status list credential id");
  if (!SUPPORTED_PURPOSES.has(input.statusPurpose)) {
    throw new Error(
      `@jeswr/solid-vc: unsupported statusPurpose ${JSON.stringify(input.statusPurpose)}`,
    );
  }
  const bits = input.bits ?? createStatusBitstring();
  const credentialSubject: CredentialSubject = {
    id: `${id}#list`,
    type: "BitstringStatusList",
    statusPurpose: input.statusPurpose,
    encodedList: encodeStatusList(bits),
  };
  return {
    id,
    type: ["BitstringStatusListCredential"],
    issuer: input.issuer,
    credentialSubject,
    ...(input.validFrom !== undefined ? { validFrom: input.validFrom } : {}),
    ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
  };
}

/**
 * Decode the raw bitstring out of a (structured) status list credential —
 * throws fail-closed on a credential that is not a well-formed
 * `BitstringStatusListCredential`.
 */
export function statusListBitsOf(
  credential: Credential,
  options?: { readonly maxDecodedBytes?: number },
): Uint8Array {
  const subject = singleSubjectOf(credential);
  const encoded = subject?.encodedList;
  if (typeof encoded !== "string") {
    throw new Error(
      "@jeswr/solid-vc: credential does not carry a BitstringStatusList subject with an encodedList",
    );
  }
  return decodeStatusList(encoded, options);
}

/**
 * Return a NEW unsigned status list credential with the bit at `index` set
 * (`value: true` — revoke/suspend) or cleared (`false` — reinstate). The
 * caller re-signs (`issue()`) and re-hosts the result; the input credential is
 * not mutated, and any existing proof is DROPPED (a changed list invalidates
 * the old signature by construction).
 */
export function withStatusBit(
  credential: Credential | VerifiableCredential,
  index: number,
  value: boolean,
): Credential {
  const bits = statusListBitsOf(credential);
  setStatusBit(bits, index, value);
  const subject = singleSubjectOf(credential);
  if (subject === undefined) {
    throw new Error("@jeswr/solid-vc: credential does not carry a single credentialSubject");
  }
  const { proof: _proof, ...unsigned } = credential as VerifiableCredential;
  return {
    ...unsigned,
    credentialSubject: { ...subject, encodedList: encodeStatusList(bits) },
  };
}

/** Read the bit at `index` of a status list credential (see {@link getStatusBit}). */
export function readStatusBit(credential: Credential, index: number): boolean {
  return getStatusBit(statusListBitsOf(credential), index);
}

// --- verify side (Phase C) ---------------------------------------------------

/** Options for {@link resolveBitstringStatus} / {@link createBitstringStatusResolver}. */
export interface BitstringStatusOptions {
  /**
   * Resolve a `verificationMethod` IRI to its public key — the SAME seam
   * `verifyCredential` uses; the status list credential's own signature is
   * verified through it. REQUIRED: an unverified status list is untrusted
   * input and must never gate a verification decision.
   */
  readonly resolveKey: VerifyCredentialOptions["resolveKey"];
  /** The proof-suite registry (default: the bundled Data Integrity suites). */
  readonly registry?: SuiteRegistry;
  /** The issuer-binding check for the LIST credential (see `verifyCredential`). */
  readonly isControlledBy?: VerifyCredentialOptions["isControlledBy"];
  /**
   * Issuers allowed to sign the status list. DEFAULT: exactly the issuer of
   * the credential being checked — the common (and safest) deployment, where
   * an issuer hosts its own lists. Widen ONLY for a deployment with a
   * dedicated status authority.
   */
  readonly trustedStatusIssuers?: readonly string[];
  /** The instant to evaluate the LIST credential's validity at (default now). */
  readonly now?: Date;
  /**
   * The fetch used to dereference `statusListCredential`. DEFAULT: the strict
   * `@jeswr/guarded-fetch/node` DNS-pinned SSRF-guarded fetch with redirects
   * REFUSED (`maxRedirects: 0`), lazily imported so browser bundles (which
   * MUST inject a fetch) never pull in undici. Even with an injected fetch,
   * the resolver still refuses any redirected or cross-URL response.
   */
  readonly fetch?: typeof globalThis.fetch;
  /** Zip-bomb ceiling on the DECODED bitstring (default 16 MiB). */
  readonly maxDecodedBytes?: number;
  /** Ceiling on the fetched response BODY (default 32 MiB). */
  readonly maxBodyBytes?: number;
}

/**
 * Resolve a credential's Bitstring Status List status — the Phase-C gate. See
 * the module header for the exact fail-closed semantics; in short:
 * `absent` (no `credentialStatus` — proceed) / `valid` (every bit clear) /
 * `revoked` / `suspended` (a bit is set) / `unreachable` (a PRESENT entry
 * could not be confirmed — a verification FAILURE, never a pass).
 *
 * With several entries, EVERY entry must resolve: a definitive `revoked`
 * outranks `suspended`, which outranks `unreachable`; `valid` only when all
 * entries resolved clear. Never throws — every anomaly folds into the result.
 */
export async function resolveBitstringStatus(
  vc: VerifiableCredential | Credential,
  options: BitstringStatusOptions,
): Promise<CredentialStatusCheck> {
  const normalized = normalizeStatusEntries(vc.credentialStatus as unknown);
  if ("reason" in normalized) return { status: "unreachable", reason: normalized.reason };
  if (normalized.entries.length === 0) return { status: "absent" };

  let suspended: string | undefined;
  let unreachable: string | undefined;
  for (const entry of normalized.entries) {
    const outcome = await checkOneEntry(vc, entry, options);
    if (outcome.kind === "revoked") return { status: "revoked", reason: outcome.reason };
    if (outcome.kind === "suspended") suspended ??= outcome.reason;
    if (outcome.kind === "unreachable") unreachable ??= outcome.reason;
  }
  if (suspended !== undefined) return { status: "suspended", reason: suspended };
  if (unreachable !== undefined) return { status: "unreachable", reason: unreachable };
  return { status: "valid" };
}

/**
 * Package {@link resolveBitstringStatus} as the `resolveStatus` seam
 * `verifyCredential` consumes: pass the result as
 * `verifyCredential(vc, { …, resolveStatus: createBitstringStatusResolver(opts) })`
 * and a revoked / suspended / unconfirmable credential fails verification with
 * `STATUS_REVOKED` / `STATUS_SUSPENDED` / `STATUS_UNREACHABLE`.
 */
export function createBitstringStatusResolver(
  options: BitstringStatusOptions,
): (vc: VerifiableCredential) => Promise<CredentialStatusCheck> {
  return (vc) => resolveBitstringStatus(vc, options);
}

// --- internals ---------------------------------------------------------------

/** Require an absolute http(s) URL, returning its canonical href. */
function requireHttpUrl(value: string | undefined, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`@jeswr/solid-vc: ${field} must be a non-empty string`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `@jeswr/solid-vc: ${field} must be an absolute URL, got ${JSON.stringify(value)}`,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(
      `@jeswr/solid-vc: ${field} must be an http(s) URL, got ${JSON.stringify(value)}`,
    );
  }
  return url.href;
}

/** The single credential subject of a status list credential, or `undefined`. */
function singleSubjectOf(credential: Credential): CredentialSubject | undefined {
  const cs = credential.credentialSubject;
  if (Array.isArray(cs)) {
    return cs.length === 1 ? (cs[0] as CredentialSubject) : undefined;
  }
  return cs as CredentialSubject | undefined;
}

/**
 * Normalise an UNTRUSTED `credentialStatus` value fail-closed. `undefined` →
 * no entries (absent — no mechanism). Anything PRESENT must be a well-formed
 * entry (or array of them): a non-object entry, an alien/unsupported status
 * type, a bad purpose/index/URL — all become a `reason` (→ `unreachable`),
 * because a status mechanism we cannot check must never read as "not revoked".
 */
function normalizeStatusEntries(
  value: unknown,
): { entries: BitstringStatusListEntry[] } | { reason: string } {
  if (value === undefined) return { entries: [] };
  const raw = Array.isArray(value) ? value : [value];
  if (raw.length > MAX_STATUS_ENTRIES) {
    return {
      reason: `credential carries ${raw.length} credentialStatus entries — more than the ${MAX_STATUS_ENTRIES}-entry cap (request-amplification guard)`,
    };
  }
  const entries: BitstringStatusListEntry[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return { reason: "credentialStatus entry is not an object" };
    }
    const entry = item as Record<string, unknown>;
    const types = Array.isArray(entry.type) ? entry.type : [entry.type];
    if (!types.includes("BitstringStatusListEntry")) {
      return {
        reason: `unsupported credentialStatus type ${JSON.stringify(
          entry.type,
        )} — cannot be checked, failing closed`,
      };
    }
    if (typeof entry.statusPurpose !== "string" || !SUPPORTED_PURPOSES.has(entry.statusPurpose)) {
      return {
        reason: `unsupported statusPurpose ${JSON.stringify(entry.statusPurpose)}`,
      };
    }
    if (typeof entry.statusListIndex !== "string" || !INDEX_PATTERN.test(entry.statusListIndex)) {
      return {
        reason: `statusListIndex is not a non-negative integer string: ${JSON.stringify(
          entry.statusListIndex,
        )}`,
      };
    }
    if ("statusSize" in entry && entry.statusSize !== undefined && entry.statusSize !== 1) {
      return {
        reason: `unsupported statusSize ${JSON.stringify(entry.statusSize)} — only 1-bit statuses are supported`,
      };
    }
    let listUrl: string;
    try {
      listUrl = requireHttpUrl(
        typeof entry.statusListCredential === "string" ? entry.statusListCredential : undefined,
        "statusListCredential",
      );
    } catch (e) {
      return { reason: (e as Error).message };
    }
    entries.push({
      ...(typeof entry.id === "string" ? { id: entry.id } : {}),
      type: "BitstringStatusListEntry",
      statusPurpose: entry.statusPurpose,
      statusListIndex: entry.statusListIndex,
      statusListCredential: listUrl,
    });
  }
  return { entries };
}

/** The per-entry outcome (folded by {@link resolveBitstringStatus}). */
type EntryOutcome =
  | { kind: "clear" }
  | { kind: "revoked"; reason: string }
  | { kind: "suspended"; reason: string }
  | { kind: "unreachable"; reason: string };

/** Check ONE validated entry — fetch, verify, decode, read the bit. Never throws. */
async function checkOneEntry(
  vc: VerifiableCredential | Credential,
  entry: BitstringStatusListEntry,
  options: BitstringStatusOptions,
): Promise<EntryOutcome> {
  const url = entry.statusListCredential;
  // 1. fetch — SSRF-guarded default, redirects refused, body byte-bounded.
  const body = await fetchStatusListBody(url, options);
  if (typeof body !== "string") return { kind: "unreachable", reason: body.reason };

  // 2. parse the JSON document into the structured credential, strictly.
  const parsed = parseStatusListDocument(body, url, entry.statusPurpose);
  if ("reason" in parsed) return { kind: "unreachable", reason: parsed.reason };
  const { listVc, encodedList } = parsed;

  // 3. verify the LIST credential's OWN signature + validity + issuer trust.
  // NO resolveStatus is passed — a status list credential's status is not
  // recursively consulted (no fetch loops; the list's freshness is bounded by
  // its own validUntil instead).
  const trustedIssuers = options.trustedStatusIssuers ?? [vc.issuer];
  const listResult = await verifyCredential(listVc, {
    resolveKey: options.resolveKey,
    ...(options.registry !== undefined ? { registry: options.registry } : {}),
    ...(options.isControlledBy !== undefined ? { isControlledBy: options.isControlledBy } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    trustedIssuers,
  });
  if (!listResult.verified) {
    const codes = listResult.errors.map((e) => e.code).join(", ");
    return {
      kind: "unreachable",
      reason: `status list credential at ${url} failed verification (${codes})`,
    };
  }

  // 4. decode the bitstring (zip-bomb-capped) + read the bit.
  let bits: Uint8Array;
  try {
    bits = decodeStatusList(encodedList, {
      ...(options.maxDecodedBytes !== undefined
        ? { maxDecodedBytes: options.maxDecodedBytes }
        : {}),
    });
  } catch (e) {
    return { kind: "unreachable", reason: (e as Error).message };
  }
  const index = Number(entry.statusListIndex);
  if (!Number.isSafeInteger(index) || index >= bits.length * 8) {
    return {
      kind: "unreachable",
      reason: `statusListIndex ${entry.statusListIndex} is outside the ${bits.length * 8}-bit status list`,
    };
  }
  if (getStatusBit(bits, index)) {
    const reason = `status list ${url} has bit ${index} SET (purpose ${entry.statusPurpose})`;
    return entry.statusPurpose === "suspension"
      ? { kind: "suspended", reason }
      : { kind: "revoked", reason };
  }
  return { kind: "clear" };
}

/** Fetch the status list body, fail-closed to a reason on ANY anomaly. */
async function fetchStatusListBody(
  url: string,
  options: BitstringStatusOptions,
): Promise<string | { reason: string }> {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  try {
    const fetchImpl = options.fetch ?? (await guardedFetchDefault());
    const res = await fetchImpl(url, {
      redirect: "manual",
      headers: { accept: STATUS_ACCEPT },
    });
    if (!res.ok) {
      return { reason: `status list fetch of ${url} returned ${res.status}` };
    }
    // Refuse a response that did not come from EXACTLY the requested URL: a
    // `redirected` response, or a final URL that differs (an injected fetch
    // that silently followed a redirect re-homes the "authoritative list").
    if (res.redirected === true) {
      return { reason: `status list fetch of ${url} was redirected — refused` };
    }
    if (typeof res.url === "string" && res.url.length > 0) {
      let finalUrl: string;
      try {
        finalUrl = new URL(res.url).href;
      } catch {
        return { reason: `status list fetch of ${url} reported an unparseable final URL` };
      }
      if (finalUrl !== url) {
        return { reason: `status list fetch of ${url} resolved to a different URL (${finalUrl})` };
      }
    }
    const body = await readBodyBounded(res, maxBodyBytes);
    if (body === undefined) {
      return { reason: `status list body at ${url} exceeded the ${maxBodyBytes}-byte ceiling` };
    }
    return body;
  } catch (e) {
    return { reason: `status list fetch of ${url} failed: ${(e as Error).message}` };
  }
}

/**
 * Read a response body STREAMING with a hard byte budget — `undefined` once
 * the budget is exceeded (the remainder is not read), so a hostile host cannot
 * balloon memory before a post-hoc length check. Falls back to `res.text()` +
 * a length check for a body-less Response (test doubles).
 */
async function readBodyBounded(res: Response, maxBytes: number): Promise<string | undefined> {
  const stream = res.body;
  if (stream === null || stream === undefined || typeof stream.getReader !== "function") {
    const text = await res.text();
    return Buffer.byteLength(text, "utf8") > maxBytes ? undefined : text;
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return undefined;
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Parse a fetched status-list document into the structured
 * {@link VerifiableCredential} + its `encodedList`, STRICTLY: the id must
 * equal the URL fetched (the spec's binding of list to location), the types
 * must name a `BitstringStatusListCredential` wrapping a single
 * `BitstringStatusList` subject, and the subject's `statusPurpose` must cover
 * the ENTRY's purpose (a mismatch means the bit does not mean what the entry
 * claims). Any deviation → a reason (→ `unreachable`).
 */
function parseStatusListDocument(
  body: string,
  url: string,
  entryPurpose: string,
): { listVc: VerifiableCredential; encodedList: string } | { reason: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    return { reason: `status list body at ${url} is not valid JSON` };
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return { reason: `status list document at ${url} is not a JSON object` };
  }
  const d = doc as Record<string, unknown>;

  if (typeof d.id !== "string" || new URL(url).href !== safeHref(d.id)) {
    return {
      reason: `status list credential id ${JSON.stringify(d.id)} does not match the URL fetched (${url})`,
    };
  }
  const types = Array.isArray(d.type) ? d.type : [d.type];
  if (
    !types.includes("BitstringStatusListCredential") &&
    !types.includes("https://www.w3.org/ns/credentials/status#BitstringStatusListCredential")
  ) {
    return { reason: `document at ${url} is not a BitstringStatusListCredential` };
  }
  const issuer =
    typeof d.issuer === "string"
      ? d.issuer
      : d.issuer !== null &&
          typeof d.issuer === "object" &&
          typeof (d.issuer as Record<string, unknown>).id === "string"
        ? ((d.issuer as Record<string, unknown>).id as string)
        : undefined;
  if (issuer === undefined) {
    return { reason: `status list credential at ${url} carries no issuer` };
  }

  // Exactly ONE subject: the hosted list.
  const rawSubject = Array.isArray(d.credentialSubject)
    ? d.credentialSubject.length === 1
      ? d.credentialSubject[0]
      : undefined
    : d.credentialSubject;
  if (rawSubject === null || typeof rawSubject !== "object" || Array.isArray(rawSubject)) {
    return { reason: `status list credential at ${url} does not carry a single subject` };
  }
  const subject = rawSubject as Record<string, unknown>;
  const subjectTypes = Array.isArray(subject.type) ? subject.type : [subject.type];
  if (!subjectTypes.includes("BitstringStatusList")) {
    return { reason: `status list subject at ${url} is not a BitstringStatusList` };
  }
  const purposes = Array.isArray(subject.statusPurpose)
    ? subject.statusPurpose
    : [subject.statusPurpose];
  if (!purposes.includes(entryPurpose)) {
    return {
      reason:
        `status list at ${url} has purpose ${JSON.stringify(subject.statusPurpose)}, ` +
        `not the entry's ${JSON.stringify(entryPurpose)} — the bit does not mean what the entry claims`,
    };
  }
  const encodedList = subject.encodedList;
  if (typeof encodedList !== "string" || encodedList.length === 0) {
    return { reason: `status list at ${url} carries no encodedList` };
  }

  const proof = parseProofs(d.proof);
  if (proof === undefined) {
    return { reason: `status list credential at ${url} carries no well-formed proof` };
  }

  const listVc: VerifiableCredential = {
    id: d.id,
    type: types.filter((t): t is string => typeof t === "string" && t !== "VerifiableCredential"),
    issuer,
    ...(typeof d.validFrom === "string" ? { validFrom: d.validFrom } : {}),
    ...(typeof d.validUntil === "string" ? { validUntil: d.validUntil } : {}),
    credentialSubject: subject as CredentialSubject & Record<string, JsonValue>,
    proof,
  };
  return { listVc, encodedList };
}

/** `new URL(value).href`, or `undefined` on an unparseable value. */
function safeHref(value: string): string | undefined {
  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
}

/** Parse the untrusted `proof` field into DataIntegrityProof(s), or `undefined`. */
function parseProofs(
  value: unknown,
): DataIntegrityProof | readonly DataIntegrityProof[] | undefined {
  const raw = Array.isArray(value) ? value : [value];
  if (raw.length === 0) return undefined;
  const proofs: DataIntegrityProof[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return undefined;
    const p = item as Record<string, unknown>;
    if (
      p.type !== "DataIntegrityProof" ||
      typeof p.cryptosuite !== "string" ||
      typeof p.verificationMethod !== "string" ||
      typeof p.proofPurpose !== "string" ||
      typeof p.proofValue !== "string"
    ) {
      return undefined;
    }
    proofs.push({
      type: "DataIntegrityProof",
      cryptosuite: p.cryptosuite,
      verificationMethod: p.verificationMethod,
      proofPurpose: p.proofPurpose,
      ...(typeof p.created === "string" ? { created: p.created } : {}),
      proofValue: p.proofValue,
    });
  }
  return proofs.length === 1 ? proofs[0] : proofs;
}
