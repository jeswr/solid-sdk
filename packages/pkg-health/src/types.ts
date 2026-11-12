// AUTHORED-BY Codex GPT-6.1-Sol
import type {
  Belief,
  EpistemicStatus,
  FactProvenance,
  SourceInfo,
  ValidityStatus,
} from "@jeswr/pkg-memory";

export type { Belief, FactProvenance, SourceInfo } from "@jeswr/pkg-memory";
export type HealthFactKind =
  | "condition"
  | "allergy"
  | "medication"
  | "observation"
  | "immunization"
  | "encounter"
  | "note"
  | "document";
export interface HealthCode {
  iri?: string;
  value?: string;
  system?: "snomed" | "loinc" | "icd10" | "atc" | "dmd" | "other";
}
export interface HealthPeriod {
  start?: string;
  end?: string;
  startTime?: number;
  endTime?: number;
}
export interface HealthFactBase {
  id: string;
  assertionId: string;
  subject: string;
  kind: HealthFactKind | "unrecognised";
  label: string;
  code?: HealthCode;
  period: HealthPeriod;
  belief: Belief;
  /** A later update could not be read; display the uncertainty alongside any non-past belief. */
  affectedBySkipped?: true;
  validity: ValidityStatus;
  epistemic: EpistemicStatus;
  hedge?: string;
  categories: string[];
  replacedBy: string[];
  corroboration: number;
  provenance: FactProvenance;
}
export type HealthFact =
  | (HealthFactBase & { kind: "condition"; onset?: string; abatement?: string })
  | (HealthFactBase & { kind: "allergy"; substance?: string })
  | (HealthFactBase & {
      kind: "medication";
      product: { name: string; atcCode?: string };
      dose?: { value: string; unit: string; frequency?: string };
    })
  | (HealthFactBase & {
      kind: "observation";
      value: number | string;
      interpretation?: "normal" | "abnormal" | "high" | "low";
      unit?: string;
      effectiveTime?: string;
      effectiveTimeMs?: number;
    })
  | (HealthFactBase & { kind: "immunization"; product?: string; date?: string })
  | (HealthFactBase & { kind: "encounter"; date?: string; recordedBy?: string })
  | (HealthFactBase & { kind: "note"; property: string; value: string })
  | (HealthFactBase & { kind: "document"; name: string; dateCreated?: string });
export interface HealthGraphView {
  facts: HealthFact[];
  byKind: Record<HealthFactKind, HealthFact[]>;
  unrecognised: HealthFactBase[];
  sources: SourceInfo[];
  excludedOtherSubjects: number;
}
export interface HealthFilterOptions {
  beliefs?: Belief[];
}
export interface ObservationSeries {
  id: string;
  label: string;
  unit?: string;
  points: {
    x: string;
    y: number;
    factId: string;
    belief: Belief;
    affectedBySkipped?: true;
  }[];
}
export type TimelineKind = "condition" | "medication" | "immunization" | "encounter" | "documents";
export interface HealthTimelineItem {
  id: string;
  start?: string;
  end?: string;
  label: string;
  belief: Belief;
  affectedBySkipped?: true;
  tone: "active" | "past" | "neutral";
}
export type HealthTimeline = Record<TimelineKind, HealthTimelineItem[]>;
/** Errors intentionally contain no facts, RDF values or backend diagnostics. */
export class HealthGraphError extends Error {
  constructor(
    readonly code:
      | "invalid-input"
      | "unsupported-correction"
      | "invalid-correction"
      | "read-failed"
      | "write-failed",
  ) {
    super(`Health graph operation failed (${code})`);
    this.name = "HealthGraphError";
  }
}
