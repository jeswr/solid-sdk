// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  FilterChips,
  LoadingSkeleton,
} from "@jeswr/suite-ui";
import { Activity, Utensils } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { encodeRef } from "@/lib/refs";
import { type DiaryDraft, type DiaryEntry, diaryLabel } from "../lib/data/diary";
import { diaryDay, diaryWeek } from "../lib/diary-time";
import { useDiary } from "../state/diary-context";
import { useDiaryMode } from "../state/diary-mode-context";
import { useHealth } from "../state/health-context";
import { DiaryModeSettings } from "./diary-mode-settings";
import { DiaryReadNote } from "./diary-read-note";
import { DiarySheet } from "./diary-sheet";

export function DiaryView() {
  const { clock } = useHealth();
  const query = useSearchParams();
  const queryDate = query.get("date");
  const queryMode = query.get("mode");
  const mode = useDiaryMode();
  const modeUnavailable = mode.loading;
  const { forVisit } = mode;
  useEffect(() => {
    if (queryMode === "coeliac") forVisit();
  }, [queryMode, forVisit]);
  const [navigation, setNavigation] = useState({ date: queryDate, offset: 0 });
  const offset = navigation.date === queryDate ? navigation.offset : 0;
  const setOffset = (change: number) => setNavigation({ date: queryDate, offset: offset + change });
  useEffect(() => {
    setNavigation({ date: queryDate, offset: 0 });
  }, [queryDate]);
  const [filters, setFilters] = useState<string[]>([]);
  const [form, setForm] = useState<{ kind: DiaryDraft["kind"]; entry?: DiaryEntry } | null>(null);
  const [failure, setFailure] = useState("");
  const range = diaryWeek(clock, queryDate, offset);
  const { start, end } = range;
  const { state, busy, remove, failures, retry } = useDiary(range);
  const entries = state.status === "ready" || state.status === "empty" ? state.data : [];
  const tags = [
    ...new Set(entries.flatMap((entry) => (entry.kind === "meal" ? entry.tags : []))),
  ].sort();
  const selectedKinds = filters.filter((value) => value === "meal" || value === "symptom");
  const selectedTags = filters
    .filter((value) => value.startsWith("tag:"))
    .map((value) => value.slice(4));
  const visible = entries.filter(
    (entry) =>
      entry.at >= start &&
      entry.at < end &&
      (!selectedKinds.length || selectedKinds.includes(entry.kind)) &&
      (!selectedTags.length ||
        (entry.kind === "meal" && selectedTags.some((tag) => entry.tags.includes(tag)))),
  );
  const days = [...new Set(visible.map((entry) => diaryDay(entry.at)))];
  const anchorEntries = visible.map((entry) => entry.url).join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry focus only when the loaded entry set or navigation changes
  useEffect(() => {
    const focusAnchor = () => {
      if (state.status !== "ready") return;
      const id = window.location.hash.slice(1);
      if (!id.startsWith("diary-")) return;
      const target = document.getElementById(id);
      if (!target) return;
      target.scrollIntoView?.({ block: "center" });
      target.focus({ preventScroll: true });
    };
    focusAnchor();
    window.addEventListener("hashchange", focusAnchor);
    return () => window.removeEventListener("hashchange", focusAnchor);
  }, [state.status, queryDate, anchorEntries]);
  return (
    <div className="hlt-page">
      <header className="hlt-page-header">
        <div>
          <p className="hlt-eyebrow">FOOD & SYMPTOMS</p>
          <h1>Diary</h1>
          <p className="hlt-muted">Your meals and symptoms, day by day. Private to you.</p>
        </div>
        <div className="hlt-diary-actions">
          <Button disabled={modeUnavailable} onClick={() => setForm({ kind: "meal" })}>
            Log meal
          </Button>
          <Button
            disabled={modeUnavailable}
            variant="outline"
            onClick={() => setForm({ kind: "symptom" })}
          >
            Log symptom
          </Button>
          <Link
            href={mode.enabled ? "/health/diary/patterns?mode=coeliac" : "/health/diary/patterns"}
          >
            Patterns
          </Link>
        </div>
      </header>
      <DiaryModeSettings />
      <section className="hlt-diary-actions" aria-label="Diary date range">
        <Button variant="outline" onClick={() => setOffset(1)}>
          Previous week
        </Button>
        <p role="status">
          {diaryDay(start)} – {diaryDay(new Date(end.getTime() - 1))} · local time
        </p>
        <Button
          variant="outline"
          disabled={diaryDay(new Date(end.getTime() - 1)) >= diaryDay(clock)}
          onClick={() => setOffset(-1)}
        >
          Next week
        </Button>
      </section>
      {failure && <p role="alert">{failure}</p>}
      <DiaryReadNote count={failures.length} />
      {state.status === "loading" ? (
        <LoadingSkeleton preset="list" label="Loading diary" />
      ) : state.status === "error" ? (
        <ErrorState error="unreachable" actions={{ retry }}>
          <p>Couldn't load your diary.</p>
        </ErrorState>
      ) : (
        <>
          <FilterChips
            label="Filter diary entries"
            options={[
              { id: "meal", label: "Meals" },
              { id: "symptom", label: "Symptoms" },
              ...tags.map((tag) => ({ id: `tag:${tag}`, label: tag })),
            ]}
            value={filters}
            onChange={setFilters}
            resultCount={visible.length}
          />
          {!visible.length ? (
            <EmptyState
              title={entries.length ? "No entries this week" : "Start your diary"}
              body="Log meals and symptoms to keep a personal timeline. Try another week or clear your filters."
              primaryAction={
                <Button disabled={modeUnavailable} onClick={() => setForm({ kind: "meal" })}>
                  Log meal
                </Button>
              }
            />
          ) : (
            days.map((day) => (
              <section key={day} aria-label={`Diary for ${day}`}>
                <h2>
                  {new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </h2>
                <ol className="hlt-diary-timeline">
                  {visible
                    .filter((entry) => diaryDay(entry.at) === day)
                    .map((entry) => {
                      const Icon = entry.kind === "meal" ? Utensils : Activity;
                      return (
                        <li key={entry.url}>
                          <article
                            className="hlt-diary-entry"
                            id={`diary-${encodeRef(entry.url)}`}
                            tabIndex={-1}
                          >
                            <div className="hlt-diary-entry-heading">
                              <Icon size={18} aria-hidden="true" />
                              <span className="hlt-muted">
                                {entry.kind === "meal" ? "Meal" : "Symptom"}
                              </span>
                              <time dateTime={entry.at.toISOString()}>
                                {entry.at.toLocaleTimeString("en-GB", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </time>
                            </div>
                            <h3>{diaryLabel(entry)}</h3>
                            {entry.kind === "meal" ? (
                              <>
                                {entry.ingredients && <p>Ingredients: {entry.ingredients}</p>}
                                <div className="hlt-diary-actions">
                                  {entry.tags.map((tag) => (
                                    <Badge key={tag}>{tag}</Badge>
                                  ))}
                                </div>
                              </>
                            ) : (
                              <p>
                                {entry.severity === null
                                  ? "Severity not recorded"
                                  : `Severity ${entry.severity}/10`}
                                {entry.durationMinutes === null
                                  ? ""
                                  : ` · ${entry.durationMinutes} minutes`}
                              </p>
                            )}
                            {entry.note && <p className="hlt-diary-note">{entry.note}</p>}
                            {entry.readOnly ? (
                              <p className="hlt-muted">Logged in the Coeliac app</p>
                            ) : (
                              <div className="hlt-diary-actions">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={modeUnavailable || busy.includes(entry.url)}
                                  onClick={() => setForm({ kind: entry.kind, entry })}
                                  aria-label={`Edit ${diaryLabel(entry)}`}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={busy.includes(entry.url)}
                                  onClick={() => {
                                    setFailure("");
                                    void remove(entry).catch(() =>
                                      setFailure(
                                        "Couldn't delete this entry. It may have changed elsewhere; review the refreshed diary and try again.",
                                      ),
                                    );
                                  }}
                                  aria-label={`Delete ${diaryLabel(entry)}`}
                                >
                                  Delete
                                </Button>
                              </div>
                            )}
                          </article>
                        </li>
                      );
                    })}
                </ol>
              </section>
            ))
          )}
        </>
      )}
      {form && !modeUnavailable && (
        <DiarySheet key={mode.trigger} {...form} onClose={() => setForm(null)} />
      )}
    </div>
  );
}
