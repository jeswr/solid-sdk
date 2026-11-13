// AUTHORED-BY Codex GPT-6.1-Sol
import { evaluateIntent, solidOdrlEngine } from "./policy.js";
import { type Intent, type Mandate, ODRL, type PolicyEngine } from "./types.js";

/** Only exact, independently effective autonomous read grants expose recall categories. */
export async function autonomousTargets(
  mandate: Mandate | undefined,
  request: Omit<Intent, "target">,
  candidates: readonly string[],
  engine: PolicyEngine = solidOdrlEngine,
): Promise<string[]> {
  if (!mandate || !["read", `${ODRL}read`].includes(request.action)) return [];
  const attributes = Object.freeze({ ...request.attributes });
  const purpose = attributes.purpose;
  if (purpose !== undefined && typeof purpose !== "string") return [];
  const admitted: string[] = [];
  for (const target of [...new Set(candidates)].sort()) {
    if (target.includes("*")) continue;
    const permissions =
      mandate.autonomous.permissions?.filter((rule) => rule.target === target) ?? [];
    if (permissions.length === 0) continue;
    const intent = { agent: request.agent, at: request.at, attributes, action: "read", target };
    const decision = await evaluateIntent(mandate, intent, engine);
    if (decision.decision !== "permit") continue;
    const exact = await evaluateIntent(
      { ...mandate, autonomous: { ...mandate.autonomous, permissions } },
      intent,
      engine,
    );
    if (exact.decision === "permit") admitted.push(target);
  }
  return admitted;
}
