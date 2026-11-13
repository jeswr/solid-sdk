// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
/**
 * The trace recorder: one per run. Each agent gets a sink bound to its party id; the
 * recorder stamps every event with the logical clock (`seq`) and the current worked-example
 * step. The step is the only thing a scenario driver sets: it labels where in the story the
 * run is, and never writes an agent event.
 */

import { jointLogView } from "../mechanisms/joint-privacy.js";
import type { LabelIndex } from "../model/labels.js";
import type { TraceEvent, TraceEventInput } from "./types.js";

/** What the runtime and gates write to. */
export interface TraceSink {
  /** The party id whose diagram lights up. */
  readonly agent: string;
  emit(event: TraceEventInput): void;
}

export class TraceRecorder {
  private readonly list: TraceEvent[] = [];
  private current = 0;
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
        const view = jointLogView(event);
        const displayed = this.presentation
          ? this.presentation.labels.annotations(view, this.presentation.meaningSuite)
          : view;
        this.list.push({ seq: this.list.length + 1, step: this.current, agent, ...displayed });
      },
    };
  }

  events(): readonly TraceEvent[] {
    return this.list;
  }
}
