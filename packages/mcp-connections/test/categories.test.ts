// AUTHORED-BY Codex GPT-6.1-Sol
import { isSpecialCategory, NanopubStore } from "@jeswr/pkg-memory";
import { SPECIAL_CATEGORIES } from "@jeswr/pkg-memory/categories";
import { createMemoryPodPort } from "@jeswr/pkg-memory/testing";
import { expect, it } from "vitest";
import {
  auditContainer,
  PERSONAL_DATA_CATEGORY_LABELS,
  personalDataCategoryLabel,
} from "../src/index.js";

it("labels every memory special category and Financial without fallback", () => {
  for (const iri of [...SPECIAL_CATEGORIES, "https://w3id.org/dpv/pd#Financial"]) {
    expect(PERSONAL_DATA_CATEGORY_LABELS[iri]).toBeTruthy();
    expect(personalDataCategoryLabel(iri)).not.toBe("Other personal data");
  }
  for (const iri of SPECIAL_CATEGORIES) expect(isSpecialCategory(iri)).toBe(true);
  expect(personalDataCategoryLabel("https://w3id.org/dpv/pd#MentalHealth")).toBe("Mental Health");
  expect(personalDataCategoryLabel("https://w3id.org/dpv/pd#DNACode")).toBe("DNA Code");
  for (const iri of ["urn:unknown", "toString", "__proto__"])
    expect(personalDataCategoryLabel(iri)).toBe("Other personal data");
});

it.each([
  "https://pod.example/",
  "https://pod.example/alice/",
])("keeps the audit path beside NanopubStore's memory container at %s", (root) => {
  const store = new NanopubStore(
    createMemoryPodPort({ root, webId: "https://example.org/people/avery#me" }),
  );
  expect(auditContainer(root)).toBe(new URL("../audit/", store.container).href);
});
