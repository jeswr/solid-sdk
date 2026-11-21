// AUTHORED-BY Codex GPT-6.1-Sol
import { type Extraction, SCHEMA } from "@jeswr/site-model";
import { expect, it } from "vitest";
import {
  effectSnapshot,
  emptyEffectCollection,
  formatEffectValue,
  learnEffectValueFormat,
} from "../src/effect-verification.js";
import type { EffectVerification } from "../src/write-response.js";

const origin = "https://shop.test";
const extraction: Extraction = {
  format: "json",
  itemType: `${SCHEMA}DiscussionForumPosting`,
  fields: [
    { property: `${SCHEMA}identifier`, path: "/id" },
    { property: `${SCHEMA}url`, path: "/url", datatype: "iri" },
  ],
};
const declaration: EffectVerification = {
  operation: "urn:read",
  bind: { id: { input: "id" } },
  identityInput: "id",
  identityPattern: `${origin}/forums/ExampleForum/{id}`,
  displaySlug: true,
  changes: [],
};

it.each([
  ["/forums/ExampleForum/73/new-display-slug", true],
  ["/forums/OtherForum/73/new-display-slug", false],
  ["/categories/73/new-display-slug", false],
  ["/forums/ExampleForum/73/74", false],
  ["/forums/ExampleForum/73/new-display-slug/child", false],
  ["/forums/ExampleForum/73/new-display-slug?tenant=other", false],
])("a witnessed presentation slug keeps its exact resource namespace: %s", async (url, accepted) => {
  const snapshot = await effectSnapshot(
    extraction,
    JSON.stringify({ id: "73", url: origin + url }),
    `${origin}/forums/ExampleForum/73`,
    "73",
    declaration,
    (value) => value,
  );
  expect(!!snapshot).toBe(accepted);
});

it("an empty collection cannot replace a baseline object even under identical envelope keys", async () => {
  const ex = { ...extraction, itemPath: "/data/items", totalPath: "/data/total" };
  const row = { id: "73", url: `${origin}/forums/ExampleForum/73` };
  const baseline = await effectSnapshot(
    ex,
    JSON.stringify({ data: { total: 1, items: row } }),
    origin,
    "73",
    declaration,
    (value) => value,
  );
  expect(baseline).toBeDefined();
  if (!baseline) throw new Error("Missing baseline");
  expect(
    emptyEffectCollection(ex, JSON.stringify({ data: { total: 0, items: [] } }), baseline),
  ).toBe(false);
});

it.each([
  [{ data: { total: 0, items: [] } }, true],
  [{ data: { total: 0, items: [], message: "Please sign in" } }, false],
  [{ data: { total: 0, items: [] }, ok: false }, false],
  [{ data: { total: 0, items: [], exception: "Unavailable" } }, false],
  [{ data: { total: 0 } }, false],
])("requires the complete nested baseline envelope and no shared failure marker: %j", async (after, accepted) => {
  const ex = { ...extraction, itemPath: "/data/items", totalPath: "/data/total" };
  const baseline = await effectSnapshot(
    ex,
    JSON.stringify({
      data: { total: 1, items: [{ id: "73", url: `${origin}/forums/ExampleForum/73` }] },
    }),
    origin,
    "73",
    declaration,
    (value) => value,
  );
  if (!baseline) throw new Error("Missing baseline");
  expect(emptyEffectCollection(ex, JSON.stringify(after), baseline)).toBe(accepted);
});

it("numeric presentation matching is exact and never rounds an unobserved value", () => {
  const format = learnEffectValueFormat("23.45", '<span class="price">$23.45</span>');
  expect(format).toEqual({ prefix: '<span class="price">$', suffix: "</span>", scale: 2 });
  if (!format) throw new Error("Missing format");
  expect(formatEffectValue("23.4500", format)).toBe('<span class="price">$23.45</span>');
  expect(formatEffectValue("23.451", format)).toBeUndefined();
  expect(learnEffectValueFormat("23.45", "$99.00")).toBeUndefined();
});
