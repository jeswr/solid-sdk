// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
// AUTHORED-BY Codex GPT-6.1-Sol
/** The outbox — the deterministic, no-LLM, mandate-enforcing executor (§2/§5/§7). */
export {
  type ConfirmInput,
  classifyFriction,
  confirmProposal,
  type TrustedReplyThread,
} from "./confirm.js";
export { type ExecutorConfig, type ExecutorResult, runOutboxOnce } from "./executor.js";
export { type ReceiptOutcome, type SendReceiptInput, serializeSendReceipt } from "./receipt.js";
export {
  type ChannelSender,
  type MimePart,
  type OutboundMessage,
  RecordingSender,
  type SendReceipt,
} from "./sender.js";
