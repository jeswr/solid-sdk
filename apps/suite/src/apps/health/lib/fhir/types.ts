// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

export const MAX_FHIR_RECORDS = 100_000;
/** R4 string and markdown primitives: 1024 * 1024 Unicode characters. */
export const MAX_FHIR_STRING_LENGTH = 1_048_576;

export type FhirErrorCode =
  | "UNSUPPORTED_METRIC"
  | "UNIT_MISMATCH"
  | "TOO_MANY_RECORDS"
  | "INVALID_INPUT"
  | "INVALID_OPTIONS"
  | "INVALID_BUNDLE";

export class FhirExportError extends Error {
  override readonly name = "FhirExportError";
  constructor(
    readonly code: FhirErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface BloodPressureValue {
  readonly systolic: number;
  readonly diastolic: number;
}

interface ObservationBase {
  readonly id: string;
  readonly unit: string;
  readonly effective: string;
  readonly source: string;
}

export type ObservationInput = ObservationBase &
  (
    | {
        readonly metric:
          | "weight"
          | "height"
          | "heartRate"
          | "steps"
          | "bodyTemperature"
          | "oxygenSaturation";
        readonly value: number;
      }
    | { readonly metric: "bloodPressure"; readonly value: BloodPressureValue }
  );

export interface MedicationInput {
  readonly id: string;
  readonly name: string;
  readonly dosageText: string;
  readonly start: string;
  readonly end?: string;
}

export interface ConditionInput {
  readonly id: string;
  readonly name: string;
  readonly onset: string;
}

export interface HealthRecords {
  readonly observations: readonly ObservationInput[];
  readonly medications: readonly MedicationInput[];
  readonly conditions: readonly ConditionInput[];
}

export interface FhirExportOptions {
  readonly uuid: () => string;
  readonly clock: () => Date;
  /** Absolute HTTP(S) REST URL ending in Patient/<logical-id>. */
  readonly patientReference?: string;
}

export interface Coding {
  system: string;
  code: string;
}

export interface CodedConcept {
  coding: [Coding];
}

export interface Quantity {
  value: number;
  unit: string;
  system: "http://unitsofmeasure.org";
  code: string;
}

export type Subject = { reference: string } | { display: "Patient not supplied" };

interface ResourceBase {
  id: string;
}

export interface ObservationResource extends ResourceBase {
  resourceType: "Observation";
  status: "final";
  category: [CodedConcept];
  code: CodedConcept;
  subject?: Subject;
  effectiveDateTime: string;
  valueQuantity?: Quantity;
  component?: [
    { code: CodedConcept; valueQuantity: Quantity },
    { code: CodedConcept; valueQuantity: Quantity },
  ];
  note: [{ text: string }];
}

export interface MedicationStatementResource extends ResourceBase {
  resourceType: "MedicationStatement";
  status: "unknown";
  medicationCodeableConcept: { text: string };
  subject: Subject;
  effectivePeriod: { start: string; end?: string };
  dosage: [{ text: string }];
}

export interface ConditionResource extends ResourceBase {
  resourceType: "Condition";
  code: { text: string };
  subject: Subject;
  onsetDateTime: string;
}

export type FhirResource = ObservationResource | MedicationStatementResource | ConditionResource;

export interface FhirBundle {
  resourceType: "Bundle";
  type: "collection";
  timestamp: string;
  entry?: { fullUrl: string; resource: FhirResource }[];
}
