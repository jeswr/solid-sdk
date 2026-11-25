// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import type { HealthGraphView } from "@jeswr/pkg-health";
import { StatTile } from "@jeswr/suite-charts";
import { useMemo } from "react";
import {
  beliefLabel,
  bodySystemGroups,
  factKey,
  formatKnowledgeDate,
  knowledgeStats,
  needsReview,
  sourceCounts,
  uncertaintyNote,
} from "../lib/knowledge/view-model";
import { ShowMore, usePaged } from "./knowledge-paging";
export function KnowledgeOverview({
  view,
  onReview,
}: {
  view: HealthGraphView;
  onReview(label: string): void;
}) {
  const stats = useMemo(() => knowledgeStats(view), [view]);
  const review = useMemo(() => needsReview(view), [view]);
  const systems = useMemo(() => bodySystemGroups(view), [view]);
  const sources = useMemo(() => sourceCounts(view), [view]);
  const shownReview = usePaged(review);
  const shownSources = usePaged(sources);
  return (
    <div className="hlt-knowledge-stack">
      <div className="hlt-knowledge-stats">
        <StatTile
          label="Current conditions"
          value={stats.conditions}
          footnote="Definitely · Current claims, not counting any with an unread later update"
        />
        <StatTile
          label="Current medications"
          value={stats.medications}
          footnote="Definitely · Current claims, not counting any with an unread later update"
        />
        <StatTile label="Tracked results" value={stats.results} footnote="Numeric result series" />
        <StatTile
          label="Sources"
          value={stats.sources}
          footnote="Referenced conversations and documents"
        />
      </div>
      <section
        className="hlt-panel hlt-knowledge-stack"
        aria-labelledby="hlt-knowledge-review-title"
      >
        <div>
          <h2 id="hlt-knowledge-review-title">Needs your review</h2>
          <p className="hlt-muted">Uncertain or conflicting claims you may want to check.</p>
        </div>
        {review.length ? (
          <ul className="hlt-knowledge-list">
            {shownReview.visible.map((f) => (
              <li key={factKey(f)}>
                {/* biome-ignore lint/a11y/useValidAnchor: This native hash link navigates to the Facts tab. */}
                <a href="#facts" onClick={() => onReview(f.label)}>
                  {f.label}
                </a>
                <span className="hlt-knowledge-badge">{beliefLabel(f.belief)}</span>
                <span className="hlt-muted">
                  {uncertaintyNote(f) ||
                    (f.validity === "Contradicted" ? "Conflicting claim" : f.hedge || "Uncertain")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No uncertain or conflicting claims to review.</p>
        )}
        <ShowMore remaining={shownReview.remaining} noun="claims" onMore={shownReview.more} />
      </section>
      <section className="hlt-knowledge-stack" aria-labelledby="hlt-knowledge-systems-title">
        <div>
          <h2 id="hlt-knowledge-systems-title">Browse by body system</h2>
          <p className="hlt-muted">Grouped by keyword, for browsing only</p>
        </div>
        <div className="hlt-knowledge-grid">
          {systems.map((group) => (
            <article className="hlt-panel" key={group.id}>
              <h3 className="hlt-knowledge-capital">{group.id}</h3>
              <p className="hlt-muted">
                {group.count} {group.count === 1 ? "fact" : "facts"}
              </p>
              <ul>
                {group.labels.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
      <section
        className="hlt-panel hlt-knowledge-stack"
        aria-labelledby="hlt-knowledge-sources-title"
      >
        <h2 id="hlt-knowledge-sources-title">Sources</h2>
        <ul className="hlt-knowledge-list">
          {shownSources.visible.map((s) => (
            <li key={`${s.batch}\u0000${s.iri}`}>
              <strong>{s.title ?? "Untitled source"}</strong>
              <span className="hlt-muted">
                {s.kind ?? "Kind not recorded"} · {formatKnowledgeDate(s.created)}
              </span>
              <span>
                {s.count} {s.count === 1 ? "fact" : "facts"}
              </span>
            </li>
          ))}
        </ul>
        <ShowMore remaining={shownSources.remaining} noun="sources" onMore={shownSources.more} />
      </section>
    </div>
  );
}
