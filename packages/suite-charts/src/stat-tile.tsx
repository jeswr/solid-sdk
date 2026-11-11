// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Sparkline } from "./sparkline.js";
import type { StatTileProps } from "./types.js";

export function StatTile({ label, value, unit, delta, sparkline, footnote }: StatTileProps) {
  const direction =
    delta?.direction === "up" ? "Up" : delta?.direction === "down" ? "Down" : "No change";
  return (
    <section className="sc-stat" aria-label={label}>
      <h3>{label}</h3>
      <p className="sc-stat-value">
        {value}
        {unit && <span> {unit}</span>}
      </p>
      {delta && (
        <p
          className={`sc-delta ${delta.good === undefined ? "" : delta.good ? "sc-good" : "sc-bad"}`}
        >
          <svg
            className="sc-delta-icon"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <path
              d={
                delta.direction === "flat"
                  ? "M 2 8 H 14"
                  : delta.direction === "up"
                    ? "M 8 14 V 2 M 3 7 L 8 2 L 13 7"
                    : "M 8 2 V 14 M 3 9 L 8 14 L 13 9"
              }
            />
          </svg>
          <span>
            {direction}: {delta.value}
          </span>
        </p>
      )}
      {sparkline && <Sparkline values={sparkline} label={`${label} trend`} />}
      {footnote && <p className="sc-footnote">{footnote}</p>}
    </section>
  );
}
