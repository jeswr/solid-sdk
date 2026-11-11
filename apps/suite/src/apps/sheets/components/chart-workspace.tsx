// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { Button } from "@jeswr/suite-ui";
import { useEffect, useId, useRef, useState } from "react";
import { chartModel } from "../lib/charts/model";
import { chartSheet, chartSource, chartValues } from "../lib/charts/range";
import {
  type ChartSpec,
  chartSpecSchema,
  chartTypes,
  readCharts,
  withCharts,
} from "../lib/charts/spec";
import type { SheetEngine, Snapshot } from "../lib/contract";

export function ChartSvg({ spec, values }: { spec: ChartSpec; values: unknown[][] }) {
  const id = useId();
  const model = chartModel(spec, values);
  return (
    <>
      <svg
        role="img"
        aria-labelledby={`${id}-title ${id}-desc`}
        viewBox="0 0 480 280"
        className="sht-chart-svg"
      >
        <title id={`${id}-title`}>{model.title}</title>
        <desc id={`${id}-desc`}>{model.description}</desc>
        {model.marks.map((mark, i) => {
          // Marks have stable data order and are wholly recomputed after each edit.
          const key = i;
          if (mark.kind === "rect")
            return (
              <rect
                key={key}
                x={mark.x}
                y={mark.y}
                width={mark.width}
                height={mark.height}
                fill={mark.colour}
              />
            );
          if (mark.kind === "circle")
            return <circle key={key} cx={mark.x} cy={mark.y} r={mark.radius} fill={mark.colour} />;
          return (
            <path
              key={key}
              d={mark.d}
              fill={mark.fill ? mark.colour : "none"}
              stroke={mark.colour}
              strokeWidth={2}
            />
          );
        })}
        {model.labels.map((label) => (
          <text key={`${label.x}-${label.y}`} x={label.x} y={label.y} textAnchor="middle">
            {label.text}
          </text>
        ))}
        {model.empty && (
          <text x={240} y={140} textAnchor="middle">
            No numeric data to display
          </text>
        )}
      </svg>
      {model.legend.length > 0 && (
        <ul className="sht-chart-legend" aria-label="Chart legend">
          {model.legend.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: legend entries have no local state
            <li key={`${i}-${item.name}`}>
              <span style={{ background: item.colour }} />
              {item.name}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ChartCard({
  spec,
  snapshot,
  onEdit,
  readOnly,
}: {
  spec: ChartSpec;
  snapshot: Snapshot;
  onEdit: () => void;
  readOnly: boolean;
}) {
  let values: unknown[][] = [];
  let error = "";
  try {
    values = chartValues(snapshot, spec.sheetId, spec.range);
  } catch (failure) {
    error =
      spec.range === null || (failure as Error).message.startsWith("Range too large to chart")
        ? (failure as Error).message
        : "The source sheet or range is no longer available. Edit or delete this chart.";
  }
  return (
    <article className="sht-chart-card" aria-label={spec.title || "Untitled chart"}>
      <div className="sht-chart-heading">
        <h2>{spec.title || "Untitled chart"}</h2>
        <Button variant="ghost" size="sm" onClick={onEdit} disabled={readOnly}>
          Edit chart
        </Button>
      </div>
      {error && <p role="status">{error}</p>}
      <ChartSvg spec={spec} values={values} />
    </article>
  );
}

export function ChartWorkspace({
  engine,
  snapshot,
  readOnly = false,
}: {
  engine: SheetEngine | null;
  snapshot: Snapshot;
  readOnly?: boolean;
}) {
  const [current, setCurrent] = useState(snapshot);
  const [draft, setDraft] = useState<ChartSpec>();
  const openedSource = useRef<ChartSpec | undefined>(undefined);
  const [inserting, setInserting] = useState(false);
  const [error, setError] = useState("");
  const insert = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    if (!engine) {
      setCurrent(snapshot);
      return;
    }
    const refresh = () => setCurrent(engine.snapshot());
    refresh();
    return engine.onValuesChange ? engine.onValuesChange(refresh) : engine.onChange(refresh);
  }, [engine, snapshot]);
  const draftId = draft?.id;
  useEffect(() => {
    if (draftId) title.current?.focus();
  }, [draftId]);
  const charts = readCharts(current).charts;
  const close = () => {
    setDraft(undefined);
    setError("");
    insert.current?.focus();
  };
  const persist = (next: ChartSpec[]) => {
    if (readOnly || !engine?.setCharts) return;
    const updated = withCharts(engine.snapshot(), next);
    engine.setCharts(updated.charts);
    setCurrent(updated);
    close();
  };
  const start = () => {
    if (readOnly) return;
    const selected = engine?.selection?.();
    if (!selected) {
      setError("Select cells in the grid before inserting a chart.");
      return;
    }
    setError("");
    setInserting(true);
    setDraft({
      id: crypto.randomUUID(),
      sheetId: selected.sheetId,
      range: selected.range,
      type: "column",
      title: "",
      legend: true,
      series: "columns",
    });
  };
  return (
    <section className="sht-chart-workspace" aria-label="Charts">
      <div className="sht-chart-toolbar">
        <Button
          ref={insert}
          variant="outline"
          size="sm"
          disabled={readOnly || !engine?.setCharts || charts.length >= 100}
          onClick={start}
        >
          Insert chart
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
      <div className="sht-chart-layout">
        {charts.length > 0 && (
          <section className="sht-chart-strip" aria-label="Workbook charts">
            {charts.map((spec) => (
              <ChartCard
                key={spec.id}
                spec={spec}
                snapshot={current}
                readOnly={readOnly}
                onEdit={() => {
                  openedSource.current = spec;
                  setDraft(spec);
                  setInserting(false);
                  setError("");
                }}
              />
            ))}
          </section>
        )}
        {draft && !readOnly && (
          <aside className="sht-chart-editor" aria-label="Chart editor">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const latest = engine?.snapshot() ?? current;
                const latestCharts = readCharts(latest).charts;
                const live = latestCharts.find((chart) => chart.id === draft.id);
                // Untouched sources follow structural edits made while this editor is open.
                const source =
                  !inserting && draft.range === openedSource.current?.range && live ? live : draft;
                const parsed = chartSpecSchema.safeParse({
                  ...draft,
                  sheetId: source.sheetId,
                  range: source.range,
                });
                if (!parsed.success) {
                  setError("Enter a valid chart title and rectangular A1 range.");
                  return;
                }
                try {
                  // The qualifier is an editor check; stable sheet identity owns saved sources.
                  if (parsed.data.range === null) chartSheet(latest, parsed.data.sheetId);
                  else
                    parsed.data.range = chartSource(
                      latest,
                      parsed.data.sheetId,
                      parsed.data.range,
                    ).range.a1;
                } catch (failure) {
                  setError((failure as Error).message);
                  return;
                }
                persist(
                  inserting
                    ? [...latestCharts, parsed.data]
                    : latestCharts.map((chart) => (chart.id === draft.id ? parsed.data : chart)),
                );
              }}
            >
              <h2>Chart editor</h2>
              <label htmlFor={`${id}-title`}>Chart title</label>
              <input
                ref={title}
                id={`${id}-title`}
                maxLength={200}
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
              <label htmlFor={`${id}-type`}>Chart type</label>
              <select
                id={`${id}-type`}
                value={draft.type}
                onChange={(event) =>
                  setDraft({ ...draft, type: event.target.value as ChartSpec["type"] })
                }
              >
                {chartTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </select>
              <label htmlFor={`${id}-range`}>Data range (A1)</label>
              <input
                id={`${id}-range`}
                value={draft.range ?? ""}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(event) => {
                  setDraft({ ...draft, range: event.target.value });
                  setError("");
                }}
              />
              <label htmlFor={`${id}-series`}>Series from</label>
              <select
                id={`${id}-series`}
                value={draft.series}
                onChange={(event) =>
                  setDraft({ ...draft, series: event.target.value as ChartSpec["series"] })
                }
              >
                <option value="columns">Columns</option>
                <option value="rows">Rows</option>
              </select>
              <label className="sht-chart-checkbox">
                <input
                  type="checkbox"
                  checked={draft.legend}
                  onChange={(event) => setDraft({ ...draft, legend: event.target.checked })}
                />
                Show legend
              </label>
              <div className="sht-chart-buttons">
                <Button type="submit">{inserting ? "Insert" : "Apply"}</Button>
                <Button type="button" variant="ghost" onClick={close}>
                  Cancel
                </Button>
                {!inserting && (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => persist(charts.filter((chart) => chart.id !== draft.id))}
                  >
                    Delete chart
                  </Button>
                )}
              </div>
            </form>
          </aside>
        )}
      </div>
    </section>
  );
}
