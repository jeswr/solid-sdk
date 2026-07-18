/**
 * The document gates: the walkthrough must parse (schema + every cross-reference)
 * and pass the editorial budgets. These are the repo's cheapest, highest-value
 * tests — run them on every edit to content/walkthrough.json.
 */
import { editorialFindings, parseWalkthrough } from "@jeswr/solid-showcase";
import { expect, test } from "vitest";
import walkthroughJson from "../content/walkthrough.json";

test("walkthrough.json parses: schema, registry references, scenes, persona honesty", () => {
  const doc = parseWalkthrough(walkthroughJson);
  expect(doc.chapters.length).toBeGreaterThan(0);
  expect(Object.keys(doc.registry.apps)).toContain("tour");
});

test("every chapter passes the editorial gates (word budgets, step minimums)", () => {
  const doc = parseWalkthrough(walkthroughJson);
  expect(editorialFindings(doc)).toEqual([]);
});
