// AUTHORED-BY Claude Opus 5.5
// Plain-English rendering of ODRL rules and mandates. The sentences are generated from the
// same policy objects the gate evaluates, so what people read is what is enforced.
import { AGENT, type Constraint, type Limit, type Mandate, type Rule } from "@jeswr/agent-mandate";
import type { OdrlDuty, OdrlPolicy } from "@jeswr/solid-odrl";
import { type Directory, joinNames, nameOf } from "./directory.js";

const ODRL = "http://www.w3.org/ns/odrl/2/";

const ACTION_WORDS: Readonly<Record<string, string>> = {
  use: "use",
  read: "read",
  write: "write to",
  modify: "change",
  delete: "delete",
  distribute: "share or send on",
  transfer: "hand over",
  aggregate: "combine",
  anonymize: "anonymise",
  archive: "archive",
  attribute: "credit the source of",
  compensate: "pay for",
  inform: "inform the owner of",
  index: "index",
  append: "add to",
  control: "control",
  grantUse: "pass on rights to",
  nextPolicy: "pass on the rules with",
  [`${AGENT}SendMessage`]: "send messages with",
  [`${AGENT}Transfer`]: "move money with",
  [`${AGENT}Sign`]: "sign agreements with",
  [`${AGENT}BookAppointment`]: "book appointments with",
};

/** The verb phrase for an action IRI or short name. */
export function actionWords(action: string): string {
  const short = action.startsWith(ODRL) ? action.slice(ODRL.length) : action;
  const known = (key: string) => (Object.hasOwn(ACTION_WORDS, key) ? ACTION_WORDS[key] : undefined);
  return known(short) ?? known(action) ?? nameOf({ names: {}, groups: {} }, action);
}

function values(c: Constraint): string[] {
  return (Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand]).map(String);
}

/** A list of parties, collapsed to a group name when it is exactly a known group. */
function parties(directory: Directory, list: readonly string[]): string {
  for (const [group, members] of Object.entries(directory.groups)) {
    if (members.length === list.length && members.every((m) => list.includes(m)))
      return nameOf(directory, group);
  }
  return joinNames(list.map((p) => nameOf(directory, p)));
}

/** Render one constraint as a phrase ("for customer care", "only to colleagues"). */
export function constraintWords(c: Constraint, directory: Directory): string {
  const vs = values(c);
  const names = vs.map((v) => nameOf(directory, v));
  const op = c.operator;
  switch (c.leftOperand) {
    case "purpose":
      if (op === "neq" || op === "isNoneOf") return `except for ${joinNames(names)}`;
      return `for ${joinNames(names)}`;
    case "recipient":
      if (op === "isPartOf") return `to ${joinNames(names)}`;
      if (op === "neq" || op === "isNoneOf")
        return `to anyone other than ${parties(directory, vs)}`;
      return `to ${parties(directory, vs)}`;
    case "spatial":
      if (op === "neq" || op === "isNoneOf") return `outside ${joinNames(names)}`;
      return `within ${joinNames(names)}`;
    case "dateTime":
      return op === "lt" || op === "lteq" ? `until ${vs[0]}` : `from ${vs[0]}`;
    case "count":
      return `at most ${vs[0]} times`;
    default: {
      const subject = nameOf(directory, c.leftOperand);
      return `when ${subject} ${op} ${joinNames(names)}`;
    }
  }
}

/** Render a rule as a sentence fragment after "may" / "may never". */
export function ruleWords(rule: Rule, directory: Directory): string {
  const target = rule.target ? ` ${nameOf(directory, rule.target)}` : "";
  const constraints = (rule.constraints ?? [])
    .map((c) => ` ${constraintWords(c, directory)}`)
    .join("");
  const duties = (rule.duties ?? [])
    .map((d) => ` and must then ${dutyWords(d, directory)}`)
    .join("");
  // Without a target, "sign agreements with" reads as "sign agreements".
  const verb = rule.target
    ? actionWords(rule.action)
    : actionWords(rule.action).replace(/ with$/, "");
  return `${verb}${target}${constraints}${duties}`;
}

/** Render a duty ("inform the owner of the record"). */
export function dutyWords(duty: OdrlDuty, directory: Directory): string {
  const target = duty.target ? ` ${nameOf(directory, duty.target)}` : " it";
  const constraints = (duty.constraints ?? [])
    .map((c) => ` ${constraintWords(c as Constraint, directory)}`)
    .join("");
  return `${actionWords(duty.action)}${target}${constraints}`;
}

/** Render a limit ("send at most 5 messages a day; then it stops"). */
export function limitWords(limit: Limit, currency: string): string {
  const operand = limit.leftOperand.startsWith(AGENT)
    ? limit.leftOperand.slice(AGENT.length)
    : limit.leftOperand;
  const after = limit.enforcement === "hard" ? "then it stops" : "then it asks a person";
  const money = (n: number) => `${currency === "GBP" ? "£" : `${currency} `}${n}`;
  switch (operand) {
    case "sendsPerDay":
      return `Send at most ${limit.rightOperand} messages a day; ${after}.`;
    case "perRecipientPerDay":
      return `Contact any one person at most ${limit.rightOperand} ${limit.rightOperand === 1 ? "time" : "times"} in 24 hours; ${after}.`;
    case "spendPerDay":
      return `Commit at most ${money(limit.rightOperand)} a day; ${after}.`;
    case "spendPerWeek":
      return `Commit at most ${money(limit.rightOperand)} a week; ${after}.`;
    case "spendPerMonth":
      return `Commit at most ${money(limit.rightOperand)} a month; ${after}.`;
    default:
      return `Limit ${operand} at most ${limit.rightOperand}; ${after}.`;
  }
}

/** A mandate in plain English, grouped the way the UI shows it. */
export interface MandateText {
  readonly onItsOwn: readonly string[];
  readonly withApproval: readonly string[];
  readonly never: readonly string[];
  readonly limits: readonly string[];
}

/** Render a mandate. */
export function describeMandate(
  mandate: Mandate,
  directory: Directory,
  currency = "GBP",
): MandateText {
  const sentence = (prefix: string) => (r: Rule) => `${prefix} ${ruleWords(r, directory)}.`;
  return {
    onItsOwn: (mandate.autonomous.permissions ?? []).map(sentence("May")),
    withApproval: (mandate.withApproval.permissions ?? []).map(
      sentence("May, with a person's approval,"),
    ),
    never: mandate.prohibitions.map(sentence("May never")),
    limits: mandate.limits.map((l) => limitWords(l, currency)),
  };
}

/** A data policy in plain English: what the owner allows and forbids. */
export function describePolicy(policy: OdrlPolicy, directory: Directory): readonly string[] {
  const who = (party: string | undefined, fallback: string) =>
    party === undefined ? fallback : nameOf(directory, party).replace(/^./, (c) => c.toUpperCase());
  return [
    ...(policy.permissions ?? []).map(
      (r) =>
        `${who(r.assignee ?? policy.assignee, "Anyone")} may ${ruleWords(r as Rule, directory)}.`,
    ),
    ...(policy.prohibitions ?? []).map(
      (r) =>
        `${who(r.assignee ?? policy.assignee, "Nobody")} may${(r.assignee ?? policy.assignee) ? " never" : ""} ${ruleWords(r as Rule, directory)}.`,
    ),
    ...(policy.obligations ?? []).map((d) => `Whoever holds it must ${dutyWords(d, directory)}.`),
  ];
}
