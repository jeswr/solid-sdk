// AUTHORED-BY Codex GPT-6.2 Sol
import type { DomainProfile, Scenario } from "./schema.js";

/** Apply a preflighted alias map to identity-bearing fields in a materialized path. */
export function applyIdentityNames(profile: DomainProfile, world: Scenario): void {
  const names = world.identityNames;
  const identity = (value: string): string =>
    Object.hasOwn(names, value) ? (names[value] ?? value) : value;
  const object = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const fields = (value: unknown, ...keys: string[]) => {
    const data = object(value);
    if (!data) return;
    for (const key of keys) if (typeof data[key] === "string") data[key] = identity(data[key]);
  };
  const rekey = <T>(map: Record<string, T>): Record<string, T> => {
    const result = new Map<string, T>();
    for (const [source, value] of Object.entries(map)) {
      const target = identity(source);
      if (result.has(target)) throw Error(`identityNames:${source} collides in a policy map`);
      result.set(target, value);
    }
    return Object.fromEntries(result);
  };
  const policyRule = (value: unknown) => {
    const rule = object(value);
    if (!rule) return;
    fields(rule, "assigner", "assignee");
    if (!Array.isArray(rule.constraints)) return;
    for (const value of rule.constraints) {
      const constraint = object(value);
      if (constraint?.leftOperand !== "recipient") continue;
      fields(constraint, "rightOperand");
      if (Array.isArray(constraint.rightOperand))
        constraint.rightOperand = constraint.rightOperand.map((operand: unknown) =>
          typeof operand === "string" ? identity(operand) : operand,
        );
    }
  };
  const terms = (value: unknown) => {
    const attached = object(value);
    const policy = object(attached?.policy);
    fields(policy, "assigner", "assignee");
    for (const rules of [policy?.permissions, policy?.prohibitions, policy?.obligations])
      if (Array.isArray(rules)) rules.forEach(policyRule);
    if (Array.isArray(attached?.inherited))
      for (const item of attached.inherited) terms(object(item)?.terms);
  };
  const action = (value: unknown) => {
    const intent = object(value);
    fields(intent, "recipient");
    if (intent?.action === "pay") fields(intent.parameters, "payee");
  };

  for (const party of world.parties) fields(party, "identity", "actor", "operator");
  for (const list of Object.values(world.trust.ownLists))
    for (const entry of list) entry.party = identity(entry.party);
  for (const rules of Object.values(world.trust.sources))
    for (const rule of rules) {
      rule.source = identity(rule.source);
      if (rule.subjects !== "any") rule.subjects = rule.subjects.map(identity);
    }
  for (const register of world.trust.root?.delegates ?? []) {
    register.id = identity(register.id);
    for (const entry of register.entries) entry.party = identity(entry.party);
  }
  if (world.trust.answeredRegisters)
    for (const [agent, registers] of Object.entries(world.trust.answeredRegisters))
      world.trust.answeredRegisters[agent] = registers.map(identity);
  world.trust.controllers = rekey(world.trust.controllers);
  for (const source of Object.keys(world.trust.controllers))
    fields(world.trust.controllers, source);
  for (const statement of world.statements) {
    fields(statement, "subject");
    terms(statement.terms);
    if (statement.kind === "payee-account") fields(statement.value, "payee");
    if (statement.kind === "valuer.registration") fields(statement.value, "agent");
  }
  for (const { accounts } of world.paymentProviders)
    for (const account of accounts) fields(account, "party");
  for (const store of world.stores) {
    fields(store, "organization");
    for (const role of store.roles) fields(role, "agent");
  }
  for (const handler of Object.values(world.handlerImplementations))
    if (handler.template === "mortgage-lender") fields(handler.params, "lender");
  for (const mandate of world.mandates)
    for (const rule of [...mandate.autonomous, ...mandate.withApproval, ...mandate.prohibitions])
      policyRule(rule);
  action(world.mandateStatusFault?.attempt);
  for (const step of world.script) {
    if ("subject" in step) fields(step, "subject");
    if ("intent" in step) action(step.intent);
    switch (step.type) {
      case "start":
        fields(step.contents, "applicant");
        fields(step.contents.compensation, "payee");
        break;
      case "effect":
        if (step.intent.action === "pay") fields(step.params, "payee");
        break;
      case "receive":
        action(step.reply?.intent);
        fields(step.reply?.output, "valuer");
        break;
      case "receipt":
        fields(step.observed?.decided, "by");
        break;
      case "issue":
        fields(step.value, "issuer", "subject");
        fields(step.value.approves, "actor");
        terms(step.value.terms);
        break;
      case "prove":
      case "offgate-copy":
        fields(step, "recipient");
        break;
      case "forum-claim":
        if (step.persons) step.persons = step.persons.map(identity);
        break;
    }
  }

  for (const claim of profile.claims) {
    claim.sources = claim.sources.map(identity);
    if (claim.precedence) claim.precedence.sources = claim.precedence.sources.map(identity);
  }
  for (const rule of profile.rules)
    if ("inputsFrom" in rule) rule.inputsFrom = rule.inputsFrom.map(identity);
  for (const source of Object.keys(profile.sources)) fields(profile.sources, source);
  for (const deriver of profile.attestedDerivers) fields(deriver, "deriver");
  if (profile.forum) profile.forum.observers = profile.forum.observers.map(identity);
  for (const recipient of Object.values(profile.notificationRecipients))
    fields(recipient, "actor", "party");
  fields(profile.organizations, "registrar");
  profile.labels = rekey(profile.labels);
  profile.termsAcceptance = rekey(profile.termsAcceptance);
}
