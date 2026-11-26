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
  type AdvanceResult,
  advanceProtocol,
  CLINICIAN_CAVEAT,
  challengeSafetyRefusal,
  DOSE_LADDER,
  isPhaseElapsed,
  type NextAction,
  nextAction,
  type ProtocolEvent,
  type ProtocolOptions,
  type ProtocolPrompt,
  type ProtocolRejection,
  type ProtocolRejectionKind,
  type ProtocolSafetyContext,
  promptFor,
  type SafetyRefusal,
  type StartProtocolInput,
  type StartResult,
  startProtocol,
} from "./fsm.js";
