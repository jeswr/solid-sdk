// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, EmptyState, ErrorState, Input, LoadingSkeleton } from "@jeswr/suite-ui";
import Link from "next/link";
import { useState } from "react";
import { diaryPatterns } from "../lib/data/diary";
import { useDiary } from "../state/diary-context";
import { useHealth } from "../state/health-context";
import { DiaryReadNote } from "./diary-read-note";

export function DiaryPatterns() {
  const { state, failures, retry } = useDiary();
  const { clock } = useHealth();
  const [minimum, setMinimum] = useState("2"),
    [maximum, setMaximum] = useState("48");
  const [window, setWindow] = useState({ min: 2, max: 48 });
  const [error, setError] = useState("");
  const entries = state.status === "ready" || state.status === "empty" ? state.data : [];
  const rows = diaryPatterns(entries, window.min, window.max, clock);
  return (
    <div className="hlt-page">
      <header className="hlt-page-header">
        <div>
          <p className="hlt-eyebrow">FOOD & SYMPTOMS</p>
          <h1>Diary patterns</h1>
        </div>
        <Link href="/health/diary">Back to diary</Link>
      </header>
      <p>
        This is a pattern summary, not a diagnosis or medical advice. Meals and symptoms can occur
        together for many reasons. These counts do not establish that a food caused a symptom.
      </p>
      <form
        className="hlt-diary-window"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          try {
            if (!minimum.trim() || !maximum.trim()) throw new Error("missing");
            diaryPatterns([], Number(minimum), Number(maximum), clock);
            setWindow({ min: Number(minimum), max: Number(maximum) });
            setError("");
          } catch {
            setError("Enter a window from 0 to 168 hours, with the end after the start.");
          }
        }}
      >
        <div>
          <label htmlFor="hlt-pattern-min">Hours after a meal, from</label>
          <Input
            id="hlt-pattern-min"
            type="number"
            min={0}
            max={168}
            value={minimum}
            onChange={(event) => setMinimum(event.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? "hlt-pattern-error" : undefined}
          />
        </div>
        <div>
          <label htmlFor="hlt-pattern-max">Hours after a meal, to</label>
          <Input
            id="hlt-pattern-max"
            type="number"
            min={0}
            max={168}
            value={maximum}
            onChange={(event) => setMaximum(event.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? "hlt-pattern-error" : undefined}
          />
        </div>
        <Button type="submit" variant="outline">
          Apply window
        </Button>
      </form>
      {error && (
        <p role="alert" id="hlt-pattern-error">
          {error}
        </p>
      )}
      <p className="hlt-muted" role="status">
        Showing {window.min}–{window.max} hours after each meal. Each meal counts once per food or
        tag and symptom type. Only meals with the full {window.max}-hour follow-up are counted.
        Foods match by their logged name; tags match by text, ignoring case. Missing diary entries
        can change this summary. Each symptom entry counts once per food or tag across overlapping
        windows.
      </p>
      <DiaryReadNote count={failures.length} />
      {state.status === "loading" ? (
        <LoadingSkeleton label="Loading diary patterns" />
      ) : state.status === "error" ? (
        <ErrorState error="unreachable" actions={{ retry }}>
          <p>Couldn't load diary patterns.</p>
        </ErrorState>
      ) : !rows.length ? (
        <EmptyState
          title="No patterns to summarize yet"
          body="Log meals and symptoms, then allow the full follow-up window to pass."
          primaryAction={<Link href="/health/diary">Log in your diary</Link>}
        />
      ) : (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The scrollable table needs a keyboard scroll target on narrow screens.
        <section className="hlt-table-scroll" aria-label="Diary pattern counts" tabIndex={0}>
          <table className="hlt-table hlt-pattern-table">
            <caption>
              Meal co-occurrences · {window.min}–{window.max} hours
            </caption>
            <thead>
              <tr>
                <th scope="col">Symptom</th>
                <th scope="col">Food or tag</th>
                <th scope="col">Meals followed by this symptom</th>
                <th scope="col">Meals without this symptom</th>
                <th scope="col">Distinct symptom entries in the windows</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.symptomType}:${row.kind}:${row.food}`}>
                  <th scope="row">{row.symptomType.replaceAll("-", " ")}</th>
                  <td>
                    {row.food} <span className="hlt-muted">({row.kind})</span>
                  </td>
                  <td>{row.followed}</td>
                  <td>{row.without}</td>
                  <td>{row.symptoms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
