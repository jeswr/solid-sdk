// AUTHORED-BY Codex GPT-6
/**
 * The deterministic conversation state machine (one instance per conversation per side).
 *
 * `transition` is PURE: same state + same event = same result, no clock, no I/O. The
 * runtime consults it before accepting an inbound message and before emitting an
 * outbound one, so a message that is authentic but out of order (an accept for a
 * proposal nobody made, a counter after the round limit, anything after a terminal state)
 * is refused as a protocol violation rather than acted on.
 *
 * Phases keep request, agreement and performance distinct: `negotiating` (an offer is
 * open) → `agreed` (an accept referenced the exact offer digest) → per-side outcomes
 * recorded from receipts → `completed` / `failed` / `uncertain`.
 */
import type { PilotLimits } from "./limits.js";
import type {
  AnyMessage,
  Basis,
  Iri,
  MessageKind,
  OperationRef,
  OutcomeConclusion,
  ReasonCode,
} from "./types.js";

export const TERMINAL_PHASES = [
  "completed",
  "refused",
  "unsupported",
  "indeterminate",
  "failed",
  "expired",
] as const;

export type Phase =
  | "open"
  | "discovering"
  | "described"
  | "negotiating"
  | "awaiting-approval"
  | "agreed"
  | "invoked"
  | "uncertain"
  | (typeof TERMINAL_PHASES)[number];

export type Side = "self" | "peer";

export interface ConversationState {
  readonly id: Iri;
  readonly role: "initiator" | "responder";
  readonly peer: { readonly actor?: Iri; readonly party?: Iri };
  readonly configuration?: string;
  readonly operation?: OperationRef;
  readonly phase: Phase;
  readonly rounds: number;
  readonly messageCount: number;
  readonly openProposal?: {
    readonly id: Iri;
    readonly termsDigest: string;
    readonly by: Side;
    readonly round: number;
  };
  readonly agreement?: Iri;
  readonly invocation?: Iri;
  /** Recorded requests, including operations invoked under a different negotiated operation. */
  readonly requests?: Readonly<
    Record<
      Iri,
      {
        readonly operation: OperationRef;
        readonly basis: Basis;
        readonly by: Side;
        readonly delivered?: boolean;
      }
    >
  >;
  readonly requiredOutcomes: readonly Side[];
  readonly outcomes: { readonly self?: OutcomeConclusion; readonly peer?: OutcomeConclusion };
  readonly openedAt: string;
  readonly updatedAt: string;
  readonly closedReason?: string;
  readonly history: ReadonlyArray<{
    readonly direction: "in" | "out";
    readonly kind: MessageKind;
    readonly id: Iri;
    readonly phaseAfter: Phase;
  }>;
}

export type ConversationEvent =
  | {
      readonly type: "message";
      readonly direction: "in" | "out";
      readonly message: AnyMessage;
      readonly at: string;
      /** Local operation obligation, never taken from the peer's message. */
      readonly agreementDelivery?: "offeror" | "acceptor";
    }
  | { readonly type: "approval-pending"; readonly at: string }
  | { readonly type: "approval-resolved"; readonly at: string }
  | {
      readonly type: "agreement-requirements";
      readonly requiredOutcomes: readonly Side[];
      readonly at: string;
    }
  | { readonly type: "expire"; readonly at: string };

export type TransitionResult =
  | { readonly ok: true; readonly state: ConversationState }
  | { readonly ok: false; readonly reason: ReasonCode; readonly detail: string };

export function isTerminal(phase: Phase): boolean {
  return (TERMINAL_PHASES as readonly string[]).includes(phase);
}

/** Create the state for a new conversation. */
export function openConversation(input: {
  id: Iri;
  role: "initiator" | "responder";
  peer: { actor?: Iri; party?: Iri };
  configuration?: string;
  at: string;
}): ConversationState {
  return {
    id: input.id,
    role: input.role,
    peer: input.peer,
    ...(input.configuration ? { configuration: input.configuration } : {}),
    phase: "open",
    rounds: 0,
    messageCount: 0,
    requiredOutcomes: [],
    outcomes: {},
    openedAt: input.at,
    updatedAt: input.at,
    history: [],
  };
}

function fail(reason: ReasonCode, detail: string): TransitionResult {
  return { ok: false, reason, detail };
}

/** Apply one event. Pure and deterministic. */
export function transition(
  state: ConversationState,
  event: ConversationEvent,
  limits: Pick<PilotLimits, "maxMessagesPerConversation" | "maxProposalRounds">,
): TransitionResult {
  if (event.type === "expire") {
    if (isTerminal(state.phase)) return { ok: true, state };
    return {
      ok: true,
      state: { ...state, phase: "expired", closedReason: "ttl", updatedAt: event.at },
    };
  }
  if (event.type === "approval-pending") {
    if (state.phase !== "negotiating" && state.phase !== "agreed" && state.phase !== "invoked") {
      return fail("protocol-violation", `cannot await approval in phase ${state.phase}`);
    }
    return { ok: true, state: { ...state, phase: "awaiting-approval", updatedAt: event.at } };
  }
  if (event.type === "approval-resolved") {
    if (state.phase !== "awaiting-approval") return { ok: true, state };
    const back = state.agreement ? "agreed" : state.invocation ? "invoked" : "negotiating";
    return { ok: true, state: { ...state, phase: back, updatedAt: event.at } };
  }
  if (event.type === "agreement-requirements") {
    return {
      ok: true,
      state: { ...state, requiredOutcomes: [...event.requiredOutcomes], updatedAt: event.at },
    };
  }

  const { direction, message, at } = event;
  const by: Side = direction === "out" ? "self" : "peer";
  if (isTerminal(state.phase)) {
    return fail("conversation-closed", `conversation is ${state.phase}`);
  }
  if (state.messageCount + 1 > limits.maxMessagesPerConversation) {
    return fail("protocol-violation", "message limit for conversation reached");
  }
  // A peer that does not accept our configuration can only say so under one of its own;
  // that notice may only close the conversation, so it is exempt from the equality rule.
  const configurationNotice =
    message.kind === "unsupported" &&
    (message.body.reason === "unsupported-configuration" ||
      message.body.reason === "unsupported-profile");
  if (
    state.configuration &&
    message.configuration !== state.configuration &&
    !configurationNotice
  ) {
    return fail("configuration-mismatch", "configuration changed within a conversation");
  }

  const base = { ...state, messageCount: state.messageCount + 1, updatedAt: at };
  let next: ConversationState;
  const phase = state.phase;

  switch (message.kind) {
    case "describe": {
      if (phase !== "open") return fail("protocol-violation", "describe only opens a conversation");
      next = { ...base, phase: direction === "out" ? "discovering" : "described" };
      break;
    }
    case "description": {
      const ok =
        (direction === "in" && phase === "discovering") ||
        (direction === "out" && phase === "described");
      if (!ok) return fail("protocol-violation", `unexpected description in ${phase}`);
      next = { ...base, phase: "described" };
      break;
    }
    case "propose": {
      const body = message.body;
      if (phase === "open" || phase === "described" || phase === "discovering") {
        if (body.round !== 1 || body.counters) {
          return fail("protocol-violation", "an opening proposal must be round 1");
        }
      } else if (phase === "negotiating" || phase === "awaiting-approval") {
        const open = state.openProposal;
        if (!open || body.counters !== open.id || open.by === by) {
          return fail("protocol-violation", "a counter-proposal must counter the peer's offer");
        }
        if (body.round !== open.round + 1) {
          return fail("protocol-violation", "counter-proposal round must increment");
        }
      } else {
        return fail("protocol-violation", `cannot propose in ${phase}`);
      }
      if (body.round > limits.maxProposalRounds) {
        return fail("round-limit", `more than ${limits.maxProposalRounds} proposal rounds`);
      }
      if (state.operation && state.operation.id !== body.operation.id) {
        return fail("protocol-violation", "operation changed within a conversation");
      }
      next = {
        ...base,
        phase: "negotiating",
        operation: body.operation,
        rounds: body.round,
        openProposal: { id: message.id, termsDigest: body.termsDigest, by, round: body.round },
      };
      break;
    }
    case "accept": {
      const open = state.openProposal;
      if ((phase !== "negotiating" && phase !== "awaiting-approval") || !open) {
        return fail("protocol-violation", `nothing to accept in ${phase}`);
      }
      if (message.body.proposal !== open.id) {
        return fail("protocol-violation", "accept does not reference the open proposal");
      }
      if (open.by === by) return fail("protocol-violation", "a party cannot accept its own offer");
      if (message.body.termsDigest !== open.termsDigest) {
        return fail("terms-digest-mismatch", "accepted terms digest differs from the offer");
      }
      const { openProposal: _closed, ...rest } = base;
      // An offer can request data or promise a result. The local operation's
      // obligation chooses the supplier; the opposite side is the requester.
      next = {
        ...rest,
        phase: "agreed",
        agreement: message.body.agreement,
        ...(state.operation && event.agreementDelivery
          ? {
              requests: {
                ...state.requests,
                [message.body.agreement]: {
                  operation: state.operation,
                  basis: { kind: "agreement", agreement: message.body.agreement },
                  by: event.agreementDelivery === "offeror" ? by : open.by,
                },
              },
            }
          : {}),
      };
      break;
    }
    case "refuse": {
      if (phase === "open" || phase === "discovering") {
        return fail("protocol-violation", `nothing to refuse in ${phase}`);
      }
      next = { ...base, phase: "refused", closedReason: message.body.reason };
      break;
    }
    case "unsupported":
    case "indeterminate": {
      next = { ...base, phase: message.kind, closedReason: message.body.reason };
      break;
    }
    case "invoke": {
      const basis = message.body.basis;
      if (basis.kind === "agreement") {
        if (phase !== "agreed" && phase !== "uncertain") {
          return fail("no-agreement", "invocation under an agreement requires an agreement");
        }
        if (state.agreement !== basis.agreement) {
          return fail("no-agreement", "invocation references a different agreement");
        }
        next = { ...base, invocation: message.id };
      } else {
        if (phase !== "open" && phase !== "described") {
          return fail("protocol-violation", `cannot invoke in ${phase}`);
        }
        next = {
          ...base,
          phase: "invoked",
          invocation: message.id,
          operation: message.body.operation,
        };
      }
      next = {
        ...next,
        requests: {
          ...state.requests,
          [message.id]: {
            operation: message.body.operation,
            basis,
            by,
          },
        },
      };
      break;
    }
    case "deliver": {
      const request = state.requests?.[message.body.ref];
      if (!request || request.by === by || request.delivered) {
        return fail("protocol-violation", "delivery does not answer an outstanding peer request");
      }
      if (
        request.operation.id !== message.body.operation.id ||
        request.operation.version !== message.body.operation.version
      ) {
        return fail("protocol-violation", "delivery operation differs from the recorded request");
      }
      const basis = message.body.basis;
      const basisMatches =
        request.basis.kind === "agreement"
          ? basis.kind === "agreement" &&
            basis.agreement === request.basis.agreement &&
            basis.agreement === state.agreement
          : basis.kind === "invocation" && basis.invocation === message.body.ref;
      if (!basisMatches)
        return fail("protocol-violation", "delivery basis differs from the recorded request");
      if (phase === "invoked") {
        if (message.body.ref !== state.invocation) {
          return fail("protocol-violation", "delivery does not answer the invocation");
        }
        next = { ...base, phase: "completed", closedReason: "delivered" };
      } else if (phase === "agreed" || phase === "uncertain") {
        next = base;
      } else {
        return fail("protocol-violation", `cannot deliver in ${phase}`);
      }
      next = {
        ...next,
        requests: { ...state.requests, [message.body.ref]: { ...request, delivered: true } },
      };
      break;
    }
    case "receipt": {
      if (phase !== "agreed" && phase !== "uncertain" && phase !== "awaiting-approval") {
        return fail("protocol-violation", `receipt not expected in ${phase}`);
      }
      // A non-final receipt is informational unless it reports uncertainty, which must be
      // visible in the state (it blocks completion until reconciled).
      if (!message.body.final && message.body.outcome !== "uncertain") {
        next = base;
        break;
      }
      const outcomes = { ...state.outcomes, [by]: message.body.outcome };
      next = { ...base, outcomes, phase: settle(state.requiredOutcomes, outcomes, phase) };
      if (next.phase === "failed") next = { ...next, closedReason: "not-executed" };
      break;
    }
  }

  return {
    ok: true,
    state: {
      ...next,
      history: [
        ...state.history,
        { direction, kind: message.kind, id: message.id, phaseAfter: next.phase },
      ],
    },
  };
}

function settle(
  required: readonly Side[],
  outcomes: { self?: OutcomeConclusion; peer?: OutcomeConclusion },
  current: Phase,
): Phase {
  const values = required.map((side) => outcomes[side]);
  if (values.some((v) => v === "not-executed")) return "failed";
  if (values.some((v) => v === "uncertain")) return "uncertain";
  if (required.length > 0 && values.every((v) => v === "completed")) return "completed";
  return current === "uncertain" ? "agreed" : current;
}
