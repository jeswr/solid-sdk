// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// GOLDEN-MASTER / CHARACTERIZATION suite — pins the OBSERVABLE OUTPUT of the public
// API byte-for-byte, so a later refactor that changes SHAPE (not behaviour) is
// proven not to have moved the emitted RDF, the content hashes, the JSON-LD
// projections, or the handshake codec.
//
// Why this exists separately from the per-module unit tests: those assert
// *properties* (hash is deterministic, verify rejects a tamper); this asserts the
// *exact bytes* — the canonical N-Quads string and the sha256 content hash for
// every intent kind / shape / protocol document / handshake message. The canonical
// N-Quads string is the RDFC-1.0 canonicalization (W3C Recommendation, see
// canonical.ts), which relabels blank nodes to stable `_:c14nN` labels and sorts
// the quads, so it is a stable, human-diffable snapshot. The content hash is the
// value that goes into an M1 AgentDescriptor.protocolSources pin, so pinning it
// guarantees a refactor does not silently re-key every published protocol.
//
// NB: these snapshots were re-baselined when the canonicalization switched from the
// package's original bespoke sorted-N-Quads form to RDFC-1.0 (the interoperable
// standard) — a deliberate, one-time content-hash change, documented in the README
// changelog + DECISIONS. The RDFC-1.0 hashes are the ones an independent conformant
// implementation reproduces (see protocol.test.ts for the spec worked-example
// vector).
//
// NON-DETERMINISM is normalised: intent node IRIs are supplied explicitly (never
// the FNV digest of the NL), and RDFC-1.0 relabels blank nodes to stable c14n
// labels, so nothing time/uuid/hash-seed-dependent leaks into a snap.

import { describe, expect, it } from "vitest";
// Import through the PUBLIC barrel (../src/index.js), NOT the internal modules, so
// this golden-master exercises the exact surface a consumer imports — a refactor
// that drops/renames an export from index.ts breaks these tests, as it should.
import {
  buildProtocolDocument,
  buildResponseShape,
  buildShapeForIntent,
  canonicalNQuads,
  defaultShapeId,
  handshakeToRdf,
  hashQuads,
  INTENT_ACTIONS,
  type Intent,
  type IntentAction,
  intentToJsonLd,
  intentToRdf,
  verifyProtocolDocument,
} from "../src/index.js";

/** A representative intent per action kind, with explicit (non-minted) id. */
function sampleIntent(action: IntentAction): Intent {
  const base: Intent = {
    id: `urn:a2a:intent:golden-${action}`,
    action,
    target: "https://alice.pod/data/resource",
    agent: "https://alice.example/profile#me",
    parameters: [
      { key: "limit", value: "10" },
      { key: "label", value: "with spaces" },
    ],
  };
  if (action === "grant") {
    return {
      ...base,
      recipient: "https://bob.example/profile#me",
      modes: ["Read", "Write", "Append", "Control"],
    };
  }
  return base;
}

describe("characterization — intent → RDF canonical N-Quads (byte-exact)", () => {
  for (const action of INTENT_ACTIONS) {
    it(`intent[${action}] canonical N-Quads is byte-stable`, async () => {
      const nq = await canonicalNQuads(intentToRdf(sampleIntent(action)));
      expect(nq).toMatchSnapshot();
    });
  }
});

describe("characterization — intent → RDF content hash (the protocolSources pin value)", () => {
  it("per-action intent hashes are byte-stable", async () => {
    const hashes = Object.fromEntries(
      await Promise.all(
        INTENT_ACTIONS.map(async (a) => [a, await hashQuads(intentToRdf(sampleIntent(a)))]),
      ),
    );
    expect(hashes).toMatchSnapshot();
  });
});

describe("characterization — intent → JSON-LD projection (byte-exact)", () => {
  for (const action of INTENT_ACTIONS) {
    it(`intent[${action}] JSON-LD is byte-stable`, () => {
      expect(intentToJsonLd(sampleIntent(action))).toMatchSnapshot();
    });
  }
});

describe("characterization — SHACL request shape canonical N-Quads + hash (byte-exact)", () => {
  for (const action of INTENT_ACTIONS) {
    it(`shape[${action}] canonical N-Quads is byte-stable`, async () => {
      expect(await canonicalNQuads(buildShapeForIntent(action))).toMatchSnapshot();
    });
  }
  it("per-action shape hashes + default shape ids are byte-stable", async () => {
    const out = Object.fromEntries(
      await Promise.all(
        INTENT_ACTIONS.map(async (a) => [
          a,
          { hash: await hashQuads(buildShapeForIntent(a)), shapeId: defaultShapeId(a) },
        ]),
      ),
    );
    expect(out).toMatchSnapshot();
  });
});

describe("characterization — SHACL response shape (byte-exact)", () => {
  it("response shape canonical N-Quads + hash are byte-stable", async () => {
    const quads = buildResponseShape("https://schema.org/ReadAction");
    expect({ nq: await canonicalNQuads(quads), hash: await hashQuads(quads) }).toMatchSnapshot();
  });
});

describe("characterization — Protocol Document hash + JSON-LD (byte-exact)", () => {
  function makePd() {
    return buildProtocolDocument({
      requestShape: buildShapeForIntent("read"),
      responseShape: buildResponseShape("https://schema.org/ReadAction"),
      meta: {
        id: "https://alice.pod/protocols/read#v1",
        name: "Read protocol",
        description: "Read a pod resource.",
        version: "1",
      },
    });
  }

  it("PD content hash is byte-stable (the published pin value must not move)", async () => {
    expect((await makePd()).hash).toMatchSnapshot();
  });

  it("PD canonical N-Quads of the full graph is byte-stable", async () => {
    expect(await canonicalNQuads([...(await makePd()).quads])).toMatchSnapshot();
  });

  it("PD JSON-LD projection is byte-stable", async () => {
    expect(await (await makePd()).toJsonLd()).toMatchSnapshot();
  });

  it("PD Turtle re-PARSES + re-hashes to the pinned hash (full round-trip stability)", async () => {
    const pd = await makePd();
    const ttl = await pd.toTurtle();
    // The genuine round-trip: PARSE the serialised Turtle back to quads and
    // confirm its canonical hash equals the pin. verifyProtocolDocument does the
    // parse-then-rehash internally, so this catches a toTurtle() regression that
    // hashing pd.quads (the source graph) would NOT. (The Turtle blank-node
    // labels are writer-assigned, so the Turtle text itself is not byte-snapshot
    // -stable — the canonical hash is the stable surface.)
    expect(await verifyProtocolDocument(ttl, pd.hash)).toBe(true);
    expect(ttl).toContain("a2a:ProtocolDocument");
  });
});

describe("characterization — handshake codec RDF (byte-exact)", () => {
  it("upgrade-offer (required, named) canonical N-Quads + hash", async () => {
    const quads = handshakeToRdf({
      kind: "upgrade-offer",
      protocolHash: "sha256:abcdef",
      protocolSource: "https://alice.pod/protocols/read#v1",
      required: true,
      protocolName: "Read protocol",
    });
    expect({ nq: await canonicalNQuads(quads), hash: await hashQuads(quads) }).toMatchSnapshot();
  });

  it("upgrade-offer (optional, unnamed) canonical N-Quads + hash", async () => {
    const quads = handshakeToRdf({
      kind: "upgrade-offer",
      protocolHash: "sha256:abcdef",
      protocolSource: "https://alice.pod/protocols/read#v1",
      required: false,
    });
    expect({ nq: await canonicalNQuads(quads), hash: await hashQuads(quads) }).toMatchSnapshot();
  });

  it("upgrade-response (decline, with reason) canonical N-Quads + hash", async () => {
    const quads = handshakeToRdf({
      kind: "upgrade-response",
      protocolHash: "sha256:abcdef",
      accept: false,
      reason: "policy forbids the requested mode",
    });
    expect({ nq: await canonicalNQuads(quads), hash: await hashQuads(quads) }).toMatchSnapshot();
  });

  it("upgrade-response (accept, no reason) canonical N-Quads + hash", async () => {
    const quads = handshakeToRdf({
      kind: "upgrade-response",
      protocolHash: "sha256:abcdef",
      accept: true,
    });
    expect({ nq: await canonicalNQuads(quads), hash: await hashQuads(quads) }).toMatchSnapshot();
  });
});

describe("characterization — canonicalNQuads invariants the content hash relies on", () => {
  it("is INPUT-ORDER-INDEPENDENT (same multiset of quads → identical string)", async () => {
    const quads = buildShapeForIntent("grant");
    const a = await canonicalNQuads(quads);
    const b = await canonicalNQuads([...quads].reverse());
    expect(a).toBe(b);
  });

  it("an empty graph canonicalises to the empty string", async () => {
    expect(await canonicalNQuads([])).toBe("");
  });

  it("xsd:string literals carry NO datatype; other datatypes are explicit", async () => {
    // grant shapes carry xsd:integer minCount literals + plain-string sh:name.
    const nq = await canonicalNQuads(buildShapeForIntent("grant"));
    expect(nq).toContain('"1"^^<http://www.w3.org/2001/XMLSchema#integer>');
    expect(nq).toContain('"mode"'); // a plain xsd:string literal, no ^^ datatype
    expect(nq).not.toContain('"mode"^^');
  });
});
