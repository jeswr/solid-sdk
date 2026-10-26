import { describe, expect, it } from "vitest";
import { runFhir } from "./scenarios/fhir.js";
import { fixedClock } from "./scenarios/personal.js";

describe("UC-04 synthetic patient-authorised FHIR access", () => {
  it("grants a patient-approved subset, enforces scope, key binding and revocation", async () => {
    const { obs } = await runFhir(fixedClock("2026-10-05T09:00:00Z"));
    expect(obs.birch).toEqual({
      phase: "unsupported",
      reason: "unsupported-term",
      proposalsSent: 0,
    });
    expect(obs.authorisation).toEqual({
      phase: "agreed",
      requested: [
        "launch/patient",
        "patient/Patient.r",
        "patient/MedicationRequest.rs",
        "patient/AllergyIntolerance.rs",
        "patient/Observation.rs",
      ],
      approvedByPatient: [
        "launch/patient",
        "patient/Patient.r",
        "patient/MedicationRequest.rs",
        "patient/AllergyIntolerance.rs",
      ],
      granted: [
        "launch/patient",
        "patient/Patient.r",
        "patient/MedicationRequest.rs",
        "patient/AllergyIntolerance.rs",
      ],
    });
    expect(obs.reads).toEqual({
      Patient: { phase: "completed", reason: "delivered" },
      MedicationRequest: { phase: "completed", reason: "delivered" },
      AllergyIntolerance: { phase: "completed", reason: "delivered" },
      Observation: { phase: "refused", reason: "insufficient-scope" },
    });
    expect(obs.outOfScopeSuccessfulReads).toBe(0);
    expect(obs.writes).toEqual({
      careBriefWriteSent: 0,
      careBriefLocalDecision: "indeterminate",
      rogueWrite: { phase: "unsupported", reason: "unsupported-operation" },
      stolenGrant: { phase: "refused", reason: "grant-invalid" },
    });
    const summary = obs.summary as Array<{ text: string; status: string; cites: string[] }>;
    expect(summary.find((s) => s.text.startsWith("atorvastatin"))?.status).toBe("unresolved");
    expect(summary.find((s) => s.text.startsWith("lisinopril"))?.status).toBe("recorded");
    expect(summary.find((s) => s.text.includes("penicillin"))?.status).toBe("recorded");
    expect(summary.find((s) => s.text.includes("Local allergen"))?.status).toBe("warning");
    expect(
      summary.every((s) => s.cites.length > 0 && s.cites.every((c) => c.includes("/_history/"))),
    ).toBe(true);
    expect(
      (obs.validation as Array<{ resource: string; valid: boolean }>).find(
        (v) => v.resource === "MedicationRequest/mr-4",
      )?.valid,
    ).toBe(false);
    expect(obs.revoked).toBe(true);
    expect(obs.afterRevocation).toEqual({ phase: "refused", reason: "grant-revoked" });
    expect(obs.auditMinimised).toBe(true);
    expect(obs.ledgers).toBe(true);
  });
});
