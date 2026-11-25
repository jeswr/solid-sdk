// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import type { HealthFact, HealthGraphView } from "@jeswr/pkg-health";
import { Button, EmptyState, FilterChips, Input } from "@jeswr/suite-ui";
import { useState } from "react";
import {
  BELIEFS,
  beliefLabel,
  factKey,
  factPeriod,
  filterFacts,
  KINDS,
  kindLabel,
} from "../lib/knowledge/view-model";
export function KnowledgeFacts({
  view,
  query,
  setQuery,
  onSelect,
}: {
  view: HealthGraphView;
  query: string;
  setQuery(query: string): void;
  onSelect(fact: HealthFact): void;
}) {
  const [beliefs, setBeliefs] = useState<string[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const facts = filterFacts(view, { beliefs, kinds, text: query });
  const clear = () => {
    setBeliefs([]);
    setKinds([]);
    setQuery("");
  };
  return (
    <div className="hlt-knowledge-stack">
      <h2>All health facts</h2>
      <FilterChips
        label="Fact belief"
        options={BELIEFS}
        value={beliefs}
        onChange={setBeliefs}
        resultCount={facts.length}
      />
      <FilterChips
        label="Fact kind"
        options={KINDS}
        value={kinds}
        onChange={setKinds}
        resultCount={facts.length}
      />
      <div className="hlt-form">
        <label htmlFor="hlt-knowledge-search">Filter facts</label>
        <Input
          id="hlt-knowledge-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, note or source"
          autoComplete="off"
        />
      </div>
      <p className="hlt-muted">
        {facts.length} of {view.facts.length} facts · Select a fact to see where it came from.
      </p>
      {facts.length ? (
        <ul className="hlt-knowledge-facts" aria-label="Health facts">
          {facts.map((f) => (
            <li key={factKey(f)}>
              <button
                data-fact-id={f.id}
                className="hlt-knowledge-fact"
                type="button"
                onClick={() => onSelect(f)}
              >
                <strong>{f.label}</strong>
                <span className="hlt-knowledge-badge">{beliefLabel(f.belief)}</span>
                <span>
                  {kindLabel(f.kind)} · {factPeriod(f)}
                </span>
                <span className="hlt-muted">
                  {f.provenance.sources.map((s) => s.title ?? "Untitled source").join(" · ") ||
                    "Source not recorded"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          variant="filtered-empty"
          title="No matching facts"
          body="Try another name, belief or kind."
          primaryAction={
            <Button variant="outline" onClick={clear}>
              Clear filters
            </Button>
          }
        />
      )}
    </div>
  );
}
export function KnowledgeNotes({
  view,
  onSelect,
}: {
  view: HealthGraphView;
  onSelect(fact: HealthFact): void;
}) {
  const groups = new Map<string, HealthFact[]>();
  for (const fact of view.byKind.note)
    groups.set(fact.label, [...(groups.get(fact.label) ?? []), fact]);
  return (
    <div className="hlt-knowledge-stack">
      <h2>Other things your assistant noted</h2>
      <div className="hlt-knowledge-grid">
        {[...groups].map(([label, facts]) => (
          <section className="hlt-panel" key={label}>
            <h3>{label}</h3>
            <ul className="hlt-knowledge-list">
              {facts.map((f) => (
                <li key={factKey(f)}>
                  <p>{f.kind === "note" ? f.value : ""}</p>
                  <span className="hlt-knowledge-badge">{beliefLabel(f.belief)}</span>
                  <Button size="sm" variant="outline" onClick={() => onSelect(f)}>
                    View {label} provenance
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {!groups.size && <p className="hlt-muted">No other notes in this graph.</p>}
      <section className="hlt-panel hlt-knowledge-stack">
        <h2>Documents</h2>
        {view.byKind.document.length ? (
          <ul className="hlt-knowledge-list">
            {view.byKind.document.map((f) => (
              <li key={factKey(f)}>
                <strong>{f.label}</strong>
                <span className="hlt-muted">{factPeriod(f)}</span>
                <span className="hlt-knowledge-badge">{beliefLabel(f.belief)}</span>
                <Button variant="outline" size="sm" onClick={() => onSelect(f)}>
                  View document provenance
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hlt-muted">No documents in this graph.</p>
        )}
      </section>
    </div>
  );
}
