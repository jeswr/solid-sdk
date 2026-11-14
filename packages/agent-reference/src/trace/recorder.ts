// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
/**
 * The trace recorder: one per run. Each agent gets a sink bound to its party id; the
 * recorder stamps every event with the logical clock (`seq`) and the current worked-example
 * step. The step is the only thing a scenario driver sets: it labels where in the story the
 * run is, and never writes an agent event.
 */

import { digestOf } from "../core/canonical.js";
import { jointLogView } from "../mechanisms/joint-privacy.js";
import { copyData } from "../model/copy.js";
import type { LabelIndex } from "../model/labels.js";
import { SettlementError } from "../settlement/adapter.js";
import { readCarried } from "../settlement/carried.js";
import type { SettlementSuite } from "../settlement/types.js";
import {
  liftPaymentObjects,
  paymentDocument,
  paymentTrace,
  readPaymentObjects,
} from "../wire/payment.js";
import type { TraceEvent, TraceEventInput } from "./types.js";

/** What the runtime and gates write to. */
export interface TraceSink {
  /** The party id whose diagram lights up. */
  readonly agent: string;
  emit(event: TraceEventInput): void;
}

export class TraceRecorder {
  private selected?: SettlementSuite;
  settlement(suite: SettlementSuite): void {
    this.selected = suite;
  }
  private readonly list: TraceEvent[] = [];
  private readonly settlementJobs: Promise<void>[] = [];
  private readonly settlements = new Map<
    string,
    Promise<import("../settlement/types.js").SettlementTrace | undefined>
  >();
  private readonly settlementErrors: unknown[] = [];
  async complete(): Promise<void> {
    await Promise.all(this.settlementJobs);
    if (this.settlementErrors.length) throw this.settlementErrors[0];
  }
  private current = 0;
  private nextSegment: "payment" | "added" | undefined;
  /** Brief 31: while an added segment is open, every event carries the adding configuration. */
  private addedBy: { readonly by: string; readonly from: number } | undefined;
  segment(value: "payment"): void;
  segment(value: "added", by: string): void;
  segment(value: "payment" | "added", by?: string): void {
    if (value === "added") {
      if (!by) throw new Error("An added segment needs the configuration that adds it");
      if (this.addedBy) throw new Error("Added segments cannot nest");
      this.addedBy = { by, from: this.list.length };
    }
    this.nextSegment = value;
  }
  segmentEnd(value: "payment" | "added"): void {
    if (value === "added") {
      const open = this.addedBy;
      this.addedBy = undefined;
      // A segment that recorded nothing marks no baseline event as its end.
      if (!open || this.list.length === open.from) {
        if (this.nextSegment === "added") this.nextSegment = undefined;
        return;
      }
    }
    const last = this.list.at(-1);
    if (last) this.list[this.list.length - 1] = { ...last, segmentEnd: value };
  }

  private rule: ((agent: string, event: TraceEventInput, step: number) => number) | undefined;
  private presentation: { labels: LabelIndex; meaningSuite: string } | undefined;

  /** Labels affect generated annotations only; original content and decisions retain their bytes. */
  labels(labels: LabelIndex, meaningSuite: string): void {
    this.presentation = { labels, meaningSuite };
  }

  /** Label the following events with a worked-example step (plan section 8). */
  step(step: number): void {
    this.current = step;
  }

  /**
   * A labelling rule for where one step hands over to the next inside a single delivery (for
   * example, a bank's outbound gate answering within the call that admitted the request).
   * It only labels; events keep their true order.
   */
  label(rule: ((agent: string, event: TraceEventInput, step: number) => number) | undefined): void {
    this.rule = rule;
  }

  sink(agent: string): TraceSink {
    return {
      agent,
      emit: (event) => {
        if (this.rule) this.current = this.rule(agent, event, this.current);
        const { settlementFacts, settlementDocument, ...plain } = event;
        const view = jointLogView(plain);
        const displayed = this.presentation
          ? this.presentation.labels.annotations(view, this.presentation.meaningSuite)
          : view;
        this.list.push({
          seq: this.list.length + 1,
          step: this.current,
          agent,
          ...(this.nextSegment ? { segment: this.nextSegment } : {}),
          ...displayed,
          ...(this.addedBy ? { addedBy: this.addedBy.by } : {}),
        });
        this.nextSegment = undefined;
        if ((settlementFacts || settlementDocument) && !event.settlement) {
          const index = this.list.length - 1;
          const key = settlementFacts
            ? `rdf:${settlementFacts.fingerprint()}`
            : `document:${digestOf(settlementDocument)}`;
          let promised = this.settlements.get(key);
          if (!promised) {
            const snapshot = settlementFacts?.snapshot();
            const document = snapshot ? undefined : copyData(settlementDocument);
            promised = (async () => {
              const suite = this.selected;
              if (suite && suite.id !== "rdf-order") {
                let carried: import("../settlement/types.js").ProtocolObjects | undefined;
                if (document && typeof document === "object" && "suite" in document) {
                  try {
                    carried = readCarried(document, suite);
                  } catch (error) {
                    // Refused native bytes stay in their packet inspector; they have no lifted facts.
                    if (error instanceof SettlementError && error.reason === "evidence-invalid")
                      return undefined;
                    throw error;
                  }
                }
                const objects = carried ?? (snapshot ? suite.objectsFor?.(snapshot) : undefined);
                if (objects && suite.trace) {
                  const trace = await suite.trace(objects);
                  return snapshot ? { ...trace, facts: await paymentDocument(snapshot) } : trace;
                }
              }
              return paymentTrace(
                snapshot ?? liftPaymentObjects(await readPaymentObjects(document)),
              );
            })();
            // Observe errors immediately; complete() still fails rather than publishing missing facts.
            promised.catch(() => undefined);
            this.settlements.set(key, promised);
          }
          const job = promised
            .then((settlement) => {
              if (!settlement) return;
              const previous = this.list[index];
              if (!previous) throw new Error("Payment trace event was removed before completion");
              this.list[index] = { ...previous, settlement };
            })
            .catch((error) => {
              this.settlementErrors.push(error);
            });
          this.settlementJobs.push(job);
        }
      },
    };
  }

  events(): readonly TraceEvent[] {
    return this.list;
  }
}
