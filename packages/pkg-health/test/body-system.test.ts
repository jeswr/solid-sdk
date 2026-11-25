// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { classifyBodySystem, type HealthCode } from "../src/index.js";

const check = (system: HealthCode["system"], value: string, label = "Fictional", iri?: string) =>
  classifyBodySystem({ label, code: { system, value, iri } });
it.each([
  ["49601007", "cardiovascular"],
  ["38341003", "cardiovascular"],
  ["53741008", "cardiovascular"],
  ["50043002", "respiratory"],
  ["195967001", "respiratory"],
  ["13645005", "respiratory"],
  ["53619000", "digestive"],
  ["235719002", "digestive"],
  ["235595009", "digestive"],
  ["362969004", "endocrine and metabolic"],
  ["73211009", "endocrine and metabolic"],
  ["44054006", "endocrine and metabolic"],
  ["928000", "musculoskeletal"],
  ["69896004", "musculoskeletal"],
  ["118940003", "nervous system"],
  ["37796009", "nervous system"],
  ["74732009", "mental health"],
  ["35489007", "mental health"],
  ["95320005", "skin"],
  ["24079001", "skin"],
  ["414285001", "immune and allergy"],
  ["419199007", "immune and allergy"],
  ["371405004", "eyes and ears"],
  ["232347008", "eyes and ears"],
  ["90708001", "kidney and urinary"],
  ["709044004", "kidney and urinary"],
  ["289903006", "reproductive and sexual health"],
  ["39898005", "sleep"],
] as const)("uses explicit SNOMED display mapping %s", (value, expected) => {
  expect(check("snomed", value)).toBe(expected);
});
it.each([
  ["A00", "immune and allergy"],
  ["B99", "immune and allergy"],
  ["D49", "general"],
  ["D50", "immune and allergy"],
  ["D89", "immune and allergy"],
  ["E11.9", "endocrine and metabolic"],
  ["F32", "mental health"],
  ["G40", "nervous system"],
  ["G47.0", "sleep"],
  ["H00", "eyes and ears"],
  ["H95", "eyes and ears"],
  ["I10", "cardiovascular"],
  ["J45", "respiratory"],
  ["K90.0", "digestive"],
  ["L30", "skin"],
  ["M06", "musculoskeletal"],
  ["N00", "kidney and urinary"],
  ["N39", "kidney and urinary"],
  ["N40", "reproductive and sexual health"],
  ["N99", "reproductive and sexual health"],
  ["O00", "reproductive and sexual health"],
] as const)("uses ICD-10 chapter boundary %s", (value, expected) => {
  expect(check("icd10", value)).toBe(expected);
});
it.each([
  ["A", "digestive"],
  ["B", "cardiovascular"],
  ["C", "cardiovascular"],
  ["D", "skin"],
  ["G", "reproductive and sexual health"],
  ["H", "endocrine and metabolic"],
  ["J", "immune and allergy"],
  ["L", "immune and allergy"],
  ["M", "musculoskeletal"],
  ["N", "nervous system"],
  ["P", "immune and allergy"],
  ["R", "respiratory"],
  ["S", "eyes and ears"],
  ["V", "general"],
] as const)("uses ATC first-letter bucket %s", (value, expected) => {
  expect(check("atc", `${value}01AA00`)).toBe(expected);
});
it.each([
  ["INSOMNIA", "sleep"],
  ["Pollen allergy", "immune and allergy"],
  ["Anxiety", "mental health"],
  ["Blood pressure", "cardiovascular"],
  ["Asthma", "respiratory"],
  ["Coeliac", "digestive"],
  ["Glucose", "endocrine and metabolic"],
  ["Joint pain", "musculoskeletal"],
  ["Migraine", "nervous system"],
  ["Eczema", "skin"],
  ["Hearing", "eyes and ears"],
  ["Kidney", "kidney and urinary"],
  ["Pregnancy", "reproductive and sexual health"],
  ["Fictional unclassified", "general"],
] as const)("uses label keyword %s", (label, expected) => {
  expect(classifyBodySystem({ label })).toBe(expected);
});
it("honours code priority, extracts an IRI code, and avoids numeric guessing and substring matches", () => {
  expect(check("snomed", "195967001", "Heart")).toBe("respiratory");
  expect(
    classifyBodySystem({
      label: "Heart",
      code: { system: "snomed", iri: "http://snomed.info/id/195967001" },
    }),
  ).toBe("respiratory");
  expect(check("other", "195967001")).toBe("general");
  expect(check("icd10", "bad value")).toBe("general");
  expect(check("atc", "Z00")).toBe("general");
  expect(classifyBodySystem({ label: "trash" })).toBe("general");
});
it.each([
  "D90",
  "E91",
  "H96",
  "K94",
  "C00",
])("keeps out-of-range or unlisted ICD-10 %s general", (value) => {
  expect(check("icd10", value)).toBe("general");
});
it("handles absent ATC identifiers", () => {
  expect(classifyBodySystem({ label: "Fictional", code: { system: "atc" } })).toBe("general");
});
