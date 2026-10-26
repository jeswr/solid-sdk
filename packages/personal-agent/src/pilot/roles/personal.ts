/**
 * The personal role: synthetic calendar scheduling (negotiated) and the UC-02 remembered
 * conventional scheduling service. Handlers and adapters are the existing domain code.
 */
import { z } from "zod";
import { ConventionalBookingAdapter } from "../domains/conventional/adapter.js";
import {
  buildMeetingTerms,
  CalendarHoldAdapter,
  MEETING_MODEL,
  SCHEDULE_OP,
  SchedulingHandler,
} from "../domains/scheduling.js";
import { NOT_SENT_NOTICE, summariseStep } from "../service.js";
import type { OperationContext, OperatorOperation, RoleDefinition } from "./types.js";

export const ISO_INSTANT = z
  .string()
  .max(64)
  .refine((s) => !Number.isNaN(Date.parse(s)) && /Z|[+-]\d\d:\d\d$/.test(s), "ISO instant");

function proposeMeeting(ctx: OperationContext): OperatorOperation {
  return {
    name: "propose_meeting",
    title: "Propose a synthetic meeting",
    description:
      "Start a scheduling negotiation with an already pinned peer, decided by this agent's owner mandate and policy module. " +
      "Returns the reviewed signed outbound envelopes (nothing is sent).",
    input: {
      peerActor: z.string().min(8).max(512),
      windowStart: ISO_INSTANT,
      windowEnd: ISO_INSTANT,
      durationMinutes: z.number().int().min(5).max(480).optional(),
      title: z.string().min(1).max(120).optional(),
    },
    async run(raw) {
      const args = raw as {
        peerActor: string;
        windowStart: string;
        windowEnd: string;
        durationMinutes?: number;
        title?: string;
      };
      const peer = ctx.pinnedPeer(args.peerActor);
      const terms = buildMeetingTerms({
        calendar: ctx.calendar,
        title: args.title ?? "Synthetic test meeting",
        durationMinutes: args.durationMinutes ?? 30,
        window: { start: args.windowStart, end: args.windowEnd },
        now: ctx.now().toISOString(),
      });
      if (terms.candidates.length === 0)
        throw new Error("no free slot of that duration in the window");
      const step = await ctx.rt.startNegotiation({
        peer,
        operation: SCHEDULE_OP,
        terms: terms as never,
        models: [MEETING_MODEL],
      });
      const items = await ctx.prepare(step.outbound);
      return { step: summariseStep(step), outbound: ctx.show(items), notice: NOT_SENT_NOTICE };
    },
  };
}

export const PERSONAL_ROLE: RoleDefinition = {
  id: "personal",
  label: "Personal agent: synthetic calendar scheduling and remembered scheduling links",
  synthetic: true,
  representationOperations: [SCHEDULE_OP.id],
  build(ctx) {
    return {
      handlers: [new SchedulingHandler(ctx.calendar)],
      effects: [
        ctx.wrapEffect(new CalendarHoldAdapter(ctx.calendar)),
        new ConventionalBookingAdapter(ctx.clients as never),
      ],
      operations: (opCtx) => [proposeMeeting(opCtx)],
    };
  },
};
