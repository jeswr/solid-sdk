// AUTHORED-BY Claude Fable 5
import { cn } from "@jeswr/app-shell";
import type { ReactNode } from "react";
import { IllustrativeFigure } from "./illustrative-figure.js";

export interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Secondary line below the value. */
  detail?: ReactNode | undefined;
  /**
   * Set for any rate/fee/payment/decision value: wraps it in the illustrative-figure
   * tag so the qualifier travels with the number.
   */
  illustrative?: boolean | undefined;
  className?: string | undefined;
}

/** Compact stat tile for dashboards; money/rate values must set `illustrative`. */
export function StatCard({ label, value, detail, illustrative = false, className }: StatCardProps) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-4", className)} data-stat-card="">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-1 font-semibold text-2xl text-card-foreground tabular-nums">
        {illustrative ? <IllustrativeFigure>{value}</IllustrativeFigure> : value}
      </p>
      {detail !== undefined && <p className="mt-1 text-muted-foreground text-sm">{detail}</p>}
    </div>
  );
}
