// AUTHORED-BY Claude Fable 5
//
// The data-class view: resources grouped by type-index registration ("Contacts
// / Tasks / Bookmarks" instead of raw paths) with a per-class aggregate access
// summary ("2 agents can Read your Contacts").

import { useMemo } from "react";
import { useSession } from "../auth/SessionContext.js";
import type { WalkedNode } from "../lib/storage-walk.js";
import { classAccessSummary, groupByDataClass, type TypeRegistration } from "../lib/type-index.js";
import { AgentLabel, resourceLabel } from "./bits.jsx";

export function DataClassView({
  nodes,
  registrations,
  storageRoot,
  walking,
}: {
  nodes: WalkedNode[];
  registrations: TypeRegistration[];
  storageRoot: string | null;
  walking: boolean;
}) {
  const session = useSession();
  const { groups, unclassified } = useMemo(
    () => groupByDataClass(nodes, registrations),
    [nodes, registrations],
  );

  if (registrations.length === 0 && !walking) {
    return (
      <section aria-label="Data classes">
        <p className="empty">
          Your profile advertises no type indexes, so resources cannot be grouped into data classes
          yet. The dashboard's by-resource view still shows everything.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Data classes">
      {groups.map((group) => {
        const summary = classAccessSummary(group, session.webId);
        return (
          <article key={group.registration.id} className="data-class">
            <h3>
              {group.registration.label}
              <span className="visibility">({group.registration.visibility} index)</span>
            </h3>
            <p className="class-summary" data-testid={`summary-${group.registration.label}`}>
              {summary.length === 0
                ? "Only you can access this data."
                : `${summary.length} other agent(s) can access this data:`}
            </p>
            {summary.length > 0 ? (
              <ul className="class-access">
                {summary.map((s) => (
                  <li key={s.agent}>
                    <AgentLabel agent={s.agent} fetchFn={session.fetch} /> — {s.modes.join(", ")}
                  </li>
                ))}
              </ul>
            ) : null}
            <details>
              <summary>{group.nodes.length} resource(s)</summary>
              <ul>
                {group.nodes.map((n) => (
                  <li key={n.url}>{resourceLabel(n.url, storageRoot)}</li>
                ))}
              </ul>
            </details>
          </article>
        );
      })}
      {unclassified.length > 0 ? (
        <details className="unclassified">
          <summary>{unclassified.length} resource(s) outside any data class</summary>
          <ul>
            {unclassified.map((n) => (
              <li key={n.url}>{resourceLabel(n.url, storageRoot)}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
