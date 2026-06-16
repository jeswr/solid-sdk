// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Vocab / serialize / canonical / shape edge cases + the public API surface.
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { canonicalNQuads } from "../src/canonical.js";
import * as api from "../src/index.js";
import { intentToRdf } from "../src/intent.js";
import { hashQuads } from "../src/protocol.js";
import { serialize } from "../src/serialize.js";
import { buildShapeForIntent, defaultShapeId, shapeToTurtle } from "../src/shape.js";
import {
  A2A,
  ACL_MODE_IRI,
  ACTION_TYPE_IRI,
  INTENT_ACTIONS,
  IRI_TO_ACTION,
  VALID_ACL_MODE_IRIS,
  VALID_INTENT_ACTIONS,
} from "../src/vocab.js";

describe("serialize", () => {
  it("serialises an empty quad array to an empty string", async () => {
    await expect(serialize([])).resolves.toBe("");
  });

  it("serialises an intent graph to Turtle containing the a2a:Intent type", async () => {
    const quads = intentToRdf({ id: "urn:i", action: "read", target: "https://a/x" });
    const ttl = await serialize(quads);
    expect(ttl).toContain("a2a:Intent");
    expect(ttl).toContain("schema:ReadAction");
  });
});

describe("vocab constants", () => {
  it("mints the a2a extension under w3id.org/jeswr (never @solid/)", () => {
    expect(A2A).toBe("https://w3id.org/jeswr/a2a#");
    expect(A2A.includes("solid")).toBe(false);
  });

  it("maps every intent action to an action-type IRI and back", () => {
    for (const action of INTENT_ACTIONS) {
      const iri = ACTION_TYPE_IRI[action];
      expect(typeof iri).toBe("string");
      expect(IRI_TO_ACTION[iri]).toBe(action);
    }
  });

  it("derives the valid-action set from the action list", () => {
    expect([...VALID_INTENT_ACTIONS].sort()).toEqual([...INTENT_ACTIONS].sort());
    expect(VALID_INTENT_ACTIONS.has("read")).toBe(true);
    expect(VALID_INTENT_ACTIONS.has("nonsense")).toBe(false);
  });

  it("maps the four ACL modes to their IRIs", () => {
    expect(ACL_MODE_IRI.Read).toBe("http://www.w3.org/ns/auth/acl#Read");
    expect(ACL_MODE_IRI.Control).toBe("http://www.w3.org/ns/auth/acl#Control");
    expect(VALID_ACL_MODE_IRIS.has(ACL_MODE_IRI.Append)).toBe(true);
  });

  it("read/create/update/delete use schema.org Action subclasses; the rest are minted", () => {
    expect(ACTION_TYPE_IRI.read).toBe("https://schema.org/ReadAction");
    expect(ACTION_TYPE_IRI.create).toBe("https://schema.org/CreateAction");
    expect(ACTION_TYPE_IRI.update).toBe("https://schema.org/UpdateAction");
    expect(ACTION_TYPE_IRI.delete).toBe("https://schema.org/DeleteAction");
    expect(ACTION_TYPE_IRI.append.startsWith(A2A)).toBe(true);
    expect(ACTION_TYPE_IRI.grant.startsWith(A2A)).toBe(true);
  });
});

describe("shape builder", () => {
  it("names the default shape after the action", () => {
    expect(defaultShapeId("read")).toBe(`${A2A}ReadIntentShape`);
    expect(defaultShapeId("grant")).toBe(`${A2A}GrantIntentShape`);
  });

  it("a grant shape declares recipient + mode property shapes", async () => {
    const ttl = await shapeToTurtle(buildShapeForIntent("grant"));
    expect(ttl).toContain("schema:recipient");
    expect(ttl).toContain("a2a:mode");
  });

  it("a subscribe shape omits the required target property (no minCount on object)", async () => {
    const ttl = await shapeToTurtle(buildShapeForIntent("subscribe"));
    // The subscribe shape constrains the action type but not a schema:object target.
    expect(ttl).not.toContain("schema:object");
  });

  it("honours a custom shapeId", () => {
    const quads = buildShapeForIntent("read", { shapeId: "https://a/MyShape" });
    expect(quads.some((q) => q.subject.value === "https://a/MyShape")).toBe(true);
  });
});

describe("canonicalNQuads", () => {
  it("is stable for an empty graph", () => {
    expect(canonicalNQuads([])).toBe("");
  });

  it("is order-independent + blank-node-label-independent (two shape builds match)", () => {
    const a = canonicalNQuads(buildShapeForIntent("grant"));
    const b = canonicalNQuads([...buildShapeForIntent("grant")].reverse());
    expect(a).toBe(b);
  });

  it("distinguishes structurally-different graphs", () => {
    expect(hashQuads(buildShapeForIntent("read"))).not.toBe(
      hashQuads(buildShapeForIntent("delete")),
    );
  });

  it("includes the graph term — two datasets differing only by named graph hash differently", () => {
    const { namedNode, quad, defaultGraph } = DataFactory;
    const s = namedNode("https://a/s");
    const p = namedNode("https://a/p");
    const o = namedNode("https://a/o");
    const inDefault = [quad(s, p, o, defaultGraph())];
    const inNamed = [quad(s, p, o, namedNode("https://a/g"))];
    const inOtherGraph = [quad(s, p, o, namedNode("https://a/g2"))];
    expect(canonicalNQuads(inDefault)).not.toBe(canonicalNQuads(inNamed));
    expect(canonicalNQuads(inNamed)).not.toBe(canonicalNQuads(inOtherGraph));
    // The named-graph line includes the graph IRI.
    expect(canonicalNQuads(inNamed)).toContain("<https://a/g>");
  });
});

describe("public API surface", () => {
  it("exports the documented functions", () => {
    for (const name of [
      "parseIntent",
      "classifyDeterministic",
      "intentToTurtle",
      "intentToJsonLd",
      "intentToRdf",
      "intentFromRdf",
      "parseIntentGraph",
      "buildShapeForIntent",
      "buildResponseShape",
      "validateIntent",
      "buildProtocolDocument",
      "verifyProtocolDocument",
      "hashQuads",
      "encodeUpgradeOffer",
      "decodeUpgradeOffer",
      "encodeUpgradeResponse",
      "decodeUpgradeResponse",
      "mayDowngradeToNl",
      "handshakeToRdf",
      "handshakeToTurtle",
      "handshakeFromRdf",
      "serialize",
      "canonicalNQuads",
    ]) {
      expect(typeof (api as Record<string, unknown>)[name]).toBe("function");
    }
  });

  it("exports the vocab constants", () => {
    expect(api.A2A).toBe(A2A);
    expect(api.ACTION_TYPE_IRI).toBe(ACTION_TYPE_IRI);
    expect(api.PROTOCOL_HASH_PREFIX).toBe("sha256:");
  });
});
