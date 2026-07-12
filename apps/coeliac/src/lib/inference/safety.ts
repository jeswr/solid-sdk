// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Hard-coded, NON-correlated safety rails (DESIGN §4.4, RESEARCH §4). These are
 * RULES, not inferences: they are never "correlated away", never suppressed, and
 * they short-circuit the correlation UI to a "see a doctor" / emergency frame.
 *
 * The **emergency exclusion** is also load-bearing for correctness: anaphylaxis /
 * breathing-difficulty symptoms are EXCLUDED from correlation entirely (they are
 * emergency-rail territory, not inference fodder — DESIGN §4.4). The emergency set
 * comes from the model (`EMERGENCY_SYMPTOM_TYPES`) — never re-listed here, so it
 * cannot drift.
 */

import {
  type DietPlanData,
  EMERGENCY_SYMPTOM_TYPES,
  isEmergencySymptomType,
  type ProtocolData,
  type SymptomData,
  type ToleranceConclusionData,
} from "@jeswr/solid-health-diary";
import {
  DEFAULT_THRESHOLDS,
  type EngineThresholds,
  type SafetyContext,
  type SafetyRail,
} from "./types";

/** Re-export the model's emergency set (single source of truth) for callers. */
export { EMERGENCY_SYMPTOM_TYPES, isEmergencySymptomType };

/** True if a symptom is a medical emergency (never correlation fodder). */
export function isEmergencySymptom(symptom: Pick<SymptomData, "symptomType">): boolean {
  return isEmergencySymptomType(symptom.symptomType);
}

/**
 * Split symptoms into the EMERGENCY ones (which surface only as a rail and are
 * excluded from all correlation) and the QUALIFYING ones (the correlation inputs).
 * The correlation code consumes ONLY `qualifying` — the structural guarantee that
 * an emergency symptom is never paired with an exposure (DESIGN §4.4).
 */
export function partitionEmergencySymptoms(
  symptoms: readonly SymptomData[],
): { emergency: SymptomData[]; qualifying: SymptomData[] } {
  const emergency: SymptomData[] = [];
  const qualifying: SymptomData[] = [];
  for (const s of symptoms) (isEmergencySymptom(s) ? emergency : qualifying).push(s);
  return { emergency, qualifying };
}

/**
 * Evaluate every safety rail over the diary snapshot + caller safety context. The
 * result is ordered strongest-first (emergency → urgent → advisory). Rails are
 * additive and independent; a caller renders all of them (they are not mutually
 * exclusive).
 */
export function evaluateSafetyRails(input: {
  symptoms: readonly SymptomData[];
  protocols?: readonly ProtocolData[];
  conclusions?: readonly ToleranceConclusionData[];
  plan?: DietPlanData;
  context?: SafetyContext;
  thresholds?: EngineThresholds;
}): SafetyRail[] {
  const { symptoms, plan, context = {}, conclusions = [] } = input;
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const rails: SafetyRail[] = [];

  // 1. EMERGENCY — any breathing-difficulty / anaphylaxis symptom (DESIGN §4.4).
  const emergencySymptoms = symptoms.filter(isEmergencySymptom);
  if (emergencySymptoms.length > 0) {
    rails.push({
      kind: "emergency-anaphylaxis",
      severity: "emergency",
      message:
        "You logged a breathing-difficulty or anaphylaxis symptom. This can be a " +
        "medical emergency — call emergency services now. This is not something to " +
        "log and correlate.",
      evidence: idsOf(emergencySymptoms),
    });
  }

  // 2. ALARM SYMPTOMS the symptom-type enum cannot express — from caller flags
  //    (weight loss, GI bleeding, persistent vomiting, dysphagia, anaemia).
  const flags = context.alarmFlags ?? {};
  const raisedAlarms = (Object.keys(flags) as (keyof typeof flags)[]).filter((k) => flags[k]);
  if (raisedAlarms.length > 0) {
    rails.push({
      kind: "alarm-symptoms",
      severity: "urgent",
      message:
        "You reported an alarm symptom (" +
        raisedAlarms.map(alarmLabel).join(", ") +
        "). These need urgent medical assessment, not dietary self-management — " +
        "please see a doctor promptly.",
      evidence: [],
    });
  }

  // 3. PERSISTENT SYMPTOMS DESPITE STRICT ADHERENCE → gastroenterology (DESIGN §4.4,
  //    RESEARCH §2.3 non-responsive coeliac). Fires when the user reports strict
  //    adherence yet is still logging (non-emergency) symptoms.
  const nonEmergencySymptoms = symptoms.filter((s) => !isEmergencySymptom(s));
  if (context.strictAdherence === true && nonEmergencySymptoms.length > 0) {
    rails.push({
      kind: "persistent-despite-adherence",
      severity: "advisory",
      message:
        "You're reporting symptoms despite strict adherence. Persistent symptoms on " +
        "a strict diet should be reviewed by a gastroenterologist (to rule out things " +
        "like refractory coeliac, microscopic colitis, or another cause) — not managed " +
        "by removing more foods.",
      evidence: idsOf(nonEmergencySymptoms),
    });
  }

  // 4. RESTRICTION-ANXIETY / rapidly-shrinking diet → dietitian (orthorexia guard,
  //    DESIGN §4.4, RESEARCH §2.8). Fires when the working exclusion set is large.
  const exclusionCount = plan?.excludes.length ?? countReactingExclusions(conclusions);
  if (exclusionCount >= thresholds.exclusionCountForAnxiety) {
    rails.push({
      kind: "restriction-anxiety",
      severity: "advisory",
      message:
        `You're now avoiding ${exclusionCount} triggers. A rapidly shrinking diet can ` +
        "become its own health risk — please work with a registered dietitian to keep " +
        "your diet as broad and nourishing as safely possible. The goal is to eat MORE " +
        "foods safely, not fewer.",
      evidence: plan?.id ? [plan.id] : idsOf(conclusions),
    });
  }

  return rails;
}

/**
 * The pre-diagnosis gluten-elimination HARD BLOCK (DESIGN §4.3, RESEARCH §4): never
 * eliminate gluten before a coeliac diagnosis — going gluten-free first invalidates
 * serology + biopsy. Returns the rail when the block applies, else `undefined`.
 * Used by the proposal generator (it must never propose gluten elimination
 * pre-diagnosis) and surfaceable directly as a rail.
 */
export function preDiagnosisGlutenBlock(context?: SafetyContext): SafetyRail | undefined {
  if (context?.coeliacDiagnosed === true) return undefined;
  return {
    kind: "pre-diagnosis-gluten",
    severity: "urgent",
    message:
      "Don't cut out gluten yet. Coeliac disease is diagnosed by a blood test and a " +
      "biopsy taken WHILE you are still eating gluten — going gluten-free first can make " +
      "the tests come back falsely negative. Get tested first, then this app can help you " +
      "manage it.",
    evidence: [],
  };
}

// --- helpers -----------------------------------------------------------------

function idsOf(records: readonly { id?: string }[]): string[] {
  return records.map((r) => r.id).filter((id): id is string => typeof id === "string");
}

/** Count exclusions implied by "reacts"/"dose-dependent" conclusions (fallback for no plan). */
function countReactingExclusions(conclusions: readonly ToleranceConclusionData[]): number {
  const reacting = new Set<string>();
  for (const c of conclusions) {
    if (c.verdict === "reacts" || c.verdict === "dose-dependent") reacting.add(c.aboutTrigger);
  }
  return reacting.size;
}

function alarmLabel(key: string): string {
  switch (key) {
    case "unintendedWeightLoss":
      return "unintended weight loss";
    case "giBleeding":
      return "gastrointestinal bleeding";
    case "persistentVomiting":
      return "persistent vomiting";
    case "dysphagia":
      return "difficulty swallowing";
    case "anaemia":
      return "anaemia";
    default:
      return key;
  }
}
