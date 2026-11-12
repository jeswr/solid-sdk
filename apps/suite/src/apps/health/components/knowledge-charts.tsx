// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  type HealthFact,
  type HealthGraphView,
  healthTimeline,
  observationSeries,
} from "@jeswr/pkg-health";
import { LineChart, TimelineChart } from "@jeswr/suite-charts";
import { DataTable, FilterChips } from "@jeswr/suite-ui";
import { useState } from "react";
import {
  BELIEFS,
  factKey,
  formatKnowledgeDate,
  timelineCoordinate,
} from "../lib/knowledge/view-model";

export function KnowledgeTimeline({ view }: { view: HealthGraphView }) {
  const [beliefs, setBeliefs] = useState<string[]>(["definitely", "past"]);
  const lanes = healthTimeline(view, {
    beliefs: BELIEFS.filter((b) => !beliefs.length || beliefs.includes(b.id)).map((b) => b.id),
  });
  const kinds = ["condition", "medication", "immunization", "encounter"] as const;
  const labels = {
    condition: "Conditions",
    medication: "Medications",
    immunization: "Immunisations",
    encounter: "Encounters",
  };
  const count = kinds.reduce((n, kind) => n + lanes[kind].length, 0);
  const undated = kinds.reduce(
    (n, kind) =>
      n + lanes[kind].filter((item) => timelineCoordinate(item.start) === undefined).length,
    0,
  );
  return (
    <div className="hlt-knowledge-stack">
      <h2>Your health timeline</h2>
      <FilterChips
        label="Timeline belief"
        options={BELIEFS}
        value={beliefs}
        onChange={setBeliefs}
        resultCount={count}
      />
      <TimelineChart
        title="Assistant knowledge over time"
        formatX={(time) => formatKnowledgeDate(new Date(time).toISOString())}
        description="Dates recorded in your graph. Partial dates use the first day of that period. Undated facts remain in Facts."
        lanes={kinds.map((kind) => ({
          id: kind,
          label: labels[kind],
          items: lanes[kind].flatMap((item, i) => {
            const start = timelineCoordinate(item.start);
            const end = timelineCoordinate(item.end);
            return start === undefined
              ? []
              : [
                  {
                    id: `${item.id}:${i}`,
                    label: item.label,
                    tone: item.tone,
                    start,
                    ...(end === undefined ? {} : { end }),
                  },
                ];
          }),
        }))}
      />
      <p className="hlt-muted">{undated} undated facts could not be placed on the timeline.</p>
    </div>
  );
}
export function KnowledgeResults({
  view,
  onSelect,
}: {
  view: HealthGraphView;
  onSelect(fact: HealthFact): void;
}) {
  const { series, skipped } = observationSeries(view);
  const qualitative = view.facts.filter(
    (f) => f.kind === "observation" && (typeof f.value === "string" || !!f.interpretation),
  );
  return (
    <div className="hlt-knowledge-stack">
      <h2>Results recorded by your assistant</h2>
      <p className="hlt-muted">
        Stored values and units, without conversion or clinical interpretation.
      </p>
      {[...series]
        .sort((a, b) => b.points.length - a.points.length || a.label.localeCompare(b.label))
        .map((s) => {
          const last = s.points.at(-1);
          return (
            <section className="hlt-panel" aria-label={`${s.label} results`} key={s.id}>
              {last && (
                <p className="hlt-latest">
                  <strong>
                    Last value: {last.y} {s.unit}
                  </strong>{" "}
                  · {formatKnowledgeDate(last.x)}
                </p>
              )}
              <LineChart
                title={s.label}
                unit={s.unit ?? ""}
                series={[s]}
                formatX={(t) => formatKnowledgeDate(new Date(t).toISOString())}
              />
            </section>
          );
        })}
      {!series.length && <p>No dated numeric results to chart.</p>}
      <p className="hlt-muted">
        {skipped} observations could not be charted (qualitative values or missing numeric values or
        dates).
      </p>
      <h3>Qualitative observations</h3>
      {qualitative.length ? (
        <DataTable
          items={qualitative}
          onOpen={onSelect}
          getKey={factKey}
          getLabel={(f) => f.label}
          label="Qualitative observations"
          columns={[
            { id: "label", header: "Observation", accessor: (f) => f.label, size: 180 },
            {
              id: "value",
              header: "Result",
              accessor: (f) => (f.kind === "observation" ? String(f.value) : ""),
              size: 160,
            },
            {
              id: "interpretation",
              header: "Recorded interpretation",
              accessor: (f) =>
                f.kind === "observation" ? (f.interpretation ?? "Not recorded") : "",
              size: 170,
            },
            {
              id: "date",
              header: "Date",
              accessor: (f) =>
                f.kind === "observation"
                  ? formatKnowledgeDate(f.effectiveTime ?? f.period.start)
                  : "",
              size: 140,
            },
          ]}
        />
      ) : (
        <p className="hlt-muted">No qualitative observations in this graph.</p>
      )}
    </div>
  );
}
