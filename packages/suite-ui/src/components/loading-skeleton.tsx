// AUTHORED-BY Codex GPT-6.1-Sol

import type { Ref } from "react";
import { Skeleton } from "./ui/skeleton.js";

export type LoadingPreset = "list" | "grid" | "document" | "detail" | "table";
export interface LoadingSkeletonProps {
  preset?: LoadingPreset;
  label?: string;
  count?: number;
  ref?: Ref<HTMLDivElement> | undefined;
  tabIndex?: number | undefined;
}

export function LoadingSkeleton({
  preset = "list",
  label = "Loading…",
  count = 6,
  ref,
  tabIndex,
}: LoadingSkeletonProps) {
  const rows = Array.from({ length: Math.max(1, Math.min(50, Math.floor(count) || 1)) });
  return (
    <div
      ref={ref}
      tabIndex={tabIndex}
      className="suite-loading"
      role="status"
      aria-label={label}
      aria-busy="true"
      data-preset={preset}
    >
      <span className="suite-sr-only">{label}</span>
      <div className={`suite-loading-layout suite-loading-${preset}`} aria-hidden="true">
        {preset === "table" && (
          <div className="suite-loading-header">
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        )}
        {(preset === "document" || preset === "detail") && (
          <Skeleton className="suite-loading-title" />
        )}
        {preset === "detail" && <Skeleton className="suite-loading-preview" />}
        {rows.map((_, index) => (
          <div className="suite-loading-row" key={index.toString()}>
            {(preset === "list" || preset === "grid") && (
              <Skeleton className="suite-loading-icon" />
            )}
            <Skeleton className="suite-loading-line" />
            {preset === "table" && (
              <>
                <Skeleton />
                <Skeleton />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
