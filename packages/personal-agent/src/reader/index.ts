// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/** The Reader — untrusted-channel ingest into the owner-private pod (§2/§4). */
export {
  GmailChannelAdapter,
  type GmailChannelAdapterOptions,
  type GmailTokenProvider,
} from "./gmail.js";
export { buildReaderInterpreter, type ReaderInterpreterOptions } from "./interpreter.js";
export { type RunReaderOptions, runReader } from "./run.js";
