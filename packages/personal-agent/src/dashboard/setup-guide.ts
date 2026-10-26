/**
 * Plain-language setup steps per kind of account. Nothing here connects anything: the steps say
 * what has to happen outside this dashboard, and what this agent can and cannot do today.
 */
import { type Connection, channelGroup } from "./model.js";

export interface SetupGuide {
  summary: string;
  steps: string[];
  disconnect: string;
}

const DISCONNECT =
  "Excluding an account here stops this agent from using it. It does not revoke anything at the provider; to revoke access, use the provider's own account security settings.";

export function setupGuide(c: Pick<Connection, "channel" | "provider" | "evidence">): SetupGuide {
  const codex =
    c.evidence.length > 0
      ? "Codex could reach this account through its own connector. That sign-in belongs to Codex; this agent cannot borrow it."
      : undefined;
  const group = channelGroup(c.channel);
  if (group === "email" && c.provider === "gmail")
    return {
      summary:
        "Gmail can be used through the agent's email adapter during a supervised session. Unattended use needs separate credentials.",
      steps: [
        ...(codex ? [codex] : []),
        "Decide the exact pair of accounts for the first synthetic test exchange and tell your supervisor. Existing mail in them is not read or changed by the test.",
        "Supervised test: your supervisor's connected session provides the Gmail access for that run only. No new sign-in is needed for it, and nothing is stored here.",
        "The first run is a dry run: you review every outgoing message exactly as it would be sent before anything is sent.",
        "Unattended use (the agent running on its own) needs credentials provisioned for this machine and limited to the approved accounts. This is not set up yet.",
      ],
      disconnect: DISCONNECT,
    };
  if (group === "email")
    return {
      summary:
        c.provider === "microsoft_365"
          ? "Microsoft 365 mail needs an organisation-approved app registration (often admin consent). No adapter for it exists in this agent yet."
          : "The mail provider is not confirmed. Confirm it first; then a connector can be planned.",
      steps: [
        ...(codex ? [codex] : []),
        "Confirm the provider and the address the agent should use.",
        "Arrange access with the organisation's IT administrators if it is a work account.",
        "A mail adapter for this provider has to be added to the agent before it can be used.",
      ],
      disconnect: DISCONNECT,
    };
  if (group === "calendar")
    return {
      summary:
        "The agent schedules against synthetic calendars only. A provider calendar cannot be read or written yet.",
      steps: [
        "Keep this calendar recorded here so it can be chosen once a calendar adapter exists.",
        "Until then it cannot count for availability or receive bookings; choosing it blocks scheduling instead of treating the time as free.",
      ],
      disconnect: DISCONNECT,
    };
  return {
    summary: "This agent has no adapter for this kind of account yet.",
    steps: [
      ...(codex ? [codex] : []),
      "Record the account identifier privately here so it is not guessed later.",
      "An adapter using the provider's documented API has to be added before the agent can use it. Your communication rules forbid automating the provider's own app interface.",
    ],
    disconnect: DISCONNECT,
  };
}
