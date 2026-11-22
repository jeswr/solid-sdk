// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  correlationVerdict,
  dailySeries,
  insights,
  laggedCorrelation,
  robustSummary,
  rollingAverage,
  type Series,
  weekdayAggregation,
} from "@jeswr/suite-insights";
import {
  EmptyState,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@jeswr/suite-ui";
import { useMemo, useState } from "react";
import { AppHeading } from "@/shell/app-frame";
import { availableSeries, weekComparison } from "../lib/presentation";
import { useInsights } from "../state/insights-context";
import { BarChart, LineChart, ScatterChart, StatTile } from "./charts";

const format = (v: number | null) =>
  v === null ? "—" : v.toLocaleString("en-GB", { maximumFractionDigits: 1 });
function NoSeries() {
  return (
    <EmptyState
      title="Your patterns start here"
      body="Add records in Health, Money or Music, then refresh your sources. Two series with at least 14 shared days can reveal a finding."
    />
  );
}
function PairChart({
  x,
  y,
  lag,
  pairs,
}: {
  x: Series;
  y: Series;
  lag: number;
  pairs: { day: string; x: number | null; y: number | null }[];
}) {
  return (
    <ScatterChart
      title={`${x.label} and ${y.label}`}
      description={
        lag
          ? `X today, Y ${Math.abs(lag)} day(s) ${lag > 0 ? "later" : "earlier"}. Dates identify the X day.`
          : "Each point is one observed day."
      }
      points={pairs.map((p) => ({ id: p.day, label: p.day, x: p.x as number, y: p.y as number }))}
      xLabel={x.label}
      yLabel={y.label}
      xUnit={x.unit}
      yUnit={y.unit}
      trend
    />
  );
}
export function Overview() {
  const { sources, timeZone, now } = useInsights();
  const series = useMemo(() => availableSeries(sources), [sources]);
  const findings = useMemo(() => insights(series, { timeZone, limit: 4 }), [series, timeZone]);
  const weeks = useMemo(
    () => new Map(series.map((s) => [s.id, weekComparison(s, now, timeZone)])),
    [series, now, timeZone],
  );
  return (
    <>
      <header>
        <p className="ins-eyebrow">YOUR LIFE, IN CONTEXT</p>
        <AppHeading>Overview</AppHeading>
        <p className="ins-muted">Small patterns across your day. A starting point for curiosity.</p>
      </header>
      {!series.length ? (
        <NoSeries />
      ) : (
        <>
          <section aria-label="This week compared with last week">
            <h2>This week so far</h2>
            <p className="ins-muted">
              Average per observed day, Monday to yesterday, compared with the same weekdays last
              week. Gaps are excluded.
            </p>
            <div className="ins-stats">
              {series.slice(0, 4).map((s) => {
                const week = weeks.get(s.id) as ReturnType<typeof weekComparison>;
                return (
                  <StatTile
                    key={s.id}
                    label={s.label}
                    value={format(week.value)}
                    unit={s.unit}
                    {...(week.delta === null
                      ? {}
                      : {
                          delta: {
                            value: `${format(Math.abs(week.delta))} ${s.unit}`,
                            direction:
                              week.delta > 0
                                ? ("up" as const)
                                : week.delta < 0
                                  ? ("down" as const)
                                  : ("flat" as const),
                          },
                        })}
                    footnote={`${week.days} of ${week.elapsed} days this week · ${week.previousDays} last week`}
                  />
                );
              })}
            </div>
          </section>
          <section aria-label="Top findings">
            <h2>Connections worth exploring</h2>
            {findings.length === 0 ? (
              <EmptyState
                title="A little more time"
                body="No clear relationships yet. Findings need at least 14 paired days, variation in both series and consistent Pearson and Spearman results."
              />
            ) : (
              <div className="ins-grid">
                {findings.map((f) => {
                  const x = series.find((s) => s.id === f.xId) as Series;
                  const y = series.find((s) => s.id === f.yId) as Series;
                  return (
                    <article className="ins-card" key={f.id}>
                      <p className="ins-eyebrow">
                        {f.confidence} data confidence · {f.correlation.n} paired days
                      </p>
                      <h3>{f.description}</h3>
                      <PairChart x={x} y={y} lag={f.lagDays} pairs={f.pairs} />
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
function Choice({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange(value: string): void;
}) {
  return (
    <div className="ins-field">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
export function Explore() {
  const { sources, timeZone } = useInsights();
  const series = useMemo(() => availableSeries(sources), [sources]);
  const [xId, setX] = useState("health.steps");
  const [yId, setY] = useState("health.sleep");
  const [lag, setLag] = useState("0");
  const x = series.find((s) => s.id === xId) ?? series[0];
  const y =
    series.find((s) => s.id === yId && s.id !== x?.id) ?? series.find((s) => s.id !== x?.id);
  const result = useMemo(
    () => (x && y ? laggedCorrelation(x, y, timeZone, Number(lag)) : null),
    [x, y, timeZone, lag],
  );
  return (
    <>
      <header>
        <AppHeading>Explore</AppHeading>
        <p className="ins-muted">Choose two parts of your day and see how they move together.</p>
      </header>
      {!x || !y || !result ? (
        <NoSeries />
      ) : (
        <>
          <div className="ins-controls">
            <Choice
              id="ins-x"
              label="First series (X)"
              value={x.id}
              options={series}
              onChange={setX}
            />
            <Choice
              id="ins-y"
              label="Second series (Y)"
              value={y.id}
              options={series.filter((s) => s.id !== x.id)}
              onChange={setY}
            />
            <Choice
              id="ins-lag"
              label="Compare Y"
              value={lag}
              options={Array.from({ length: 15 }, (_, i) => ({
                id: String(i - 7),
                label:
                  i === 7
                    ? "On the same day"
                    : `${Math.abs(i - 7)} day(s) ${i > 7 ? "later" : "earlier"}`,
              }))}
              onChange={setLag}
            />
          </div>
          <article className="ins-card">
            <p className="ins-verdict" role="status">
              {correlationVerdict(result.pearson)}
            </p>
            <div className="ins-stats">
              <StatTile label="Paired days" value={result.pearson.n} />
              <StatTile label="Pearson r" value={format(result.pearson.coefficient)} />
              <StatTile label="Spearman ρ" value={format(result.spearman.coefficient)} />
            </div>
            <PairChart x={x} y={y} lag={Number(lag)} pairs={result.pairs} />
          </article>
        </>
      )}
    </>
  );
}
export function Trends() {
  const { sources, timeZone } = useInsights();
  const series = useMemo(() => availableSeries(sources), [sources]);
  const trends = useMemo(
    () =>
      series.map((s) => {
        const daily = dailySeries(s.points, timeZone, s.aggregation);
        return {
          s,
          summary: robustSummary(daily.map((p) => p.value as number)),
          rolling: rollingAverage(daily, 30),
          weekdays: weekdayAggregation(daily),
        };
      }),
    [series, timeZone],
  );
  return (
    <>
      <header>
        <AppHeading>Trends</AppHeading>
        <p className="ins-muted">
          Your typical week and the longer view. A rolling average needs 30 observed days in its
          30-day window.
        </p>
      </header>
      {!series.length ? (
        <NoSeries />
      ) : (
        <div className="ins-grid">
          {trends.map(({ s, summary, rolling, weekdays }) => {
            return (
              <article className="ins-card" key={s.id}>
                <h2>{s.label}</h2>
                <p className="ins-muted">
                  {summary.n} observed days · median {format(summary.median)} {s.unit} · IQR{" "}
                  {format(summary.iqr)} {s.unit}
                </p>
                <BarChart
                  title="Weekday pattern"
                  description="Mean per observed day; empty weekdays are omitted."
                  data={weekdays.flatMap((b) =>
                    b.value === null
                      ? []
                      : [{ id: b.id, label: `${b.label} (n=${b.n})`, value: b.value }],
                  )}
                  unit={s.unit}
                />
                <LineChart
                  title="30-day rolling average"
                  series={[
                    {
                      id: s.id,
                      label: s.label,
                      points: rolling.flatMap((p) =>
                        p.value === null ? [] : [{ x: p.day, y: p.value }],
                      ),
                    },
                  ]}
                  unit={s.unit}
                />
                {!rolling.some((p) => p.value !== null) && (
                  <p className="ins-muted">No complete 30-day windows yet.</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
export function Sources() {
  const { sources } = useInsights();
  return (
    <>
      <header>
        <AppHeading>Sources</AppHeading>
        <p className="ins-muted">
          Records available to Insights in your current pod. Missing records are never assumed to be
          zero.
        </p>
      </header>
      <div className="ins-grid">
        {sources.map((source) => (
          <article key={source.id} className="ins-card">
            <h2>{source.label}</h2>
            <p>
              <strong>{source.days}</strong> observed days ·{" "}
              {source.status === "found"
                ? "Connected"
                : source.status === "empty"
                  ? "No records yet"
                  : source.status === "error"
                    ? "Could not read"
                    : "Coming later"}
            </p>
            {source.message && (
              <p role={source.status === "error" ? "status" : undefined}>{source.message}</p>
            )}
            {!!source.droppedPoints && (
              <p className="ins-muted">
                {source.droppedPoints} invalid{" "}
                {source.droppedPoints === 1 ? "record was" : "records were"} left out.
              </p>
            )}
            <ul>
              {source.series.map((s) => (
                <li key={s.id}>
                  {s.label} · {s.unit} · daily {s.aggregation}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </>
  );
}
