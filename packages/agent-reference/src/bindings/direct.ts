/**
 * Direct local binding: an in-process message bus between runtimes. The wire unit is
 * serialised to JSON and back on every hop, exactly as it would be on a socket or file
 * spool, so no object identity leaks between agents. An optional interceptor lets tests
 * tamper with, duplicate, redirect or drop messages in transit.
 */
import type { Iri } from "../core/types.js";
import type { AgentRuntime, OutboundMessage, StepResult } from "../runtime/agent.js";
import type { WireMessage } from "../store/state.js";

export interface TraceEntry {
  readonly step: number;
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly messageId: Iri;
  readonly conversation: Iri;
  readonly disposition: string;
  readonly reason?: string;
  readonly phaseAfter?: string;
}

export type Interceptor = (item: {
  from: AgentRuntime;
  to: AgentRuntime;
  out: OutboundMessage;
}) => WireMessage | "drop" | { redirect: AgentRuntime; wire?: WireMessage } | undefined;

export class DirectBus {
  private readonly byActor = new Map<Iri, AgentRuntime>();
  private readonly origin = new Map<Iri, AgentRuntime>();
  private readonly queue: Array<{ from: AgentRuntime; out: OutboundMessage }> = [];
  readonly trace: TraceEntry[] = [];
  readonly results: StepResult[] = [];
  private step = 0;

  constructor(private readonly maxSteps = 200) {}

  register(...runtimes: AgentRuntime[]): this {
    for (const rt of runtimes) this.byActor.set(rt.identity.actor, rt);
    return this;
  }

  /** Queue the outbound messages of a step result produced by `from`. */
  send(from: AgentRuntime, result: StepResult | readonly OutboundMessage[]): this {
    const outs = Array.isArray(result) ? result : (result as StepResult).outbound;
    for (const out of outs) {
      // Anonymous requesters have no actor to address; replies route back by conversation.
      if (out.message.from.actor === undefined) this.origin.set(out.conversation, from);
      this.queue.push({ from, out });
    }
    return this;
  }

  private route(from: AgentRuntime, out: OutboundMessage): AgentRuntime | undefined {
    if (out.toActor) return this.byActor.get(out.toActor);
    const o = this.origin.get(out.conversation);
    return o && o !== from ? o : undefined;
  }

  /** Deliver until quiescent or the step bound is reached (workflow loop bound). */
  async run(intercept?: Interceptor): Promise<{ steps: number; bounded: boolean }> {
    let steps = 0;
    while (this.queue.length > 0) {
      if (steps >= this.maxSteps) return { steps, bounded: true };
      const item = this.queue.shift();
      if (!item) break;
      let to = this.route(item.from, item.out);
      if (!to) {
        this.trace.push(this.entry(item.from, undefined, item.out, "undeliverable"));
        continue;
      }
      let wire: WireMessage = item.out.wire;
      const decision = intercept?.({ from: item.from, to, out: item.out });
      if (decision === "drop") {
        this.trace.push(this.entry(item.from, to, item.out, "dropped-in-transit"));
        continue;
      }
      if (decision && "redirect" in decision) {
        to = decision.redirect;
        if (decision.wire) wire = decision.wire;
      } else if (decision) {
        wire = decision;
      }
      steps++;
      this.step++;
      const result = await to.receive(JSON.parse(JSON.stringify(wire)), {
        binding: "direct-local/0.1",
      });
      this.results.push(result);
      this.trace.push(
        this.entry(item.from, to, item.out, result.disposition, result.reason, result.phase),
      );
      this.send(to, result);
    }
    return { steps, bounded: false };
  }

  private entry(
    from: AgentRuntime,
    to: AgentRuntime | undefined,
    out: OutboundMessage,
    disposition: string,
    reason?: string,
    phaseAfter?: string,
  ): TraceEntry {
    return {
      step: this.step,
      from: from.identity.actor,
      to: to?.identity.actor ?? "(none)",
      kind: out.kind,
      messageId: out.id,
      conversation: out.conversation,
      disposition,
      ...(reason ? { reason } : {}),
      ...(phaseAfter ? { phaseAfter } : {}),
    };
  }
}
