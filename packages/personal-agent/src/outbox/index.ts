// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/** The outbox — the deterministic, no-LLM, mandate-enforcing executor (§2/§5/§7). */
export { type ConfirmInput, classifyFriction, confirmProposal } from "./confirm.js";
// AUTHORED-BY Codex GPT-6
export {
  type ExecutorConfig,
  type ExecutorResult,
  ReceiptPersistenceError,
  runOutboxOnce,
} from "./executor.js";
export { type ReceiptOutcome, type SendReceiptInput, serializeSendReceipt } from "./receipt.js";
export {
  type ChannelSender,
  type MimePart,
  type OutboundMessage,
  RecordingSender,
  type SendReceipt,
} from "./sender.js";
