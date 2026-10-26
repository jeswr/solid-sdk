// AUTHORED-BY Codex GPT-6.1-Sol
export { composeMessage } from "./compose";
export { forward, reply, replyAll } from "./replies";
export type {
  Attachment,
  ComposedMessage,
  ComposeInput,
  ComposeSources,
  MailAddress,
  MessageDraft,
  OriginalMessage,
} from "./types";
export { ComposeError, type ComposeErrorCode } from "./validation";
