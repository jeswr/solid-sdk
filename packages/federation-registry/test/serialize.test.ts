// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { describe, expect, it } from "vitest";
import { buildRegistry } from "../src/registry.js";
import { serialize } from "../src/serialize.js";
import { APP_MUSIC, AUTHORITY, REGISTRY_NS } from "./fixtures.js";

describe("serialize", () => {
  it("emits Turtle with the fedreg prefix by default", async () => {
    const built = buildRegistry({
      id: REGISTRY_NS,
      members: [{ app: APP_MUSIC, assertedBy: AUTHORITY }],
    });
    const turtle = await serialize(built.quads);
    expect(turtle).toContain("@prefix fedreg:");
    expect(turtle).toContain("fedreg:Registry");
  });

  it("emits N-Triples when asked", async () => {
    const built = buildRegistry({
      id: REGISTRY_NS,
      members: [{ app: APP_MUSIC, assertedBy: AUTHORITY }],
    });
    const nt = await serialize(built.quads, "application/n-triples");
    // N-Triples uses full IRIs, no prefixes.
    expect(nt).toContain("<https://w3id.org/jeswr/fedreg#Registry>");
    expect(nt).not.toContain("@prefix");
  });

  it("serialises an empty quad set to only prefix declarations (no triples)", async () => {
    const out = await serialize([]);
    // n3.Writer always emits the configured @prefix lines; there must be no
    // triple (no subject IRI/blank node line) for an empty quad set.
    expect(out).toContain("@prefix fedreg:");
    expect(out).not.toMatch(/^<|^_:/m);
  });
});
