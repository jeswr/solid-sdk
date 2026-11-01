// AUTHORED-BY Codex GPT-6
"use client";
import { Button, EmptyState, ErrorState, LoadingSkeleton, ProvenanceBadge } from "@jeswr/suite-ui";
import Link from "next/link";
import { useState } from "react";
import { CATALOGUE, formatMetric } from "../lib/data/metrics";
import type { MetricKind } from "../lib/model";
import { useHealth, useMetric } from "../state/health-context";
import { BucketTable, TrendChart } from "./charts";
import { useMeasurement } from "./health-app";

export function MetricView({ metric }: { metric: string }) {
  const card = CATALOGUE.find((item) => item.id === metric);
  if (!card)
    return (
      <div className="hlt-page">
        <h1>Metric not found</h1>
        <EmptyState
          title="Choose a metric"
          body="Open a metric from your summary."
          primaryAction={<Link href="/health">Go to summary</Link>}
        />
      </div>
    );
  return <MetricContent key={metric} card={card} />;
}
function MetricContent({ card }: { card: (typeof CATALOGUE)[number] }) {
  const [range, setRange] = useState<"7d" | "30d" | "1y">("30d");
  const [table, setTable] = useState(false);
  const primary = useMetric(card.kinds[0], range);
  // A null secondary metric keeps hook order fixed without duplicate shard reads.
  const secondary = useMetric(card.kinds[1] ?? null, range);
  const { invalidate } = useHealth();
  const add = useMeasurement();
  const ready = primary.status === "ready" || primary.status === "empty";
  const series = ready
    ? [
        {
          label: card.id === "blood-pressure" ? "Systolic" : card.label,
          aggregation: card.aggregation,
          buckets: primary.data.buckets,
        },
        ...(card.id === "blood-pressure" &&
        (secondary.status === "ready" || secondary.status === "empty")
          ? [{ label: "Diastolic", aggregation: card.aggregation, buckets: secondary.data.buckets }]
          : []),
      ]
    : [];
  return (
    <div className="hlt-page">
      <Link href="/health" className="hlt-back">
        ← Summary
      </Link>
      <header className="hlt-page-header">
        <div>
          <p className="hlt-eyebrow">METRIC HISTORY</p>
          <h1>{card.label}</h1>
          <p className="hlt-muted">
            {card.id === "steps" || card.id === "sleep" ? "Daily totals" : "Daily averages"}
            {range === "1y" ? " grouped by week" : ""} · {card.unit}
          </p>
        </div>
        <Button variant="outline" onClick={() => add(card.id)}>
          Add measurement
        </Button>
      </header>
      <div className="hlt-chart-toolbar">
        <fieldset className="hlt-ranges" aria-label="Time range">
          {(["7d", "30d", "1y"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={range === value ? "secondary" : "ghost"}
              aria-pressed={range === value}
              onClick={() => setRange(value)}
            >
              {value.toUpperCase()}
            </Button>
          ))}
        </fieldset>
        <Button variant="outline" size="sm" aria-pressed={table} onClick={() => setTable(!table)}>
          {table ? "Show as chart" : "Show as table"}
        </Button>
      </div>
      {primary.status === "loading" || secondary.status === "loading" ? (
        <LoadingSkeleton preset="detail" label="Loading metric history" />
      ) : primary.status === "error" || secondary.status === "error" ? (
        <ErrorState error="unreachable" actions={{ retry: invalidate }} />
      ) : primary.status === "empty" && secondary.status === "empty" ? (
        <EmptyState
          title="No readings in this range"
          body="Choose another range or add a measurement."
          primaryAction={<Button onClick={() => add(card.id)}>Add measurement</Button>}
        />
      ) : (
        <>
          <section className="hlt-panel" aria-label={`${card.label} trend`}>
            <p className="hlt-latest">
              {card.id === "blood-pressure" ? (
                <>
                  Latest readings:{" "}
                  <strong>
                    Systolic{" "}
                    {primary.data.latest
                      ? formatMetric("systolic", primary.data.latest.value)
                      : "—"}{" "}
                    mmHg
                  </strong>{" "}
                  ·{" "}
                  <strong>
                    Diastolic{" "}
                    {secondary.data.latest
                      ? formatMetric("diastolic", secondary.data.latest.value)
                      : "—"}{" "}
                    mmHg
                  </strong>
                </>
              ) : (
                <>
                  Latest reading:{" "}
                  <strong>
                    {primary.data.latest
                      ? formatMetric(card.kinds[0], primary.data.latest.value)
                      : "—"}{" "}
                    {card.unit}
                  </strong>
                </>
              )}
            </p>
            {table ? (
              <BucketTable series={series} unit={card.unit} />
            ) : (
              <TrendChart
                series={series}
                unit={card.unit}
                label={`${card.label} over ${range}. ${range === "1y" ? "Weekly" : "Daily"} ${card.aggregation === "sum" ? "totals" : "averages"} in ${card.unit}.`}
              />
            )}
          </section>
          <div className="hlt-stats">
            {[
              ["Average", primary.data.average, secondary.data.average],
              ["Minimum", primary.data.min, secondary.data.min],
              ["Maximum", primary.data.max, secondary.data.max],
            ].map(([name, value, second]) => (
              <div className="hlt-stat" key={String(name)}>
                <span className="hlt-muted">
                  {name}
                  {card.id === "blood-pressure" ? " · systolic / diastolic" : ""}
                </span>
                <strong>
                  {typeof value === "number"
                    ? value.toLocaleString("en", { maximumFractionDigits: 1 })
                    : "—"}
                  {card.id === "blood-pressure"
                    ? ` / ${typeof second === "number" ? second.toLocaleString("en", { maximumFractionDigits: 1 }) : "—"}`
                    : ""}{" "}
                  <small>{card.unit}</small>
                </strong>
              </div>
            ))}
          </div>
          <section>
            <div className="hlt-section-heading">
              <h2>Entries</h2>
              <span className="hlt-muted">Newest first</span>
            </div>
            <p className="hlt-muted hlt-small">
              Measurements are append-only in this version. Add a new reading to record a change.
            </p>
            <div className="hlt-entry-list">
              {[
                ...primary.data.entries,
                ...(card.id === "blood-pressure" ? secondary.data.entries : []),
              ]
                .sort((a, b) => b.at.getTime() - a.at.getTime())
                .map((entry) => (
                  <article key={entry.iri} className="hlt-entry">
                    <div>
                      <strong>
                        {formatMetric(entry.kind as MetricKind, entry.value)} {card.unit}
                        {card.id === "blood-pressure" ? ` · ${entry.kind}` : ""}
                      </strong>
                      <p className="hlt-muted hlt-small">
                        {entry.at.toLocaleString("en-GB", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                      {entry.note && <p>{entry.note}</p>}
                    </div>
                    <ProvenanceBadge source={entry.source} />
                  </article>
                ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
