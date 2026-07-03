// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The elimination-protocol state machine (coeliac-app DESIGN §3, Brief 2B) — a PURE
 * reducer over `@jeswr/solid-health-diary`'s {@link ProtocolData}, with the
 * hard-coded health-safety rails (gluten never reintroduced; emergency triggers
 * never auto-challenged; one active challenge at a time). Correlation only ever
 * PROPOSES a challenge; a completed protocol is the ONLY path to a `confirmed`
 * conclusion (via `deriveConfirmedConclusion`).
 *
 * @packageDocumentation
 */
export {
  advanceProtocol,
  type AdvanceResult,
  challengeSafetyRefusal,
  CLINICIAN_CAVEAT,
  DOSE_LADDER,
  isPhaseElapsed,
  nextAction,
  type NextAction,
  type ProtocolEvent,
  type ProtocolOptions,
  type ProtocolPrompt,
  type ProtocolRejection,
  type ProtocolRejectionKind,
  type ProtocolSafetyContext,
  promptFor,
  type SafetyRefusal,
  startProtocol,
  type StartProtocolInput,
  type StartResult,
} from "./fsm.js";
