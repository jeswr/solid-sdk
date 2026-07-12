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
import { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
import { phaseCodec } from "./concepts.js";
import { type TriggerSlug } from "./vocab.js";
/** The elimination-protocol phases (DESIGN §3 FSM; stored as `diet:{concept}` IRIs). */
export type ProtocolPhase = (typeof phaseCodec.tokens)[number];
/** The known phases, in FSM order. */
export declare const PROTOCOL_PHASES: readonly ProtocolPhase[];
/**
 * The phases that count as an ACTIVE CHALLENGE (a live reintroduction being
 * observed). The one-active-challenge invariant is over exactly these.
 */
export declare const ACTIVE_CHALLENGE_PHASES: readonly ProtocolPhase[];
/** True if `phase` is an active challenge (`reintroduce`/`observe`). */
export declare function isActiveChallengePhase(phase: ProtocolPhase): boolean;
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
export declare class EliminationProtocol extends TermWrapper {
    get id(): string;
    get types(): Set<string>;
    mark(): this;
    get isProtocol(): boolean;
    /** `diet:targetTrigger` → `diet:{slug}`; read back as the slug. */
    get targetTrigger(): TriggerSlug | undefined;
    set targetTrigger(value: TriggerSlug | undefined);
    /** `diet:phase` → `diet:{concept}`; read back as the friendly token. */
    get phase(): ProtocolPhase | undefined;
    set phase(value: ProtocolPhase | undefined);
    get phaseStarted(): Date | undefined;
    set phaseStarted(value: Date | undefined);
    get phasePlannedEnd(): Date | undefined;
    set phasePlannedEnd(value: Date | undefined);
    get challengeStep(): number | undefined;
    set challengeStep(value: number | undefined);
    /** `health:patient` — the pod-owner Patient/Person WebID. */
    get patient(): string | undefined;
    set patient(value: string | undefined);
    get created(): Date | undefined;
    set created(value: Date | undefined);
}
/** The protocol subject IRI: `${url}#it`. */
export declare function protocolSubject(url: string): string;
/**
 * How many of the given protocols are in an active-challenge phase. The
 * one-active-challenge invariant holds iff this is ≤ 1.
 */
export declare function countActiveChallenges(protocols: readonly Pick<ProtocolData, "phase">[]): number;
/** True if AT MOST ONE protocol is in an active-challenge phase (the invariant). */
export declare function hasSingleActiveChallenge(protocols: readonly Pick<ProtocolData, "phase">[]): boolean;
/**
 * Throw if MORE THAN ONE protocol is in an active-challenge phase (concurrent
 * challenges destroy attribution — DESIGN §3). Call before persisting a
 * phase transition into `reintroduce`/`observe`.
 */
export declare function assertSingleActiveChallenge(protocols: readonly Pick<ProtocolData, "phase">[]): void;
/** Parse a Protocol out of a dataset, or `undefined` if `${url}#it` is not one. */
export declare function parseProtocol(url: string, dataset: DatasetCore): ProtocolData | undefined;
/** Build a fresh n3 `Store` holding one Protocol rooted at `${url}#it`. */
export declare function buildProtocol(url: string, data: ProtocolData): Store;
/** Serialise a Protocol to Turtle (via `n3.Writer`). */
export declare function serializeProtocol(url: string, data: ProtocolData): Promise<string>;
/** Parse a fetched Protocol body (Turtle / JSON-LD) via `@jeswr/fetch-rdf`. */
export declare function parseProtocolTtl(url: string, body: string, contentType?: string | null): Promise<ProtocolData | undefined>;
//# sourceMappingURL=protocol.d.ts.map