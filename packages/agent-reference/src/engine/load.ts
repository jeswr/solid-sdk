// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { validateRules } from "../derive/rules.js";
import {
  type DomainProfile,
  domainProfileSchema,
  type Scenario,
  scenarioSchema,
} from "./schema.js";

export function loadProfile(path: string): DomainProfile {
  const profile = domainProfileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  validateRules(profile.rules.filter((r) => "template" in r));
  return profile;
}
export function loadScenario(path: string): Scenario {
  return scenarioSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
export function loadCase(
  directory: string,
  id: string,
): { profile: DomainProfile; scenario: Scenario } {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error("invalid scenario id");
  const scenario = loadScenario(join(directory, "scenarios", `${id}.json`));
  const profile = loadProfile(join(directory, "profiles", `${scenario.profile}.json`));
  if (scenario.id !== id || scenario.profile !== profile.id)
    throw new Error("profile/scenario id mismatch");
  validateReferences(profile, scenario);
  return { profile, scenario };
}
export function validateReferences(profile: DomainProfile, scenario: Scenario): void {
  validateRules(profile.rules.filter((r) => "template" in r));
  const unique = (values: readonly string[], label: string) => {
    if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`);
  };
  unique(
    scenario.parties.map((p) => p.id),
    "party",
  );
  unique(
    scenario.script.map((s) => s.id),
    "step",
  );
  unique(
    scenario.statements.map((s) => s.id),
    "statement",
  );
  unique(
    scenario.branches.map((b) => b.id),
    "branch",
  );
  unique(
    profile.operations.map((o) => o.id),
    "operation",
  );
  if (profile.personMayRelyOn.length) {
    const steps = [
      ...scenario.script,
      ...scenario.branches.flatMap((b) => {
        const change = b.change as { script?: Scenario["script"] };
        return change.script ?? [];
      }),
    ];
    for (const step of steps) {
      if (!("intent" in step)) continue;
      const intent = step.intent as import("../core/types.js").JsonObject;
      const parameters = intent.parameters as import("../core/types.js").JsonObject | undefined;
      const support = [parameters?.support, parameters?.evidence].flatMap((v) =>
        Array.isArray(v) ? v : [],
      );
      const kinds = profile.actionClaims
        .filter((r) => r.action === intent.action || r.action === intent.operation)
        .flatMap((r) => r.claims);
      const statements = scenario.statements.filter(
        (s) =>
          profile.personMayRelyOn.includes(s.kind) &&
          (kinds.includes(s.kind) ||
            support.includes(s.id) ||
            support.includes(`urn:scenario:${scenario.id}:${s.id}`)),
      );
      const depends = statements.length || kinds.some((k) => profile.personMayRelyOn.includes(k));
      if (!depends) continue;
      const pays = intent.action === "pay";
      const discloses =
        intent.action === "distribute" ||
        (Array.isArray(parameters?.evidence) && parameters.evidence.length > 0);
      const toAuthor =
        statements.length > 0 &&
        statements.every(
          (s) => scenario.parties.find((p) => p.id === s.issuer)?.identity === intent.recipient,
        );
      if (pays || (discloses && !toAuthor))
        throw new Error(
          "personMayRelyOn cannot support payment or disclosure of personal data to a third party",
        );
    }
  }
  const parties = new Map(scenario.parties.map((p) => [p.id, p]));
  const requireParty = (id: string) => {
    if (!parties.has(id)) throw new Error(`unknown party ${id}`);
  };
  for (const party of scenario.parties) {
    if (party.actsFor) requireParty(party.actsFor);
    if (party.runs === "agent" && (!party.actor || !party.actsFor))
      throw new Error(`agent ${party.id} needs actor and actsFor`);
  }
  for (const [a, b] of scenario.trust.introductions) {
    requireParty(a);
    requireParty(b);
  }
  for (const statement of scenario.statements) requireParty(statement.issuer);
  for (const mandate of scenario.mandates) requireParty(mandate.agent);
  for (const step of scenario.script) {
    requireParty(step.agent);
    if (step.type === "start") {
      requireParty(step.peer);
      if (!profile.operations.some((o) => o.id === step.operation))
        throw new Error(`unknown operation ${step.operation}`);
    }
    if (step.type === "admit")
      for (const id of step.statements)
        if (
          !scenario.statements.some((s) => s.id === id) &&
          !scenario.script.some((s) => s.type === "issue" && s.id === id)
        )
          throw new Error(`unknown statement ${id}`);
  }
  for (const injection of scenario.inject)
    if (!scenario.script.some((s) => s.id === injection.step))
      throw new Error(`unknown injection step ${injection.step}`);
}
