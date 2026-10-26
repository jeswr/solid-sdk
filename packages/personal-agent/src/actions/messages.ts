/**
 * message.prepare — render a reply from STRUCTURED inputs and FIXED templates, for one of the
 * owner's accounts, as local content for review. Gated by that account's draft permission (owner
 * restriction) and the workflow policy (`draft`). It never sends and never saves a provider
 * draft (no provider draft adapter exists); the result says so. Renderers are per channel group
 * (mail, chat) and know nothing about transport. Protocol metadata of the message being answered
 * (Message-ID, agent-protocol conversation) is carried through as validated values.
 */
import { z } from "zod";
import { channelGroup } from "../dashboard/model.js";
import { iso } from "../pilot/core/schema.js";
import { isTimeZone } from "../pilot/domains/scheduling.js";
import { formatLocal } from "./calendar/availability.js";
import type { ActionsEnv } from "./env.js";
import type { ActionDefinition } from "./types.js";

const MAX_OPTION_MS = 24 * 3_600_000;
export const CHAT_MAX_CHARS = 1000;
/** Phone messages: a few concatenated SMS segments at most. */
export const SMS_MAX_CHARS = 480;

const line = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => !/\p{Cc}/u.test(v), "no control characters or line breaks");

const templates = z.discriminatedUnion("template", [
  z.strictObject({
    template: z.literal("availability-reply"),
    title: line(120).min(1),
    timeZone: z.string().max(64).refine(isTimeZone, "unknown IANA time zone"),
    options: z
      .array(
        z
          .strictObject({ start: iso, end: iso })
          .refine(
            (o) =>
              Date.parse(o.end) > Date.parse(o.start) &&
              Date.parse(o.end) - Date.parse(o.start) <= MAX_OPTION_MS,
            "each option must end after it starts, within 24 hours",
          ),
      )
      .min(1)
      .max(10),
    validUntil: iso.optional(),
  }),
  z.strictObject({
    template: z.literal("acknowledgement"),
    topic: line(200).min(1),
    replyBy: iso.optional(),
  }),
  z.strictObject({
    template: z.literal("follow-up"),
    topic: line(200).min(1),
    since: iso.optional(),
  }),
]);

const input = z.strictObject({
  accountId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  recipientName: line(80).optional(),
  content: templates,
  inReplyTo: z
    .strictObject({
      subject: line(300).optional(),
      messageId: z
        .string()
        .max(300)
        .regex(/^<[^<>\s]+@[^<>\s]+>$/, "an RFC 5322 Message-ID")
        .optional(),
      /** Agent-protocol conversation this reply belongs to (preserved as metadata). */
      conversation: z
        .string()
        .max(300)
        .regex(/^(urn:|https:\/\/)\S+$/)
        .optional(),
    })
    .optional(),
});

const result = z.strictObject({
  accountId: z.string(),
  channel: z.string(),
  renderer: z.enum(["mail", "chat"]),
  prepared: z.strictObject({
    subject: z.string().optional(),
    text: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    threadRef: z.string().optional(),
  }),
  /** For availability replies: what the rendered times rest on (this action checks nothing). */
  basis: z
    .strictObject({
      availabilityCheckedHere: z.literal(false),
      suppliedValidUntil: z.string().optional(),
      note: z.string(),
    })
    .optional(),
  delivery: z.strictObject({
    state: z.literal("prepared-locally"),
    providerDraft: z.string(),
    send: z.string(),
  }),
});

const fmtDay = (v: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(v));

function body(i: z.infer<typeof input>): { subject: string; lines: string[]; short: string } {
  const hello = `Hello${i.recipientName ? ` ${i.recipientName}` : ""},`;
  const c = i.content;
  switch (c.template) {
    case "availability-reply": {
      const opts = c.options.map((o, n) => `${n + 1}. ${formatLocal(o, c.timeZone)}`);
      return {
        subject: `Times for ${c.title}`,
        lines: [
          hello,
          "",
          `These times work for me for ${c.title}:`,
          "",
          ...opts,
          "",
          "Please reply with the one that suits you. Nothing is booked until we have both confirmed.",
        ],
        short: `Times that work for me for ${c.title}: ${c.options.map((o, n) => `(${n + 1}) ${formatLocal(o, c.timeZone)}`).join("; ")}. Which suits you?`,
      };
    }
    case "acknowledgement":
      return {
        subject: `Received: ${c.topic}`,
        lines: [
          hello,
          "",
          `Thank you, I have received your message about ${c.topic}.`,
          c.replyBy
            ? `I will get back to you by ${fmtDay(c.replyBy, "UTC")}.`
            : "I will get back to you.",
        ],
        short: `Thanks, received your message about ${c.topic}.${c.replyBy ? ` I'll reply by ${fmtDay(c.replyBy, "UTC")}.` : ""}`,
      };
    case "follow-up":
      return {
        subject: `Following up: ${c.topic}`,
        lines: [
          hello,
          "",
          `I am following up on ${c.topic}${c.since ? ` from ${fmtDay(c.since, "UTC")}` : ""}.`,
          "Could you let me know where this stands?",
        ],
        short: `Following up on ${c.topic}${c.since ? ` from ${fmtDay(c.since, "UTC")}` : ""}. Any update?`,
      };
  }
}

export const messagePrepareAction: ActionDefinition<
  z.infer<typeof input>,
  z.infer<typeof result>,
  ActionsEnv
> = {
  id: "message.prepare",
  version: "2",
  title: "Prepare a reply",
  description:
    "Renders an availability reply, an acknowledgement or a follow-up from structured fields and fixed templates, for one of your accounts (mail or chat renderer). Local content for your review: nothing is sent, and no draft is saved at the provider.",
  effect: "prepare",
  capabilities: ["account.draft"],
  limitations: [
    "Fixed templates only; no free-form or generated text.",
    "Provider drafts are not saved (no draft adapter yet) and nothing is ever sent from here.",
    "An availability reply renders the times it is given; it checks no calendar (the result's basis says so). Expired options (validUntil passed) are refused.",
    `Chat text longer than ${CHAT_MAX_CHARS} characters (${SMS_MAX_CHARS} for phone messages) is refused, never truncated.`,
  ],
  input,
  result,
  example: (ctx) => ({
    accountId: ctx.env.settings.connections.find((c) => c.restrictions.draft)?.id ?? "demo-mailbox",
    recipientName: "Sam",
    content: {
      template: "acknowledgement",
      topic: "the project update",
    },
  }),
  permissions(ctx, i) {
    const c = ctx.env.settings.connections.find((x) => x.id === i.accountId);
    const policy = ctx.env.settings.workflowPolicy;
    const check = (allowed: boolean, why: string) => ({
      subject: c?.label ?? i.accountId,
      capability: "account.draft",
      allowed,
      why,
    });
    if (!c) return [check(false, "no such account")];
    if (!c.restrictions.agentEnabled)
      return [check(false, "the account is excluded from the agent")];
    if (!c.restrictions.draft)
      return [check(false, "drafting is not allowed for this account (Connections page)")];
    if (!policy?.defaultAllowed.includes("draft"))
      return [
        check(false, "your communication policy does not allow drafting (or none is imported)"),
      ];
    return [check(true, "drafting allowed by you and by your policy")];
  },
  async prepare(ctx, i) {
    const c = ctx.env.settings.connections.find((x) => x.id === i.accountId);
    if (!c) return { status: "refused", reasons: ["no such account"] };
    const group = channelGroup(c.channel);
    if (group !== "email" && group !== "chat")
      return { status: "needs-setup", reasons: [`no renderer for “${c.channel}” accounts`] };
    const c0 = i.content;
    if (c0.template === "availability-reply" && c0.validUntil) {
      if (Date.parse(c0.validUntil) <= ctx.now().getTime())
        return {
          status: "needs-review",
          reasons: [
            `these options expired at ${c0.validUntil}; compute availability again (meeting.prepare-proposal) before replying`,
          ],
        };
    }
    const b = body(i);
    const chatText = `${i.recipientName ? `${i.recipientName}: ` : ""}${b.short}`;
    // Never cut a chat message (a truncated date or a dropped option would mislead).
    const limit = c.channel === "phone_messages" ? SMS_MAX_CHARS : CHAT_MAX_CHARS;
    if (group === "chat" && chatText.length > limit)
      return {
        status: "needs-review",
        reasons: [
          `the chat text would be ${chatText.length} characters (limit ${limit}); use fewer options or a shorter title/topic`,
        ],
      };
    const reSubject = i.inReplyTo?.subject
      ? /^re:/i.test(i.inReplyTo.subject)
        ? i.inReplyTo.subject
        : `Re: ${i.inReplyTo.subject}`
      : undefined;
    const headers: Record<string, string> = {};
    if (i.inReplyTo?.messageId) {
      headers["In-Reply-To"] = i.inReplyTo.messageId;
      headers.References = i.inReplyTo.messageId;
    }
    if (i.inReplyTo?.conversation) headers["X-AWP-Conversation"] = i.inReplyTo.conversation;
    return {
      status: "ok",
      reasons: [],
      result: {
        accountId: c.id,
        channel: c.channel,
        renderer: group === "email" ? "mail" : "chat",
        prepared:
          group === "email"
            ? {
                subject: reSubject ?? b.subject,
                text: b.lines.join("\n"),
                ...(Object.keys(headers).length ? { headers } : {}),
              }
            : {
                text: chatText,
                ...((i.inReplyTo?.conversation ?? i.inReplyTo?.messageId)
                  ? { threadRef: (i.inReplyTo?.conversation ?? i.inReplyTo?.messageId) as string }
                  : {}),
              },
        ...(c0.template === "availability-reply"
          ? {
              basis: {
                availabilityCheckedHere: false as const,
                ...(c0.validUntil ? { suppliedValidUntil: c0.validUntil } : {}),
                note: c0.validUntil
                  ? `Times as supplied, stated valid until ${c0.validUntil}. This action renders them; it did not check any calendar. Re-check a chosen time with meeting.check-slot before confirming.`
                  : "Unverified supplied suggestions: no validity was given and this action did not check any calendar. Prefer the options of meeting.prepare-proposal; re-check a chosen time with meeting.check-slot.",
              },
            }
          : {}),
        delivery: {
          state: "prepared-locally",
          providerDraft:
            "Not saved at the provider: no draft adapter is configured in this version.",
          send: "Not sent. Sending needs your review of this exact text and a separate, explicit instruction; this action cannot send.",
        },
      },
    };
  },
};
