// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `diet:EliminationProtocol` — the elimination/reintroduction state machine as a
 * pod resource (DESIGN §2.2 entity 6, §3). One resource per protocol
 * (`protocols/{ulid}.ttl`).
 *
 * **This module is the DATA MODEL only** — the typed accessors + the
 * one-active-challenge invariant. The pure reducer `advance(protocol, event, now)`
 * that drives the FSM is Brief 2B; it consumes {@link ProtocolData}.
 *
 * The **one-active-challenge invariant** (DESIGN §2.2 entity 6 / §3): at most ONE
 * protocol per pod may be in an active `reintroduce`/`observe` phase at a time —
 * concurrent challenges destroy attribution. {@link hasSingleActiveChallenge} /
 * {@link assertSingleActiveChallenge} let the accessor + UI enforce it.
 */

import type { DatasetCore } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { phaseCodec } from "./concepts.js";
import { httpIriOrUndefined } from "./iri.js";
import { assertSubjectSingletons } from "./rdfGuards.js";
import { parseBody, storeToTurtle } from "./serialize.js";
import { setIfDefined, tryRead, validDateOrUndefined } from "./util.js";
import {
  DIET_ELIMINATION_PROTOCOL,
  dct,
  diet,
  HEALTH_PATIENT_PROP,
  isTriggerSlug,
  rdf,
  type TriggerSlug,
  triggerIri,
  triggerSlugFromIri,
} from "./vocab.js";

/** The elimination-protocol phases (DESIGN §3 FSM; stored as `diet:{concept}` IRIs). */
export type ProtocolPhase = (typeof phaseCodec.tokens)[number];

/** The known phases, in FSM order. */
export const PROTOCOL_PHASES: readonly ProtocolPhase[] = phaseCodec.tokens;

/**
 * The phases that count as an ACTIVE CHALLENGE (a live reintroduction being
 * observed). The one-active-challenge invariant is over exactly these.
 */
export const ACTIVE_CHALLENGE_PHASES: readonly ProtocolPhase[] = ["reintroduce", "observe"];

/** True if `phase` is an active challenge (`reintroduce`/`observe`). */
export function isActiveChallengePhase(phase: ProtocolPhase): boolean {
  return (ACTIVE_CHALLENGE_PHASES as readonly string[]).includes(phase);
}

/** An elimination protocol (DESIGN §2.2 entity 6). */
export interface ProtocolData {
  /** Subject IRI (`${url}#it`); informational. */
  id?: string;
  /** `diet:targetTrigger` — the TriggerClass this protocol tests (required). */
  targetTrigger: TriggerSlug;
  /** `diet:phase` — the current FSM phase (required). */
  phase: ProtocolPhase;
  /** `diet:phaseStarted` — when the current phase began. */
  phaseStarted?: Date;
  /** `diet:phasePlannedEnd` — planned end of the current phase. */
  phasePlannedEnd?: Date;
  /** `diet:challengeStep` — dose-escalation step within `reintroduce` (0-based). */
  challengeStep?: number;
  /** `health:patient` — the pod-owner Patient/Person WebID. */
  patient?: string;
  /** `dcterms:created`. */
  created?: Date;
}

/** Typed `@rdfjs/wrapper` view of a `diet:EliminationProtocol`. */
export class EliminationProtocol extends TermWrapper {
  get id(): string {
    return this.value;
  }
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  mark(): this {
    this.types.add(DIET_ELIMINATION_PROTOCOL);
    return this;
  }
  get isProtocol(): boolean {
    return this.types.has(DIET_ELIMINATION_PROTOCOL);
  }

  /** `diet:targetTrigger` → `diet:{slug}`; read back as the slug. */
  get targetTrigger(): TriggerSlug | undefined {
    return triggerSlugFromIri(
      OptionalFrom.subjectPredicate(this, diet("targetTrigger"), NamedNodeAs.string) ?? "",
    );
  }
  set targetTrigger(value: TriggerSlug | undefined) {
    OptionalAs.object(
      this,
      diet("targetTrigger"),
      value ? triggerIri(value) : undefined,
      NamedNodeFrom.string,
    );
  }

  /** `diet:phase` → `diet:{concept}`; read back as the friendly token. */
  get phase(): ProtocolPhase | undefined {
    return phaseCodec.fromIri(
      OptionalFrom.subjectPredicate(this, diet("phase"), NamedNodeAs.string),
    );
  }
  set phase(value: ProtocolPhase | undefined) {
    OptionalAs.object(
      this,
      diet("phase"),
      value ? phaseCodec.toIri(value) : undefined,
      NamedNodeFrom.string,
    );
  }

  get phaseStarted(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, diet("phaseStarted"), LiteralAs.date);
  }
  set phaseStarted(value: Date | undefined) {
    OptionalAs.object(this, diet("phaseStarted"), value, LiteralFrom.dateTime);
  }

  get phasePlannedEnd(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, diet("phasePlannedEnd"), LiteralAs.date);
  }
  set phasePlannedEnd(value: Date | undefined) {
    OptionalAs.object(this, diet("phasePlannedEnd"), value, LiteralFrom.dateTime);
  }

  get challengeStep(): number | undefined {
    return OptionalFrom.subjectPredicate(this, diet("challengeStep"), LiteralAs.number);
  }
  set challengeStep(value: number | undefined) {
    OptionalAs.object(this, diet("challengeStep"), value, LiteralFrom.integer);
  }

  /** `health:patient` — the pod-owner Patient/Person WebID. */
  get patient(): string | undefined {
    return OptionalFrom.subjectPredicate(this, HEALTH_PATIENT_PROP, NamedNodeAs.string);
  }
  set patient(value: string | undefined) {
    OptionalAs.object(this, HEALTH_PATIENT_PROP, value, NamedNodeFrom.string);
  }

  get created(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, dct("created"), LiteralAs.date);
  }
  set created(value: Date | undefined) {
    OptionalAs.object(this, dct("created"), value, LiteralFrom.dateTime);
  }
}

/** The protocol subject IRI: `${url}#it`. */
export function protocolSubject(url: string): string {
  return `${url}#it`;
}

/** The SHACL `sh:maxCount 1` predicates for a Protocol (only these are guarded). */
const PROTOCOL_SINGLETONS: readonly string[] = [
  diet("targetTrigger"),
  diet("phase"),
  diet("phaseStarted"),
];

/**
 * How many of the given protocols are in an active-challenge phase. The
 * one-active-challenge invariant holds iff this is ≤ 1.
 */
export function countActiveChallenges(protocols: readonly Pick<ProtocolData, "phase">[]): number {
  return protocols.filter((p) => isActiveChallengePhase(p.phase)).length;
}

/** True if AT MOST ONE protocol is in an active-challenge phase (the invariant). */
export function hasSingleActiveChallenge(
  protocols: readonly Pick<ProtocolData, "phase">[],
): boolean {
  return countActiveChallenges(protocols) <= 1;
}

/**
 * Throw if MORE THAN ONE protocol is in an active-challenge phase (concurrent
 * challenges destroy attribution — DESIGN §3). Call before persisting a
 * phase transition into `reintroduce`/`observe`.
 */
export function assertSingleActiveChallenge(
  protocols: readonly Pick<ProtocolData, "phase">[],
): void {
  const n = countActiveChallenges(protocols);
  if (n > 1) {
    throw new Error(
      `one-active-challenge invariant violated: ${n} protocols are in an active ` +
        "reintroduce/observe phase (concurrent challenges destroy attribution).",
    );
  }
}

/**
 * `diet:challengeStep` is a 0-based dose-escalation step — a NON-NEGATIVE safe
 * integer. `undefined` ⇒ valid (optional). A negative, fractional, `NaN`, or
 * infinite value is invalid (and a fractional/`NaN` value would also serialise as
 * an invalid `xsd:integer`): {@link buildProtocol} refuses it (fail-closed) and
 * {@link parseProtocol} drops it from an untrusted document.
 */
function isValidChallengeStep(value: number | undefined): boolean {
  return value === undefined || (Number.isSafeInteger(value) && value >= 0);
}

/** Parse a Protocol out of a dataset, or `undefined` if `${url}#it` is not one. */
export function parseProtocol(url: string, dataset: DatasetCore): ProtocolData | undefined {
  return tryRead(() => parseProtocolImpl(url, dataset));
}
function parseProtocolImpl(url: string, dataset: DatasetCore): ProtocolData | undefined {
  const doc = new EliminationProtocol(protocolSubject(url), dataset, DataFactory);
  if (!doc.isProtocol) return undefined;
  assertSubjectSingletons(dataset, protocolSubject(url), PROTOCOL_SINGLETONS);
  const targetTrigger = doc.targetTrigger;
  const phase = doc.phase;
  if (!targetTrigger || !phase) return undefined;
  const data: ProtocolData = { id: protocolSubject(url), targetTrigger, phase };
  setIfDefined(data, "phaseStarted", validDateOrUndefined(doc.phaseStarted));
  setIfDefined(data, "phasePlannedEnd", validDateOrUndefined(doc.phasePlannedEnd));
  // 0-based non-negative integer only — drop a negative/fractional/NaN value read
  // from an untrusted document rather than surface a corrupt escalation step.
  setIfDefined(
    data,
    "challengeStep",
    isValidChallengeStep(doc.challengeStep) ? doc.challengeStep : undefined,
  );
  // http(s)-filtered on READ (symmetric with the writer) — never surface a
  // non-http(s) IRI from a hostile pod document.
  setIfDefined(data, "patient", httpIriOrUndefined(doc.patient));
  setIfDefined(data, "created", validDateOrUndefined(doc.created));
  return data;
}

/** Build a fresh n3 `Store` holding one Protocol rooted at `${url}#it`. */
export function buildProtocol(url: string, data: ProtocolData): Store {
  // Fail-closed on the SHACL MUSTs (symmetric with parseProtocol, which rejects a
  // record missing either): a known targetTrigger and a valid FSM phase. JS callers
  // / bad casts could smuggle a missing or non-canonical coded value.
  if (!data.targetTrigger || !isTriggerSlug(data.targetTrigger)) {
    throw new Error(
      `buildProtocol: targetTrigger is REQUIRED and must be a known TriggerClass — got ${JSON.stringify(
        data.targetTrigger,
      )}.`,
    );
  }
  if (!data.phase || !phaseCodec.isToken(data.phase)) {
    throw new Error(
      `buildProtocol: phase is REQUIRED and must be a known protocol phase — got ${JSON.stringify(
        data.phase,
      )}.`,
    );
  }
  if (!isValidChallengeStep(data.challengeStep)) {
    throw new Error(
      `buildProtocol: challengeStep must be a non-negative integer (0-based) — got ${JSON.stringify(
        data.challengeStep,
      )}.`,
    );
  }
  const store = new Store();
  const doc = new EliminationProtocol(protocolSubject(url), store, DataFactory).mark();
  doc.targetTrigger = data.targetTrigger;
  doc.phase = data.phase;
  doc.phaseStarted = data.phaseStarted;
  doc.phasePlannedEnd = data.phasePlannedEnd;
  doc.challengeStep = data.challengeStep;
  doc.patient = httpIriOrUndefined(data.patient);
  doc.created = data.created ?? new Date();
  return store;
}

/** Serialise a Protocol to Turtle (via `n3.Writer`). */
export function serializeProtocol(url: string, data: ProtocolData): Promise<string> {
  return storeToTurtle(buildProtocol(url, data));
}

/** Parse a fetched Protocol body (Turtle / JSON-LD) via `@jeswr/fetch-rdf`. */
export async function parseProtocolTtl(
  url: string,
  body: string,
  contentType: string | null = "text/turtle",
): Promise<ProtocolData | undefined> {
  return parseProtocol(url, await parseBody(body, url, contentType));
}
