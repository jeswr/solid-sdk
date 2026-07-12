// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Public-surface sanity: the index re-exports the documented API, and the vocab
// constants are the REAL W3C VC 2.0 IRIs (nothing standard is minted).

import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";
import { SVC, VC, VC_V2_CONTEXT } from "../src/vocab.js";

describe("public API surface", () => {
  it("exports the data-model / sign / verify / seam entry points", () => {
    for (const name of [
      "credentialToRdf",
      "credentialToTurtle",
      "credentialToJsonLd",
      "parseCredentialRdf",
      "credentialFromRdf",
      "buildAgentAuthorizationCredential",
      "issue",
      "issueAgentAuthorization",
      "verifyCredential",
      "generateKeyPairForSuite",
      "importPublicKey",
      "defaultSuiteRegistry",
      "canonicalNQuads",
      "dataIntegrityHash",
      "base58btcEncode",
      "base58btcDecode",
    ] as const) {
      expect(typeof (api as Record<string, unknown>)[name]).toBe("function");
    }
  });

  it("exports the ProofSuite seam classes", () => {
    expect(typeof api.SuiteRegistry).toBe("function");
    expect(typeof api.DataIntegritySuite).toBe("function");
  });

  it("uses the canonical W3C VC 2.0 namespace + context", () => {
    expect(VC).toBe("https://www.w3.org/2018/credentials#");
    expect(VC_V2_CONTEXT).toBe("https://www.w3.org/ns/credentials/v2");
    expect(api.VC).toBe(VC);
    expect(api.VC_V2_CONTEXT).toBe(VC_V2_CONTEXT);
  });

  it("homes the agent-authz extension under the @jeswr w3id namespace (never @solid)", () => {
    expect(SVC).toBe("https://w3id.org/jeswr/solid-vc#");
    expect(api.SVC_AGENT_AUTHORIZATION).toBe(`${SVC}AgentAuthorizationCredential`);
    expect(SVC.includes("solid.org")).toBe(false);
    expect(api.SVC_AGENT_AUTHORIZATION.startsWith("https://w3id.org/jeswr/")).toBe(true);
  });

  it("the bundled registry knows both rdfc cryptosuites", () => {
    const reg = api.defaultSuiteRegistry();
    expect(reg.list().sort()).toEqual(["ecdsa-rdfc-2019", "eddsa-rdfc-2022"]);
  });
});
