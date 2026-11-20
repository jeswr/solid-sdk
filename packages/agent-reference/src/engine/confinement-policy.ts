// AUTHORED-BY Codex GPT-6.2 Sol
import { canonicalJson } from "../core/canonical.js";
import type { ScenarioConfiguration } from "./matrix.js";
import type { DomainProfile, Scenario } from "./schema.js";

const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);
const object = (value: unknown) => (value ?? {}) as Record<string, unknown>;
const changes = (a: unknown, b: unknown) => {
  const before = object(a),
    after = object(b);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => !same(before[key], after[key]),
  );
};
function keeps<T>(before: readonly T[], after: readonly T[]): boolean {
  let next = 0;
  for (const item of after) if (next < before.length && same(before[next], item)) next++;
  return next === before.length;
}

const statementFields: Readonly<Record<string, readonly string[]>> = {
  "registry-lookup": ["employmentStatus"],
  negotiated: ["monthly"],
  corroboration: ["incomeProvenance", "salaryCredits"],
  "stated-confidence": ["qualityMeasurement"],
  "quality-certificate": ["qualityDataset", "productCategory", "issuedAt"],
};

export function ownedReplacement(
  entry: ScenarioConfiguration,
  id: string,
  before: unknown,
  after: unknown,
): boolean {
  if (!before || !after) return false;
  const [layer, suite] = Object.entries(entry.change)[0]!;
  const fields = changes(before, after);
  if (id.startsWith("statement:")) {
    if (layer === "meaning" || layer === "reliance")
      return (
        fields.every((key) => key === "value") &&
        changes(object(before).value, object(after).value).every((key) =>
          statementFields[suite]?.includes(key),
        )
      );
    if (layer === "authenticity" && suite === "selective-disclosure")
      return (
        fields.every(
          (key) => key === "value" || key === "kind" || key === "identifier" || key === "asOf",
        ) &&
        object(before).kind === "income.gross.monthly-series" &&
        object(after).kind === "income.gross.annual"
      );
  }
  if (id.startsWith("step:") && layer === "authenticity" && suite === "selective-disclosure")
    return (
      (object(before).type === "start" && fields.every((key) => key === "models")) ||
      (object(before).type === "store-assess" && fields.every((key) => key === "items"))
    );
  return false;
}

const worldFields: Readonly<Record<string, readonly string[]>> = {
  transport: ["carriage"],
  identity: ["mailboxes", "identityNames"],
  meaning: ["mailboxes", "registryMeaning", "mappingTables", "documents", "negotiatedMeaning"],
  reliance: ["relianceCorroboration", "statedConfidence", "qualityCertificate", "documents"],
  authenticity: ["handlerImplementations", "selectiveCredentials", "originHosted"],
  trust: ["trustedIndex", "federation", "reputation"],
};

const policyClaims: Readonly<Record<string, readonly string[]>> = {
  meaning: ["code-mapping", "term.deliberation"],
  reliance: ["dataset.quality", "income.salary-credits"],
  authenticity: ["source.address"],
  trust: ["index.transparency", "agent.reputation"],
};

export function configurationPolicyDifferences(
  reference: Scenario,
  world: Scenario,
  entry: ScenarioConfiguration,
  baseline: DomainProfile,
  configured: DomainProfile,
): string[] {
  const problems: string[] = [];
  const [layer, suite] = Object.entries(entry.change)[0]!;
  const worldCommon = [
    "parties",
    "statements",
    "mandates",
    "script",
    "trust",
    "standIns",
    "branches",
  ];
  for (const key of changes(reference, world))
    if (!worldCommon.includes(key) && !worldFields[layer]?.includes(key))
      problems.push(`world.${key} is outside the ${layer} layer`);

  const baselineOperations = new Set(baseline.operations.map(({ id }) => id));
  const operations = new Set(
    configured.operations.filter(({ id }) => !baselineOperations.has(id)).map(({ id }) => id),
  );
  const baselineClaims = new Set(baseline.claims.map(({ kind }) => kind));
  const claims = new Set(
    configured.claims.filter(({ kind }) => !baselineClaims.has(kind)).map(({ kind }) => kind),
  );
  const newAgents = new Set(
    world.parties
      .filter(({ id }) => !reference.parties.some((party) => party.id === id))
      .map(({ id }) => id),
  );

  const newPurposes = new Set(
    configured.purposes
      .filter(({ id }) => !baseline.purposes.some((purpose) => purpose.id === id))
      .map(({ id }) => id),
  );
  for (const key of changes(baseline, configured)) {
    if (
      ["identity", "meaning", "usage-control", "accountability"].includes(layer) &&
      ["operations", "claims", "purposes", "labels", "vocabulary"].includes(key)
    )
      continue;
    if (key === "email" && (layer === "identity" || layer === "meaning") && !baseline.email)
      continue;
    if (
      key === "forum" &&
      layer === "accountability" &&
      (!baseline.forum ||
        changes(baseline.forum, configured.forum).every(
          (field) => field === "publication" && !baseline.forum?.publication,
        ))
    )
      continue;
    if (
      key === "readings" &&
      (layer === "meaning" || layer === "identity") &&
      keeps(baseline.readings, configured.readings) &&
      configured.readings
        .filter((value) => !baseline.readings.some((v) => same(v, value)))
        .every(
          ({ claimType }) =>
            claims.has(claimType) || (layer === "identity" && claimType === "email.reading"),
        )
    )
      continue;
    if (
      key === "actionClaims" &&
      layer === "meaning" &&
      keeps(baseline.actionClaims, configured.actionClaims) &&
      configured.actionClaims
        .filter((value) => !baseline.actionClaims.some((v) => same(v, value)))
        .every(({ action }) => operations.has(action))
    )
      continue;
    problems.push(`profile.${key} is outside the ${layer} layer`);
  }
  for (const before of baseline.operations) {
    const after = configured.operations.find(({ id }) => id === before.id);
    if (
      !same(before, after) &&
      (!after ||
        changes(before, after).some((key) => key !== "purposes") ||
        !keeps(before.purposes, after.purposes) ||
        after.purposes.some(
          (purpose) => !before.purposes.includes(purpose) && !newPurposes.has(purpose),
        ))
    )
      problems.push(`profile.operations:${before.id} rewrites an existing operation`);
  }
  for (const before of baseline.claims)
    if (
      !same(
        before,
        configured.claims.find(({ kind }) => kind === before.kind),
      )
    )
      problems.push(`profile.claims:${before.kind} rewrites an existing claim`);
  for (const before of baseline.purposes) {
    const after = configured.purposes.find(({ id }) => id === before.id);
    if (
      !same(before, after) &&
      (!after ||
        changes(before, after).some((key) => key !== "claims") ||
        !keeps(before.claims, after.claims) ||
        after.claims.some((claim) => !before.claims.includes(claim) && !claims.has(claim)))
    )
      problems.push(`profile.purposes:${before.id} rewrites an existing purpose`);
  }
  for (const key of ["labels", "vocabulary"] as const)
    for (const [id, before] of Object.entries(baseline[key]))
      if (!same(before, configured[key][id]))
        problems.push(`profile.${key}:${id} rewrites an existing entry`);
  if (
    new Set(configured.claims.map(({ kind }) => kind)).size !== configured.claims.length ||
    new Set(configured.purposes.map(({ id }) => id)).size !== configured.purposes.length
  )
    problems.push("profile contains duplicate claim or purpose IDs");

  for (const mandate of world.mandates) {
    const before = reference.mandates.find(({ agent }) => agent === mandate.agent);
    for (const field of [
      "autonomous",
      "withApproval",
      "prohibitions",
      "standingRules",
      "duties",
    ] as const) {
      const prior = before?.[field] ?? [];
      const rules = mandate[field] ?? [];
      if (!keeps(prior, rules))
        problems.push(`mandate:${mandate.agent}#${field} changes existing rules`);
      for (const rule of rules.filter((value) => !prior.some((v) => same(v, value))))
        if (
          (field !== "autonomous" && field !== "withApproval") ||
          typeof object(rule).target !== "string" ||
          !operations.has(String(object(rule).target))
        )
          problems.push(`mandate:${mandate.agent}#${field} adds a rule outside a new operation`);
    }
    if (!same(before?.limits, mandate.limits))
      problems.push(`mandate:${mandate.agent}#limits changes its limits`);
  }

  const old = reference.trust,
    current = world.trust;
  const pinned = layer === "trust" && suite === "pinned-list";
  for (const key of ["introductions", "pins"] as const)
    if (
      !keeps(old[key], current[key]) ||
      current[key].some(
        (pair) =>
          !old[key].some((existing) => same(pair, existing)) &&
          !pair.some((party) => newAgents.has(party)),
      )
    )
      problems.push(`trust.${key} changes a baseline binding`);

  for (const agent of new Set([...Object.keys(old.ownLists), ...Object.keys(current.ownLists)])) {
    const before = old.ownLists[agent] ?? [],
      after = current.ownLists[agent] ?? [];
    const preserved = before.map((rule) => {
      const found = after.find(({ party }) => party === rule.party);
      if (
        !found ||
        found.block !== rule.block ||
        found.note !== rule.note ||
        !same(found.purposes, rule.purposes) ||
        !keeps(rule.tasks, found.tasks) ||
        found.tasks.some((task) => !rule.tasks.includes(task) && !operations.has(task)) ||
        (found.expiresAt !== rule.expiresAt &&
          !(pinned && !!found.expiresAt && (!rule.expiresAt || found.expiresAt <= rule.expiresAt)))
      )
        return rule;
      return found;
    });
    if (
      !keeps(preserved, after) ||
      new Set(after.map(({ party }) => party)).size !== after.length ||
      after.some(
        (rule) =>
          !before.some(({ party }) => party === rule.party) &&
          (rule.block ||
            !rule.tasks.length ||
            rule.tasks.some(
              (task) =>
                !operations.has(task) &&
                !(
                  pinned &&
                  rule.expiresAt &&
                  old.root?.delegates.some((register) =>
                    register.entries.some(
                      (registered) =>
                        registered.status === "authorized" &&
                        registered.party === rule.party &&
                        registered.authorizedFor.includes(task),
                    ),
                  )
                ),
            )),
      )
    )
      problems.push(`trust.ownLists:${agent} changes baseline recipient policy`);
  }
  for (const agent of new Set([...Object.keys(old.sources), ...Object.keys(current.sources)])) {
    const before = old.sources[agent] ?? [],
      after = current.sources[agent] ?? [];
    const preserved = before.map((rule) => {
      const found = after.find(({ id }) => id === rule.id);
      if (
        pinned &&
        found?.validUntil &&
        (!rule.validUntil || found.validUntil <= rule.validUntil) &&
        changes(rule, found).every((key) => key === "validUntil")
      )
        return found;
      return rule;
    });
    if (
      !keeps(preserved, after) ||
      new Set(after.map(({ id }) => id)).size !== after.length ||
      after.some(
        (rule) =>
          !before.some(({ id }) => id === rule.id) &&
          !(
            pinned &&
            !!rule.validUntil &&
            old.root?.delegates.some((register) =>
              register.entries.some(
                (entry) =>
                  entry.status === "authorized" &&
                  entry.party === rule.source &&
                  rule.claimTypes.every((claim) => entry.claimTypes?.includes(claim)),
              ),
            )
          ) &&
          !(
            rule.claimTypes.length &&
            rule.claimTypes.every(
              (kind) =>
                !kind.includes("*") &&
                (newAgents.has(agent) || claims.has(kind) || policyClaims[layer]?.includes(kind)),
            )
          ),
      )
    )
      problems.push(`trust.sources:${agent} changes baseline source policy`);
  }
  for (const key of changes(old, current)) {
    if (["introductions", "pins", "ownLists", "sources"].includes(key)) continue;
    if (
      key === "controllers" &&
      layer === "reliance" &&
      Object.entries(old.controllers ?? {}).every(
        ([id, value]) => current.controllers?.[id] === value,
      )
    )
      continue;
    if (
      key === "answeredRegisters" &&
      layer === "identity" &&
      suite === "anonymous" &&
      Object.entries(old.answeredRegisters ?? {}).every(([id, value]) =>
        keeps(value, current.answeredRegisters?.[id] ?? []),
      ) &&
      Object.entries(current.answeredRegisters ?? {}).every(([id, values]) =>
        values
          .filter((value) => !old.answeredRegisters?.[id]?.includes(value))
          .every(
            (value) =>
              world.parties.some(
                (party) =>
                  newAgents.has(party.id) &&
                  party.runs === "agent" &&
                  world.parties.some(
                    (owner) => owner.id === party.actsFor && owner.identity === value,
                  ),
              ) &&
              current.sources[id]?.some(
                (rule) => rule.source === value && rule.claimTypes.includes("register.entry"),
              ),
          ),
      )
    )
      continue;
    if (
      key === "root" &&
      layer === "authority" &&
      old.root &&
      current.root &&
      changes(old.root, current.root).every((field) => field === "delegates") &&
      keeps(old.root.delegates, current.root.delegates) &&
      current.root.delegates
        .filter((value) => !old.root?.delegates.some((v) => same(v, value)))
        .every((register) =>
          register.entries.every(
            (rule) =>
              !rule.authorizedFor.length &&
              rule.claimTypes?.length &&
              rule.claimTypes.every((kind) => kind.startsWith("authority.")),
          ),
        )
    )
      continue;
    problems.push(`trust.${key} is outside the ${layer} layer`);
  }
  return problems;
}
