/**
 * inbox.normalise — a bounded, deterministic action queue from SUPPLIED items (exported or
 * adapter-provided data; this action reads no mailbox). Explicit rules only, in this order:
 *   account not allowed (included + read + triage, and policy `classify`) → excluded (FIRST, so
 *     an excluded item never takes part in de-duplication)
 *   same account + id, or same Message-ID: identical content → duplicate (dropped with a
 *     reference); different content → collision (both kept, both to manual review)
 *   agent-protocol marker → the agent runtime (verification decides; never classified)
 *   structured request (a typed `structured` field) → a suggested next action; the field is
 *     SUPPLIED data (not authenticated) and the suggestion carries no authority
 *   explicit deadline field → deadline, ordered by due time
 *   known subscription (List-Id the caller lists) → digest
 *   anything else → manual review / triage
 * Free text is NOT interpreted: no keyword "understanding" is claimed.
 */
import { z } from "zod";
import { sampleTriagePermission } from "../dashboard/assess.js";
import { iso } from "../pilot/core/schema.js";
import { isAgentProtocolMessage } from "../triage/triage.js";
import type { ActionsEnv } from "./env.js";
import type { ActionDefinition } from "./types.js";

const item = z.strictObject({
  id: z.string().min(1).max(200),
  accountId: z.string().max(64),
  receivedAt: iso,
  from: z.string().max(200).optional(),
  subject: z.string().max(300).optional(),
  text: z.string().max(4000).optional(),
  headers: z.record(z.string().max(60), z.string().max(500)).optional(),
  /** An explicit, machine-provided deadline (e.g. a task or invitation field), not parsed text. */
  dueAt: iso.optional(),
  structured: z
    .discriminatedUnion("type", [
      z.strictObject({
        type: z.literal("meeting-request"),
        window: z.strictObject({ start: iso, end: iso }),
        durationMinutes: z.number().int().min(15).max(480),
      }),
      z.strictObject({ type: z.literal("task"), dueAt: iso }),
    ])
    .optional(),
});

const input = z.strictObject({
  items: z.array(item).max(200),
  /** List-Id values the owner recognises as subscriptions. */
  knownSubscriptions: z.array(z.string().max(200)).max(100).default([]),
});

const category = z.enum([
  "agent-protocol",
  "structured-request",
  "deadline",
  "manual-review",
  "subscription",
]);
const result = z.strictObject({
  queue: z.array(
    z.strictObject({
      id: z.string(),
      accountId: z.string(),
      category,
      receivedAt: z.string(),
      dueAt: z.string().optional(),
      overdue: z.boolean().optional(),
      next: z.strictObject({
        action: z.string().optional(),
        input: z.unknown().optional(),
        route: z.string(),
      }),
      rule: z.string(),
    }),
  ),
  excluded: z.array(z.strictObject({ id: z.string(), accountId: z.string(), why: z.string() })),
  duplicates: z.array(z.strictObject({ id: z.string(), duplicateOf: z.string() })),
  /** Same identifier, different content: both kept, both to manual review. */
  collisions: z.array(z.strictObject({ id: z.string(), collidesWith: z.string() })),
});
type Item = z.infer<typeof item>;

/** What must be equal for two records with one identifier to count as the same message. */
const fingerprint = (m: Item) =>
  JSON.stringify([
    m.from ?? null,
    m.subject ?? null,
    m.text ?? null,
    m.dueAt ?? null,
    m.structured ?? null,
    header(m.headers, "list-id") ?? null,
  ]);

const ORDER: Record<z.infer<typeof category>, number> = {
  "agent-protocol": 0,
  "structured-request": 1,
  deadline: 2,
  "manual-review": 3,
  subscription: 4,
};

const header = (h: Record<string, string> | undefined, name: string) =>
  Object.entries(h ?? {}).find(([k]) => k.toLowerCase() === name)?.[1];

export const inboxNormaliseAction: ActionDefinition<
  z.infer<typeof input>,
  z.infer<typeof result>,
  ActionsEnv
> = {
  id: "inbox.normalise",
  version: "2",
  title: "Sort supplied messages into an action queue",
  description:
    "Turns supplied message or notification records into a deterministic queue using explicit rules (duplicates, agent-protocol markers, structured requests, explicit deadlines, known subscriptions). Everything else goes to manual review or triage: free text is not interpreted.",
  effect: "read",
  capabilities: ["account.read", "account.triage"],
  limitations: [
    "Works on supplied data only; no mailbox or chat is read by this action.",
    "An agent-protocol marker is routed to the agent runtime, whose verification decides; the marker proves nothing.",
    "Message identifiers are untrusted: identical content is de-duplicated, different content under one identifier is a collision for review.",
  ],
  input,
  result,
  example: (ctx) => {
    const account = ctx.env.settings.connections[0]?.id ?? "demo-mailbox";
    const t = ctx.schedulingNow().toISOString();
    return {
      items: [
        {
          id: "m-1",
          accountId: account,
          receivedAt: t,
          subject: "Meeting next week",
          structured: {
            type: "meeting-request",
            window: { start: t, end: new Date(Date.parse(t) + 3 * 86_400_000).toISOString() },
            durationMinutes: 30,
          },
        },
        {
          id: "m-2",
          accountId: account,
          receivedAt: t,
          subject: "Weekly digest",
          headers: { "List-Id": "<news.example.org>" },
        },
        {
          id: "m-3",
          accountId: account,
          receivedAt: t,
          subject: "Can we talk?",
          text: "Free text is not interpreted here.",
        },
      ],
      knownSubscriptions: ["<news.example.org>"],
    };
  },
  async prepare(ctx, i) {
    const s = ctx.env.settings;
    const queue: z.infer<typeof result>["queue"] = [];
    const excluded: z.infer<typeof result>["excluded"] = [];
    const duplicates: z.infer<typeof result>["duplicates"] = [];
    const collisions: z.infer<typeof result>["collisions"] = [];
    const now = ctx.schedulingNow().getTime();
    const subscriptions = new Set(i.knownSubscriptions.map((x) => x.toLowerCase()));
    // 1. Eligibility FIRST: an item from an excluded or unknown account is excluded and takes no
    //    part in de-duplication (it cannot suppress an allowed account's item).
    const eligible: Item[] = [];
    for (const m of i.items) {
      const account = s.connections.find((c) => c.id === m.accountId);
      const permission = account
        ? sampleTriagePermission(account, s.workflowPolicy)
        : { allowed: false, why: "unknown account" };
      if (permission.allowed) eligible.push(m);
      else excluded.push({ id: m.id, accountId: m.accountId, why: permission.why });
    }
    // 2. Identifiers are untrusted: the same (account, id) or Message-ID with the SAME content is a
    //    duplicate; with DIFFERENT content it is a collision — nothing is dropped, every item
    //    involved goes to manual review.
    const seen = new Map<string, Item>();
    const collided = new Set<Item>();
    const kept: Item[] = [];
    for (const m of eligible) {
      const messageId = header(m.headers, "message-id");
      const keys = [`${m.accountId}\u0000${m.id}`, ...(messageId ? [`mid\u0000${messageId}`] : [])];
      const earlier = keys.map((k) => seen.get(k)).find((x) => x !== undefined);
      if (earlier && fingerprint(earlier) === fingerprint(m)) {
        duplicates.push({ id: m.id, duplicateOf: earlier.id });
        continue;
      }
      if (earlier) {
        collided.add(earlier).add(m);
        collisions.push({ id: m.id, collidesWith: earlier.id });
      } else for (const k of keys) seen.set(k, m);
      kept.push(m);
    }
    for (const m of kept) {
      const base = { id: m.id, accountId: m.accountId, receivedAt: m.receivedAt };
      if (collided.has(m)) {
        queue.push({
          ...base,
          category: "manual-review",
          next: { route: "owner review (identifier collision)" },
          rule: "same message identifier as another item with different content (not de-duplicated)",
        });
        continue;
      }
      const headerText = Object.entries(m.headers ?? {})
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      const listId = header(m.headers, "list-id");
      const due = m.structured?.type === "task" ? m.structured.dueAt : m.dueAt;
      if (isAgentProtocolMessage(`${headerText}\n${m.subject ?? ""}\n${m.text ?? ""}`))
        queue.push({
          ...base,
          category: "agent-protocol",
          next: { route: "agent-runtime (signature verification decides)" },
          rule: "agent-protocol marker",
        });
      else if (m.structured?.type === "meeting-request")
        queue.push({
          ...base,
          category: "structured-request",
          next: {
            route: "calendar",
            action: "calendar.availability",
            input: { window: m.structured.window, durationMinutes: m.structured.durationMinutes },
          },
          rule: "structured meeting request (supplied field; not authenticated)",
        });
      else if (due)
        queue.push({
          ...base,
          category: "deadline",
          dueAt: due,
          overdue: Date.parse(due) < now,
          next: { route: "owner" },
          rule: "explicit deadline field",
        });
      else if (listId && subscriptions.has(listId.toLowerCase()))
        queue.push({
          ...base,
          category: "subscription",
          next: { route: "digest" },
          rule: "known subscription (List-Id)",
        });
      else
        queue.push({
          ...base,
          category: "manual-review",
          next: { route: "triage or owner review" },
          rule: "no explicit rule applies (free text is not interpreted)",
        });
    }
    queue.sort(
      (a, b) =>
        ORDER[a.category] - ORDER[b.category] ||
        (a.dueAt && b.dueAt ? Date.parse(a.dueAt) - Date.parse(b.dueAt) : 0) ||
        Date.parse(a.receivedAt) - Date.parse(b.receivedAt) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    return { status: "ok", reasons: [], result: { queue, excluded, duplicates, collisions } };
  },
};
