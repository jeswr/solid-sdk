// AUTHORED-BY Codex GPT-6
"use client";
import { Button, EmptyState, ErrorState, LoadingSkeleton, ProvenanceBadge } from "@jeswr/suite-ui";
import { ArrowUpRight, LockKeyhole, Pill } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect } from "react";
import { loadDashboard } from "../lib/data/dashboard";
import { displayValue, formatMetric, summarizeMetric } from "../lib/data/metrics";
import { dueMedications } from "../lib/data/records";
import { useHealth, useHealthResource, useRecords } from "../state/health-context";
import { Sparkline } from "./charts";
import { useMeasurement } from "./health-app";

const neverEmpty = () => false;
export function relativeTime(at: Date, now = new Date(), daily = false): string {
  const days =
    Math.floor(Date.parse(now.toISOString().slice(0, 10)) / 86400000) -
    Math.floor(Date.parse(at.toISOString().slice(0, 10)) / 86400000);
  if (days === 0)
    return daily
      ? "Today"
      : `Today at ${at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}`;
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-days, "day");
}
export function trendText(change: number | null) {
  if (change === null) return "More readings will reveal a trend";
  const rounded = Math.abs(change).toFixed(0);
  if (rounded === "0") return "Same as previous week";
  return `${change > 0 ? "Up" : "Down"} ${rounded}% vs previous week`;
}
function DueNow() {
  const meds = useRecords("medications");
  const { invalidate, clock } = useHealth();
  if (meds.status === "loading")
    return <LoadingSkeleton count={1} label="Loading medication reminders" />;
  if (meds.status === "error")
    return (
      <ErrorState error="unreachable" actions={{ retry: invalidate }}>
        <p>Couldn't load medication reminders.</p>
      </ErrorState>
    );
  const due = dueMedications(meds.data, clock);
  return (
    <section className="hlt-due" aria-label="Medication reminders">
      <div className="hlt-due-icon">
        <Pill size={20} aria-hidden="true" />
      </div>
      <div>
        <h2>Due now</h2>
        {due.length ? (
          <ul>
            {due.map(({ record, at }) => (
              <li key={`${record.iri}-${at.toISOString()}`}>
                <strong>{record.name}</strong> · {record.dose}{" "}
                <span className="hlt-muted">
                  · Due{" "}
                  {at.toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: record.timeZone,
                  })}{" "}
                  {record.timeZone}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No medication reminders due today.</p>
        )}
        <Link href="/health/medications">View medications</Link>
      </div>
    </section>
  );
}
export function Dashboard() {
  const { store, invalidate, pending, clock, acknowledge } = useHealth();
  const add = useMeasurement();
  // biome-ignore lint/correctness/useExhaustiveDependencies: clock requests a fresh read each minute; writes read the current instant.
  const loader = useCallback(() => loadDashboard(store, new Date()), [store, clock]);
  const state = useHealthResource(loader, neverEmpty);
  const viewNow = new Date();
  const oldest = new Date(Date.UTC(viewNow.getUTCFullYear(), viewNow.getUTCMonth() - 1, 1));
  useEffect(() => {
    if (state.status === "ready" || state.status === "empty")
      acknowledge(state.data.flatMap((card) => card.entries.map((entry) => entry.iri)));
  }, [state, acknowledge]);
  return (
    <div className="hlt-page">
      <header className="hlt-page-header">
        <div>
          <p className="hlt-eyebrow">YOUR HEALTH, IN ONE PLACE</p>
          <h1>Summary</h1>
          <p className="hlt-muted">A daily view of your activity and readings.</p>
        </div>
        <span className="hlt-private">
          <LockKeyhole size={14} aria-hidden="true" />
          Private to you
        </span>
      </header>
      <DueNow />
      <div className="hlt-section-heading">
        <h2>Your metrics</h2>
        <span className="hlt-muted">Last 7 days · UTC</span>
      </div>
      {state.status === "loading" ? (
        <LoadingSkeleton preset="grid" label="Loading metrics" />
      ) : state.status === "error" ? (
        <ErrorState error="unreachable" actions={{ retry: invalidate }} />
      ) : (
        <div className="hlt-metric-grid">
          {state.data.map((card) => {
            const kind = card.kinds[0];
            const entries = new Map(card.entries.map((entry) => [entry.iri, entry]));
            for (const entry of pending)
              if (entry.kind === kind && entry.at <= viewNow && entry.at >= oldest)
                entries.set(entry.iri, entry);
            const latest = summarizeMetric([...entries.values()], kind, "day").latest;
            const second =
              pending.findLast(
                (entry) =>
                  entry.kind === "diastolic" && entry.at.getTime() === latest?.at.getTime(),
              ) ?? card.secondary;
            const latestDay = latest?.at.toISOString().slice(0, 10);
            const latestValue =
              latest && (kind === "steps" || kind === "sleep")
                ? [...entries.values()]
                    .filter((entry) => entry.at.toISOString().slice(0, 10) === latestDay)
                    .reduce((total, entry) => total + entry.value, 0)
                : (latest?.value ?? 0);
            const weekStart = new Date(clock);
            weekStart.setUTCHours(0, 0, 0, 0);
            weekStart.setUTCDate(weekStart.getUTCDate() - 6);
            const buckets = summarizeMetric(
              [...entries.values()].filter((entry) => entry.at >= weekStart && entry.at <= viewNow),
              kind,
              "day",
            ).buckets;
            const display = latest
              ? `${formatMetric(kind, latestValue)}${card.id === "blood-pressure" ? ` / ${second ? formatMetric("diastolic", second.value) : "—"}` : ""}`
              : "";
            return (
              <article
                className="hlt-metric-card"
                key={card.id}
                data-testid={`health-card-${card.id}`}
              >
                <Link className="hlt-card-link" href={`/health/m/${card.id}`}>
                  <h3>{card.label}</h3>
                  <ArrowUpRight size={18} aria-hidden="true" />
                </Link>
                {latest ? (
                  <>
                    <p className="hlt-big-number">
                      {display} <span>{card.unit}</span>
                    </p>
                    <p className="hlt-muted hlt-small">
                      {relativeTime(latest.at, viewNow, card.aggregation === "sum")}
                    </p>
                    <Sparkline
                      values={
                        buckets.length
                          ? buckets.map((bucket) => bucket.value)
                          : [displayValue(kind, latest.value)]
                      }
                    />
                    <p className="hlt-trend-copy">{trendText(card.change)}</p>
                    <div className="hlt-source">
                      <ProvenanceBadge source={latest.source} />
                    </div>
                  </>
                ) : (
                  <EmptyState
                    title="No data yet"
                    body="Add a reading to start your history."
                    primaryAction={
                      <Button size="sm" onClick={() => add(card.id)}>
                        Add measurement
                      </Button>
                    }
                  />
                )}
              </article>
            );
          })}
        </div>
      )}
      <div className="hlt-bottom-note">
        <LockKeyhole size={16} aria-hidden="true" />
        <p>
          Built around your privacy. Your Health data is stored in your pod and is only visible to
          you.
        </p>
      </div>
    </div>
  );
}
