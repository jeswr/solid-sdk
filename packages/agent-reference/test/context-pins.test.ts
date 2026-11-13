// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { digestBytes } from "../src/core/canonical.js";
import { ANSWERABLE_CONTEXT, bundledContext, readPinnedContext } from "../src/wire/contexts.js";

it("checks pinned context bytes and isolates each load from caller mutation", () => {
  const original = '{"@context":{"safe":"urn:term:safe"}}';
  const hash = digestBytes(original).slice("sha-256:".length);
  expect(readPinnedContext(original, hash)).toEqual({ "@context": { safe: "urn:term:safe" } });
  expect(() =>
    readPinnedContext(original.replace("urn:term:safe", "urn:term:changed"), hash),
  ).toThrow("context-not-accepted");
  const before = bundledContext(ANSWERABLE_CONTEXT);
  const saved = JSON.stringify(before);
  before["@context"] = { unsafe: "urn:attacker:context" };
  expect(JSON.stringify(bundledContext(ANSWERABLE_CONTEXT))).toBe(saved);
});
