// AUTHORED-BY Claude Fable 5
import { cn } from "@jeswr/app-shell";
import type { ReactNode } from "react";

export interface HonestyPanelProps {
  /** What actually happens (real Solid reads/writes, real VC signatures, …). */
  real: ReactNode;
  /** What is simulated (rates, decisions, personas, org involvement, …). */
  simulated: ReactNode;
  defaultOpen?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Collapsible "what is real / what is simulated" panel; content is injected per app.
 * Built on native <details>/<summary> so keyboard and screen-reader behaviour come free.
 */
export function HonestyPanel({
  real,
  simulated,
  defaultOpen = false,
  className,
}: HonestyPanelProps) {
  return (
    <details
      className={cn("rounded-lg border border-border bg-card", className)}
      data-honesty-panel=""
      open={defaultOpen}
    >
      <summary className="cursor-pointer px-4 py-3 font-medium text-card-foreground text-sm">
        What is real and what is simulated?
      </summary>
      <div className="grid gap-4 border-border border-t px-4 py-3 sm:grid-cols-2">
        <section>
          <h3 className="font-semibold text-card-foreground text-sm">Real</h3>
          <div className="mt-1 text-muted-foreground text-sm">{real}</div>
        </section>
        <section>
          <h3 className="font-semibold text-card-foreground text-sm">Simulated</h3>
          <div className="mt-1 text-muted-foreground text-sm">{simulated}</div>
        </section>
      </div>
    </details>
  );
}
