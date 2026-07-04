// AUTHORED-BY Claude Fable 5
//
// WebID verification-method publish + resolve (runtime Phase-1 G4/G5) —
// SECURITY-CRITICAL and exhaustive. The resolver is a TRUST ROOT: a credential
// verifies against whatever key it returns, so every fail-open here is a
// forgery path. All tests are OFFLINE (the fetch is injected) — the one
// guarded-fetch case drives the SSRF refusal with an injected resolver, no
// network ever.

import { describe, expect, it } from "vitest";
import { issueAgentAuthorization } from "../src/issue.js";
import { generateKeyPairForSuite } from "../src/keys.js";
import { DataIntegritySuite } from "../src/proof.js";
import type { KeyPair } from "../src/types.js";
import { verifyCredential } from "../src/verify.js";
import {
  createWebIdKeyResolver,
  decodeMultikey,
  encodeMultikey,
  publishVerificationMethod,
  resolveWebIdKey,
} from "../src/webid.js";
import { ACL_READ, AGENT, expectDefined } from "./helpers.js";

const WEBID = "https://alice.example/profile#me";
const DOC = "https://alice.example/profile";
const KEY_ID = "https://alice.example/profile#key-1";
const MALLORY = "https://mallory.example/profile#me";

const AUTH = {
  principal: WEBID,
  agent: AGENT,
  action: ACL_READ,
  target: "https://alice.example/notes/",
} as const;

/** One mock document an injected fetch serves. */
interface MockDoc {
  readonly body: string;
  readonly contentType?: string;
  readonly status?: number;
  readonly redirected?: boolean;
  /** Override the response's reported final URL (default: the requested URL). */
  readonly url?: string;
  readonly throws?: boolean;
}

/** An offline fetch over a fixed URL → document map, recording every request. */
function mockFetch(docs: Record<string, MockDoc>, calls: string[] = []): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    calls.push(url);
    const doc = docs[url];
    if (doc === undefined) return new Response("not found", { status: 404 });
    if (doc.throws === true) throw new TypeError("network unreachable");
    const res = new Response(doc.body, {
      status: doc.status ?? 200,
      headers: { "content-type": doc.contentType ?? "text/turtle" },
    });
    Object.defineProperty(res, "url", { value: doc.url ?? url });
    Object.defineProperty(res, "redirected", { value: doc.redirected ?? false });
    return res;
  }) as typeof globalThis.fetch;
}

/** Publish alice's key and serve the resulting document at her profile URL. */
async function publishedDocs(
  keyPair: KeyPair,
  extra: Record<string, MockDoc> = {},
): Promise<Record<string, MockDoc>> {
  const published = await publishVerificationMethod({ controller: WEBID, key: keyPair });
  return { [DOC]: { body: published.turtle }, ...extra };
}

describe("publishVerificationMethod (G5)", () => {
  it("emits the controller listing + Multikey node the resolver requires", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const published = await publishVerificationMethod({ controller: WEBID, key: kp });
    expect(published.controller).toBe(WEBID);
    expect(published.verificationMethod).toBe(KEY_ID);
    expect(published.keyType).toBe("Ed25519");
    expect(published.publicKeyMultibase.startsWith("z")).toBe(true);
    expect(published.quads).toHaveLength(5);
    // The Turtle carries every relationship the read side enforces.
    expect(published.turtle).toContain("verificationMethod");
    expect(published.turtle).toContain("assertionMethod");
    expect(published.turtle).toContain("Multikey");
    expect(published.turtle).toContain("controller");
    expect(published.turtle).toContain(published.publicKeyMultibase);
  });

  it("accepts a bare public CryptoKey with an explicit verificationMethod", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "P-256");
    const published = await publishVerificationMethod({
      controller: WEBID,
      key: kp.publicKey,
      verificationMethod: KEY_ID,
    });
    expect(published.keyType).toBe("P-256");
    expect(published.verificationMethod).toBe(KEY_ID);
  });

  it("throws on a non-http(s) controller", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID);
    await expect(
      publishVerificationMethod({ controller: "did:example:alice", key: kp }),
    ).rejects.toThrow(/controller must be an absolute http\(s\) IRI/);
    await expect(publishVerificationMethod({ controller: "not a url", key: kp })).rejects.toThrow(
      /controller/,
    );
  });

  it("throws on a non-http(s) / missing verificationMethod", async () => {
    const kp = await generateKeyPairForSuite("javascript:alert(1)");
    await expect(publishVerificationMethod({ controller: WEBID, key: kp })).rejects.toThrow(
      /verificationMethod/,
    );
    const bare = await generateKeyPairForSuite(KEY_ID);
    await expect(
      publishVerificationMethod({ controller: WEBID, key: bare.publicKey }),
    ).rejects.toThrow(/requires a verificationMethod/);
  });
});

describe("multikey codec", () => {
  it("round-trips an Ed25519 public key", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const encoded = await encodeMultikey(kp.publicKey);
    const decoded = expectDefined(await decodeMultikey(encoded), "decoded Ed25519 multikey");
    expect(decoded.keyType).toBe("Ed25519");
    expect(await encodeMultikey(decoded.publicKey)).toBe(encoded);
  });

  it("round-trips a P-256 public key (compressed point)", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "P-256");
    const encoded = await encodeMultikey(kp.publicKey);
    const decoded = expectDefined(await decodeMultikey(encoded), "decoded P-256 multikey");
    expect(decoded.keyType).toBe("P-256");
    expect(await encodeMultikey(decoded.publicKey)).toBe(encoded);
  });

  it("fails closed on every malformed multikey", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const good = await encodeMultikey(kp.publicKey);
    expect(await decodeMultikey("")).toBeUndefined();
    expect(await decodeMultikey("not-multibase")).toBeUndefined();
    // wrong multibase prefix (base64url 'u' instead of base58btc 'z')
    expect(await decodeMultikey(`u${good.slice(1)}`)).toBeUndefined();
    // truncated key bytes
    expect(await decodeMultikey(good.slice(0, good.length - 4))).toBeUndefined();
    // an unknown multicodec prefix (valid base58btc, wrong header)
    expect(await decodeMultikey("z6666666666666666666666666666666666666666666")).toBeUndefined();
  });
});

describe("resolveWebIdKey (G4) — happy paths", () => {
  it("round-trips publish → resolve (Ed25519)", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const fetch = mockFetch(await publishedDocs(kp));
    const resolved = expectDefined(await resolveWebIdKey(WEBID, KEY_ID, { fetch }), "resolved");
    expect(resolved.controller).toBe(WEBID);
    expect(resolved.verificationMethod).toBe(KEY_ID);
    expect(resolved.keyType).toBe("Ed25519");
    expect(await encodeMultikey(resolved.publicKey)).toBe(await encodeMultikey(kp.publicKey));
  });

  it("round-trips publish → resolve (P-256)", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "P-256");
    const fetch = mockFetch(await publishedDocs(kp));
    const resolved = expectDefined(await resolveWebIdKey(WEBID, KEY_ID, { fetch }), "resolved");
    expect(resolved.keyType).toBe("P-256");
  });

  it("resolves a document written with RELATIVE IRIs (baseIRI resolution)", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const multibase = await encodeMultikey(kp.publicKey);
    const body = `@prefix sec: <https://w3id.org/security#>.
<#me> sec:assertionMethod <#key-1>.
<#key-1> a sec:Multikey; sec:controller <#me>; sec:publicKeyMultibase "${multibase}".`;
    const fetch = mockFetch({ [DOC]: { body } });
    const resolved = await resolveWebIdKey(WEBID, KEY_ID, { fetch });
    expect(resolved?.verificationMethod).toBe(KEY_ID);
  });

  it("resolves a key hosted in a SEPARATE document when BOTH sides assert it", async () => {
    const remoteKeyId = "https://keys.alice.example/k#key-9";
    const kp = await generateKeyPairForSuite(remoteKeyId, "Ed25519");
    const multibase = await encodeMultikey(kp.publicKey);
    const controllerBody = `@prefix sec: <https://w3id.org/security#>.
<${WEBID}> sec:assertionMethod <${remoteKeyId}>.`;
    const keyBody = `@prefix sec: <https://w3id.org/security#>.
<${remoteKeyId}> a sec:Multikey; sec:controller <${WEBID}>; sec:publicKeyMultibase "${multibase}".`;
    const fetch = mockFetch({
      [DOC]: { body: controllerBody },
      "https://keys.alice.example/k": { body: keyBody },
    });
    const resolved = await resolveWebIdKey(WEBID, remoteKeyId, { fetch });
    expect(resolved?.keyType).toBe("Ed25519");
  });
});

describe("resolveWebIdKey (G4) — fail-closed document enforcement", () => {
  it("refuses a key id the WebID document does NOT list (isControlledBy not backed)", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const multibase = await encodeMultikey(kp.publicKey);
    // The key node exists with the right controller — but alice's document never
    // AUTHORISES it under sec:assertionMethod. The credential-names-an-
    // unauthorised-key attack: must fail closed.
    const body = `@prefix sec: <https://w3id.org/security#>.
<${KEY_ID}> a sec:Multikey; sec:controller <${WEBID}>; sec:publicKeyMultibase "${multibase}".`;
    const fetch = mockFetch({ [DOC]: { body } });
    expect(await resolveWebIdKey(WEBID, KEY_ID, { fetch })).toBeUndefined();
  });

  it("refuses a generic sec:verificationMethod listing without assertionMethod", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const multibase = await encodeMultikey(kp.publicKey);
    const body = `@prefix sec: <https://w3id.org/security#>.
<${WEBID}> sec:verificationMethod <${KEY_ID}>.
<${KEY_ID}> a sec:Multikey; sec:controller <${WEBID}>; sec:publicKeyMultibase "${multibase}".`;
    const fetch = mockFetch({ [DOC]: { body } });
    expect(await resolveWebIdKey(WEBID, KEY_ID, { fetch })).toBeUndefined();
  });

  it("refuses a key id that is absent from its document", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const fetch = mockFetch(await publishedDocs(kp));
    expect(
      await resolveWebIdKey(WEBID, "https://alice.example/profile#key-2", { fetch }),
    ).toBeUndefined();
  });

  it("refuses a key whose document asserts a DIFFERENT controller", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const multibase = await encodeMultikey(kp.publicKey);
    const body = `@prefix sec: <https://w3id.org/security#>.
<${WEBID}> sec:assertionMethod <${KEY_ID}>.
<${KEY_ID}> a sec:Multikey; sec:controller <${MALLORY}>; sec:publicKeyMultibase "${multibase}".`;
    const fetch = mockFetch({ [DOC]: { body } });
    expect(await resolveWebIdKey(WEBID, KEY_ID, { fetch })).toBeUndefined();
  });

  it("refuses a key with EXTRA controllers (ambiguous control)", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const multibase = await encodeMultikey(kp.publicKey);
    const body = `@prefix sec: <https://w3id.org/security#>.
<${WEBID}> sec:assertionMethod <${KEY_ID}>.
<${KEY_ID}> a sec:Multikey; sec:controller <${WEBID}>, <${MALLORY}>;
  sec:publicKeyMultibase "${multibase}".`;
    const fetch = mockFetch({ [DOC]: { body } });
    expect(await resolveWebIdKey(WEBID, KEY_ID, { fetch })).toBeUndefined();
  });

  it("refuses a key node not typed sec:Multikey", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const multibase = await encodeMultikey(kp.publicKey);
    const body = `@prefix sec: <https://w3id.org/security#>.
<${WEBID}> sec:assertionMethod <${KEY_ID}>.
<${KEY_ID}> sec:controller <${WEBID}>; sec:publicKeyMultibase "${multibase}".`;
    const fetch = mockFetch({ [DOC]: { body } });
    expect(await resolveWebIdKey(WEBID, KEY_ID, { fetch })).toBeUndefined();
  });

  it("refuses CONFLICTING publicKeyMultibase values", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const other = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const body = `@prefix sec: <https://w3id.org/security#>.
<${WEBID}> sec:assertionMethod <${KEY_ID}>.
<${KEY_ID}> a sec:Multikey; sec:controller <${WEBID}>;
  sec:publicKeyMultibase "${await encodeMultikey(kp.publicKey)}", "${await encodeMultikey(other.publicKey)}".`;
    const fetch = mockFetch({ [DOC]: { body } });
    expect(await resolveWebIdKey(WEBID, KEY_ID, { fetch })).toBeUndefined();
  });

  it("refuses an attacker-hosted key the WebID never authorised (cross-document)", async () => {
    const hostileKeyId = "https://mallory.example/keys#k";
    const kp = await generateKeyPairForSuite(hostileKeyId, "Ed25519");
    const multibase = await encodeMultikey(kp.publicKey);
    // Mallory's document claims alice controls mallory's key — but ALICE's own
    // document never lists it, so the claim is not document-backed.
    const alice = `@prefix sec: <https://w3id.org/security#>. <${WEBID}> a <https://example.org/Agent>.`;
    const hostile = `@prefix sec: <https://w3id.org/security#>.
<${WEBID}> sec:assertionMethod <${hostileKeyId}>.
<${hostileKeyId}> a sec:Multikey; sec:controller <${WEBID}>; sec:publicKeyMultibase "${multibase}".`;
    const fetch = mockFetch({
      [DOC]: { body: alice },
      "https://mallory.example/keys": { body: hostile },
    });
    expect(await resolveWebIdKey(WEBID, hostileKeyId, { fetch })).toBeUndefined();
  });

  it("ignores statements a FOREIGN document makes about the WebID (authoritative-doc discipline)", async () => {
    // The assertionMethod listing appears ONLY in mallory's document; alice's own
    // document does not list the key. The resolver must read the listing only
    // from alice's document → fail closed.
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const multibase = await encodeMultikey(kp.publicKey);
    const alice = `@prefix sec: <https://w3id.org/security#>.
<${KEY_ID}> a sec:Multikey; sec:controller <${WEBID}>; sec:publicKeyMultibase "${multibase}".`;
    const mallory = `@prefix sec: <https://w3id.org/security#>.
<${WEBID}> sec:assertionMethod <${KEY_ID}>.`;
    const fetch = mockFetch({
      [DOC]: { body: alice },
      "https://mallory.example/profile": { body: mallory },
    });
    expect(await resolveWebIdKey(WEBID, KEY_ID, { fetch })).toBeUndefined();
  });
});

describe("resolveWebIdKey (G4) — transport fail-closed", () => {
  it("refuses non-http(s) identities WITHOUT issuing any request", async () => {
    const calls: string[] = [];
    const fetch = mockFetch({}, calls);
    for (const bad of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "did:key:z6Mk",
      "not a url",
      "",
    ]) {
      expect(await resolveWebIdKey(bad, KEY_ID, { fetch })).toBeUndefined();
      expect(await resolveWebIdKey(WEBID, bad, { fetch })).toBeUndefined();
    }
    expect(calls).toEqual([]);
  });

  it("refuses a redirect response (3xx never followed)", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const docs = await publishedDocs(kp);
    const body = (docs[DOC] as MockDoc).body;
    const fetch = mockFetch({ [DOC]: { body, status: 302 } });
    expect(await resolveWebIdKey(WEBID, KEY_ID, { fetch })).toBeUndefined();
  });

  it("refuses a response an injected fetch silently FOLLOWED (redirected flag)", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const docs = await publishedDocs(kp);
    const body = (docs[DOC] as MockDoc).body;
    const fetch = mockFetch({ [DOC]: { body, redirected: true } });
    expect(await resolveWebIdKey(WEBID, KEY_ID, { fetch })).toBeUndefined();
  });

  it("refuses a response whose final URL differs from the requested document", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const docs = await publishedDocs(kp);
    const body = (docs[DOC] as MockDoc).body;
    const fetch = mockFetch({ [DOC]: { body, url: "https://evil.example/profile" } });
    expect(await resolveWebIdKey(WEBID, KEY_ID, { fetch })).toBeUndefined();
  });

  it("fails closed on 404 / 500 / thrown fetch / unparseable body / non-RDF content type", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const docs = await publishedDocs(kp);
    const body = (docs[DOC] as MockDoc).body;
    const cases: Record<string, MockDoc>[] = [
      {},
      { [DOC]: { body, status: 404 } },
      { [DOC]: { body, status: 500 } },
      { [DOC]: { body, throws: true } },
      { [DOC]: { body: "@prefix broken" } },
      { [DOC]: { body, contentType: "text/html" } },
    ];
    for (const c of cases) {
      expect(await resolveWebIdKey(WEBID, KEY_ID, { fetch: mockFetch(c) })).toBeUndefined();
    }
  });

  it("is refused by the guarded default posture for a private-address host (SSRF)", async () => {
    // Drive the REAL @jeswr/guarded-fetch node path with an injected resolver
    // that answers with the cloud-metadata address — the guard must refuse
    // before any socket, entirely offline.
    const { createNodeGuardedFetch } = await import("@jeswr/guarded-fetch/node");
    const fetch = createNodeGuardedFetch({
      maxRedirects: 0,
      resolveAll: async () => [{ address: "169.254.169.254", family: 4 }],
    });
    expect(await resolveWebIdKey(WEBID, KEY_ID, { fetch })).toBeUndefined();
  });
});

describe("createWebIdKeyResolver — the verifyCredential wiring", () => {
  it("resolveKey discovers the controller from the key document and returns the key", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const resolver = createWebIdKeyResolver({ fetch: mockFetch(await publishedDocs(kp)) });
    const key = expectDefined(await resolver.resolveKey(KEY_ID), "resolved key");
    expect(await encodeMultikey(key)).toBe(await encodeMultikey(kp.publicKey));
  });

  it("resolveKey fails closed on an ambiguous (multi-controller) key", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const multibase = await encodeMultikey(kp.publicKey);
    const body = `@prefix sec: <https://w3id.org/security#>.
<${WEBID}> sec:assertionMethod <${KEY_ID}>.
<${KEY_ID}> a sec:Multikey; sec:controller <${WEBID}>, <${MALLORY}>;
  sec:publicKeyMultibase "${multibase}".`;
    const resolver = createWebIdKeyResolver({ fetch: mockFetch({ [DOC]: { body } }) });
    expect(await resolver.resolveKey(KEY_ID)).toBeUndefined();
  });

  it("isControlledBy is document-resolved: true for the backing WebID, false otherwise", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const resolver = createWebIdKeyResolver({ fetch: mockFetch(await publishedDocs(kp)) });
    expect(await resolver.isControlledBy(KEY_ID, WEBID)).toBe(true);
    expect(await resolver.isControlledBy(KEY_ID, MALLORY)).toBe(false);
    expect(await resolver.isControlledBy("javascript:alert(1)", WEBID)).toBe(false);
  });

  it("caches documents for the resolver's lifetime (one fetch per document)", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const calls: string[] = [];
    const resolver = createWebIdKeyResolver({ fetch: mockFetch(await publishedDocs(kp), calls) });
    await resolver.resolveKey(KEY_ID);
    await resolver.isControlledBy(KEY_ID, WEBID);
    await resolver.resolveKey(KEY_ID);
    expect(calls).toEqual([DOC]);
  });

  it("verifies an end-to-end credential with document-resolved key + control (Ed25519)", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const vc = await issueAgentAuthorization(AUTH, kp);
    const resolver = createWebIdKeyResolver({ fetch: mockFetch(await publishedDocs(kp)) });
    const result = await verifyCredential(vc, {
      resolveKey: resolver.resolveKey,
      isControlledBy: resolver.isControlledBy,
    });
    expect(result.verified).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("verifies end-to-end with P-256 / ecdsa-rdfc-2019 too", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "P-256");
    const vc = await issueAgentAuthorization(AUTH, kp, {
      suite: new DataIntegritySuite("ecdsa-rdfc-2019"),
    });
    const resolver = createWebIdKeyResolver({ fetch: mockFetch(await publishedDocs(kp)) });
    const result = await verifyCredential(vc, {
      resolveKey: resolver.resolveKey,
      isControlledBy: resolver.isControlledBy,
    });
    expect(result.verified).toBe(true);
  });

  it("REJECTS a credential whose issuer never authorised the signing key (ISSUER_MISMATCH)", async () => {
    // Alice's key is validly published; the credential is signed with it but
    // names MALLORY as issuer/principal. The signature is cryptographically
    // valid — only the document-resolved control check catches the mismatch.
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const vc = await issueAgentAuthorization({ ...AUTH, principal: MALLORY }, kp);
    const malloryDoc = `@prefix sec: <https://w3id.org/security#>. <${MALLORY}> a <https://example.org/Agent>.`;
    const resolver = createWebIdKeyResolver({
      fetch: mockFetch(
        await publishedDocs(kp, { "https://mallory.example/profile": { body: malloryDoc } }),
      ),
    });
    const result = await verifyCredential(vc, {
      resolveKey: resolver.resolveKey,
      isControlledBy: resolver.isControlledBy,
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("ISSUER_MISMATCH");
  });

  it("REJECTS a tampered credential through the document-resolved key (INVALID_SIGNATURE)", async () => {
    const kp = await generateKeyPairForSuite(KEY_ID, "Ed25519");
    const vc = await issueAgentAuthorization(AUTH, kp);
    const tampered = {
      ...vc,
      credentialSubject: {
        ...(vc.credentialSubject as Record<string, unknown>),
        action: "http://www.w3.org/ns/auth/acl#Control",
      },
    } as typeof vc;
    const resolver = createWebIdKeyResolver({ fetch: mockFetch(await publishedDocs(kp)) });
    const result = await verifyCredential(tampered, {
      resolveKey: resolver.resolveKey,
      isControlledBy: resolver.isControlledBy,
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("INVALID_SIGNATURE");
  });

  it("fails closed (NO key, NO control) when the WebID document is unreachable", async () => {
    const resolver = createWebIdKeyResolver({ fetch: mockFetch({}) });
    expect(await resolver.resolveKey(KEY_ID)).toBeUndefined();
    expect(await resolver.isControlledBy(KEY_ID, WEBID)).toBe(false);
  });
});
