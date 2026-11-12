// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import type { HealthGraphView } from "@jeswr/pkg-health";
import { StatTile } from "@jeswr/suite-charts";
import {
  beliefLabel,
  bodySystemGroups,
  factKey,
  formatKnowledgeDate,
  knowledgeStats,
  needsReview,
  sourceCounts,
} from "../lib/knowledge/view-model";
export function KnowledgeOverview({
  view,
  onReview,
}: {
  view: HealthGraphView;
  onReview(label: string): void;
}) {
  const stats = knowledgeStats(view);
  const review = needsReview(view);
  return (
    <div className="hlt-knowledge-stack">
      <div className="hlt-knowledge-stats">
        <StatTile
          label="Current conditions"
          value={stats.conditions}
          footnote="Definitely · Current claims"
        />
        <StatTile
          label="Current medications"
          value={stats.medications}
          footnote="Definitely · Current claims"
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
            {review.map((f) => (
              <li key={factKey(f)}>
                {/* biome-ignore lint/a11y/useValidAnchor: This native hash link navigates to the Facts tab. */}
                <a href="#facts" onClick={() => onReview(f.label)}>
                  {f.label}
                </a>
                <span className="hlt-knowledge-badge">{beliefLabel(f.belief)}</span>
                <span className="hlt-muted">
                  {f.validity === "Contradicted" ? "Conflicting claim" : f.hedge || "Uncertain"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No uncertain or conflicting claims to review.</p>
        )}
      </section>
      <section className="hlt-knowledge-stack" aria-labelledby="hlt-knowledge-systems-title">
        <div>
          <h2 id="hlt-knowledge-systems-title">Browse by body system</h2>
          <p className="hlt-muted">Grouped by keyword, for browsing only</p>
        </div>
        <div className="hlt-knowledge-grid">
          {bodySystemGroups(view).map((group) => (
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
          {sourceCounts(view).map((s) => (
            <li key={s.iri}>
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
      </section>
    </div>
  );
}
