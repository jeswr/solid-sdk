// AUTHORED-BY Codex GPT-6.1-Sol
/** Email defaults retained here; shared contracts and memory adapter live in agent-channels. */

import type { BridgeMessage, InboundRawMessage } from "@jeswr/agent-channels";
import { InMemoryChannelAdapter as SharedAdapter } from "@jeswr/agent-channels";
import { parseEmail } from "./email/index.js";
import { toBridgeMessage } from "./message.js";

export type { ChannelAdapter, InboundRawMessage, ReplyTarget } from "@jeswr/agent-channels";

/**
 * The EMAIL channel's `parse` — email is the first {@link ChannelAdapter}: the
 * hardened RFC 5322 / MIME parse ({@link parseEmail}) mapped 1:1 onto the
 * channel-neutral shape ({@link toBridgeMessage}). Throws `EmailParseError`
 * (a `ChannelParseError`) on an over-cap input, exactly as in M1.
 */
export function parseEmailInbound(item: InboundRawMessage): BridgeMessage {
  return toBridgeMessage(parseEmail(item.raw));
}

/** Compatibility adapter preserving the email-only default parser. */
export class InMemoryChannelAdapter extends SharedAdapter {
  constructor(
    channel: string,
    messages: readonly InboundRawMessage[],
    parse?: (item: InboundRawMessage) => BridgeMessage,
  ) {
    if (parse === undefined && channel !== "email") {
      throw new TypeError(
        "InMemoryChannelAdapter: a non-email channel requires an explicit parse function.",
      );
    }
    super(channel, messages, parse ?? parseEmailInbound);
  }
}
