/**
 * Calendar and meeting actions.
 *  - calendar.availability      read     ranked free times over all authoritative calendars
 *  - meeting.prepare-proposal   prepare  options + reply templates (human text and structured)
 *  - meeting.check-slot         prepare  re-checks ONE chosen slot against fresh data (the
 *                                        confirmation step); books nothing
 *  - agent.propose-meeting      local-write  starts a scheduling negotiation in a managed agent's
 *                                        runtime (pinned peer, owner mandate; the runtime's policy
 *                                        module decides its steps) and writes the first signed
 *                                        outbound message for review; nothing is sent
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { agentRunning } from "../../dashboard/calendars.js";
import { readAvailabilityOverlay } from "../../pilot/availability.js";
import { main as pilot } from "../../pilot/cli.js";
import { iso } from "../../pilot/core/schema.js";
import type { ActionsEnv, Ctx } from "../env.js";
import type { ActionDefinition } from "../types.js";
import {
  type AvailabilityInput,
  availabilityInput,
  availabilityPermissions,
  availabilityResult,
  computeAvailability,
  formatLocal,
  overridePermissions,
} from "./availability.js";

const nextWeekdayWindow = (ctx: Ctx) => {
  const d = new Date(ctx.schedulingNow());
  d.setUTCDate(d.getUTCDate() + 1);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  const day = d.toISOString().slice(0, 10);
  const end = new Date(`${day}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 3);
  return { start: `${day}T00:00:00Z`, end: end.toISOString().replace(".000Z", "Z") };
};
const exampleAvailability = (ctx: Ctx): AvailabilityInput => ({
  window: nextWeekdayWindow(ctx),
  durationMinutes: 30,
  bufferMinutes: 10,
  maxProposals: 5,
  ranking: "spread",
});

export const availabilityAction: ActionDefinition<
  AvailabilityInput,
  z.infer<typeof availabilityResult>,
  ActionsEnv
> = {
  id: "calendar.availability",
  version: "1",
  title: "Find free times",
  description:
    "Ranked free times of a given length within working hours, over every calendar the owner selected as authoritative (agent synthetic, dashboard synthetic, Google, Microsoft), with buffers, time zone and DST. Returns slots, merged busy time and per-source coverage — never event titles or attendees.",
  effect: "read",
  capabilities: ["calendar.read-availability"],
  limitations: [
    "Any selected calendar that cannot be read completely blocks the whole answer (no partial availability).",
    "Results are valid for 5 minutes and cover exactly the requested window; they are not cached.",
    "Microsoft tentative, out-of-office, working-elsewhere and unknown times count as busy.",
    "Free times are on the agent's 30-minute grid.",
    "Needs the calendars' 'read availability' permission only — never an account's 'Read messages'.",
    "Time zone / working-hours overrides are accepted from owner/operator surfaces only; a message or an extraction cannot widen availability.",
    "A provider observation older than 60 s when the answer is finalised blocks it; validity counts from the oldest provider read. All provider reads share a 30 s budget.",
  ],
  input: availabilityInput,
  result: availabilityResult,
  example: exampleAvailability,
  permissions: (ctx, input) => [
    ...availabilityPermissions(ctx),
    ...overridePermissions(ctx, input),
  ],
  async prepare(ctx, input) {
    const { calendar: _calendar, ...outcome } = await computeAvailability(ctx, input);
    return outcome;
  },
};

// ------------------------------------------------------------------ meeting proposal

const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => !/\p{Cc}/u.test(v), "no control characters or line breaks");

const proposalInput = z.strictObject({
  availability: availabilityInput,
  title: text(120).min(1),
  counterpartName: text(80).optional(),
});
const proposalResult = z.strictObject({
  title: z.string(),
  timeZone: z.string(),
  durationMinutes: z.number(),
  validUntil: z.string(),
  options: z.array(
    z.strictObject({ rank: z.number(), start: z.string(), end: z.string(), local: z.string() }),
  ),
  templates: z.strictObject({
    email: z.strictObject({ subject: z.string(), text: z.string() }),
    chat: z.strictObject({ text: z.string() }),
  }),
  structured: z.strictObject({
    type: z.literal("awp-meeting-options/0.1"),
    title: z.string(),
    durationMinutes: z.number(),
    timeZone: z.string(),
    options: z.array(z.strictObject({ start: z.string(), end: z.string() })),
    validUntil: z.string(),
  }),
  coverage: availabilityResult.shape.sources,
  next: z.array(z.string()),
});

export function renderOptions(
  name: string | undefined,
  title: string,
  options: { local: string }[],
): { email: { subject: string; text: string }; chat: { text: string } } {
  const list = options.map((o, i) => `${i + 1}. ${o.local}`);
  return {
    email: {
      subject: `Times for ${title}`,
      text: [
        `Hello${name ? ` ${name}` : ""},`,
        "",
        `These times work for me for ${title}:`,
        "",
        ...list,
        "",
        "Please reply with the one that suits you. Nothing is booked until we have both confirmed.",
      ].join("\n"),
    },
    chat: {
      text: `Times that work for me for ${title}: ${options.map((o, i) => `(${i + 1}) ${o.local}`).join("; ")}. Which suits you? Nothing is booked yet.`,
    },
  };
}

export const proposalAction: ActionDefinition<
  z.infer<typeof proposalInput>,
  z.infer<typeof proposalResult>,
  ActionsEnv
> = {
  id: "meeting.prepare-proposal",
  version: "1",
  title: "Prepare a meeting proposal",
  description:
    "Computes fresh availability and prepares options for a meeting: plain-text email and chat templates and a structured list, for the owner to review and send. Books nothing and sends nothing; confirming a chosen time is the separate meeting.check-slot action.",
  effect: "prepare",
  capabilities: ["calendar.read-availability"],
  limitations: [
    "The options expire with the availability they came from (5 minutes); prepare again after that.",
  ],
  input: proposalInput,
  result: proposalResult,
  example: (ctx) => ({
    availability: exampleAvailability(ctx),
    title: "a 30-minute catch-up",
    counterpartName: "Sam",
  }),
  permissions: (ctx, input) => [
    ...availabilityPermissions(ctx),
    ...overridePermissions(ctx, input.availability),
  ],
  async prepare(ctx, input) {
    const a = await computeAvailability(ctx, input.availability);
    if (a.status !== "ok" || !a.result) return { status: a.status, reasons: a.reasons };
    const r = a.result;
    if (r.proposals.length === 0) return { status: "needs-review", reasons: a.reasons };
    return {
      status: "ok",
      reasons: [],
      result: {
        title: input.title,
        timeZone: r.timeZone,
        durationMinutes: r.durationMinutes,
        validUntil: r.validUntil,
        options: r.proposals,
        templates: renderOptions(input.counterpartName, input.title, r.proposals),
        structured: {
          type: "awp-meeting-options/0.1",
          title: input.title,
          durationMinutes: r.durationMinutes,
          timeZone: r.timeZone,
          options: r.proposals.map(({ start, end }) => ({ start, end })),
          validUntil: r.validUntil,
        },
        coverage: r.sources,
        next: [
          "message.prepare (template availability-reply) to render it for a specific account",
          "meeting.check-slot with the chosen option before anything is booked",
        ],
      },
    };
  },
};

// ------------------------------------------------------------------ confirmation check

const checkInput = z.strictObject({
  slot: z
    .strictObject({ start: iso, end: iso })
    .refine((s) => Date.parse(s.end) > Date.parse(s.start)),
  bufferMinutes: z.number().int().min(0).max(120).default(0),
  /** The availability the slot came from (only its times are used, to report staleness). */
  basedOn: z.strictObject({ computedAt: iso, validUntil: iso }).optional(),
});
const checkResult = z.strictObject({
  slot: z.strictObject({ start: z.string(), end: z.string(), local: z.string() }),
  free: z.boolean(),
  earlierAvailabilityExpired: z.boolean().optional(),
  coverage: availabilityResult.shape.sources,
  checkedAt: z.string(),
  booking: z.string(),
});

export const checkSlotAction: ActionDefinition<
  z.infer<typeof checkInput>,
  z.infer<typeof checkResult>,
  ActionsEnv
> = {
  id: "meeting.check-slot",
  version: "1",
  title: "Check a chosen time",
  description:
    "The confirmation step: re-reads every authoritative calendar for the chosen time (never reusing earlier results) and says whether it is still free and within working hours. It does not book: it explains where booking would happen.",
  effect: "prepare",
  capabilities: ["calendar.read-availability"],
  limitations: ["Provider event creation is not implemented; nothing is booked by this action."],
  input: checkInput,
  result: checkResult,
  example: (ctx) => {
    const w = nextWeekdayWindow(ctx);
    const start = w.start.replace("T00:00:00Z", "T10:00:00Z");
    return { slot: { start, end: start.replace("T10:00:00Z", "T10:30:00Z") }, bufferMinutes: 0 };
  },
  permissions: (ctx) => availabilityPermissions(ctx),
  async prepare(ctx, input) {
    const minutes = Math.round(
      (Date.parse(input.slot.end) - Date.parse(input.slot.start)) / 60_000,
    );
    const a = await computeAvailability(ctx, {
      window: input.slot,
      durationMinutes: Math.min(480, Math.max(15, minutes)),
      bufferMinutes: input.bufferMinutes,
      maxProposals: 1,
      ranking: "earliest",
    });
    if (a.status !== "ok" || !a.result) return { status: a.status, reasons: a.reasons };
    const free = a.calendar.acceptable(input.slot, ctx.schedulingNow().getTime());
    const expired = input.basedOn
      ? Date.parse(input.basedOn.validUntil) <= ctx.now().getTime()
      : undefined;
    return {
      status: free ? "ok" : "needs-review",
      reasons: [
        ...(free
          ? []
          : ["this time is no longer free (or outside working hours) in the selected calendars"]),
        ...(expired ? ["the earlier availability had expired; this check used fresh data"] : []),
      ],
      result: {
        slot: { ...input.slot, local: formatLocal(input.slot, a.result.timeZone) },
        free,
        ...(expired !== undefined ? { earlierAvailabilityExpired: expired } : {}),
        coverage: a.result.sources,
        checkedAt: a.result.computedAt,
        booking:
          "Not booked. Provider event creation is not implemented. A managed agent books only on its own synthetic calendar, through its runtime and the owner mandate, and refuses while calendars it cannot read count for availability.",
      },
    };
  },
};

// ------------------------------------------------------------------ runtime proposal (execute)

const iri = z
  .string()
  .max(300)
  .regex(/^(https:\/\/|urn:)[^\s]+$/, "an https: or urn: identifier");
const proposeInput = z.strictObject({
  agent: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  peerActor: iri,
  peerParty: iri,
  window: z
    .strictObject({ start: iso, end: iso })
    .refine((w) => Date.parse(w.end) > Date.parse(w.start)),
  durationMinutes: z.number().int().min(15).max(240),
  title: text(120).min(1),
});
const proposePlan = z.strictObject({
  agent: z.string(),
  peer: z.strictObject({ actor: z.string(), party: z.string() }),
  window: z.strictObject({ start: z.string(), end: z.string() }),
  durationMinutes: z.number(),
  title: z.string(),
  runtimeAvailability: z.string(),
  effect: z.string(),
});

function pinnedSubjects(agentsDir: string, agent: string): Set<string> {
  const path = join(agentsDir, agent, "trust.json");
  if (!existsSync(path)) return new Set();
  const trust = JSON.parse(readFileSync(path, "utf8")) as { keys?: { subject?: string }[] };
  return new Set((trust.keys ?? []).map((k) => String(k.subject ?? "")));
}

export const proposeAction: ActionDefinition<
  z.infer<typeof proposeInput>,
  z.infer<typeof proposePlan>,
  ActionsEnv
> = {
  id: "agent.propose-meeting",
  version: "1",
  title: "Propose a meeting to a pinned agent",
  description:
    "Prepare: checks the managed agent, the pinned peer and the agent's applied availability. Execute (operator only): the agent's own runtime starts a scheduling negotiation with the pinned peer — its first signed message is a discovery request — and writes it as a reviewed outbound file. The runtime's policy module (SPARQ) decides the authorised steps as the exchange continues through the agent's usual operator path (process / MCP). Nothing is sent.",
  effect: "local-write",
  capabilities: ["agent.propose-meeting (owner mandate, decided by the agent's policy module)"],
  limitations: [
    "Peers must already be pinned by the operator; nothing in the request can add trust.",
    "Uses the agent's runtime calendar, which blocks while provider calendars count for availability.",
    "The agent must not be running (its runtime owns its state); use its MCP propose_meeting tool then.",
  ],
  input: proposeInput,
  result: proposePlan,
  example: (ctx) => ({
    agent: ctx.env.settings.managedAgents[0] ?? "demo-owner",
    peerActor: "https://agents.peer.example/personal#agent",
    peerParty: "https://peer.example/#me",
    window: nextWeekdayWindow(ctx),
    durationMinutes: 30,
    title: "A synthetic catch-up",
  }),
  permissions(ctx, input) {
    const managed = ctx.env.settings.managedAgents.includes(input.agent);
    const pinned = pinnedSubjects(ctx.env.agentsDir, input.agent);
    return [
      {
        subject: input.agent,
        capability: "agent.managed",
        allowed: managed,
        why: managed ? "managed by this dashboard" : "not an agent this dashboard manages",
      },
      {
        subject: input.peerActor,
        capability: "peer.pinned",
        allowed: pinned.has(input.peerActor) && pinned.has(input.peerParty),
        why:
          pinned.has(input.peerActor) && pinned.has(input.peerParty)
            ? "peer keys pinned by the operator"
            : "peer is not pinned for this agent (the request cannot add trust)",
      },
    ];
  },
  async prepare(ctx, input) {
    const dir = join(ctx.env.agentsDir, input.agent);
    if (agentRunning(dir))
      return {
        status: "needs-review",
        reasons: ["the agent is running; use its own MCP propose_meeting tool"],
      };
    const overlay = readAvailabilityOverlay(dir);
    if (overlay?.blocked)
      return {
        status: "blocked",
        reasons: [`the agent's applied availability is blocked: ${overlay.blocked.reason}`],
      };
    return {
      status: "ok",
      reasons: [],
      result: {
        agent: input.agent,
        peer: { actor: input.peerActor, party: input.peerParty },
        window: input.window,
        durationMinutes: input.durationMinutes,
        title: input.title,
        runtimeAvailability: overlay
          ? `owner settings revision ${overlay.revision} applied`
          : "the agent's own calendar only (no owner settings applied)",
        effect:
          "Execution records a new negotiation in the agent's state and writes its first signed outbound message (discovery) for review. Nothing is sent.",
      },
    };
  },
  async execute(ctx, input) {
    const out = join(ctx.env.stateDir, "outbound", input.agent);
    mkdirSync(out, { recursive: true, mode: 0o700 });
    let printed = "";
    const scrub = (m: string) =>
      m
        .split(ctx.env.agentsDir)
        .join("<agents>")
        .split(ctx.env.stateDir)
        .join("<state>")
        .slice(0, 300);
    try {
      const code = await pilot(
        [
          "propose-meeting",
          "--name",
          input.agent,
          "--peer-actor",
          input.peerActor,
          "--peer-party",
          input.peerParty,
          "--window-start",
          input.window.start,
          "--window-end",
          input.window.end,
          "--duration",
          String(input.durationMinutes),
          "--title",
          input.title,
          "--out",
          out,
          "--dir",
          ctx.env.agentsDir,
          "--now",
          ctx.schedulingNow().toISOString(),
        ],
        {
          stdout: (s) => {
            printed += s;
          },
        },
      );
      if (code !== 0)
        return { status: "blocked", reasons: [`the agent runtime stopped (exit ${code})`] };
    } catch (error) {
      return {
        status: "blocked",
        reasons: [`the agent runtime refused: ${scrub((error as Error).message)}`],
      };
    }
    const r = JSON.parse(printed) as { step?: unknown; files?: string[]; notice?: string };
    return {
      status: "ok",
      reasons: [],
      result: { step: r.step, files: (r.files ?? []).map((f) => basename(f)), notice: r.notice },
    };
  },
};
