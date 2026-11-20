// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
import { bitstringStatusListEntry } from "@jeswr/solid-vc";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { createPrivateKey, createPublicKey, sign } from "crypto";
import { DataFactory, type Store } from "n3";
import { digestBytes, digestOf, isIri, scopedUrn } from "../core/canonical.js";
import { mandateSchema } from "../mechanisms/mandate.js";
import { TYP } from "../mechanisms/statements.js";
import { attachmentGraph, attachmentGraphs, materializeAttachments } from "../model/attachments.js";
import { NamedValuesNode, SCHEMA, scopedId } from "../model/named-values.js";
import { AWP } from "../profile/vocabulary.js";
import { mandateOf } from "../scenarios/common.js";
import type { TraceObservation, VerifiedStatement } from "../trace/recorder.js";
import type { TraceEvent, TraceFile } from "../trace/types.js";
import { assertUniqueKeys } from "../wire/document.js";
import { inspectEvidenceJws } from "../wire/evidence-jws.js";
import { decodeAdapterJson } from "../wire/inspect.js";
import {
  cachedMessageProjection,
  documentConfiguration,
  isMessagePacket,
} from "../wire/message-packet.js";
import {
  explainedValues,
  maskJsonStrings,
  type RefusedContent,
  type RefusedStatement,
  refusedContent,
} from "./refused-values.js";
import type { Scenario } from "./schema.js";

export function decisionsOf(events: readonly TraceEvent[]) {
  return events
    .filter((e) => e.kind === "decision" && e.outcome)
    .map((e) => ({
      ...e,
      check:
        e.check ??
        (e.reason === undefined
          ? undefined
          : events.findLast(
              (c) =>
                c.seq < e.seq && c.kind === "check" && c.reason === e.reason && sameGateRun(c, e),
            )?.check),
    }));
}

const goes = (outcome: string | undefined) => outcome === "go" || outcome === "admit";
const passing = ({ outcome }: { outcome?: string }) => goes(outcome) || outcome === "pass";
const superseded = "superseded-by-better-source";

export function comparisonOutcome(outcome: string | undefined) {
  if (outcome === "refuse") return "stop";
  if (outcome === "admit") return "go";
  return outcome;
}

/** Ordered, consuming matching: one main event cannot match two branch events. */
function* orderedMatches<T>(
  main: readonly T[],
  branch: readonly T[],
  equal: (candidate: T, event: T) => boolean,
) {
  let next = 0;
  for (const event of branch) {
    const match = main.findIndex((candidate, index) => index >= next && equal(candidate, event));
    if (match >= 0) next = match + 1;
    yield [event, main[match]] as const;
  }
}

const sameCheck = (a: TraceEvent, b: TraceEvent) =>
  a.agent === b.agent && a.part === b.part && a.check === b.check && a.reason === b.reason;

const sameDecision = (a: TraceEvent, b: TraceEvent) => sameCheck(a, b) && a.outcome === b.outcome;

const decisionMatches = (main: readonly TraceEvent[], branch: readonly TraceEvent[]) =>
  orderedMatches(main, branch, sameDecision);

const sameGateRun = (a: TraceEvent, b: TraceEvent) =>
  a.gateRun !== undefined && a.gateRun === b.gateRun && a.agent === b.agent && a.part === b.part;

interface StepDescriptor {
  readonly type: string;
  readonly action?: string;
  readonly operation?: string;
  readonly target?: string;
  readonly recipient?: string;
  readonly messageKind?: string;
  readonly items: readonly string[];
  readonly decision?: string;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const string = (value: unknown) => (typeof value === "string" ? value : undefined);

/** The descriptor uses only scenario identifiers. Never resolve run-generated references. */
export function describeStep(
  step: Scenario["script"][number],
  statementId: (id: string) => string = (id) => id,
): StepDescriptor {
  const data: Record<string, unknown> = step;
  const reply = object(data.reply);
  const intent = object(data.intent ?? reply?.intent);
  const parameters = object(intent?.parameters);
  const params = object(data.params);
  const body = object(data.body);
  const input = object(body?.input);
  const output = object(body?.output ?? reply?.output);
  const items = new Set<string>();
  for (const list of [
    data.items,
    data.evidence,
    data.statements,
    object(data.contents)?.items,
    input?.items,
    output?.items,
    reply?.evidence,
    intent?.evidence,
    ...[parameters, params].flatMap((source) => [
      source?.items,
      source?.evidence,
      source?.support,
      [source?.reading],
    ]),
  ]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const entry = object(item);
      const reference = string(entry?.$ref);
      const declaration = reference?.match(/^statements\.([^.]+)\.(?:evidence|statement\.id)$/);
      const stepItem = reference?.match(/^steps\.[^.]+\.(?:readings\.\d+\.)?statement\.id$/);
      const id = string(item) ?? string(entry?.itemId) ?? declaration?.[1] ?? stepItem?.[0];
      if (id && !id.startsWith("sha-256:")) items.add(statementId(id));
    }
  }
  return {
    type: step.type,
    action: string(intent?.action ?? data.action),
    operation: string(intent?.operation ?? data.operation ?? object(body?.operation)?.id),
    target: string(intent?.target),
    recipient: string(intent?.recipient ?? data.recipient ?? data.peer),
    messageKind: string(data.kind ?? reply?.type),
    items: [...items].sort(),
    decision: step.type === "effect" ? string(params?.decision) : undefined,
  };
}

export interface ComparisonStep {
  readonly id: string;
  readonly descriptor: StepDescriptor;
}

export type { RefusedStatement } from "./refused-values.js";

export interface ComparisonRun {
  readonly events: readonly TraceEvent[];
  readonly trace?: TraceFile;
  /** Keyed by event sequence because multiple script steps can share a trace step number. */
  readonly steps?: ReadonlyMap<number, ComparisonStep>;
  readonly scriptIds?: ReadonlySet<string>;
  readonly effectReleases?: ReadonlySet<number>;
  readonly effectSupport?: ReadonlyMap<number, readonly string[]>;
  /** Statement identity and content by the sequence of its standalone inbound refusal. */
  readonly standaloneRefusals?: ReadonlyMap<number, RefusedStatement>;
  readonly admissions?: ReadonlyMap<
    number,
    Extract<TraceObservation, { kind: "admitted-statements" }>
  >;
  readonly payloads?: ReadonlyMap<number, unknown>;
  readonly releaseSupport?: ReadonlyMap<number, readonly string[]>;
  readonly approvedAsks?: ReadonlySet<number>;
}

interface DecisionWitness {
  readonly outcome: string;
  readonly check: string;
  readonly reason: string;
}

function sameScriptStep(run: ComparisonRun, a: TraceEvent, b: TraceEvent): boolean {
  if (!run.steps) return a.step === b.step;
  const step = run.steps.get(a.seq);
  return step !== undefined && step.id === run.steps.get(b.seq)?.id;
}

function inMessageRun(run: ComparisonRun, check: TraceEvent): boolean {
  return run.events.some(
    (event) =>
      event.seq < check.seq &&
      event.kind === "message-in" &&
      event.agent === check.agent &&
      event.gateRun === check.gateRun &&
      sameScriptStep(run, event, check),
  );
}

function witnessCheck(run: ComparisonRun, decision: TraceEvent, witness: DecisionWitness) {
  return run.events.some(
    (check) =>
      check.seq < decision.seq &&
      check.kind === "check" &&
      check.check === witness.check &&
      check.reason === witness.reason &&
      sameGateRun(check, decision) &&
      // Standalone precedence is emitted after admission and carries the next run number.
      (check.reason !== superseded ||
        (sameScriptStep(run, check, decision) && inMessageRun(run, check))) &&
      (!goes(witness.outcome) || check.verdict === "pass"),
  );
}

function laterRelease(run: ComparisonRun, admission: TraceEvent) {
  return run.events.some(
    (release) =>
      release.seq > admission.seq &&
      release.agent === admission.agent &&
      release.part === "outbound-gate" &&
      release.kind === "decision" &&
      release.outcome === "go" &&
      (run.effectReleases?.has(release.seq) ||
        (release.messageId !== undefined &&
          release.gateRun !== undefined &&
          run.events.some(
            (out) =>
              out.seq > release.seq &&
              out.agent === release.agent &&
              out.kind === "message-out" &&
              out.messageId === release.messageId &&
              out.gateRun === release.gateRun,
          ))),
  );
}

export function witnessedDecision(
  run: ComparisonRun,
  witness: DecisionWitness,
  agent?: string,
): TraceEvent | undefined {
  return run.events.find(
    (decision) =>
      decision.kind === "decision" &&
      (!agent || decision.agent === agent) &&
      comparisonOutcome(decision.outcome) === comparisonOutcome(witness.outcome) &&
      witnessCheck(run, decision, witness) &&
      (witness.outcome !== "go" ||
        decision.outcome !== "admit" ||
        (decision.part === "inbound-gate" && laterRelease(run, decision))),
  );
}

function boundReleaseDecision(run: ComparisonRun, witness: DecisionWitness, agent?: string) {
  const { events } = run;
  const direct = events.find(
    (decision) =>
      decision.kind === "decision" &&
      decision.outcome === witness.outcome &&
      (!agent || decision.agent === agent) &&
      witnessCheck(run, decision, witness),
  );
  if (direct || witness.outcome !== "go") return direct;

  // A completed effect can witness a prior inbound check by using the item that gate admitted.
  return events.find((release) => {
    if (
      release.kind !== "decision" ||
      release.outcome !== "go" ||
      !run.effectReleases?.has(release.seq) ||
      (agent && release.agent !== agent)
    )
      return false;
    const support = run.effectSupport?.get(release.seq);
    if (!support?.length) return false;
    return events.some((store) => {
      if (
        store.seq >= release.seq ||
        store.agent !== release.agent ||
        store.kind !== "store" ||
        !store.fact ||
        !support.includes(store.fact.id)
      )
        return false;
      const step = run.steps?.get(store.seq);
      const admission = events.findLast(
        (event) =>
          event.seq < store.seq &&
          event.agent === store.agent &&
          event.part === "inbound-gate" &&
          event.kind === "decision",
      );
      return (
        admission?.outcome === "admit" &&
        admission.gateRun !== undefined &&
        !!step &&
        step.id === run.steps?.get(admission.seq)?.id &&
        witnessCheck(run, admission, witness)
      );
    });
  });
}

function witnessedRelease(
  main: ComparisonRun,
  branch: ComparisonRun,
  witness: DecisionWitness | undefined,
  judgedAgent: string | undefined,
) {
  if (!witness || !goes(witness.outcome)) return undefined;
  const decision = boundReleaseDecision(branch, witness, judgedAgent);
  if (!decision) return undefined;
  // A release inside the shared prefix does not witness the branch going further.
  const split = branch.events.findIndex((event, index) => {
    const before = main.events[index];
    return (
      !before ||
      !sameCheck(event, before) ||
      event.kind !== before.kind ||
      event.outcome !== before.outcome ||
      event.verdict !== before.verdict ||
      event.packet?.kind !== before.packet?.kind
    );
  });
  const released = branch.events.some((event, index) => {
    if (event.agent !== decision.agent) return false;
    const afterSplit = split >= 0 && index >= split;
    return (
      (event.seq > decision.seq && event.kind === "message-out" && afterSplit) ||
      (event.seq >= decision.seq &&
        branch.effectReleases?.has(event.seq) &&
        (afterSplit || !main.effectReleases?.has(event.seq)))
    );
  });
  return released ? decision : undefined;
}

const withheld = (e: TraceEvent) =>
  e.part === "inbound-gate" &&
  e.kind === "check" &&
  e.reason !== undefined &&
  (["fail", "indeterminate", "ask-more", "ask-principal"].includes(e.verdict ?? "") ||
    e.reason === superseded);

function admittedStatementChecks(run: ComparisonRun, judgedAgent: string | undefined) {
  const admissions = run.events.filter(
    (event) =>
      event.part === "inbound-gate" &&
      event.kind === "decision" &&
      event.outcome === "admit" &&
      event.gateRun !== undefined &&
      (!judgedAgent || event.agent === judgedAgent),
  );
  return run.events.flatMap((check) => {
    const gateRun = check.gateRun;
    if (!withheld(check) || gateRun === undefined) return [];
    // Standalone admissions record precedence after the last individual admission.
    const admission =
      check.reason === superseded && !inMessageRun(run, check)
        ? admissions.findLast(
            (event) =>
              event.seq < check.seq &&
              event.agent === check.agent &&
              event.gateRun === gateRun - 1 &&
              sameScriptStep(run, event, check),
          )
        : admissions.find(
            (event) =>
              event.seq > check.seq &&
              sameGateRun(check, event) &&
              (check.reason !== superseded || sameScriptStep(run, event, check)),
          );
    return admission ? [{ check, admission }] : [];
  });
}

function firstStatementDifference(main: ComparisonRun, branch: ComparisonRun, agent?: string) {
  const matches = orderedMatches(
    admittedStatementChecks(main, agent),
    admittedStatementChecks(branch, agent),
    (a, b) => sameCheck(a.check, b.check) && a.check.verdict === b.check.verdict,
  );
  for (const [{ check, admission }, match] of matches) {
    if (!match)
      return { ...check, seq: Math.max(check.seq, admission.seq), outcome: "admit" as const };
  }
  return undefined;
}

function matchesMessageRelease(release: TraceEvent | undefined, send: TraceEvent): boolean {
  return (
    !!release &&
    release.seq < send.seq &&
    release.messageId === send.messageId &&
    !!release.messageDigest &&
    release.messageDigest === send.packet?.layers.header.digest &&
    release.actionDigest === send.actionDigest
  );
}

const intentFormat = "awp-action-intent/0.1";
const actionSlots = ["action", "recipient"] as const;
type ActionSlot = (typeof actionSlots)[number];
type ActionSlots = Partial<Record<ActionSlot, string>>;

function boundMessage(run: ComparisonRun, go: TraceEvent, send: TraceEvent) {
  if (go.effectRelease || !matchesMessageRelease(go, send)) return undefined;
  const observed = object(run.payloads?.get(send.seq));
  const wire = observed?.wire;
  try {
    const compact = object(wire);
    const native = isMessagePacket(wire) ? cachedMessageProjection(wire) : undefined;
    const jws = compact?.format === "awp-jws-compact/0.1" ? string(compact.jws) : undefined;
    const message = native ? object(native.node.live) : jws && inspectEvidenceJws(jws).payload;
    if (!message || message.id !== go.messageId || digestOf(message) !== go.messageDigest)
      return undefined;
    if (jws && digestOf(observed?.message) !== go.messageDigest) return undefined;
    return {
      message,
      native,
      jws,
      signed: !!jws || (isMessagePacket(wire) && documentConfiguration(wire).signed),
    };
  } catch {
    return undefined;
  }
}

type BoundMessage = NonNullable<ReturnType<typeof boundMessage>>;

function boundActionEnvelope(bound: BoundMessage, go: TraceEvent) {
  const { message } = bound;
  if (!bound.signed || !go.actionScope || !go.actionDigest || !Array.isArray(message.evidence))
    return undefined;
  try {
    const indexes = message.evidence.flatMap((item, index) =>
      object(item)?.format === intentFormat ? [index] : [],
    );
    const index = indexes[0];
    if (indexes.length !== 1 || index === undefined) return undefined;
    const entry = object(message.evidence[index]);
    const bytes = string(entry?.value);
    if (entry?.role !== "authorisation" || !bytes || digestBytes(bytes) !== go.actionDigest)
      return undefined;
    // A parsed digest alone would accept an overwritten action or recipient member.
    assertUniqueKeys(bytes);
    const intent = object(decodeAdapterJson(bytes));
    if (
      !intent ||
      intent.operation !== go.actionScope.operation ||
      intent.target !== go.actionScope.target
    )
      return undefined;
    return { ...bound, intent, bytes, index };
  } catch {
    return undefined;
  }
}

type BoundActionEnvelope = NonNullable<ReturnType<typeof boundActionEnvelope>>;

function signingAgents(scenario: Scenario | undefined, traceId: string) {
  return (
    scenario?.parties.filter(
      (party) => party.runs === "agent" && (party.traceId ?? party.id) === traceId,
    ) ?? []
  );
}

// The scripted runner provisions fixed Ed25519 keys. Rebuild the exact initial credential
// here so the synchronous comparator can compare wire digests without using inbound bytes.
function syntheticKey(agent: string, role: "owner" | "actor") {
  const seed = digestBytes(`agent-reference test key: engine/${agent}/${role}`).slice(8);
  const key = createPrivateKey({
    key: Buffer.from(`302e020100300506032b657004220420${seed}`, "hex"),
    format: "der",
    type: "pkcs8",
  });
  const { crv, kty, x } = createPublicKey(key).export({ format: "jwk" });
  const kid = Buffer.from(digestOf({ crv, kty, x }).slice(8), "hex").toString("base64url");
  return { key, kid };
}

function provisionedMandateDigest(
  scenario: Scenario,
  agent: Scenario["parties"][number],
  owner: string,
  configuration?: string,
) {
  const mandate = scenario.mandates.find((entry) => entry.agent === agent.id);
  if (!mandate || !agent.actor) return undefined;
  const keyAgent =
    scenario.parties.find(
      (party) =>
        party.runs === "agent" &&
        scenario.parties.find((principal) => principal.id === party.actsFor)?.identity === owner,
    )?.id ?? agent.id;
  const { key, kid } = syntheticKey(keyAgent, "owner");
  const issuedAt = Date.parse("2026-11-13T09:00:00.000Z");
  const base = mandateOf(
    scenario.id,
    mandate.autonomous as unknown as Parameters<typeof mandateOf>[1],
    mandate.withApproval as unknown as Parameters<typeof mandateOf>[2],
    mandate.prohibitions as unknown as Parameters<typeof mandateOf>[3],
    mandate.standingRules as unknown as Parameters<typeof mandateOf>[4],
    mandate.duties ?? [],
  )({
    owner,
    actor: agent.actor,
    validFrom: new Date(issuedAt - 60_000).toISOString(),
    validUntil: new Date(issuedAt + 60 * 86_400_000).toISOString(),
  });
  const payload =
    configuration === "authority-mandate-credential" && agent.id === "sam-agent"
      ? {
          ...mandateSchema.parse(base),
          actorKid: syntheticKey(agent.id, "actor").kid,
          credentialStatus: (["suspension", "revocation"] as const).map((statusPurpose) =>
            bitstringStatusListEntry({
              statusPurpose,
              statusListIndex: 42,
              statusListCredential: `https://mandate-status.example/${kid}/${statusPurpose}`,
            }),
          ),
        }
      : base;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${encode({ alg: "EdDSA", kid, typ: TYP.mandate })}.${encode(payload)}`;
  return digestBytes(`${input}.${sign(null, Buffer.from(input), key).toString("base64url")}`);
}

function mandateRevoked(
  run: ComparisonRun,
  scenario: Scenario,
  agent: string,
  send: TraceEvent,
): boolean {
  if (
    run.events.some(
      (event) =>
        event.seq < send.seq &&
        event.agent === send.agent &&
        run.steps?.get(event.seq)?.descriptor.type === "revoke-mandate",
    )
  )
    return true;
  // Local revocation steps need not emit a trace event. The authored script orders them.
  const sendStep = scenario.script.findIndex(({ id }) => id === run.steps?.get(send.seq)?.id);
  const status =
    run.trace?.configuration.id === "authority-mandate-credential" &&
    agent === "sam-agent" &&
    scenario.mandateStatusFault;
  return scenario.script.some(
    (step, index) =>
      (sendStep < 0 || index <= sendStep) &&
      ((step.type === "revoke-mandate" && step.agent === agent) ||
        (status && status.purpose === "revocation" && step.id === status.at)),
  );
}

function provisionedMandateSlots(
  run: ComparisonRun,
  scenario: Scenario,
  send: TraceEvent,
  { message }: BoundMessage,
): ReadonlySet<number> {
  const slots = new Set<number>();
  if (!Array.isArray(message.evidence)) return slots;
  const from = object(message.from);
  const agent = signingAgents(scenario, send.agent).find(({ actor }) => actor === from?.actor);
  const owner = scenario.parties.find(({ id }) => id === agent?.actsFor)?.identity;
  if (
    !agent ||
    !owner ||
    from?.onBehalfOf !== owner ||
    mandateRevoked(run, scenario, agent.id, send)
  )
    return slots;
  let expected: string | undefined;
  for (const [index, item] of message.evidence.entries()) {
    const entry = object(item);
    const value = string(entry?.value);
    if (entry?.role !== "authorisation" || entry.format !== "jws-compact" || !value) continue;
    try {
      const { header, payload } = inspectEvidenceJws(value);
      if (header.typ !== TYP.mandate || payload.type !== "OwnerMandate" || payload.issuer !== owner)
        continue;
      expected ??= provisionedMandateDigest(scenario, agent, owner, run.trace?.configuration.id);
      if (digestBytes(value) === expected) slots.add(index);
    } catch {
      // An unproved credential remains visible to the ordinary refusal scan.
    }
  }
  return slots;
}

function replyRecipientEstablished(
  run: ComparisonRun,
  go: TraceEvent,
  message: Record<string, unknown>,
  recipient: string,
): boolean {
  const replyTo = string(message.inReplyTo);
  if (message.inReplyTo === undefined) return message.kind !== "accept";
  if (!replyTo) return false;
  const decision = run.events.findLast(
    (event) =>
      event.seq < go.seq &&
      event.agent === go.agent &&
      event.part === "inbound-gate" &&
      event.kind === "decision" &&
      event.outcome === "admit" &&
      event.messageId === replyTo,
  );
  if (decision?.gateRun === undefined || !decision.messageDigest) return false;
  const packet = run.events.findLast(
    (event) =>
      event.seq < decision.seq &&
      event.agent === go.agent &&
      event.kind === "message-in" &&
      event.gateRun === decision.gateRun &&
      event.messageId === replyTo &&
      event.packet?.id === replyTo &&
      event.packet.layers.header.digest === decision.messageDigest,
  )?.packet;
  if (!packet) return false;
  const from = object(object(packet.layers.header.raw)?.from);
  if (from?.onBehalfOf !== recipient) return false;
  if (message.kind !== "accept") return true;
  const body = object(message.body);
  const content = object(packet.layers.content.raw);
  const termsDigest = string((object(content?.body) ?? content)?.termsDigest);
  return (
    packet.kind === "propose" &&
    body?.proposal === replyTo &&
    !!termsDigest &&
    body.termsDigest === termsDigest
  );
}

function scenarioAcceptsRecipient(
  scenario: Scenario,
  agent: string,
  recipient: string,
  operation: string,
  createdAt: unknown,
  check: TraceEvent,
): boolean {
  const own = scenario.trust.ownLists[agent]?.find((entry) => entry.party === recipient);
  if (own?.block) return false;
  if (
    own?.tasks.includes(operation) &&
    (!own.expiresAt ||
      (typeof createdAt === "string" && Date.parse(createdAt) < Date.parse(own.expiresAt)))
  )
    return true;
  // A register rule is named by the recipient check. Match the authored entry and task.
  return (
    !!check.rule?.id &&
    (scenario.trust.root?.delegates ?? []).some(({ entries }) =>
      entries.some(
        (entry) =>
          entry.id === check.rule?.id &&
          entry.party === recipient &&
          entry.status === "authorized" &&
          entry.authorizedFor.includes(operation),
      ),
    )
  );
}

function gateEstablishedSlots(
  run: ComparisonRun,
  scenario: Scenario,
  stop: TraceEvent,
  go: TraceEvent,
  { message, intent }: BoundActionEnvelope,
  content: RefusedContent,
): ActionSlots {
  const agent = scenario.parties.find(
    (party) => party.runs === "agent" && (party.traceId ?? party.id) === go.agent,
  );
  const principal = scenario.parties.find((party) => party.id === agent?.actsFor);
  const scope = go.actionScope;
  if (!agent || !principal || !scope) return {};
  const check = (name: "mandate" | "recipient") =>
    run.events.findLast(
      (event) =>
        event.seq < go.seq &&
        sameGateRun(event, go) &&
        event.kind === "check" &&
        event.check === name,
    );
  const matchesSlot = (slot: ActionSlot) =>
    typeof scope[slot] === "string" &&
    intent[slot] === scope[slot] &&
    !content.inspect(scope[slot], { referencesOnly: true });
  const mandate = scenario.mandates.find((entry) => entry.agent === agent.id);
  const mandateCheck = check("mandate");
  const ruleId = mandateCheck?.rule?.id;
  const rule =
    ruleId &&
    [...(mandate?.autonomous ?? []), ...(mandate?.withApproval ?? [])].find(({ id }) => {
      if (typeof id !== "string") return false;
      const provisionedId = id.startsWith("#")
        ? agent.actor && scopedUrn("rule", agent.actor, id.slice(1))
        : id;
      return provisionedId === ruleId;
    });
  const slots: ActionSlots = {};
  if (
    mandateCheck?.verdict === "pass" &&
    (!mandateCheck.actionDigest || mandateCheck.actionDigest === go.actionDigest) &&
    ruleId &&
    rule &&
    matchesSlot("action") &&
    rule.action === scope.action &&
    typeof rule.target === "string" &&
    !statementReferencesRule(content.refused.statement, [ruleId, scope.action, rule.target]) &&
    !run.events.some(
      (event) =>
        event.agent === go.agent &&
        event.seq > stop.seq &&
        event.seq < go.seq &&
        run.steps?.get(event.seq)?.descriptor.type === "revoke-mandate",
    )
  )
    slots.action = scope.action;
  const recipientCheck = check("recipient");
  const recipient = scope.recipient;
  if (
    recipientCheck?.verdict === "pass" &&
    (!recipientCheck.actionDigest || recipientCheck.actionDigest === go.actionDigest) &&
    recipient &&
    recipient !== principal.identity &&
    matchesSlot("recipient") &&
    object(message.to)?.party === recipient &&
    scenarioAcceptsRecipient(
      scenario,
      agent.id,
      recipient,
      scope.operation,
      message.createdAt,
      recipientCheck,
    ) &&
    replyRecipientEstablished(run, go, message, recipient)
  )
    slots.recipient = recipient;
  return slots;
}

function statementReferencesRule(statement: unknown, identifiers: readonly string[]): boolean {
  function visit(value: unknown, reference = false): boolean {
    if (typeof value === "string")
      return (reference || isIri(value)) && identifiers.includes(value);
    if (Array.isArray(value)) return value.some((item) => visit(item, reference));
    return Object.entries(object(value) ?? {}).some(([key, child]) =>
      visit(
        child,
        reference ||
          ["id", "@id", "ref", "$ref", "reference", "references", "derivedFrom"].includes(key),
      ),
    );
  }
  return visit(statement);
}

function maskActionScope(scope: TraceEvent["actionScope"], slots?: ActionSlots) {
  if (!scope || !slots) return scope;
  return {
    ...scope,
    ...(slots.action && { action: undefined }),
    ...(slots.recipient && { recipient: undefined }),
  };
}

function maskIntent(bytes: string, slots: ActionSlots): string {
  return maskJsonStrings(bytes, ([key, ...rest], value) =>
    rest.length === 0 && (key === "action" || key === "recipient") && slots[key] === value
      ? null
      : undefined,
  );
}

function maskCompactMessage(
  jws: string,
  replacements: ReadonlyMap<number, string | null>,
  recipient?: string,
) {
  const [header, payload, signature] = jws.split(".");
  if (payload === undefined) return undefined;
  const json = Buffer.from(payload, "base64url").toString("utf8");
  const masked = maskJsonStrings(json, (path, value) => {
    if (path.length === 2 && path[0] === "to" && path[1] === "party" && value === recipient)
      return null;
    if (
      path.length === 3 &&
      path[0] === "evidence" &&
      typeof path[1] === "number" &&
      path[2] === "value"
    )
      return replacements.get(path[1]);
    return undefined;
  });
  return `${header}.${Buffer.from(masked).toString("base64url")}.${signature}`;
}

function nativeSlotMask(
  envelope: BoundActionEnvelope,
  slots: ActionSlots,
  json: string,
  bytes: string,
) {
  const node = envelope.native?.node;
  const credential = node?.evidence?.[envelope.index]?.credential;
  if (!node || !credential || credential.originalJws !== envelope.bytes) return undefined;
  const root = scopedId(credential.id, "payload");
  const named = DataFactory.namedNode;
  const defaultGraph = DataFactory.defaultGraph();
  const link = named(`${AWP}statementPayload`);
  if (!node.dataset.countQuads(named(credential.id), link, named(root), defaultGraph))
    return undefined;
  const graph = attachmentGraph(node.dataset, root);
  let entries: NamedValuesNode["entries"];
  try {
    entries = new NamedValuesNode(root, node.dataset).entries;
  } catch {
    return undefined;
  }
  const names = new Map<string, string>();
  for (const slot of actionSlots) {
    const value = slots[slot];
    if (value === undefined) continue;
    const matching = entries.filter((entry) => entry.name === slot);
    const entry = matching[0];
    if (
      matching.length === 1 &&
      entry?.domainValue.value === value &&
      (graph ?? node.dataset).countQuads(
        null,
        named(`${SCHEMA}itemListElement`),
        named(entry.id),
        null,
      ) === 1
    )
      names.set(entry.id, value);
  }
  const doc = object(decodeAdapterJson(json));
  const nodes = Array.isArray(doc?.["@included"]) ? doc["@included"].map(object) : [];
  const uniqueNodeIndex = (id: string | undefined) => {
    if (!id) return -1;
    const index = nodes.findIndex((item) => item?.id === id);
    return nodes.findLastIndex((item) => item?.id === id) === index ? index : -1;
  };
  const replacements = new Map<string, { original: string; replacement: string | null }>();
  const set = (index: number, path: string[], original: string, replacement: string | null) => {
    if (index >= 0)
      replacements.set(JSON.stringify(["@included", index, ...path]), { original, replacement });
  };
  const audience = node.to;
  if (audience && slots.recipient && object(doc?.to)?.id === audience.id)
    set(uniqueNodeIndex(audience.id), ["party"], slots.recipient, null);
  const presentation = uniqueNodeIndex(credential.id);
  set(presentation, ["envelopeBytes"], envelope.bytes, bytes);
  if (!graph) {
    for (const [id, value] of names) {
      const index = uniqueNodeIndex(id);
      const domainValue = nodes[index]?.domainValue;
      const reference = object(domainValue);
      if (typeof domainValue === "string") set(index, ["domainValue"], value, null);
      else if (reference?.id === value && Object.keys(reference).length === 1)
        set(index, ["domainValue", "id"], value, null);
    }
  }
  const maskedJson = maskJsonStrings(json, (path, value) => {
    const slot = replacements.get(JSON.stringify(path));
    return slot?.original === value ? slot.replacement : undefined;
  });
  const attached = string(object(nodes[presentation]?.envelopeBytes)?.id);
  const envelopeDigest = digestBytes(envelope.bytes);
  const attachedBytes =
    attached &&
    node.dataset.countQuads(null, null, named(attached), null) === 1 &&
    node.dataset.countQuads(
      null,
      named(`${AWP}attachmentDigest`),
      DataFactory.literal(envelopeDigest),
      null,
    ) === 1
      ? envelopeDigest
      : undefined;
  return {
    json: maskedJson,
    attachment: attachedBytes,
    masksQuad: (
      store: Store,
      subject: string,
      predicate: string,
      value: string,
      defaultGraph: boolean,
    ) =>
      store === graph &&
      defaultGraph &&
      predicate === `${SCHEMA}value` &&
      names.get(subject) === value,
  };
}

function addMandateProjection(
  native: NonNullable<BoundMessage["native"]>,
  index: number,
  bytes: string,
  subjects: Set<string>,
  intentIndex?: number,
): void {
  const node = native.node.evidence?.[index];
  const credential = node?.credential;
  if (!credential || node.role !== "authorisation" || node.statement !== bytes) return;
  const projection = credential.projectionSubjects(node.format);
  if (!projection.size) return;
  const intent =
    intentIndex === undefined ? undefined : native.node.evidence?.[intentIndex]?.credential;
  // The action intent's presentation can link to its sibling authorisation credential.
  // Further incoming links would also carry the credential through another slot.
  for (const quad of materializeAttachments(native.node.dataset)) {
    if (
      quad.object.termType === "NamedNode" &&
      projection.has(quad.object.value) &&
      !projection.has(quad.subject.value) &&
      !(
        (quad.subject.value === node.id || quad.subject.value === intent?.id) &&
        quad.object.value === credential.id &&
        quad.predicate.value === "https://www.w3.org/2018/credentials#verifiableCredential"
      )
    )
      return;
  }
  for (const subject of projection) subjects.add(subject);
}

function mandateAttachment(dataset: Store, digest: string, subjects: ReadonlySet<string>) {
  if (!subjects.size) return false;
  const refs = dataset.getSubjects(
    DataFactory.namedNode(`${AWP}attachmentDigest`),
    DataFactory.literal(digest),
    null,
  );
  return (
    refs.length > 0 &&
    refs.every((ref) => {
      const links = dataset.getQuads(null, null, ref, null);
      return links.length > 0 && links.every((quad) => subjects.has(quad.subject.value));
    })
  );
}

function packetCopies(
  content: RefusedContent,
  event: TraceEvent,
  payload: unknown,
  cited: readonly VerifiedStatement[],
  admitted: readonly VerifiedStatement[],
  established?: { envelope: BoundActionEnvelope; slots: ActionSlots },
  mandateProof?: { indexes: ReadonlySet<number>; bound: BoundMessage; intentIndex?: number },
): boolean {
  const matchValue = explainedValues(content, cited);
  const observed = object(payload);
  const wire = observed?.wire;
  const native = isMessagePacket(wire) ? wire : undefined;
  const materialized = native && cachedMessageProjection(native);
  const message = object(materialized?.node.live ?? observed?.message);
  if (!message || wire === undefined)
    return (
      content.inspect(event.packet, { matchValue }) || content.inspect(payload, { matchValue })
    );

  const { evidence, ...fields } = message;
  const { envelope, slots } = established ?? {};
  const maskedBytes = envelope && slots && maskIntent(envelope.bytes, slots);
  const carried = new Set<string>();
  const subjects = new Set<string>();
  const mandateSubjects = new Set<string>();
  const replacements = new Map<number, string | null>();
  if (envelope && maskedBytes !== undefined) replacements.set(envelope.index, maskedBytes);
  if (Array.isArray(evidence)) {
    for (const [index, item] of evidence.entries()) {
      const entry = object(item);
      const value = string(entry?.value);
      const statement =
        entry?.role === "credential" && value !== undefined
          ? admitted.find(({ wireDigest }) => wireDigest === digestBytes(value))
          : undefined;
      if (mandateProof?.indexes.has(index) && entry && value !== undefined) {
        const { value: _value, ...metadata } = entry;
        if (content.inspect(metadata) || content.inspect(value, { referencesOnly: true }))
          return true;
        replacements.set(index, null);
        if (materialized)
          addMandateProjection(
            materialized,
            index,
            value,
            mandateSubjects,
            mandateProof.intentIndex,
          );
      } else if (statement && entry && value !== undefined) {
        const { value: _value, ...metadata } = entry;
        if (
          content.inspect(metadata, { matchValue }) ||
          content.inspect(value, { referencesOnly: true }) ||
          content.inspect(statement.statement, { referencesOnly: true })
        )
          return true;
        carried.add(value);
        const node = materialized?.node.evidence?.[index];
        if (node?.statement === value)
          for (const subject of node.credential?.projectionSubjects(node.format) ?? [])
            subjects.add(subject);
      } else if (
        content.inspect(
          entry &&
            maskedBytes !== undefined &&
            index === envelope?.index &&
            value === envelope.bytes
            ? { ...entry, value: maskedBytes }
            : item,
        )
      )
        return true;
    }
  } else if (content.inspect(evidence, { matchValue })) return true;
  const to = object(fields.to);
  if (slots?.recipient !== undefined && to?.party === slots.recipient)
    fields.to = { ...to, party: undefined };
  if (content.inspect(fields, { matchValue })) return true;
  if (!native) {
    const compact = mandateProof?.bound.jws ?? envelope?.jws;
    const jws = compact && maskCompactMessage(compact, replacements, slots?.recipient);
    return content.inspect(jws ? { ...object(wire), jws } : wire, { matchValue, carried });
  }
  const nativeMask =
    envelope && slots && maskedBytes !== undefined
      ? nativeSlotMask(envelope, slots, native.jsonld, maskedBytes)
      : undefined;
  if (materialized) {
    // Scan attachment terms in their own graph scope, including nodes outside the model view.
    const type = DataFactory.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
    const property = DataFactory.namedNode(SCHEMA + "PropertyValue");
    for (const graph of attachmentGraphs(materialized.node.dataset)) {
      for (const quad of graph) {
        const referencesOnly =
          subjects.has(quad.subject.value) || mandateSubjects.has(quad.subject.value);
        const structuralKey =
          [SCHEMA + "name", SCHEMA + "propertyID"].includes(quad.predicate.value) &&
          graph.countQuads(quad.subject, type, property, null) > 0;
        if (
          content.inspect(quad.subject.value, { matchValue, referencesOnly }) ||
          content.inspect(quad.graph.value, { matchValue, referencesOnly }) ||
          (!structuralKey &&
            !nativeMask?.masksQuad(
              graph,
              quad.subject.value,
              quad.predicate.value,
              quad.object.value,
              quad.graph.termType === "DefaultGraph",
            ) &&
            content.inspect(quad.object.value, { matchValue, referencesOnly }))
        )
          return true;
      }
    }
  }
  return (
    content.inspect(nativeMask?.json ?? native.jsonld, {
      matchValue,
      projection: materialized
        ? {
            subjects: new Set([...subjects, ...mandateSubjects]),
            repeatedProof: materialized.repeatedProof,
          }
        : undefined,
    }) ||
    native.attachments.some(({ bytes, ...attachment }) => {
      const graph = attachment.mediaType === "application/n-quads";
      return (
        content.inspect(attachment, { matchValue }) ||
        (!(graph && materialized) &&
          content.inspect(
            nativeMask?.attachment === attachment.digest && maskedBytes !== undefined
              ? maskedBytes
              : Buffer.from(bytes, "base64").toString("utf8"),
            {
              matchValue,
              carried,
              referencesOnly:
                !!materialized &&
                mandateAttachment(materialized.node.dataset, attachment.digest, mandateSubjects),
            },
          ))
      );
    })
  );
}

export function stoppedReleaseProblem(
  run: ComparisonRun,
  stop: TraceEvent,
  expectedOutcome: string,
  scenario: Scenario,
): boolean {
  const later = run.events.slice(stop.seq);
  const refused = run.standaloneRefusals?.get(stop.seq);
  if (
    stop.part !== "inbound-gate" ||
    stop.outcome !== "refuse" ||
    stop.gateRun === undefined ||
    refused === undefined ||
    run.events.some(
      (event) =>
        event.kind === "message-in" && event.agent === stop.agent && event.gateRun === stop.gateRun,
    )
  ) {
    return later.some(
      (event) =>
        event.agent === stop.agent &&
        (event.effectRelease ||
          event.kind === "store" ||
          (event.kind === "message-out" &&
            !(
              expectedOutcome === "refuse" &&
              ["refuse", "challenge", "unsupported", "indeterminate"].includes(
                event.packet?.kind ?? "",
              )
            ))),
    );
  }

  const ownSigners = new Set<string>();
  for (const { actor, actsFor } of signingAgents(scenario, stop.agent)) {
    const party = scenario.parties.find(({ id }) => id === actsFor)?.identity;
    if (!actor || !party) {
      ownSigners.clear();
      break;
    }
    ownSigners.add(actor);
    ownSigners.add(party);
  }
  const withheld = [refusedContent(refused)];
  const admitted = new Map<string, { statement: VerifiedStatement; decision: TraceEvent }>();
  const remember = (event: TraceEvent) => {
    if (
      ownSigners.size === 0 ||
      event.agent !== stop.agent ||
      event.kind !== "decision" ||
      event.part !== "inbound-gate" ||
      event.outcome !== "admit" ||
      event.gateRun === undefined
    )
      return;
    const admission = run.admissions?.get(event.seq);
    if (!admission) return;
    for (const statement of admission.statements) {
      const { id, issuer } = statement.statement;
      if (typeof id !== "string") continue;
      // A subsequent admission of the same ID must not leave an older citation usable.
      admitted.delete(id);
      if (
        typeof issuer === "string" &&
        admission.party !== undefined &&
        issuer !== admission.party &&
        !ownSigners.has(issuer)
      )
        admitted.set(id, { statement, decision: event });
    }
  };
  for (const event of run.events.slice(0, stop.seq - 1)) remember(event);
  const eligible = (statement: VerifiedStatement) =>
    digestOf(statement.statement) === statement.claimDigest &&
    withheld.every(
      ({ refused }) =>
        refused.id !== statement.statement.id &&
        refused.claimDigest !== statement.claimDigest &&
        refused.wireDigest !== statement.wireDigest,
    );
  const citations = (event: TraceEvent) => [
    ...(event.actionScope?.evidence ?? []),
    ...(run.effectSupport?.get(event.seq) ?? []),
    ...(run.releaseSupport?.get(event.seq) ?? []),
  ];
  const sources = (content: RefusedContent, ids: readonly string[]) =>
    ids.flatMap((id) => {
      const found = admitted.get(id)?.statement;
      return found && eligible(found) && !content.inspect(found.statement, { referencesOnly: true })
        ? [found]
        : [];
    });
  const allowed = new Map<number, TraceEvent>();
  const established = new Map<
    number,
    { envelope: BoundActionEnvelope; slots: Map<RefusedContent, ActionSlots> }
  >();
  let preceding: TraceEvent | undefined;
  for (const event of later) {
    if (event.agent !== stop.agent) continue;
    const nextRefusal = run.standaloneRefusals?.get(event.seq);
    if (nextRefusal) withheld.push(refusedContent(nextRefusal));
    if (event.kind === "decision") {
      preceding = event;
      remember(event);
      if (event.part === "outbound-gate" && event.outcome === "go") {
        const payload = run.payloads?.get(event.seq);
        const ids = citations(event);
        let slots: Map<RefusedContent, ActionSlots> | undefined;
        if (event.gateRun !== undefined && event.messageId && event.actionDigest) {
          const send = later.find(
            (candidate) =>
              candidate.kind === "message-out" &&
              candidate.agent === event.agent &&
              candidate.gateRun === event.gateRun &&
              matchesMessageRelease(event, candidate),
          );
          const message = send && boundMessage(run, event, send);
          const envelope = message && boundActionEnvelope(message, event);
          if (send && envelope && scenario) {
            slots = new Map(
              withheld.map((content) => [
                content,
                gateEstablishedSlots(run, scenario, stop, event, envelope, content),
              ]),
            );
            established.set(send.seq, { envelope, slots });
          }
        }
        if (
          (event.effectRelease && payload === undefined) ||
          withheld.some((content) => {
            const matchValue = explainedValues(content, sources(content, ids));
            return (
              content.inspect(maskActionScope(event.actionScope, slots?.get(content)), {
                matchValue,
              }) ||
              content.inspect(ids, { matchValue }) ||
              content.inspect(payload, { matchValue })
            );
          })
        )
          return true;
        if (event.gateRun !== undefined) allowed.set(event.gateRun, event);
      }
    }
    if (event.kind === "store") {
      // A decision after the refusal must admit the store in this trace step.
      const payload = run.payloads?.get(event.seq);
      if (
        (!event.fact && payload === undefined) ||
        preceding?.part !== "inbound-gate" ||
        preceding.outcome !== "admit" ||
        !sameScriptStep(run, preceding, event)
      )
        return true;
      const id = string(object(payload)?.id) ?? event.fact?.id;
      const found = id === undefined ? undefined : admitted.get(id);
      const digestMatches =
        found !== undefined &&
        payload !== undefined &&
        digestOf(payload) === found.statement.claimDigest;
      // A later citation resolves to the current statement at this ID.
      if (id !== undefined && !digestMatches) admitted.delete(id);
      const verified =
        found && digestMatches && found.decision.seq === preceding.seq && eligible(found.statement)
          ? found.statement
          : undefined;
      if (
        withheld.some((content) => {
          const matchValue = explainedValues(content, verified ? [verified] : []);
          return (
            content.inspect(event.fact, { matchValue }) ||
            content.inspect(payload, { matchValue, referencesOnly: verified !== undefined })
          );
        })
      )
        return true;
    }
    if (event.kind === "message-out") {
      const release = event.gateRun === undefined ? undefined : allowed.get(event.gateRun);
      const bound =
        release &&
        scenario &&
        (established.get(event.seq)?.envelope ?? boundMessage(run, release, event));
      const indexes = scenario && bound && provisionedMandateSlots(run, scenario, event, bound);
      if (
        event.messageId === undefined ||
        !release ||
        !matchesMessageRelease(release, event) ||
        withheld.some((content) => {
          const proof = established.get(event.seq);
          const slots = proof?.slots.get(content);
          return packetCopies(
            content,
            event,
            run.payloads?.get(event.seq),
            sources(content, citations(release)),
            [...admitted.values()].map(({ statement }) => statement).filter(eligible),
            proof && (slots?.action || slots?.recipient)
              ? { envelope: proof.envelope, slots }
              : undefined,
            bound && indexes?.size
              ? { bound, indexes, intentIndex: proof?.envelope.index }
              : undefined,
          );
        })
      )
        return true;
    }
  }
  return false;
}

/** A scoped stop permits subsequent releases only after their own gate decision. */
export function continuedReleaseProblem(stop: TraceEvent, later: readonly TraceEvent[]): boolean {
  if (!stop.actionDigest || !stop.actionScope) return true;
  const rejected = stop.actionScope;
  const allowed = new Map<number, TraceEvent>();
  for (const event of later) {
    if (event.agent !== stop.agent || event.part !== "outbound-gate" || event.outcome !== "go")
      continue;
    const action = event.actionScope;
    if (!action || !event.actionDigest || event.actionDigest === stop.actionDigest) return true;
    if (
      action.conversation === rejected.conversation &&
      action.action === rejected.action &&
      action.operation === rejected.operation &&
      (action.target !== rejected.target ||
        !action.otherParametersDigest ||
        action.otherParametersDigest !== rejected.otherParametersDigest ||
        action.recipient !== rejected.recipient ||
        action.purpose !== rejected.purpose ||
        new Set(action.evidence).size >= new Set(rejected.evidence).size ||
        action.evidence.some((item) => !rejected.evidence.includes(item)))
    )
      return true;
    if (event.gateRun !== undefined) allowed.set(event.gateRun, event);
  }
  return later.some((event) => {
    if (event.agent !== stop.agent) return false;
    if (event.kind === "store") {
      const preceding = later.findLast(
        (candidate) =>
          candidate.agent === event.agent &&
          candidate.kind === "decision" &&
          candidate.step === event.step &&
          candidate.seq < event.seq,
      );
      return (
        !preceding ||
        !(
          (preceding.part === "inbound-gate" && preceding.outcome === "admit") ||
          (preceding.gateRun !== undefined && allowed.get(preceding.gateRun) === preceding)
        )
      );
    }
    if (event.kind !== "message-out") return false;
    const release = event.gateRun === undefined ? undefined : allowed.get(event.gateRun);
    return !matchesMessageRelease(release, event);
  });
}

function hasNewTransportFault(main: ComparisonRun, branch: ComparisonRun) {
  const faults = (run: ComparisonRun) =>
    run.events
      .filter((e) => e.part === "transport" && e.kind === "record" && e.fault)
      .map((e) => e.fault);
  const mainFaults = new Set(faults(main));
  return faults(branch).some((fault) => !mainFaults.has(fault));
}

function changedAction(
  main: ComparisonRun,
  branch: ComparisonRun,
  decision: TraceEvent,
  match: TraceEvent,
) {
  const before = main.steps?.get(match.seq)?.descriptor;
  const after = branch.steps?.get(decision.seq)?.descriptor;
  return !!before && !!after && JSON.stringify(before) !== JSON.stringify(after);
}

type DecisionMatch = readonly [TraceEvent, TraceEvent | undefined];

function deniedAsk(
  main: ComparisonRun,
  branch: ComparisonRun,
  matches: readonly DecisionMatch[],
  denial: TraceEvent,
) {
  if (
    denial.part !== "outbound-gate" ||
    denial.outcome !== "stop" ||
    denial.reason !== "approval-denied" ||
    !denial.actionDigest
  )
    return undefined;
  const reply = branch.events.findLast(
    (event) =>
      event.seq < denial.seq &&
      event.agent === denial.agent &&
      event.kind === "principal-reply" &&
      event.actionDigest === denial.actionDigest,
  );
  if (reply?.approvalDecision !== "deny") return undefined;
  const ask = matches.findLast(
    ([event]) =>
      event.seq < reply.seq &&
      event.agent === denial.agent &&
      event.part === "outbound-gate" &&
      event.outcome === "ask-principal" &&
      event.actionDigest === denial.actionDigest,
  );
  return ask?.[1] && changedAction(main, branch, ask[0], ask[1]) ? ask[0] : undefined;
}

/** Longest common subsequence of passing decisions, including the originating script step. */
function alignPassing(
  main: ComparisonRun,
  branch: ComparisonRun,
  before: TraceEvent[],
  after: TraceEvent[],
) {
  const equal = (a: TraceEvent | undefined, b: TraceEvent | undefined) => {
    if (!a || !b || !sameDecision(a, b)) return false;
    const id = main.steps?.get(a.seq)?.id;
    return id !== undefined && id === branch.steps?.get(b.seq)?.id;
  };
  const width = after.length + 1;
  const lengths = new Uint32Array((before.length + 1) * width);
  const lengthAt = (i: number, j: number) => lengths[i * width + j] ?? 0;
  for (let i = before.length - 1; i >= 0; i--)
    for (let j = after.length - 1; j >= 0; j--)
      lengths[i * width + j] = equal(before[i], after[j])
        ? lengthAt(i + 1, j + 1) + 1
        : Math.max(lengthAt(i + 1, j), lengthAt(i, j + 1));

  const aligned = new Map<number, TraceEvent>();
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    const a = before[i];
    const b = after[j];
    if (a && b && equal(a, b)) {
      aligned.set(b.seq, a);
      i++;
      j++;
    } else if (lengthAt(i + 1, j) >= lengthAt(i, j + 1)) i++;
    else j++;
  }
  return aligned;
}

function prefixGuard(
  main: ComparisonRun,
  branch: ComparisonRun,
  mainDecisions: TraceEvent[],
  prefix: TraceEvent[],
  changedSteps: ReadonlySet<string>,
  boundary: TraceEvent | undefined,
  permissive: boolean,
) {
  const releases = prefix.filter(passing);
  const aligned = alignPassing(main, branch, mainDecisions.filter(passing), releases);
  const setup = releases.filter((event) => !aligned.has(event.seq));
  const unexplained = setup.find(
    (event) => !changedSteps.has(branch.steps?.get(event.seq)?.id ?? ""),
  );
  if (permissive) return { setup, failure: unexplained, notReached: [] };

  const branchBars = prefix.filter((event) => !passing(event));
  // A shared release reaches its actual main position, even when earlier steps were skipped.
  const comparable = prefix.filter((event) => !passing(event) || aligned.has(event.seq));
  const lastShared = releases.findLast((event) => aligned.has(event.seq));
  const reached = lastShared && aligned.get(lastShared.seq);
  const mainPrefix = mainDecisions.filter(
    (event, index) =>
      (boundary ? event.seq < boundary.seq : index < comparable.length) ||
      (reached !== undefined && event.seq <= reached.seq),
  );
  const branchStepIds = new Set(branch.scriptIds);
  for (const step of branch.steps?.values() ?? []) branchStepIds.add(step.id);
  const notReached = mainPrefix.filter((event) => {
    if (passing(event) || !branch.scriptIds) return false;
    const step = main.steps?.get(event.seq);
    return step !== undefined && !branchStepIds.has(step.id);
  });
  const dropped = new Set(notReached);
  const mainBars = mainDecisions.filter((event) => !passing(event) && !dropped.has(event));
  const sameBar = (expected: TraceEvent, actual: TraceEvent) => {
    if (!sameDecision(expected, actual)) return false;
    if (!main.steps && !branch.steps) return true;
    const id = main.steps?.get(expected.seq)?.id;
    return id !== undefined && id === branch.steps?.get(actual.seq)?.id;
  };
  const changed = branchBars.find((event, i) => {
    const expected = mainBars[i];
    return !expected || !sameBar(expected, event);
  });
  // A bar must occur before every shared release it preceded on the main path.
  const missing = mainBars.find((bar, index) => {
    if (!mainPrefix.includes(bar)) return false;
    const match = branchBars[index];
    return (
      !match ||
      !sameBar(bar, match) ||
      releases.some(
        (release) => (aligned.get(release.seq)?.seq ?? 0) > bar.seq && match.seq > release.seq,
      )
    );
  });
  const skipped =
    missing &&
    (releases.find((event) => (aligned.get(event.seq)?.seq ?? 0) > missing.seq) ??
      comparable[mainPrefix.indexOf(missing)] ??
      missing);
  const failure = [unexplained, changed, skipped]
    .filter((event) => event !== undefined)
    .sort((a, b) => a.seq - b.seq)[0];
  return { setup, failure, notReached };
}

export function compareBranch(
  main: ComparisonRun | undefined,
  branch: ComparisonRun,
  options: {
    judgedAgent?: string;
    witness?: DecisionWitness;
    expectedOutcome?: string;
    changedSteps?: ReadonlySet<string>;
  } = {},
): {
  judged?: TraceEvent;
  diverges: boolean;
  failure?: TraceEvent;
  denial?: TraceEvent;
  setup: TraceEvent[];
  notReached?: TraceEvent[];
} {
  const { judgedAgent, witness, expectedOutcome, changedSteps } = options;
  const decisions = decisionsOf(branch.events);
  const setup = judgedAgent ? decisions.filter((e) => e.agent !== judgedAgent) : [];
  for (const event of setup) {
    if (
      !passing(event) &&
      !(event.outcome === "ask-principal" && branch.approvedAsks?.has(event.seq))
    )
      throw new Error(
        `judgedAgent ${judgedAgent} cannot skip ${event.agent}'s ${event.outcome} at event ${event.seq}`,
      );
  }
  const judgedDecisions = decisions.filter((e) => !judgedAgent || e.agent === judgedAgent);
  if (!main) {
    const judged = judgedDecisions.find((e) => !passing(e)) ?? judgedDecisions.at(-1);
    return { judged, diverges: !!judged, setup };
  }
  const mainDecisions = decisionsOf(main.events).filter(
    (e) => !judgedAgent || e.agent === judgedAgent,
  );
  const matches = [...decisionMatches(mainDecisions, judgedDecisions)];
  const difference = matches.find(([event, match]) => !match && !passing(event))?.[0];
  const ask = difference && deniedAsk(main, branch, matches, difference);
  const permissive =
    !difference &&
    (!expectedOutcome || goes(expectedOutcome)) &&
    [...decisionMatches(judgedDecisions, mainDecisions)].some(
      ([event, match]) => !match && !passing(event),
    )
      ? witnessedRelease(main, branch, witness, judgedAgent)
      : undefined;
  const statement =
    !difference && !permissive ? firstStatementDifference(main, branch, judgedAgent) : undefined;
  const fault = !difference && !permissive && !statement && hasNewTransportFault(main, branch);
  const action =
    !difference && !permissive && !statement && !fault
      ? matches.find(
          ([event, match]) => match && !passing(event) && changedAction(main, branch, event, match),
        )?.[0]
      : undefined;
  const prefixEnd = ask ?? difference ?? permissive ?? action;
  const judged = ask ?? difference ?? statement ?? action;
  if (!changedSteps)
    return {
      judged,
      diverges: !!(judged || permissive || fault),
      denial: ask ? difference : undefined,
      setup,
    };
  const boundary = prefixEnd && matches.find(([event]) => event === prefixEnd)?.[1];
  const guarded = prefixGuard(
    main,
    branch,
    mainDecisions,
    judgedDecisions.filter((event) => !prefixEnd || event.seq < prefixEnd.seq),
    changedSteps,
    boundary,
    !!permissive,
  );
  return {
    judged,
    diverges: !!(judged || permissive || fault),
    failure: guarded.failure,
    notReached: guarded.notReached,
    denial: ask ? difference : undefined,
    setup: [...setup, ...guarded.setup].sort((a, b) => a.seq - b.seq),
  };
}
