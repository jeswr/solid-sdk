// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
/**
 * The trace recorder: one per run. Each agent gets a sink bound to its party id; the
 * recorder stamps every event with the logical clock (`seq`) and the current worked-example
 * step. The step is the only thing a scenario driver sets: it labels where in the story the
 * run is, and never writes an agent event.
 */

import { digestBytes, digestOf } from "../core/canonical.js";
import type { EvidenceItem, JsonObject } from "../core/types.js";
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
import { linkedViewOfProjection, storeProjection } from "../wire/store-document.js";
import { writeNQuads } from "../wire/store-quads.js";
import type { TraceLinkedInput } from "./linked.js";
import type { TraceEvent, TraceEventInput, TraceLinkedView } from "./types.js";

export interface VerifiedStatement {
  readonly statement: JsonObject;
  readonly claimDigest: string;
  readonly wireDigest?: string;
}

export type TraceObservation =
  | { readonly kind: "payload"; readonly value: unknown; readonly support?: readonly string[] }
  | {
      readonly kind: "admitted-statements";
      readonly party: string | undefined;
      readonly statements: readonly VerifiedStatement[];
    }
  | {
      readonly kind: "refused-statement";
      readonly evidence: EvidenceItem;
      readonly claim?: unknown;
    };

/** What the runtime and gates write to. */
export interface TraceSink {
  /** The party id whose diagram lights up. */
  readonly agent: string;
  /** Opt in to comparisons using the original data before the trace projection. */
  readonly observePayloads?: boolean;
  readonly linked?: boolean;
  emit(event: TraceEventInput, observation?: TraceObservation): void;
}

export class TraceRecorder {
  constructor(
    private readonly observe?: (seq: number, observation: TraceObservation) => void,
    linked = false,
  ) {
    if (linked) this.linkedJobs = new Map();
  }

  private readonly linkedJobs?: Map<number, readonly TraceLinkedInput[]>;
  private linkedTable?: Record<string, TraceLinkedView>;

  linkedViews(): Readonly<Record<string, TraceLinkedView>> | undefined {
    return this.linkedTable;
  }

  private async completeLinked(): Promise<void> {
    if (!this.linkedJobs?.size) return;
    const table: Record<string, TraceLinkedView> = {};
    const graphs = new Map<string, string>();
    for (const [index, inputs] of this.linkedJobs) {
      const keys = new Set<string>();
      for (const { dataset, root, what } of inputs) {
        const graph = storeProjection(dataset, root);
        const fingerprint = digestBytes(writeNQuads(graph));
        const identity = `${what}:${fingerprint}`;
        let key = graphs.get(identity);
        if (!key) {
          const view = await linkedViewOfProjection(graph, what);
          key = digestBytes(view.jsonld);
          if (Object.hasOwn(table, key) && table[key]?.what !== what)
            throw new Error("Linked view graph has conflicting categories");
          graphs.set(identity, key);
          table[key] ??= view;
        }
        keys.add(key);
      }
      const event = this.list[index];
      if (!event) throw new Error("Linked trace event was removed before completion");
      this.list[index] = { ...event, linked: [...keys] };
    }
    this.linkedJobs.clear();
    this.linkedTable = table;
  }

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
    if (this.linkedJobs) await this.completeLinked();
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
      observePayloads: !!this.observe,
      linked: this.linkedJobs !== undefined,
      emit: (event, observation) => {
        if (observation) this.observe?.(this.list.length + 1, observation);
        if (this.rule) this.current = this.rule(agent, event, this.current);
        const { settlementFacts, settlementDocument, linkedInputs, ...plain } = event;
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
        if (linkedInputs?.length) this.linkedJobs?.set(this.list.length - 1, linkedInputs);
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
