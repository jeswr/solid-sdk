// AUTHORED-BY Codex GPT-6.1-Sol
import type { BridgeMessage } from "../message.js";

/** Low-trust inbox routing only: From does not authenticate LinkedIn or a member. */
export function triageLinkedInNotification(message: BridgeMessage): BridgeMessage {
  if (
    message.channel !== "email" ||
    !message.sender ||
    !/^(?:messages-noreply|notifications-noreply|updates-noreply|invitations)@linkedin\.com$/i.test(
      message.sender.handle,
    )
  )
    return message;
  return {
    ...message,
    channel: "linkedin-proxy",
    warnings: [...message.warnings, "linkedin-proxy-unverified"],
  };
}
