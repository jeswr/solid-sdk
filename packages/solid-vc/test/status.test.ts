// AUTHORED-BY Claude Fable 5
//
// Bitstring Status List (runtime Phase-1 G2) — SECURITY-CRITICAL revocation
// surface, exhaustive and offline (injected fetch throughout):
//
//   - bitstring encode/decode round-trip, bit order, boundaries, fail-closed
//     decode (prefix / alphabet / gzip / undersize / zip-bomb);
//   - issue side: entry + list credential builders, set/clear a bit, RDF and
//     JSON-LD lowering round-trip;
//   - verify side (Phase C): a non-revoked credential verifies; a REVOKED
//     (bit set) credential fails `STATUS_REVOKED`; a suspended one
//     `STATUS_SUSPENDED`; EVERY unconfirmable variant — unreachable list,
//     tampered list, invalid list signature, untrusted list issuer, purpose /
//     id mismatch, out-of-range index, undecodable bitstring, unsupported
//     entry, throwing resolver — fails `STATUS_UNREACHABLE`, never a pass;
//   - an ABSENT status entry means "no revocation mechanism" (verify
//     proceeds); a PRESENT-but-unresolvable one fails closed.

import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  BitstringDecodeError,
  createStatusBitstring,
  decodeStatusList,
  encodeStatusList,
  getStatusBit,
  MIN_STATUS_LIST_LENGTH,
  setStatusBit,
} from "../src/bitstring.js";
import {
  credentialFromRdf,
  credentialStatusFromNode,
  credentialToJsonLd,
  credentialToTurtle,
  parseCredentialRdf,
} from "../src/credential.js";
import { issue, issueAgentAuthorization } from "../src/issue.js";
import {
  bitstringStatusListEntry,
  buildBitstringStatusListCredential,
  createBitstringStatusResolver,
  readStatusBit,
  resolveBitstringStatus,
  withStatusBit,
} from "../src/status.js";
import type {
  Credential,
  CredentialStatusCheck,
  KeyPair,
  VerifiableCredential,
} from "../src/types.js";
import { verifyCredential } from "../src/verify.js";
import { ACL_READ, AGENT, expectDefined, ISSUER, issuerKey, keyResolver } from "./helpers.js";

const LIST_URL = "https://alice.example/status/revocation-1";
const INDEX = 42;

/** Build + sign a status list credential (default: issuer key, revocation). */
async function signedList(
  key: KeyPair,
  overrides?: {
    readonly bits?: Uint8Array;
    readonly statusPurpose?: "revocation" | "suspension";
    readonly issuer?: string;
    readonly id?: string;
    readonly validUntil?: string;
  },
): Promise<VerifiableCredential> {
  const unsigned = buildBitstringStatusListCredential({
    id: overrides?.id ?? LIST_URL,
    issuer: overrides?.issuer ?? ISSUER,
    statusPurpose: overrides?.statusPurpose ?? "revocation",
    ...(overrides?.bits !== undefined ? { bits: overrides.bits } : {}),
    ...(overrides?.validUntil !== undefined ? { validUntil: overrides.validUntil } : {}),
  });
  return issue({ credential: unsigned, key });
}

/** An injected fetch serving `body` (default JSON) at exactly `url`. */
function fetchServing(url: string, body: unknown, status = 200): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL) => {
    if (String(input) !== url) return new Response("not found", { status: 404 });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, {
      status,
      headers: { "content-type": "application/vc+ld+json" },
    });
  }) as typeof globalThis.fetch;
}

/** Issue an agent-authorization credential carrying a status entry. */
async function issuedWithStatus(
  key: KeyPair,
  purpose: "revocation" | "suspension" = "revocation",
): Promise<VerifiableCredential> {
  return issueAgentAuthorization(
    {
      principal: ISSUER,
      agent: AGENT,
      action: ACL_READ,
      credentialStatus: bitstringStatusListEntry({
        statusPurpose: purpose,
        statusListIndex: INDEX,
        statusListCredential: LIST_URL,
      }),
    },
    key,
  );
}

// ---------------------------------------------------------------------------
describe("bitstring encode/decode", () => {
  it("creates the spec-minimum 131072-bit (16KB) list by default", () => {
    const bits = createStatusBitstring();
    expect(bits.length).toBe(MIN_STATUS_LIST_LENGTH / 8);
    expect(bits.every((b) => b === 0)).toBe(true);
  });

  it("refuses a list below the 16KB herd-privacy minimum or a partial byte", () => {
    expect(() => createStatusBitstring(8)).toThrow(RangeError);
    expect(() => createStatusBitstring(MIN_STATUS_LIST_LENGTH - 8)).toThrow(RangeError);
    expect(() => createStatusBitstring(MIN_STATUS_LIST_LENGTH + 3)).toThrow(RangeError);
    expect(createStatusBitstring(MIN_STATUS_LIST_LENGTH * 2).length).toBe(
      MIN_STATUS_LIST_LENGTH / 4,
    );
  });

  it("sets, reads and clears bits — MSB-first (index 0 = leftmost bit of byte 0)", () => {
    const bits = createStatusBitstring();
    setStatusBit(bits, 0, true);
    expect(bits[0]).toBe(0x80);
    expect(getStatusBit(bits, 0)).toBe(true);
    expect(getStatusBit(bits, 1)).toBe(false);
    setStatusBit(bits, 7, true);
    expect(bits[0]).toBe(0x81);
    setStatusBit(bits, 0, false);
    expect(bits[0]).toBe(0x01);
    expect(getStatusBit(bits, 0)).toBe(false);
  });

  it("round-trips boundary indices 0 and 131071 through encode/decode", () => {
    const bits = createStatusBitstring();
    setStatusBit(bits, 0, true);
    setStatusBit(bits, MIN_STATUS_LIST_LENGTH - 1, true);
    setStatusBit(bits, INDEX, true);
    const decoded = decodeStatusList(encodeStatusList(bits));
    expect(decoded).toEqual(bits);
    expect(getStatusBit(decoded, 0)).toBe(true);
    expect(getStatusBit(decoded, MIN_STATUS_LIST_LENGTH - 1)).toBe(true);
    expect(getStatusBit(decoded, INDEX)).toBe(true);
    expect(getStatusBit(decoded, INDEX + 1)).toBe(false);
  });

  it("bounds-checks bit access — out-of-range reads THROW, never read as clear", () => {
    const bits = createStatusBitstring();
    expect(() => getStatusBit(bits, -1)).toThrow(RangeError);
    expect(() => getStatusBit(bits, MIN_STATUS_LIST_LENGTH)).toThrow(RangeError);
    expect(() => getStatusBit(bits, 1.5)).toThrow(RangeError);
    expect(() => setStatusBit(bits, MIN_STATUS_LIST_LENGTH, true)).toThrow(RangeError);
  });

  it("encodes with the multibase base64url prefix `u`", () => {
    const encoded = encodeStatusList(createStatusBitstring());
    expect(encoded.startsWith("u")).toBe(true);
    expect(encoded).toMatch(/^u[A-Za-z0-9_-]+$/);
  });

  it("fail-closed decode: wrong prefix, bad alphabet, non-gzip, undersize", () => {
    const good = encodeStatusList(createStatusBitstring());
    expect(() => decodeStatusList(`z${good.slice(1)}`)).toThrow(BitstringDecodeError);
    expect(() => decodeStatusList("u!!!not-base64url!!!")).toThrow(BitstringDecodeError);
    expect(() =>
      decodeStatusList(`u${Buffer.from("plainly not gzip").toString("base64url")}`),
    ).toThrow(BitstringDecodeError);
    // valid gzip, but expands below the spec's 16KB minimum
    const tiny = `u${Buffer.from(gzipSync(new Uint8Array(16))).toString("base64url")}`;
    expect(() => decodeStatusList(tiny)).toThrow(/below the spec/);
    expect(() => decodeStatusList("")).toThrow(BitstringDecodeError);
    expect(() => decodeStatusList("u")).toThrow(BitstringDecodeError);
  });

  it("zip-bomb guard: an expansion over maxDecodedBytes is refused", () => {
    const big = new Uint8Array(64 * 1024); // 64KB expanded
    const encoded = encodeStatusList(big);
    expect(() => decodeStatusList(encoded, { maxDecodedBytes: 32 * 1024 })).toThrow(
      BitstringDecodeError,
    );
    expect(decodeStatusList(encoded, { maxDecodedBytes: 64 * 1024 }).length).toBe(64 * 1024);
  });
});

// ---------------------------------------------------------------------------
describe("issue side — entry + list credential builders", () => {
  it("builds a validated status entry (number index → spec string form)", () => {
    const entry = bitstringStatusListEntry({
      statusPurpose: "revocation",
      statusListIndex: INDEX,
      statusListCredential: LIST_URL,
    });
    expect(entry).toEqual({
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "42",
      statusListCredential: LIST_URL,
    });
  });

  it("refuses a malformed entry: bad index, purpose, or list URL", () => {
    const base = {
      statusPurpose: "revocation",
      statusListIndex: INDEX,
      statusListCredential: LIST_URL,
    } as const;
    expect(() => bitstringStatusListEntry({ ...base, statusListIndex: -1 })).toThrow();
    expect(() => bitstringStatusListEntry({ ...base, statusListIndex: 1.5 })).toThrow();
    expect(() => bitstringStatusListEntry({ ...base, statusListIndex: "007" })).toThrow();
    expect(() =>
      bitstringStatusListEntry({
        ...base,
        statusPurpose: "message" as unknown as "revocation",
      }),
    ).toThrow();
    expect(() =>
      bitstringStatusListEntry({ ...base, statusListCredential: "ftp://x.example/l" }),
    ).toThrow();
    expect(() =>
      bitstringStatusListEntry({ ...base, statusListCredential: "not a url" }),
    ).toThrow();
  });

  it("builds, signs and verifies a status list credential", async () => {
    const key = await issuerKey();
    const list = await signedList(key);
    expect(list.id).toBe(LIST_URL);
    expect(list.type).toContain("BitstringStatusListCredential");
    const result = await verifyCredential(list, { resolveKey: keyResolver(key) });
    expect(result.verified).toBe(true);
  });

  it("withStatusBit flips one bit immutably and drops any stale proof", async () => {
    const key = await issuerKey();
    const list = await signedList(key);
    expect(readStatusBit(list, INDEX)).toBe(false);
    const revokedList = withStatusBit(list, INDEX, true);
    expect(readStatusBit(revokedList, INDEX)).toBe(true);
    expect(readStatusBit(list, INDEX)).toBe(false); // original untouched
    expect((revokedList as VerifiableCredential).proof).toBeUndefined();
    const reinstated = withStatusBit(revokedList, INDEX, false);
    expect(readStatusBit(reinstated, INDEX)).toBe(false);
  });

  it("lowers credentialStatus into the SIGNED RDF graph and round-trips it", async () => {
    const key = await issuerKey();
    const vc = await issuedWithStatus(key);
    const turtle = await credentialToTurtle(vc);
    expect(turtle).toContain("credentials/status#BitstringStatusListEntry");
    expect(turtle).toContain(LIST_URL);
    const node = expectDefined(
      credentialFromRdf(await parseCredentialRdf(turtle)),
      "credential node",
    );
    expect(credentialStatusFromNode(node)).toEqual([
      {
        type: "BitstringStatusListEntry",
        statusPurpose: "revocation",
        statusListIndex: "42",
        statusListCredential: LIST_URL,
      },
    ]);
  });

  it("projects credentialStatus into the JSON-LD document (lock-step keys)", async () => {
    const key = await issuerKey();
    const vc = await issuedWithStatus(key);
    const doc = credentialToJsonLd(vc);
    expect(doc.credentialStatus).toEqual({
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "42",
      statusListCredential: LIST_URL,
    });
  });

  it("refuses to lower an unsupported / malformed status entry (fail-closed)", async () => {
    const key = await issuerKey();
    const bad = (status: unknown): Promise<VerifiableCredential> =>
      issue({
        credential: {
          issuer: ISSUER,
          credentialSubject: { id: AGENT },
          credentialStatus: status,
        } as unknown as Credential,
        key,
      });
    await expect(bad({ type: "StatusList2021Entry" })).rejects.toThrow(/unsupported/);
    await expect(
      bad({
        type: "BitstringStatusListEntry",
        statusPurpose: "revocation",
        statusListIndex: "1.5",
        statusListCredential: LIST_URL,
      }),
    ).rejects.toThrow(/statusListIndex/);
    await expect(
      bad({
        type: "BitstringStatusListEntry",
        statusPurpose: "revocation",
        statusListIndex: "1",
        statusListCredential: "relative/path",
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
describe("Phase C — a non-revoked credential verifies; a revoked one fails closed", () => {
  it("verifies a credential whose status bit is CLEAR", async () => {
    const key = await issuerKey();
    const vc = await issuedWithStatus(key);
    const list = await signedList(key);
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      resolveStatus: createBitstringStatusResolver({
        resolveKey: keyResolver(key),
        fetch: fetchServing(LIST_URL, list),
      }),
    });
    expect(result.verified).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("REJECTS a revoked credential (bit set) with STATUS_REVOKED", async () => {
    const key = await issuerKey();
    const vc = await issuedWithStatus(key);
    const bits = createStatusBitstring();
    setStatusBit(bits, INDEX, true);
    const list = await signedList(key, { bits });
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      resolveStatus: createBitstringStatusResolver({
        resolveKey: keyResolver(key),
        fetch: fetchServing(LIST_URL, list),
      }),
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("STATUS_REVOKED");
  });

  it("REJECTS a suspended credential with STATUS_SUSPENDED", async () => {
    const key = await issuerKey();
    const vc = await issuedWithStatus(key, "suspension");
    const bits = createStatusBitstring();
    setStatusBit(bits, INDEX, true);
    const list = await signedList(key, { bits, statusPurpose: "suspension" });
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      resolveStatus: createBitstringStatusResolver({
        resolveKey: keyResolver(key),
        fetch: fetchServing(LIST_URL, list),
      }),
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("STATUS_SUSPENDED");
  });

  it("a credential with NO credentialStatus verifies (no revocation mechanism)", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization(
      { principal: ISSUER, agent: AGENT, action: ACL_READ },
      key,
    );
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      resolveStatus: createBitstringStatusResolver({
        resolveKey: keyResolver(key),
        fetch: fetchServing(LIST_URL, "unused"),
      }),
    });
    expect(result.verified).toBe(true);
    expect(
      await resolveBitstringStatus(vc, {
        resolveKey: keyResolver(key),
        fetch: fetchServing(LIST_URL, "unused"),
      }),
    ).toEqual({ status: "absent" });
  });
});

// ---------------------------------------------------------------------------
describe("Phase C — every unconfirmable status FAILS CLOSED as STATUS_UNREACHABLE", () => {
  /** Verify `vc` with the given status fetch/options and expect STATUS_UNREACHABLE. */
  async function expectUnreachable(
    vc: VerifiableCredential,
    key: KeyPair,
    fetchImpl: typeof globalThis.fetch,
    extra?: { readonly maxDecodedBytes?: number; readonly maxBodyBytes?: number },
  ): Promise<void> {
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      resolveStatus: createBitstringStatusResolver({
        resolveKey: keyResolver(key),
        fetch: fetchImpl,
        ...(extra ?? {}),
      }),
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("STATUS_UNREACHABLE");
    expect(result.errors.map((e) => e.code)).not.toContain("STATUS_REVOKED");
  }

  it("an unreachable list (404) is a failure, not a pass", async () => {
    const key = await issuerKey();
    const vc = await issuedWithStatus(key);
    await expectUnreachable(vc, key, fetchServing("https://elsewhere.example/", "x"));
  });

  it("a throwing fetch (network / SSRF refusal) is a failure", async () => {
    const key = await issuerKey();
    const vc = await issuedWithStatus(key);
    const throwing = (async () => {
      throw new Error("connect refused");
    }) as unknown as typeof globalThis.fetch;
    await expectUnreachable(vc, key, throwing);
  });

  it("a REDIRECTED response is refused", async () => {
    const key = await issuerKey();
    const vc = await issuedWithStatus(key);
    const list = await signedList(key);
    const redirected = (async () =>
      ({
        ok: true,
        status: 200,
        redirected: true,
        url: LIST_URL,
        body: null,
        text: async () => JSON.stringify(list),
      }) as unknown as Response) as typeof globalThis.fetch;
    await expectUnreachable(vc, key, redirected);
  });

  it("a response whose final URL differs is refused (silent-follow guard)", async () => {
    const key = await issuerKey();
    const vc = await issuedWithStatus(key);
    const list = await signedList(key);
    const crossUrl = (async () =>
      ({
        ok: true,
        status: 200,
        redirected: false,
        url: "https://evil.example/list",
        body: null,
        text: async () => JSON.stringify(list),
      }) as unknown as Response) as typeof globalThis.fetch;
    await expectUnreachable(vc, key, crossUrl);
  });

  it("a TAMPERED list (encodedList swapped after signing) fails its signature", async () => {
    const key = await issuerKey();
    const vc = await issuedWithStatus(key);
    const list = await signedList(key); // signed over the all-clear list
    const bits = createStatusBitstring();
    setStatusBit(bits, INDEX, true);
    const tampered = {
      ...list,
      credentialSubject: {
        ...(list.credentialSubject as Record<string, unknown>),
        encodedList: encodeStatusList(bits),
      },
    };
    await expectUnreachable(vc, key, fetchServing(LIST_URL, tampered));
  });

  it("a list whose own signature is INVALID (garbage proofValue) is refused", async () => {
    const key = await issuerKey();
    const vc = await issuedWithStatus(key);
    const list = await signedList(key);
    const broken = {
      ...list,
      proof: { ...(list.proof as Record<string, unknown>), proofValue: "z3BrokenBroken" },
    };
    await expectUnreachable(vc, key, fetchServing(LIST_URL, broken));
  });

  it("a list signed by an ATTACKER issuer/key is refused (issuer pinning)", async () => {
    const key = await issuerKey();
    const vc = await issuedWithStatus(key);
    // The attacker controls a different WebID + key and serves their own
    // "all clear" list at the expected URL.
    const { generateKeyPairForSuite } = await import("../src/keys.js");
    const attacker = "https://mallory.example/profile#me";
    const attackerKey = await generateKeyPairForSuite(`${attacker}#key-1`, "Ed25519");
    const forgedList = await signedList(attackerKey, { issuer: attacker });
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key, attackerKey), // even with the key resolvable…
      resolveStatus: createBitstringStatusResolver({
        resolveKey: keyResolver(key, attackerKey),
        fetch: fetchServing(LIST_URL, forgedList),
      }),
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("STATUS_UNREACHABLE");
  });

  it("a purpose mismatch (entry: revocation, list: suspension) is refused", async () => {
    const key = await issuerKey();
    const vc = await issuedWithStatus(key, "revocation");
    const list = await signedList(key, { statusPurpose: "suspension" });
    await expectUnreachable(vc, key, fetchServing(LIST_URL, list));
  });

  it("a list whose id differs from the fetched URL is refused", async () => {
    const key = await issuerKey();
    const vc = await issuedWithStatus(key);
    const list = await signedList(key, { id: "https://alice.example/status/other" });
    await expectUnreachable(vc, key, fetchServing(LIST_URL, list));
  });

  it("an out-of-range statusListIndex is refused (never read as clear)", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization(
      {
        principal: ISSUER,
        agent: AGENT,
        action: ACL_READ,
        credentialStatus: bitstringStatusListEntry({
          statusPurpose: "revocation",
          statusListIndex: MIN_STATUS_LIST_LENGTH, // one past the end
          statusListCredential: LIST_URL,
        }),
      },
      key,
    );
    const list = await signedList(key);
    await expectUnreachable(vc, key, fetchServing(LIST_URL, list));
  });

  it("an EXPIRED status list credential is refused (stale-list replay)", async () => {
    const key = await issuerKey();
    const vc = await issuedWithStatus(key);
    const list = await signedList(key, { validUntil: "2001-01-01T00:00:00Z" });
    await expectUnreachable(vc, key, fetchServing(LIST_URL, list));
  });

  it("a non-JSON body / non-list document is refused", async () => {
    const key = await issuerKey();
    const vc = await issuedWithStatus(key);
    await expectUnreachable(vc, key, fetchServing(LIST_URL, "<html>not json</html>"));
    await expectUnreachable(vc, key, fetchServing(LIST_URL, { id: LIST_URL, type: ["Nope"] }));
  });

  it("an undecodable / zip-bomb encodedList inside a VALIDLY SIGNED list is refused", async () => {
    const key = await issuerKey();
    const vc = await issuedWithStatus(key);
    // 32KB list, signed correctly — but the verifier caps decode at 20000 bytes.
    const list = await signedList(key, {
      bits: createStatusBitstring(2 * MIN_STATUS_LIST_LENGTH),
    });
    await expectUnreachable(vc, key, fetchServing(LIST_URL, list), {
      maxDecodedBytes: 20000,
    });
  });

  it("a body over maxBodyBytes is refused before it is parsed", async () => {
    const key = await issuerKey();
    const vc = await issuedWithStatus(key);
    const list = await signedList(key);
    await expectUnreachable(vc, key, fetchServing(LIST_URL, list), { maxBodyBytes: 512 });
  });

  it("an unsupported entry (alien type / statusSize > 1 / bad shape) is refused", async () => {
    const key = await issuerKey();
    const resolve = (status: unknown): Promise<CredentialStatusCheck> =>
      resolveBitstringStatus(
        {
          issuer: ISSUER,
          credentialSubject: { id: AGENT },
          credentialStatus: status,
        } as unknown as Credential,
        { resolveKey: keyResolver(key), fetch: fetchServing(LIST_URL, "unused") },
      );
    expect((await resolve({ type: "StatusList2021Entry" })).status).toBe("unreachable");
    expect((await resolve("a string")).status).toBe("unreachable");
    expect((await resolve([null])).status).toBe("unreachable");
    expect(
      (
        await resolve({
          type: "BitstringStatusListEntry",
          statusPurpose: "revocation",
          statusListIndex: "1",
          statusListCredential: LIST_URL,
          statusSize: 2,
        })
      ).status,
    ).toBe("unreachable");
    expect(
      (
        await resolve({
          type: "BitstringStatusListEntry",
          statusPurpose: "revocation",
          statusListIndex: 7 as unknown as string, // number, not the spec string
          statusListCredential: LIST_URL,
        })
      ).status,
    ).toBe("unreachable");
  });

  it("an entry-count over the request-amplification cap is refused", async () => {
    const key = await issuerKey();
    const entries = Array.from({ length: 9 }, (_, i) =>
      bitstringStatusListEntry({
        statusPurpose: "revocation",
        statusListIndex: i,
        statusListCredential: `https://alice.example/status/${i}`,
      }),
    );
    const check = await resolveBitstringStatus(
      {
        issuer: ISSUER,
        credentialSubject: { id: AGENT },
        credentialStatus: entries,
      },
      { resolveKey: keyResolver(key), fetch: fetchServing(LIST_URL, "unused") },
    );
    expect(check.status).toBe("unreachable");
  });

  it("a THROWING resolveStatus seam maps to STATUS_UNREACHABLE, never a crash", async () => {
    const key = await issuerKey();
    const vc = await issuedWithStatus(key);
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      resolveStatus: () => {
        throw new Error("resolver exploded");
      },
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("STATUS_UNREACHABLE");
  });

  it("an unrecognised resolver outcome shape maps to STATUS_UNREACHABLE", async () => {
    const key = await issuerKey();
    const vc = await issuedWithStatus(key);
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      resolveStatus: () => ({ status: "fine" }) as unknown as CredentialStatusCheck,
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("STATUS_UNREACHABLE");
  });

  it("with several entries, ONE bad entry fails the credential (revoked wins)", async () => {
    const key = await issuerKey();
    const clearList = await signedList(key);
    const otherUrl = "https://alice.example/status/suspension-1";
    const suspBits = createStatusBitstring();
    setStatusBit(suspBits, 7, true);
    const suspList = await signedList(key, {
      id: otherUrl,
      statusPurpose: "suspension",
      bits: suspBits,
    });
    const vc = await issueAgentAuthorization(
      {
        principal: ISSUER,
        agent: AGENT,
        action: ACL_READ,
        credentialStatus: [
          bitstringStatusListEntry({
            statusPurpose: "revocation",
            statusListIndex: INDEX,
            statusListCredential: LIST_URL,
          }),
          bitstringStatusListEntry({
            statusPurpose: "suspension",
            statusListIndex: 7,
            statusListCredential: otherUrl,
          }),
        ],
      },
      key,
    );
    const byUrl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url === LIST_URL ? clearList : url === otherUrl ? suspList : undefined;
      if (body === undefined) return new Response("nope", { status: 404 });
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof globalThis.fetch;
    const check = await resolveBitstringStatus(vc, {
      resolveKey: keyResolver(key),
      fetch: byUrl,
    });
    expect(check.status).toBe("suspended"); // the clear revocation entry does NOT mask the set suspension bit
  });
});
