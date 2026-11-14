// AUTHORED-BY Codex GPT-6
import { z } from "zod";
import { ConfidenceStatementNode } from "../model/reliance-confidence.js";

export const statedConfidenceSchema = z.strictObject({
  receivers: z.array(z.string().url()),
  rules: z.array(
    z.strictObject({
      claimType: z.string(),
      minimum: z.number().min(0).max(1),
      metric: z.string().url(),
      methods: z.array(z.string().url()).min(1),
    }),
  ),
});
export type StatedConfidenceSettings = z.infer<typeof statedConfidenceSchema>;
export function confidenceFitness(input: unknown, settings: StatedConfidenceSettings) {
  try {
    const statement = ConfidenceStatementNode.fromSignedPayload(input);
    const rule = settings.rules.find((r) => r.claimType === statement.claimType);
    if (!rule) return { ok: true as const };
    const measurement = statement.measurement;
    if (
      measurement?.metric === rule.metric &&
      measurement.calibration === "calibrated" &&
      measurement.method &&
      rule.methods.includes(measurement.method) &&
      Number.isFinite(measurement.score) &&
      measurement.score >= rule.minimum
    )
      return { ok: true as const, statement };
    return { ok: false as const, reason: "confidence-too-low" as const, statement };
  } catch {
    return { ok: false as const, reason: "confidence-too-low" as const };
  }
}
