// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { DEFAULT_MEMORY_SCOPE, memoryCategory, scopeAdmits } from "../src/index.js";

const PD = "https://w3id.org/dpv/pd#";
it("shares a frozen preference-only default and exact category expansion", () => {
  expect(DEFAULT_MEMORY_SCOPE).toEqual([`${PD}Preference`]);
  expect(Object.isFrozen(DEFAULT_MEMORY_SCOPE)).toBe(true);
  expect(memoryCategory("pd:Preference")).toBe(`${PD}Preference`);
  expect(memoryCategory(`${PD}Health`)).toBe(`${PD}Health`);
  expect(scopeAdmits(undefined, [])).toBe(false);
  expect(scopeAdmits(undefined, ["pd:Preference"])).toBe(true);
  expect(scopeAdmits([], ["pd:Preference"])).toBe(false);
  expect(scopeAdmits(undefined, ["pd:Health"])).toBe(false);
  expect(scopeAdmits(["pd:Health"], [`${PD}Health`])).toBe(true);
  expect(scopeAdmits(["pd:Health"], ["pd:Health", "pd:Preference"])).toBe(false);
});
it.each([
  "Preference",
  "pd:",
  "pd:1Health",
  "pd:Health_",
  "pd:Health-Data",
  "pd:Health/",
  "https://foreign.example/#Health",
  `${PD}Health#x`,
  `${PD}Health?x`,
  `${PD}Health\n`,
])("rejects category %j", (value) => {
  expect(() => memoryCategory(value)).toThrow(TypeError);
});
