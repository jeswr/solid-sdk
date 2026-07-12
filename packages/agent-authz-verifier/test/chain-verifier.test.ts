// AUTHORED-BY Claude Fable 5
//
// Focused unit tests for the composed verifier's assembly (root-first ordering,
// fail-closed on cycles / branches / gaps / multi-root / duplicate ids) and the
// AgentAuthorizationCredential reader. Ported from the runtime's
// `test/chain-verifier.test.ts` @ 72ec20a (scenario calls replaced by the
// injected-seam fixture).

import type { OdrlPolicy } from "@jeswr/solid-odrl";
import { describe, expect, it } from "vitest";
import { type PresentedChain, readBoundAuthorization, verifyAgentAuthority } from "../src/index.js";
import { buildFixture, CAST } from "./fixture.js";

/** Assembly runs BEFORE any credential check, so these need no real credentials. */
async function assemble(
  policies: readonly OdrlPolicy[],
): Promise<{ phase: string; code?: string }> {
  const chain: PresentedChain = { credentials: [], policies };
  const r = await verifyAgentAuthority(chain, {
    request: { action: "read", target: "urn:t" },
    rootPrincipal: "urn:root",
    now: new Date("2026-08-01T00:00:00Z"),
    resolveKey: () => undefined,
  });
  return { phase: r.phase, ...(r.code !== undefined && { code: r.code }) };
}

const P = (id: string, delegatedUnder?: string): OdrlPolicy => ({
  id,
  type: "Agreement",
  assigner: "urn:a",
  ...(delegatedUnder !== undefined && { delegatedUnder }),
});

describe("chain assembly — fail-closed on structural anomalies", () => {
  it("empty policy set → CHAIN_MALFORMED", async () => {
    expect(await assemble([])).toEqual({ phase: "assembly", code: "CHAIN_MALFORMED" });
  });

  it("duplicate policy id → CHAIN_MALFORMED", async () => {
    expect(await assemble([P("urn:x"), P("urn:x")])).toEqual({
      phase: "assembly",
      code: "CHAIN_MALFORMED",
    });
  });

  it("two roots (no delegatedUnder) → CHAIN_MALFORMED", async () => {
    expect(await assemble([P("urn:a"), P("urn:b")])).toEqual({
      phase: "assembly",
      code: "CHAIN_MALFORMED",
    });
  });

  it("a branch (two children under one parent) → CHAIN_MALFORMED", async () => {
    expect(
      await assemble([P("urn:root"), P("urn:c1", "urn:root"), P("urn:c2", "urn:root")]),
    ).toEqual({ phase: "assembly", code: "CHAIN_MALFORMED" });
  });

  it("a gap (delegatedUnder points outside the set) → CHAIN_MALFORMED", async () => {
    expect(await assemble([P("urn:root"), P("urn:c1", "urn:missing")])).toEqual({
      phase: "assembly",
      code: "CHAIN_MALFORMED",
    });
  });

  it("a cycle (no root) → CHAIN_MALFORMED", async () => {
    expect(await assemble([P("urn:a", "urn:b"), P("urn:b", "urn:a")])).toEqual({
      phase: "assembly",
      code: "CHAIN_MALFORMED",
    });
  });
});

describe("readBoundAuthorization", () => {
  it("reads the bound claim from a real AgentAuthorizationCredential", async () => {
    const fx = await buildFixture();
    const auth = readBoundAuthorization(fx.credentials.mandate);
    expect(auth).toBeDefined();
    expect(auth?.principal).toBe(CAST.alice);
    expect(auth?.authorizes).toBe(CAST.agentA);
    expect(auth?.policy).toBe(CAST.mandateId);
    expect(auth?.action).toContain("read");
    expect(auth?.action).toContain("grantUse");
  });

  it("returns undefined for a non-AgentAuthorizationCredential", () => {
    expect(
      readBoundAuthorization({
        issuer: "urn:i",
        type: ["VerifiableCredential"],
        credentialSubject: { id: "urn:s" },
        proof: {
          type: "DataIntegrityProof",
          cryptosuite: "eddsa-rdfc-2022",
          proofPurpose: "assertionMethod",
          proofValue: "z1",
          verificationMethod: "urn:vm",
        },
      }),
    ).toBeUndefined();
  });
});
