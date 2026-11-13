// AUTHORED-BY Claude Opus 5.5
/**
 * The trace recorder: one per run. Each agent gets a sink bound to its party id; the
 * recorder stamps every event with the logical clock (`seq`) and the current worked-example
 * step. The step is the only thing a scenario driver sets: it labels where in the story the
 * run is, and never writes an agent event.
 */
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

  /** Label the following events with a worked-example step (plan section 8). */
  step(step: number): void {
    this.current = step;
  }

  sink(agent: string): TraceSink {
    return {
      agent,
      emit: (event) => {
        this.list.push({ seq: this.list.length + 1, step: this.current, agent, ...event });
      },
    };
  }

  events(): readonly TraceEvent[] {
    return this.list;
  }
}
