// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `@jeswr/personal-agent` — the maintainer's personal agent (NOW), the works-today
 * counterpart of the Accountable Web of Agents vision. It composes the suite's hardened
 * packages under a HARD Reader / pod / Actor / outbox trust split (§2/§7) so no single
 * context both reads hostile input and holds act-credentials, and it makes the agent's
 * AUTONOMY ENVELOPE an owner-signed ODRL mandate the credential-holding outbox executor
 * enforces deny-by-default.
 *
 *  - {@link runReader} + {@link GmailChannelAdapter} — untrusted channel ingest into the
 *    owner-private pod (the whole hostile-input surface is the bridge's hardened parser);
 *  - {@link runActorOnce} + {@link createClaudeActor} — the Actor: deterministic §5 metadata
 *    first (zero LLM tokens), the guarded LLM loop on top, PROPOSING only;
 *  - {@link runOutboxOnce} — the no-LLM executor: evaluates the signed ODRL mandate against
 *    every intent, sends only what is permitted (or confirmed), and audits it with PROV.
 *
 * Every credential is an injected SEAM (Gmail token, pod fetch, channel send tokens, the
 * signed mandate, the Anthropic API key). M1 builds to the seams and stops there.
 *
 * @packageDocumentation
 */

export * as actor from "./actor/index.js";
// Flat re-exports of the primary entrypoints (the common consumer surface).
export {
  buildActorOptions,
  createClaudeActor,
  createGate,
  deriveProposals,
  runActorOnce,
} from "./actor/index.js";
export type { AgentIdentity, PodFetch, PodLayout } from "./config.js";
export { isSafeContainer } from "./config.js";
export * as mandate from "./mandate/index.js";
export {
  createSolidVcMandateVerifier,
  defaultAutonomyPolicy,
  evaluateAutonomy,
  type MandateVerifier,
  withAutonomousScheduling,
} from "./mandate/index.js";
export * as outbox from "./outbox/index.js";
export {
  type ChannelSender,
  confirmProposal,
  type ExecutorConfig,
  type ExecutorResult,
  ReceiptPersistenceError,
  RecordingSender,
  runOutboxOnce,
} from "./outbox/index.js";
export type { ActionProposal, Confirmation, LoadedProposal } from "./pod/index.js";
export * as pod from "./pod/index.js";
export { proposalContentDigest, writeConfirmation } from "./pod/index.js";
export * as reader from "./reader/index.js";
export { GmailChannelAdapter, runReader } from "./reader/index.js";
export * as vocab from "./vocab.js";
