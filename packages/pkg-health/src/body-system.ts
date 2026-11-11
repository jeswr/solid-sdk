// AUTHORED-BY Codex GPT-6.1-Sol
import type { HealthFactBase } from "./types.js";
export type BodySystem =
  | "cardiovascular"
  | "respiratory"
  | "digestive"
  | "endocrine and metabolic"
  | "musculoskeletal"
  | "nervous system"
  | "mental health"
  | "skin"
  | "immune and allergy"
  | "eyes and ears"
  | "kidney and urinary"
  | "reproductive and sexual health"
  | "sleep"
  | "general";
// Display buckets only. No ontology traversal, diagnosis or clinical inference.
const snomed: Record<string, BodySystem> = {
  "49601007": "cardiovascular",
  "38341003": "cardiovascular",
  "53741008": "cardiovascular",
  "50043002": "respiratory",
  "195967001": "respiratory",
  "13645005": "respiratory",
  "53619000": "digestive",
  "235719002": "digestive",
  "235595009": "digestive",
  "362969004": "endocrine and metabolic",
  "73211009": "endocrine and metabolic",
  "44054006": "endocrine and metabolic",
  "928000": "musculoskeletal",
  "69896004": "musculoskeletal",
  "118940003": "nervous system",
  "37796009": "nervous system",
  "74732009": "mental health",
  "35489007": "mental health",
  "95320005": "skin",
  "24079001": "skin",
  "414285001": "immune and allergy",
  "419199007": "immune and allergy",
  "371405004": "eyes and ears",
  "232347008": "eyes and ears",
  "90708001": "kidney and urinary",
  "709044004": "kidney and urinary",
  "289903006": "reproductive and sexual health",
  "39898005": "sleep",
};
const atc: Record<string, BodySystem> = {
  A: "digestive",
  B: "cardiovascular",
  C: "cardiovascular",
  D: "skin",
  G: "reproductive and sexual health",
  H: "endocrine and metabolic",
  J: "immune and allergy",
  L: "immune and allergy",
  M: "musculoskeletal",
  N: "nervous system",
  P: "immune and allergy",
  R: "respiratory",
  S: "eyes and ears",
  V: "general",
};
const keywords: [BodySystem, RegExp][] = [
  ["sleep", /\b(sleep|insomnia|apnoea|apnea)\b/],
  [
    "immune and allergy",
    /\b(allergy|allergic|allergies|anaphylaxis|immune|immunization|vaccine)\b/,
  ],
  ["mental health", /\b(anxiety|depression|mental|bipolar|adhd|ptsd)\b/],
  ["cardiovascular", /\b(heart|cardiac|hypertension|blood pressure|cholesterol)\b/],
  ["respiratory", /\b(asthma|lung|respiratory|copd|breathing)\b/],
  ["digestive", /\b(coeliac|celiac|bowel|stomach|digestive|reflux|crohn)\b/],
  ["endocrine and metabolic", /\b(diabetes|thyroid|endocrine|metabolic|glucose)\b/],
  ["musculoskeletal", /\b(arthritis|joint|muscle|bone|back pain)\b/],
  ["nervous system", /\b(migraine|epilepsy|neurological|nerve|seizure)\b/],
  ["skin", /\b(skin|eczema|psoriasis|rash|dermatitis)\b/],
  ["eyes and ears", /\b(eye|eyes|ear|ears|vision|hearing|glaucoma|tinnitus)\b/],
  ["kidney and urinary", /\b(kidney|renal|urinary|bladder)\b/],
  ["reproductive and sexual health", /\b(reproductive|sexual|pregnancy|menstrual|prostate)\b/],
];
/** Ordered: explicit SNOMED, ICD-10, ATC, label keywords, general. Display heuristic only. */
export function classifyBodySystem(fact: Pick<HealthFactBase, "code" | "label">): BodySystem {
  const code = fact.code;
  const value = code?.value ?? code?.iri?.split("/").at(-1) ?? "";
  if (code?.system === "snomed" && snomed[value]) return snomed[value];
  if (code?.system === "icd10") {
    const match = /^([A-Z])(\d{2})(?:\.[A-Z\d]+)?$/i.exec(value);
    if (match) {
      const chapter = match[1]?.toUpperCase();
      const number = Number(match[2]);
      if (chapter === "G" && number === 47) return "sleep";
      if (chapter === "D") return number >= 50 && number <= 89 ? "immune and allergy" : "general";
      if (chapter === "N")
        return number < 40 ? "kidney and urinary" : "reproductive and sexual health";
      if (
        (chapter === "E" && number > 90) ||
        (chapter === "H" && number > 95) ||
        (chapter === "K" && number > 93)
      )
        return "general";
      const chapters: Record<string, BodySystem> = {
        A: "immune and allergy",
        B: "immune and allergy",
        E: "endocrine and metabolic",
        F: "mental health",
        G: "nervous system",
        H: "eyes and ears",
        I: "cardiovascular",
        J: "respiratory",
        K: "digestive",
        L: "skin",
        M: "musculoskeletal",
        O: "reproductive and sexual health",
      };
      const bucket = chapters[chapter as string];
      if (bucket) return bucket;
    }
  }
  if (code?.system === "atc") {
    const bucket = atc[value.slice(0, 1).toUpperCase()];
    if (bucket) return bucket;
  }
  const label = fact.label.toLowerCase();
  return keywords.find(([, pattern]) => pattern.test(label))?.[0] ?? "general";
}
