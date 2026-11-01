// AUTHORED-BY Codex GPT-6.1-Sol
export { adherenceByPeriod, logDose } from "./adherence";
export { generateDueDoses } from "./schedule";
export type {
  AdherencePeriod,
  DoseEntry,
  DoseLog,
  DoseWindow,
  DueDose,
  MedicationSchedule,
} from "./types";
export { MedicationError, type MedicationErrorCode, validateSchedule } from "./validation";
