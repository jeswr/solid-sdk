/**
 * The owner dashboard's persistent settings model (one JSON document, owner-private, 0600).
 * Every field has a bound; everything arriving from a browser or an import file is validated
 * against these schemas before it is stored. Nothing here holds a credential: connection
 * records describe accounts and evidence, never tokens or secrets.
 */
import { z } from "zod";
import { workingHoursSchema } from "../pilot/availability.js";
import { iso } from "../pilot/core/schema.js";
import { isTimeZone } from "../pilot/domains/scheduling.js";

export const SETTINGS_VERSION = 1;
export const MAX_CONNECTIONS = 200;
export const MAX_CALENDARS = 50;
export const MAX_BUSY = 200;
export const MAX_HISTORY = 200;

const text = (max: number) => z.string().max(max);
const label = z.string().trim().min(1).max(120);
export const recordId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "lowercase letters, digits and hyphens");
const channelName = z.string().regex(/^[a-z0-9_]{1,40}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const slot = z
  .strictObject({ start: iso, end: iso })
  .refine((s) => Date.parse(s.end) > Date.parse(s.start), "a busy period must end after it starts");

/** Owner restrictions per account. Default DENY: nothing is enabled until the owner enables it. */
export const restrictionsSchema = z.strictObject({
  /** The agent may use this account at all (master switch; off = locally excluded). */
  agentEnabled: z.boolean(),
  read: z.boolean(),
  triage: z.boolean(),
  draft: z.boolean(),
  /** Sample text for this account may be sent to the hosted triage provider (explicit consent). */
  hostedTriage: z.boolean(),
});
export type Restrictions = z.infer<typeof restrictionsSchema>;
export const DENY_ALL: Restrictions = {
  agentEnabled: false,
  read: false,
  triage: false,
  draft: false,
  hostedTriage: false,
};

export const connectionSchema = z.strictObject({
  id: recordId,
  label,
  /** Registry channel name, e.g. email, slack, whatsapp, github_notifications. */
  channel: channelName,
  provider: text(60),
  organisation: text(120),
  /** Private account identifiers (addresses, handles). Stored only in the ignored state. */
  identifiers: z.array(text(200)).max(10),
  origin: z.enum(["inventory", "manual", "demo"]),
  /** What the imported inventory said (a registry snapshot, not a live check). */
  inventory: z
    .strictObject({
      observedAt: iso,
      registryUpdated: text(40),
      connectorTarget: text(80),
      setupStatus: text(80),
      lastTested: text(40).optional(),
      lastTestResult: text(120).optional(),
      availableInMcp: z.boolean().optional(),
    })
    .optional(),
  /** Historic evidence from elsewhere (e.g. another tool's connector). Never current health. */
  evidence: z
    .array(
      z.strictObject({
        kind: z.enum(["codex-connector"]),
        observedOn: day,
        /** The exact identifier and method the observation was about (structured evidence). */
        identifier: text(200).optional(),
        method: text(80).optional(),
        summary: text(300),
      }),
    )
    .max(10),
  /** Unresolved identity conflicts (preserved, never silently merged). */
  conflicts: z.array(text(300)).max(10),
  /**
   * Local connector for THIS agent. No provider adapter is configured in this phase, so the
   * only states are "none" and "setup-required"; `target` is the owner's intended route.
   */
  localConnector: z.strictObject({
    state: z.enum(["none", "setup-required"]),
    target: text(80).optional(),
  }),
  restrictions: restrictionsSchema,
  notes: text(1000),
  updatedAt: iso,
  updatedBy: z.enum(["owner (dashboard)", "inventory import", "demo setup"]),
  /**
   * Set when `updatedAt` came from the synthetic demo clock (before the clocks were separated);
   * the time is kept as written and labelled, never silently rewritten.
   */
  updatedAtClock: z.literal("synthetic-demo").optional(),
});
export type Connection = z.infer<typeof connectionSchema>;

export const calendarSchema = z.strictObject({
  id: recordId,
  label,
  /**
   * agent-synthetic: the managed agent's own synthetic calendar (the only place holds are
   *   written; read by the dashboard, never written by it);
   * local-synthetic: an owner-defined synthetic calendar with busy periods kept here;
   * external: a provider calendar record (Google, Microsoft, CalDAV…) — setup required; it
   *   cannot be read in this phase, so it is never live-ready.
   */
  kind: z.enum(["agent-synthetic", "local-synthetic", "external"]),
  provider: text(60).optional(),
  /** For agent-synthetic: the managed agent's name. */
  agent: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
  /** For external: the connection record the calendar belongs to. */
  connectionId: recordId.optional(),
  /**
   * For external: the provider's calendar ID (Google calendar ID or `primary`; Microsoft calendar
   * id or `primary`). Read by the availability action's provider adapters; the agent runtime
   * itself cannot read provider calendars.
   */
  providerCalendarId: z
    .string()
    .regex(/^[A-Za-z0-9@._=+\-#]{1,300}$/)
    .optional(),
  busy: z.array(slot).max(MAX_BUSY),
  enabled: z.boolean(),
  permissions: z.strictObject({
    readAvailability: z.boolean(),
    createBookings: z.boolean(),
  }),
});
export type CalendarSource = z.infer<typeof calendarSchema>;

export const availabilitySchema = z.strictObject({
  /** Calendars whose busy time counts. Every one must be readable and available (fail closed). */
  authoritative: z.array(recordId).max(MAX_CALENDARS),
  /** Where confirmed synthetic holds are written. */
  bookingTarget: recordId.nullable(),
  timeZone: z.string().max(64).refine(isTimeZone, "unknown IANA time zone"),
  workingHours: workingHoursSchema,
});
export type Availability = z.infer<typeof availabilitySchema>;

/** Read-only copy of the owner's communication policy (from the inventory import). */
export const workflowPolicySchema = z.strictObject({
  source: text(200),
  lastUpdated: text(40),
  askWhenUncertain: z.array(text(80)).max(20),
  defaultAllowed: z.array(text(80)).max(20),
  requiresCurrentInstruction: z.array(text(80)).max(20),
  requiresFreshExplicitInstruction: z.array(text(80)).max(20),
  taxonomy: z.record(z.string().max(40), text(300)),
});
export type WorkflowPolicy = z.infer<typeof workflowPolicySchema>;

export const triageSettingsSchema = z.strictObject({
  /** Hosted (TypeSafe) triage is off unless the owner turns it on AND the server has a key. */
  hostedEnabled: z.boolean(),
});

export const historyEntrySchema = z.strictObject({
  revision: z.number().int().min(1),
  at: iso,
  actor: z.enum([
    "owner (dashboard)",
    "inventory import",
    "demo setup",
    "initialisation",
    "migration (CLI)",
  ]),
  action: text(80),
  summary: text(300),
  /** Set when `at` came from the synthetic demo clock (labelled by an explicit migration). */
  clock: z.literal("synthetic-demo").optional(),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const settingsSchema = z.strictObject({
  version: z.literal(SETTINGS_VERSION),
  revision: z.number().int().min(0),
  updatedAt: iso,
  inventory: z
    .strictObject({
      source: text(300),
      observedAt: iso,
      registryUpdated: text(40),
      notes: z.array(text(500)).max(20),
      /** Structured evidence that matched no account of its channel (kept, never attached). */
      unmatchedEvidence: z
        .array(
          z.strictObject({
            channel: text(40),
            provider: text(60),
            identifier: text(200),
            method: text(80),
            observedOn: day,
          }),
        )
        .max(50)
        .optional(),
    })
    .nullable(),
  connections: z.array(connectionSchema).max(MAX_CONNECTIONS),
  calendars: z.array(calendarSchema).max(MAX_CALENDARS),
  availability: availabilitySchema,
  workflowPolicy: workflowPolicySchema.nullable(),
  triage: triageSettingsSchema,
  /** Personal agents (in the dashboard's agents directory) whose availability it manages. */
  managedAgents: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(10),
  history: z.array(historyEntrySchema).max(MAX_HISTORY),
});
export type Settings = z.infer<typeof settingsSchema>;

export function emptySettings(now: string): Settings {
  return {
    version: SETTINGS_VERSION,
    revision: 0,
    updatedAt: now,
    inventory: null,
    connections: [],
    calendars: [],
    availability: {
      authoritative: [],
      bookingTarget: null,
      timeZone: "UTC",
      workingHours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] },
    },
    workflowPolicy: null,
    triage: { hostedEnabled: false },
    managedAgents: [],
    history: [],
  };
}

/** Coarse grouping for filters (the registry's channel names are kept as they are). */
export function channelGroup(channel: string): "email" | "chat" | "calendar" | "other" {
  if (channel === "email") return "email";
  if (channel === "calendar") return "calendar";
  if (
    [
      "slack",
      "whatsapp",
      "signal",
      "matrix",
      "matrix_bot",
      "microsoft_teams",
      "discord",
      "phone_messages",
    ].includes(channel)
  )
    return "chat";
  return "other";
}
