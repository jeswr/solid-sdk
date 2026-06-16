// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// SHACL validation: a conforming intent passes; a malformed intent fails with a
// structured report; validateIntent never throws on non-conformance.
import { Store } from "n3";
import { describe, expect, it } from "vitest";
import { intentToRdf } from "../src/intent.js";
import { buildProtocolDocument } from "../src/protocol.js";
import { buildResponseShape, buildShapeForIntent } from "../src/shape.js";
import { parseIntent } from "../src/translate.js";
import type { Intent } from "../src/types.js";
import { validateIntent } from "../src/validate.js";

describe("validateIntent — conformance", () => {
  it("a well-formed read intent conforms to the read shape", async () => {
    const r = await parseIntent("read https://a/x");
    const report = await validateIntent(r.intent as Intent, buildShapeForIntent("read"));
    expect(report.conforms).toBe(true);
    expect(report.results).toEqual([]);
  });

  it("a read intent MISSING its target fails with a structured report (never throws)", async () => {
    const bad: Intent = { id: "urn:i", action: "read" }; // no target
    const report = await validateIntent(bad, buildShapeForIntent("read"));
    expect(report.conforms).toBe(false);
    expect(report.results.length).toBeGreaterThan(0);
    // The structured result carries a constraint component + a focus node.
    expect(report.results[0]?.sourceConstraintComponent).toBeTruthy();
    expect(report.results[0]?.message).toBeTruthy();
  });

  it("an intent of the WRONG action type fails the shape's type constraint", async () => {
    const r = await parseIntent("delete https://a/x");
    // Validate a DELETE intent against the READ shape — the rdf:type hasValue fails.
    const report = await validateIntent(r.intent as Intent, buildShapeForIntent("read"));
    expect(report.conforms).toBe(false);
  });

  it("a grant intent conforms to the grant shape only with recipient + ≥1 mode", async () => {
    const ok: Intent = {
      id: "urn:g1",
      action: "grant",
      target: "https://a/x",
      recipient: "https://b/me",
      modes: ["Read"],
    };
    expect((await validateIntent(ok, buildShapeForIntent("grant"))).conforms).toBe(true);

    const noRecipient: Intent = {
      id: "urn:g2",
      action: "grant",
      target: "https://a/x",
      modes: ["Read"],
    };
    expect((await validateIntent(noRecipient, buildShapeForIntent("grant"))).conforms).toBe(false);

    const noModes: Intent = {
      id: "urn:g3",
      action: "grant",
      target: "https://a/x",
      recipient: "https://b/me",
    };
    expect((await validateIntent(noModes, buildShapeForIntent("grant"))).conforms).toBe(false);
  });

  it("a subscribe intent conforms even without a concrete target (standing subscription)", async () => {
    const sub: Intent = { id: "urn:s", action: "subscribe" };
    expect((await validateIntent(sub, buildShapeForIntent("subscribe"))).conforms).toBe(true);
  });

  it("accepts intent quads and a dataset as inputs (not just a structured Intent)", async () => {
    const r = await parseIntent("read https://a/x");
    const quads = intentToRdf(r.intent as Intent);
    const shape = buildShapeForIntent("read");
    expect((await validateIntent(quads, shape)).conforms).toBe(true);
    const store = new Store();
    store.addQuads(quads);
    expect((await validateIntent(store, shape)).conforms).toBe(true);
  });

  it("validates against a Protocol Document's bundled request shape", async () => {
    const r = await parseIntent("read https://a/x");
    const pd = buildProtocolDocument({
      requestShape: buildShapeForIntent("read"),
      responseShape: buildResponseShape("https://schema.org/ReadAction"),
      meta: { id: "https://a/p#v1", name: "Read" },
    });
    const report = await validateIntent(r.intent as Intent, pd);
    expect(report.conforms).toBe(true);
  });

  it("uses ONLY the request shape of a PD — a response shape targeting a2a:Intent does not fail a valid request", async () => {
    const r = await parseIntent("read https://a/x");
    // A deliberately adversarial response shape that TARGETS a2a:Intent (the same
    // class the request graph carries) and demands a property the request lacks.
    // If validateIntent used the whole PD graph, the request would fail; using
    // only the request shape, it must still pass.
    const pd = buildProtocolDocument({
      requestShape: buildShapeForIntent("read"),
      responseShape: buildResponseShape("https://w3id.org/jeswr/a2a#Intent"),
      meta: { id: "https://a/p#v1", name: "Read" },
    });
    const report = await validateIntent(r.intent as Intent, pd);
    expect(report.conforms).toBe(true);
  });

  it("never throws on non-conformance — only returns conforms:false", async () => {
    const bad: Intent = { id: "urn:i", action: "create" }; // create needs a target
    await expect(validateIntent(bad, buildShapeForIntent("create"))).resolves.toMatchObject({
      conforms: false,
    });
  });
});
