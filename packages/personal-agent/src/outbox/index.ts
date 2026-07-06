// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/** The outbox — the deterministic, no-LLM, mandate-enforcing executor (§2/§5/§7). */
export {
  type ConfirmInput,
  classifyFriction,
  confirmProposal,
  rejectProposal,
} from "./confirm.js";
export {
  type ExecutorConfig,
  type ExecutorResult,
  runOutboxOnce,
} from "./executor.js";
export { type SendReceiptInput, serializeSendReceipt } from "./receipt.js";
export {
  type ChannelSender,
  type MimePart,
  type OutboundMessage,
  RecordingSender,
  type SendReceipt,
} from "./sender.js";
