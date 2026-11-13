// AUTHORED-BY Codex GPT-6
import { z } from "zod";
import { digestOf } from "../core/canonical.js";
import { id, iso } from "../core/schema.js";
export const dutyRuleSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("delete"),
    items: z.array(id).min(1),
    by: iso.optional(),
    on: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal("notify"),
    parties: z.array(id).min(1),
    withinSeconds: z.number().positive(),
    event: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal("inform-onward"), items: z.array(id).optional() }),
]);
export type DutyRule = z.infer<typeof dutyRuleSchema>;
export interface Transfer {
  item: string;
  digest: string;
  subject: string;
  to: { actor: string; party: string };
  agreement?: string;
  duties: DutyRule[];
  message: string;
  at: string;
}
export interface DutyWork {
  id: string;
  kind: "delete" | "notify" | "inform-onward";
  source: string;
  items: string[];
  subject?: string;
  event?: string;
  recipient?: { actor: string; party: string };
  due: string;
  status: "pending" | "discharged" | "acknowledged" | "missed" | "blocked";
  reason?: string;
  message?: string;
  conversation?: string;
  acknowledgedAt?: string;
  missedAt?: string;
}
export interface DutyState {
  transfers: Transfer[];
  incoming: Transfer[];
  work: Record<string, DutyWork>;
}
export function emptyDuties(): DutyState {
  return { transfers: [], incoming: [], work: {} };
}
/** Pure durable transitions shared by agreement duties and the legacy duty adapters. */
export function deadlineMissed(due: string, at: string) {
  return Date.parse(at) > Date.parse(due);
}
export class DutyExecutor {
  constructor(
    readonly state: DutyState,
    private readonly now: () => string,
    private readonly record: (r: { type: string; [key: string]: unknown }) => void,
  ) {}
  transfer(transfer: Transfer, incoming = false) {
    const list = incoming ? this.state.incoming : this.state.transfers;
    if (list.some((t) => t.message === transfer.message && t.item === transfer.item)) return;
    list.push(structuredClone(transfer));
    this.record({ type: incoming ? "item-received" : "item-released", ...transfer });
  }
  add(work: Omit<DutyWork, "id" | "status">) {
    const id = digestOf(work);
    if (!this.state.work[id]) {
      this.state.work[id] = { ...structuredClone(work), id, status: "pending" };
      this.record({ type: "duty-created", ...this.state.work[id] });
    }
    return this.state.work[id] as DutyWork;
  }
  inform(subject: string, items: string[], request: string) {
    const parts: {
      item: string;
      recipient: string;
      outcome: "pending" | "stop";
      reason?: string;
    }[] = [];
    for (const transfer of this.state.transfers.filter(
      (t) => items.includes(t.item) && t.subject === subject,
    )) {
      if (
        !transfer.agreement ||
        !transfer.duties.some(
          (d) => d.kind === "inform-onward" && (!d.items || d.items.includes(transfer.item)),
        )
      ) {
        parts.push({
          item: transfer.item,
          recipient: transfer.to.party,
          outcome: "stop",
          reason: "no-agreement",
        });
        this.record({
          type: "duty-undischargeable",
          item: transfer.item,
          recipient: transfer.to.party,
          reason: "no-agreement",
          request,
        });
        continue;
      }
      this.add({
        kind: "inform-onward",
        source: request,
        items: [transfer.item],
        subject,
        recipient: transfer.to,
        due: this.now(),
      });
      parts.push({ item: transfer.item, recipient: transfer.to.party, outcome: "pending" });
    }
    return parts;
  }
  audit() {
    for (const work of Object.values(this.state.work))
      if (
        work.kind === "notify" &&
        work.status !== "acknowledged" &&
        !work.missedAt &&
        deadlineMissed(work.due, this.now())
      ) {
        work.status = "missed";
        work.missedAt = this.now();
        this.record({ type: "duty-missed", ...work });
      }
    return structuredClone(Object.values(this.state.work));
  }
  sent(id: string, message: string, conversation: string) {
    const work = this.state.work[id];
    if (!work) return;
    work.message = message;
    work.conversation = conversation;
    if (work.status !== "missed") work.status = "discharged";
    this.record({ type: "duty-discharged", ...work });
  }
  acknowledge(conversation: string, party: string) {
    this.audit();
    const work = Object.values(this.state.work).find(
      (w) => w.conversation === conversation && w.recipient?.party === party,
    );
    if (!work) return;
    work.acknowledgedAt = this.now();
    if (!work.missedAt) work.status = "acknowledged";
    this.record({
      type: work.missedAt ? "duty-late-acknowledgement" : "duty-acknowledged",
      ...work,
    });
  }
}
