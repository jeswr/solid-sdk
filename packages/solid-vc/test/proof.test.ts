// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The canonicalization (RDFC-1.0) determinism, the Data Integrity proof-options
// binding, the bundled EdDSA/ECDSA suite, and the PLUGGABLE seam — including a
// stub "ZK" suite that demonstrates exactly how @jeswr/sparq's ZK-over-SPARQL
// proof would register and be dispatched WITHOUT any change to the data model or
// the verify pipeline.

import type { Quad } from "@rdfjs/types";
import { describe, expect, it } from "vitest";
import { canonicalNQuads, dataIntegrityHash } from "../src/canonicalize.js";
import { credentialToRdf } from "../src/credential.js";
import { base58btcEncode } from "../src/multibase.js";
import {
  DataIntegritySuite,
  defaultSuiteRegistry,
  type ProofSignOptions,
  type ProofSuite,
  type ProofVerifyOptions,
  proofOptionsQuads,
} from "../src/proof.js";
import type { DataIntegrityProof } from "../src/types.js";

const QUADS = (): Quad[] =>
  credentialToRdf({
    id: "urn:uuid:canon-1",
    issuer: "https://alice.example/#me",
    credentialSubject: { id: "https://x.example/#s", a: "1", b: "2" },
  });

describe("RDFC-1.0 canonicalization", () => {
  it("is deterministic regardless of input quad order", async () => {
    const quads = QUADS();
    const forward = await canonicalNQuads(quads);
    const reversed = await canonicalNQuads([...quads].reverse());
    expect(forward).toBe(reversed);
  });

  it("changes when any triple changes (the signature pre-image binds the graph)", async () => {
    const a = await canonicalNQuads(QUADS());
    const b = await canonicalNQuads(
      credentialToRdf({
        id: "urn:uuid:canon-1",
        issuer: "https://alice.example/#me",
        credentialSubject: { id: "https://x.example/#s", a: "1", b: "CHANGED" },
      }),
    );
    expect(a).not.toBe(b);
  });
});

describe("dataIntegrityHash", () => {
  it("is 64 bytes (SHA-256 proof-options || SHA-256 document)", async () => {
    const opts = proofOptionsQuads({
      type: "DataIntegrityProof",
      cryptosuite: "eddsa-rdfc-2022",
      verificationMethod: "https://alice.example/#k",
      proofPurpose: "assertionMethod",
      created: "2026-01-01T00:00:00.000Z",
    });
    const hash = await dataIntegrityHash(QUADS(), opts);
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(64);
  });

  it("changes when the proof OPTIONS change (binds suite/method/purpose/created)", async () => {
    const base = proofOptionsQuads({
      type: "DataIntegrityProof",
      cryptosuite: "eddsa-rdfc-2022",
      verificationMethod: "https://alice.example/#k",
      proofPurpose: "assertionMethod",
      created: "2026-01-01T00:00:00.000Z",
    });
    const swappedMethod = proofOptionsQuads({
      type: "DataIntegrityProof",
      cryptosuite: "eddsa-rdfc-2022",
      verificationMethod: "https://mallory.example/#k", // attacker swaps the key
      proofPurpose: "assertionMethod",
      created: "2026-01-01T00:00:00.000Z",
    });
    const q = QUADS();
    const h1 = await dataIntegrityHash(q, base);
    const h2 = await dataIntegrityHash(q, swappedMethod);
    expect(Buffer.from(h1).equals(Buffer.from(h2))).toBe(false);
  });
});

describe("DataIntegritySuite construction", () => {
  it("accepts the two rdfc cryptosuites", () => {
    expect(new DataIntegritySuite("eddsa-rdfc-2022").cryptosuite).toBe("eddsa-rdfc-2022");
    expect(new DataIntegritySuite("ecdsa-rdfc-2019").cryptosuite).toBe("ecdsa-rdfc-2019");
  });
  it("rejects an unsupported cryptosuite at construction", () => {
    // @ts-expect-error deliberately passing an unsupported id
    expect(() => new DataIntegritySuite("bbs-2023")).toThrow(/unsupported cryptosuite/);
  });
});

describe("SuiteRegistry — the pluggable seam", () => {
  it("dispatches by cryptosuite and lists registered suites", () => {
    const reg = defaultSuiteRegistry();
    expect(reg.get("eddsa-rdfc-2022")).toBeDefined();
    expect(reg.get("ecdsa-rdfc-2019")).toBeDefined();
    expect(reg.get("does-not-exist")).toBeUndefined();
  });

  it("a custom (e.g. SPARQ ZK) suite plugs in WITHOUT touching the pipeline", async () => {
    // A stub standing in for @jeswr/sparq's future ZK-over-SPARQL proof suite. It
    // implements the SAME ProofSuite interface; the issue/verify pipeline never
    // learns it exists beyond the cryptosuite dispatch key. The real suite would
    // produce/verify an UltraHonk proof over Merkle-committed signed RDF; here we
    // just prove the seam: a registered cryptosuite id is sign+verify dispatchable.
    let signCalled = false;
    let verifyCalled = false;
    const zkSuite: ProofSuite = {
      cryptosuite: "sparql-zk-2026",
      async sign(_quads: readonly Quad[], opts: ProofSignOptions): Promise<DataIntegrityProof> {
        signCalled = true;
        return {
          type: "DataIntegrityProof",
          cryptosuite: "sparql-zk-2026",
          verificationMethod: "https://issuer.example/#registry",
          proofPurpose: opts.proofPurpose,
          created: opts.created.toISOString(),
          proofValue: base58btcEncode(new TextEncoder().encode("stub-ultrahonk-proof")),
        };
      },
      async verify(
        _quads: readonly Quad[],
        proof: DataIntegrityProof,
        _opts: ProofVerifyOptions,
      ): Promise<boolean> {
        verifyCalled = true;
        return proof.cryptosuite === "sparql-zk-2026";
      },
    };
    const reg = defaultSuiteRegistry().register(zkSuite);
    expect(reg.list()).toContain("sparql-zk-2026");

    const dispatched = reg.get("sparql-zk-2026");
    expect(dispatched).toBeDefined();
    const suite = dispatched as ProofSuite;
    const proof = await suite.sign(QUADS(), {
      key: undefined,
      proofPurpose: "assertionMethod",
      created: new Date(),
    });
    const ok = await suite.verify(QUADS(), proof, {
      resolveKey: () => undefined,
    });
    expect(signCalled).toBe(true);
    expect(verifyCalled).toBe(true);
    expect(ok).toBe(true);
  });
});

describe("DataIntegritySuite.verify fails closed on structural mismatch", () => {
  it("returns false for a non-matching cryptosuite without touching crypto", async () => {
    const suite = new DataIntegritySuite("eddsa-rdfc-2022");
    const proof: DataIntegrityProof = {
      type: "DataIntegrityProof",
      cryptosuite: "ecdsa-rdfc-2019", // mismatched
      verificationMethod: "https://alice.example/#k",
      proofPurpose: "assertionMethod",
      proofValue: base58btcEncode(new Uint8Array(64)),
    };
    const ok = await suite.verify(QUADS(), proof, { resolveKey: () => undefined });
    expect(ok).toBe(false);
  });

  it("returns false when the key cannot be resolved", async () => {
    const suite = new DataIntegritySuite("eddsa-rdfc-2022");
    const proof: DataIntegrityProof = {
      type: "DataIntegrityProof",
      cryptosuite: "eddsa-rdfc-2022",
      verificationMethod: "https://alice.example/#k",
      proofPurpose: "assertionMethod",
      proofValue: base58btcEncode(new Uint8Array(64)),
    };
    const ok = await suite.verify(QUADS(), proof, { resolveKey: () => undefined });
    expect(ok).toBe(false);
  });
});
