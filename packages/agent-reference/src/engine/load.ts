// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";
import jsonld from "jsonld";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { isIri } from "../core/canonical.js";
import { validateRules } from "../derive/rules.js";
import { checkDocumentTerms } from "../wire/contexts.js";
import { SCENARIO_CONTEXT, scenarioContext, scenarioJsonLdLoader } from "../wire/store-contexts.js";
import { gateFaultPlacementProblem } from "./faulty-gate.js";
import { fixtureContextResolver } from "./fixture-context-resolver.js";
import {
  type DomainProfile,
  domainProfileSchema,
  type Scenario,
  scenarioSchema,
} from "./schema.js";

function readFixture(path: string): Record<string, unknown> {
  const document: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!document || typeof document !== "object" || Array.isArray(document))
    throw new Error(`${path}: invalid fixture envelope`);
  return document as Record<string, unknown>;
}

function loadFixture(path: string, kind: "profile" | "scenario") {
  const document = readFixture(path);
  if (document.schema === `agent-${kind}/0.2` && document["@context"] === SCENARIO_CONTEXT) {
    delete document["@context"];
    document.schema = `agent-${kind}/0.1`;
  } else if (document.schema !== `agent-${kind}/0.1` || "@context" in document) {
    throw new Error(`${path}: invalid agent-${kind} schema or @context`);
  }
  return document;
}

export function loadProfile(path: string): DomainProfile {
  const profile = domainProfileSchema.parse(loadFixture(path, "profile"));
  validateRules(profile.rules.filter((r) => "template" in r));
  return profile;
}
export function loadScenario(path: string): Scenario {
  return scenarioSchema.parse(loadFixture(path, "scenario"));
}

function typeTrustEntries(trust: Scenario["trust"]): void {
  Object.assign(trust, { "@type": "awp:TrustStore" });
  for (const entries of Object.values(trust.ownLists))
    for (const entry of entries) Object.assign(entry, { "@type": "awp:OwnListEntry" });
  for (const rules of Object.values(trust.sources))
    for (const rule of rules)
      Object.assign(rule, {
        "@type": "awp:SourceAuthorityRule",
        subjects: rule.subjects === "any" ? "any" : { "@list": rule.subjects },
      });
  if (!trust.root) return;
  Object.assign(trust.root, { "@type": "awp:TrustRoot" });
  for (const register of trust.root.delegates) {
    Object.assign(register, { "@type": "awp:Register" });
    for (const entry of register.entries) Object.assign(entry, { "@type": "awp:RegisterEntry" });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fixtureRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function iriReference(value: unknown) {
  return typeof value === "string" && isIri(value) ? { "@id": value } : value;
}

function linkRuleInputs(rules: unknown): void {
  for (const rule of fixtureRecords(rules))
    if (Array.isArray(rule.inputsFrom)) rule.inputsFrom = rule.inputsFrom.map(iriReference);
}

function linkProfileReferences(document: Record<string, unknown>): void {
  // The same authoring fields also accept local action names and source aliases.
  for (const rule of fixtureRecords(document.actionClaims))
    if ("action" in rule) rule.action = iriReference(rule.action);
  linkRuleInputs(document.rules);
}

function linkScenarioReferences(document: Record<string, unknown>): void {
  for (const step of fixtureRecords(document.script)) {
    if ("adapter" in step) step.adapter = iriReference(step.adapter);
    if (isRecord(step.protocol)) linkRuleInputs(step.protocol.rules);
  }
  for (const grant of fixtureRecords(document.queryGrants)) {
    if (!isRecord(grant.value)) continue;
    for (const protocol of fixtureRecords(grant.value.protocol)) linkRuleInputs(protocol.rules);
  }
}

/** Read a 0.2 authoring file as RDF using only the bundled fixture contexts. */
export async function readCaseGraph(path: string) {
  try {
    const document = readFixture(path);
    const profile = document.schema === "agent-profile/0.2";
    if (
      (!profile && document.schema !== "agent-scenario/0.2") ||
      document["@context"] !== SCENARIO_CONTEXT
    )
      throw new Error("invalid fixture JSON-LD envelope");
    if (
      typeof document.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]*$/.test(document.id) ||
      "@id" in document ||
      "@type" in document
    )
      throw new Error("invalid fixture root");
    const root = `urn:${profile ? "profile" : "scenario"}:${document.id}`;
    document["@id"] = root;
    document["@type"] = profile ? "DomainProfile" : "Scenario";
    checkDocumentTerms(document, { allowJson: true, resolveContext: scenarioContext });
    if (profile) {
      linkProfileReferences(document);
    } else {
      // Check the trust shape before adding RDF types to the authored nodes.
      scenarioSchema.shape.trust.parse(document.trust);
      typeTrustEntries(document.trust as Scenario["trust"]);
      linkScenarioReferences(document);
    }
    // The streaming parser drops entries from property-indexed arrays of objects.
    // Expand with the same offline JSON-LD processor used by the message reader.
    const contextResolver = await fixtureContextResolver(document);
    const options = {
      format: "application/n-quads" as const,
      documentLoader: scenarioJsonLdLoader,
      ...(contextResolver && { contextResolver }),
    };
    const quads = await jsonld.toRDF(document as import("jsonld").NodeObject, options);
    const dataset = await parseRdf(quads as unknown as string, "application/n-quads");
    return { dataset, root };
  } catch (error) {
    throw new Error(`${path}: ${(error as Error).message}`, { cause: error });
  }
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
export function validateReferences(
  profile: DomainProfile,
  scenario: Scenario,
  options: { readonly pathWorld?: boolean } = {},
): void {
  validateRules(profile.rules.filter((r) => "template" in r));
  // Brief 32: the faulty-gate stand-in may appear only in a vendor-fault branch's change. A
  // path's world (the branch change applied) is checked by runPath instead.
  const misplaced = gateFaultPlacementProblem(
    options.pathWorld ? { ...scenario, gateFault: undefined } : scenario,
  );
  if (misplaced) throw new Error(misplaced);
  const unique = (values: readonly string[], label: string) => {
    if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`);
  };
  unique(
    scenario.configurations.map((entry) => entry.id),
    "configuration",
  );
  for (const branch of scenario.branches)
    if (branch.onlyUnder && !scenario.configurations.some((entry) => entry.id === branch.onlyUnder))
      throw new Error("branch names an unknown configuration");
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
  if (scenario.branches.some((branch) => branch.id === "main"))
    throw new Error("branch id main is reserved");
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
  if (scenario.carriage) {
    unique(scenario.carriage.parties, "carriage party");
    for (const id of scenario.carriage.parties) {
      requireParty(id);
      if (parties.get(id)?.runs !== "agent")
        throw new Error("a carriage endpoint must be an agent");
    }
  }
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
  unique(
    scenario.mandates.map((mandate) => mandate.agent),
    "mandate for agent",
  );
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
