/**
 * capabilities.matrix — what the agent can actually do per provider family, from the code that
 * exists (not from the inventory's hopes), joined with the owner's accounts. Statuses:
 *   implemented             works now (local, or on supplied data)
 *   configuration-dependent the adapter exists; needs a configured credential/calendar
 *   future                  no adapter in this version
 *   not-provided            deliberately absent (e.g. sending)
 */
import { z } from "zod";
import type { Connection } from "../dashboard/model.js";
import { providerFamily } from "./calendar/availability.js";
import type { ActionsEnv } from "./env.js";
import type { ActionDefinition } from "./types.js";

type Status = "implemented" | "configuration-dependent" | "future" | "not-provided";
const FAMILIES = [
  "google",
  "microsoft",
  "teams",
  "slack",
  "matrix",
  "signal",
  "sms",
  "github",
  "other",
] as const;
type Family = (typeof FAMILIES)[number];

const CHAT = {
  status: "implemented" as Status,
  via: "message.prepare (chat renderer, local content only)",
};
const SUPPLIED = { status: "implemented" as Status, via: "inbox.normalise (supplied data only)" };
const future = (what: string) => ({
  status: "future" as Status,
  via: `no ${what} adapter in this version`,
});
const NO_SEND = { status: "not-provided" as Status, via: "sending is not available from actions" };

const MATRIX: Record<Family, Record<string, { status: Status; via: string }>> = {
  google: {
    "calendar availability": {
      status: "configuration-dependent",
      via: "calendar.availability (Google freeBusy)",
    },
    "mail read": future("Gmail read"),
    "reply preparation": {
      status: "implemented",
      via: "message.prepare (mail renderer, local content only)",
    },
    "provider draft save": future("Gmail draft"),
    "queue from supplied items": SUPPLIED,
    send: NO_SEND,
  },
  microsoft: {
    "calendar availability": {
      status: "configuration-dependent",
      via: "calendar.availability (Graph calendarView)",
    },
    "mail read": future("Outlook mail read"),
    "reply preparation": {
      status: "implemented",
      via: "message.prepare (mail renderer, local content only)",
    },
    "provider draft save": future("Outlook draft"),
    "queue from supplied items": SUPPLIED,
    send: NO_SEND,
  },
  teams: {
    "chat read": future("Teams chat"),
    "reply preparation": CHAT,
    "queue from supplied items": SUPPLIED,
    send: NO_SEND,
  },
  slack: {
    "chat read": future("Slack"),
    "reply preparation": CHAT,
    "queue from supplied items": SUPPLIED,
    send: NO_SEND,
  },
  matrix: {
    "chat read": future("Matrix"),
    "reply preparation": CHAT,
    "queue from supplied items": SUPPLIED,
    send: NO_SEND,
  },
  signal: {
    "chat read": future("Signal"),
    "reply preparation": CHAT,
    "queue from supplied items": SUPPLIED,
    send: NO_SEND,
  },
  sms: {
    "message read": future("SMS/phone"),
    "reply preparation": CHAT,
    "queue from supplied items": SUPPLIED,
    send: NO_SEND,
  },
  github: {
    "notifications read": future("GitHub notifications"),
    "reply preparation": { status: "future", via: "no renderer for GitHub" },
    "queue from supplied items": SUPPLIED,
    send: NO_SEND,
  },
  other: { "queue from supplied items": SUPPLIED, send: NO_SEND },
};

/** Families with a provider (credentialed) adapter in this code: calendar availability only. */
const PROVIDER_ADAPTER = new Set<Family>(["google", "microsoft"]);

function familyOf(c: Connection): Family {
  if (c.channel === "microsoft_teams") return "teams";
  if (c.channel === "slack") return "slack";
  if (c.channel === "matrix" || c.channel === "matrix_bot") return "matrix";
  if (c.channel === "signal") return "signal";
  if (c.channel === "phone_messages") return "sms";
  if (c.channel === "github_notifications") return "github";
  return providerFamily(c.provider) ?? "other";
}

/**
 * An account's provider credential state. A fixture simulation is NOT a credential, and a family
 * without a provider adapter has none whatever the mode.
 */
export function credentialState(
  c: Connection,
  env: Pick<ActionsEnv, "providers" | "configuredConnections">,
): "configured" | "fixture-simulation" | "none" {
  if (!PROVIDER_ADAPTER.has(familyOf(c))) return "none";
  if (env.providers.mode === "fixture") return "fixture-simulation";
  return env.providers.mode === "live" && env.configuredConnections.includes(c.id)
    ? "configured"
    : "none";
}

const result = z.strictObject({
  providerMode: z.enum(["live", "fixture", "none"]),
  families: z.array(
    z.strictObject({
      family: z.string(),
      capabilities: z.array(
        z.strictObject({ capability: z.string(), status: z.string(), via: z.string() }),
      ),
      accounts: z.array(
        z.strictObject({
          id: z.string(),
          label: z.string(),
          included: z.boolean(),
          /**
           * configured: a real credential is configured for this account (live mode);
           * fixture-simulation: synthetic provider answers stand in (no credential exists);
           * none: neither. Only Google and Microsoft have a provider adapter at all.
           */
          credential: z.enum(["configured", "fixture-simulation", "none"]),
          calendarsSelected: z.number().int(),
        }),
      ),
    }),
  ),
});

export const capabilityMatrixAction: ActionDefinition<
  Record<string, never>,
  z.infer<typeof result>,
  ActionsEnv
> = {
  id: "capabilities.matrix",
  version: "2",
  title: "What can the agent do, per provider",
  description:
    "Per provider family (Google, Microsoft, Teams, Slack, Matrix, Signal, SMS, GitHub): which capabilities are implemented, depend on configuration, or are future, joined with your accounts and their credential state: a configured real credential, a fixture simulation (synthetic answers, no credential) or none (no secrets shown).",
  effect: "read",
  capabilities: [],
  limitations: ["Describes this code base; an account listed here is not a connection."],
  input: z.strictObject({}),
  result,
  example: () => ({}),
  async prepare(ctx) {
    const s = ctx.env.settings;
    const families = FAMILIES.map((family) => ({
      family,
      capabilities: Object.entries(MATRIX[family]).map(([capability, v]) => ({ capability, ...v })),
      accounts: s.connections
        .filter((c) => familyOf(c) === family)
        .map((c) => ({
          id: c.id,
          label: c.label,
          included: c.restrictions.agentEnabled,
          credential: credentialState(c, ctx.env),
          calendarsSelected: s.calendars.filter(
            (k) => k.connectionId === c.id && s.availability.authoritative.includes(k.id),
          ).length,
        })),
    }));
    return {
      status: "ok",
      reasons: [],
      result: { providerMode: ctx.env.providers.mode, families },
    };
  },
};
