// AUTHORED-BY Codex GPT-6.1-Sol
import type { CarriageProfile } from "./binding.js";

/** DESIGN §3.2's accepted footer (J2). */
export const AGENT_FOOTER =
  "— Sent by Jesse Wright's software agent · how to talk to it: https://jeswr.org/agent · spec: https://jeswr.org/agentic-web";
// Only email's provider byte limit is specified in the design. Other profiles use
// conservative local ceilings pending their binding tasks, not provider-limit claims.
const profile = (
  id: string,
  structured: CarriageProfile["structured"],
  footer: CarriageProfile["footer"],
  maxBytes: number,
  envelopeMediaType?: string,
): CarriageProfile =>
  Object.freeze({
    id,
    structured,
    footer,
    maxBytes,
    ...(envelopeMediaType ? { envelopeMediaType } : {}),
  });

/** Email covers Gmail, Graph mail and Google Workspace. */
export const EMAIL_MIME = profile(
  "email-mime/0.1",
  "mime-part",
  "required",
  25_000_000,
  "application/ld+json",
);
export const SLACK_METADATA = profile(
  "slack-metadata/0.1",
  "metadata-field",
  "required",
  64 * 1024,
  "application/ld+json",
);
export const MATRIX_CONTENT = profile(
  "matrix-content/0.1",
  "event-content",
  "required",
  64 * 1024,
  "application/ld+json",
);
export const TEAMS_CARD = profile(
  "teams-card/0.1",
  "metadata-field",
  "required",
  64 * 1024,
  "application/ld+json",
);
export const A2A_DATA_PART = profile(
  "a2a-data-part/0.2",
  "native",
  "none",
  64 * 1024,
  "application/vnd.jeswr.agent-envelope+json",
);
export const MCP_STRUCTURED = profile(
  "mcp-structured/0.1",
  "native",
  "none",
  64 * 1024,
  "application/ld+json",
);
export const DISCORD_FOOTER = profile("discord-footer/0.1", "footer-url-only", "required", 256);
export const BLUESKY_FOOTER = profile("bluesky-footer/0.1", "footer-url-only", "required", 256);
export const MASTODON_FOOTER = profile("mastodon-footer/0.1", "footer-url-only", "required", 256);
export const TELEGRAM_FOOTER = profile("telegram-footer/0.1", "footer-url-only", "required", 256);
export const IMESSAGE_FOOTER = profile("imessage-footer/0.1", "footer-url-only", "required", 256);
export const SMS_FOOTER = profile("sms-footer/0.1", "footer-url-only", "required", 256);
export const SIGNAL_FOOTER = profile("signal-footer/0.1", "footer-url-only", "required", 256);
export const WHATSAPP_FOOTER = profile("whatsapp-footer/0.1", "footer-url-only", "required", 256);
/** Read-only proxies; zero bytes explicitly forbids rendering a send. */
export const LINKEDIN_READ_ONLY = profile("linkedin-read-only/0.1", "footer-url-only", "none", 0);
export const X_READ_ONLY = profile("x-read-only/0.1", "footer-url-only", "none", 0);
/** Local, structured loopback used by tests. */
export const DIRECT = profile(
  "direct-local/0.1",
  "native",
  "none",
  64 * 1024,
  "application/ld+json",
);
/** Every channel row in DESIGN §3.2; bindings remain separate implementations. */
export const CARRIAGE_PROFILES = Object.freeze({
  email: EMAIL_MIME,
  slack: SLACK_METADATA,
  matrix: MATRIX_CONTENT,
  teams: TEAMS_CARD,
  a2a: A2A_DATA_PART,
  mcp: MCP_STRUCTURED,
  discord: DISCORD_FOOTER,
  bluesky: BLUESKY_FOOTER,
  mastodon: MASTODON_FOOTER,
  telegram: TELEGRAM_FOOTER,
  imessage: IMESSAGE_FOOTER,
  sms: SMS_FOOTER,
  signal: SIGNAL_FOOTER,
  whatsapp: WHATSAPP_FOOTER,
  linkedin: LINKEDIN_READ_ONLY,
  x: X_READ_ONLY,
  direct: DIRECT,
});
