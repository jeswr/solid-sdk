// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  credentialFromRdf,
  credentialMetaFromNode,
  credentialToJsonLd,
  credentialToRdf,
  parseCredentialRdf,
} from "../src/credential.js";
import { digestQuads, digestRdfContent } from "../src/digest.js";

const VC_V1 = "https://www.w3.org/2018/credentials/v1";
const VC_V2 = "https://www.w3.org/ns/credentials/v2";
const DI_V2 = "https://w3id.org/security/data-integrity/v2";
const UNKNOWN = "https://untrusted.example/context";

describe("offline credential contexts", () => {
  const fetch = vi.fn(() => {
    throw new Error("Network access forbidden");
  });
  beforeEach(() => {
    fetch.mockClear();
    vi.stubGlobal("fetch", fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([VC_V1, VC_V2])("expands %s from the bundled context", async (context) => {
    const dataset = await parseCredentialRdf(
      JSON.stringify({
        "@context": context,
        id: "urn:uuid:offline",
        type: "VerifiableCredential",
        issuer: "https://issuer.example/#me",
        credentialSubject: { id: "https://subject.example/#me" },
      }),
      "application/ld+json",
    );
    const node = credentialFromRdf(dataset);
    expect(node).toBeDefined();
    if (!node) throw new Error("Missing credential");
    expect(credentialMetaFromNode(node).issuer).toBe("https://issuer.example/#me");
  });

  it("round-trips the generated JSON-LD claim graph and digest offline", async () => {
    const credential = {
      id: "urn:uuid:offline-roundtrip",
      issuer: "https://issuer.example/#me",
      credentialSubject: {
        id: "https://subject.example/#me",
        action: "http://www.w3.org/ns/auth/acl#Read",
      },
    };
    const json = JSON.stringify(credentialToJsonLd(credential));
    expect(await digestRdfContent(json, "application/ld+json")).toBe(
      await digestQuads(credentialToRdf(credential)),
    );
  });

  it("expands the supported Data Integrity context offline", async () => {
    const dataset = await parseCredentialRdf(
      JSON.stringify({
        "@context": DI_V2,
        id: "urn:uuid:proof",
        type: "DataIntegrityProof",
        verificationMethod: "https://issuer.example/#key",
      }),
      "application/ld+json",
    );
    expect(
      [...dataset].some(
        (q) =>
          q.predicate.value === "https://w3id.org/security#verificationMethod" &&
          q.object.value === "https://issuer.example/#key",
      ),
    ).toBe(true);
  });

  it.each([
    [UNKNOWN],
    [VC_V2, UNKNOWN],
    [VC_V2, { extension: { "@id": "https://example.org/extension", "@context": UNKNOWN } }],
    ["https://www.w3.org/ns/credentials/v2?untrusted"],
  ])("refuses unbundled and nested contexts: %j", async (...context) => {
    await expect(
      parseCredentialRdf(
        JSON.stringify({
          "@context": context,
          id: "urn:uuid:refused",
          type: "VerifiableCredential",
          extension: { id: "urn:uuid:nested" },
        }),
        "application/ld+json",
      ),
    ).rejects.toMatchObject({
      cause: { message: expect.stringContaining("Remote JSON-LD context refused:") },
    });
  });
});
