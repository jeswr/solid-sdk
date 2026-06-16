// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Round-trip: intent → Turtle → parse → equality on the structured fields; intent
// → JSON-LD → parse → equality; edge cases.
import { Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  intentFromRdf,
  intentToJsonLd,
  intentToRdf,
  intentToTurtle,
  parseIntentGraph,
} from "../src/intent.js";
import { parseIntent } from "../src/translate.js";
import type { Intent } from "../src/types.js";

/** Compare two intents on their structured fields (ignoring quad object identity). */
function sameIntent(a: Intent | undefined, b: Intent | undefined): boolean {
  if (!a || !b) {
    return false;
  }
  return (
    a.id === b.id &&
    a.action === b.action &&
    a.target === b.target &&
    a.recipient === b.recipient &&
    a.agent === b.agent &&
    JSON.stringify(a.modes ?? []) === JSON.stringify(b.modes ?? []) &&
    JSON.stringify([...(a.parameters ?? [])].sort((x, y) => x.key.localeCompare(y.key))) ===
      JSON.stringify([...(b.parameters ?? [])].sort((x, y) => x.key.localeCompare(y.key)))
  );
}

describe("intent round-trip (Turtle)", () => {
  it("round-trips a simple read intent losslessly", async () => {
    const r = await parseIntent("read https://alice.pod/notes.ttl");
    const ttl = await intentToTurtle(r.intent as Intent);
    const back = await parseIntentGraph(ttl);
    expect(sameIntent(back, r.intent)).toBe(true);
  });

  it("round-trips a grant intent with recipient + modes", async () => {
    const intent: Intent = {
      id: "urn:a2a:intent:abc",
      action: "grant",
      target: "https://alice.pod/notes.ttl",
      recipient: "https://bob.pod/me",
      modes: ["Read", "Append"],
    };
    const ttl = await intentToTurtle(intent);
    const back = await parseIntentGraph(ttl);
    expect(back?.action).toBe("grant");
    expect(back?.target).toBe("https://alice.pod/notes.ttl");
    expect(back?.recipient).toBe("https://bob.pod/me");
    expect((back?.modes ?? []).sort()).toEqual(["Append", "Read"]);
  });

  it("round-trips a list intent (target carried as schema:target)", async () => {
    const intent: Intent = {
      id: "urn:a2a:intent:lst",
      action: "list",
      target: "https://alice.pod/photos/",
    };
    const back = await parseIntentGraph(await intentToTurtle(intent));
    expect(back?.action).toBe("list");
    expect(back?.target).toBe("https://alice.pod/photos/");
  });

  it("round-trips parameters + agent", async () => {
    const intent: Intent = {
      id: "urn:a2a:intent:p",
      action: "query",
      target: "https://alice.pod/sparql",
      agent: "https://carol.pod/me",
      parameters: [
        { key: "limit", value: "10" },
        { key: "format", value: "json" },
      ],
    };
    const back = await parseIntentGraph(await intentToTurtle(intent));
    expect(sameIntent(back, intent)).toBe(true);
  });
});

describe("intent round-trip (JSON-LD)", () => {
  it("round-trips through JSON-LD", async () => {
    const intent: Intent = {
      id: "urn:a2a:intent:jl",
      action: "create",
      target: "https://alice.pod/new",
    };
    const jsonld = intentToJsonLd(intent);
    expect(jsonld["@type"]).toBe("Intent");
    const back = await parseIntentGraph(JSON.stringify(jsonld), "application/ld+json");
    expect(sameIntent(back, intent)).toBe(true);
  });

  it("round-trips a grant through JSON-LD with recipient + modes", async () => {
    const intent: Intent = {
      id: "urn:a2a:intent:jlg",
      action: "grant",
      target: "https://alice.pod/x",
      recipient: "https://bob.pod/me",
      modes: ["Control"],
    };
    const back = await parseIntentGraph(
      JSON.stringify(intentToJsonLd(intent)),
      "application/ld+json",
    );
    expect(back?.recipient).toBe("https://bob.pod/me");
    expect(back?.modes).toEqual(["Control"]);
  });

  it("round-trips parameters + agent through JSON-LD", async () => {
    const intent: Intent = {
      id: "urn:a2a:intent:jlp",
      action: "query",
      target: "https://alice.pod/sparql",
      agent: "https://carol.pod/me",
      parameters: [{ key: "limit", value: "5" }],
    };
    const jsonld = intentToJsonLd(intent);
    expect(Array.isArray(jsonld.parameter)).toBe(true);
    const back = await parseIntentGraph(JSON.stringify(jsonld), "application/ld+json");
    expect(sameIntent(back, intent)).toBe(true);
  });

  it("round-trips a list through JSON-LD (target as schema:target)", async () => {
    const intent: Intent = { id: "urn:a2a:intent:jll", action: "list", target: "https://a/c/" };
    const back = await parseIntentGraph(
      JSON.stringify(intentToJsonLd(intent)),
      "application/ld+json",
    );
    expect(back?.action).toBe("list");
    expect(back?.target).toBe("https://a/c/");
  });
});

describe("intentFromRdf edge cases", () => {
  it("returns undefined when no a2a:Intent subject is present", async () => {
    const back = await parseIntentGraph(
      `@prefix schema: <https://schema.org/> . <urn:x> a schema:Thing .`,
    );
    expect(back).toBeUndefined();
  });

  it("returns undefined for an intent with no action node", async () => {
    const back = await parseIntentGraph(
      `@prefix a2a: <https://w3id.org/jeswr/a2a#> . <urn:i> a a2a:Intent .`,
    );
    expect(back).toBeUndefined();
  });

  it("returns undefined for an intent whose action has an unrecognised type", async () => {
    const ttl = `@prefix a2a: <https://w3id.org/jeswr/a2a#> .
<urn:i> a a2a:Intent ; a2a:action [ a a2a:BogusAction ] .`;
    expect(await parseIntentGraph(ttl)).toBeUndefined();
  });

  it("intentFromRdf reads directly from an n3 Store of the intent quads", async () => {
    const intent: Intent = { id: "urn:a2a:intent:store", action: "read", target: "https://a/x" };
    const store = new Store();
    store.addQuads(intentToRdf(intent));
    const back = intentFromRdf(store);
    expect(sameIntent(back, intent)).toBe(true);
  });

  it("parseIntentGraph accepts an already-parsed dataset (no re-parse)", async () => {
    const intent: Intent = { id: "urn:a2a:intent:ds", action: "delete", target: "https://a/x" };
    const store = new Store();
    store.addQuads(intentToRdf(intent));
    const back = await parseIntentGraph(store);
    expect(sameIntent(back, intent)).toBe(true);
  });
});
