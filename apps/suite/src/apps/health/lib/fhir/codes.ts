// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { CodedConcept, Quantity } from "./types";

export const LOINC_SYSTEM = "http://loinc.org";
export const UCUM_SYSTEM = "http://unitsofmeasure.org";
export const CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";

export const METRIC_CODES = {
  weight: { code: "29463-7", unit: "kg", category: "vital-signs" },
  height: { code: "8302-2", unit: "cm", category: "vital-signs" },
  heartRate: { code: "8867-4", unit: "/min", category: "vital-signs" },
  steps: { code: "55423-8", unit: "{steps}", category: "activity" },
  bodyTemperature: { code: "8310-5", unit: "Cel", category: "vital-signs" },
  oxygenSaturation: { code: "59408-5", unit: "%", category: "vital-signs" },
  bloodPressure: { code: "85354-9", unit: "mm[Hg]", category: "vital-signs" },
} as const;

export function concept(code: string, system = LOINC_SYSTEM): CodedConcept {
  return { coding: [{ system, code }] };
}

export function quantity(value: number, unit: string): Quantity {
  return { value, unit, system: UCUM_SYSTEM, code: unit };
}
