// AUTHORED-BY Claude Fable 5
//
// The grant dashboard: BY-RESOURCE ("what is shared, with whom, which modes")
// and BY-AGENT ("who can see what") over the walked tree. Direct vs inherited
// access is labelled; public access is prominently flagged. Edits (revoke an
// agent, downgrade modes, remove public) are optimistic + If-Match-guarded —
// the CAS retry loop lives in the lib; a lost conflict reverts and surfaces.

import { useMemo, useState } from "react";
import { useSession } from "../auth/SessionContext.js";
import {
  removeAgentFromEntry,
  removeAuthenticatedFromEntry,
  removePublicFromEntry,
  setAgentModes,
  updateAclWithRetry,
  type WacMode,
} from "../lib/acl.js";
import {
  AUTHENTICATED_AGENT,
  byAgent,
  byResource,
  PUBLIC_AGENT,
  type ShareLine,
} from "../lib/grants.js";
import type { WalkedNode } from "../lib/storage-walk.js";
import { AgentLabel, ModeBadges, resourceLabel, SavingIndicator, useOptimistic } from "./bits.jsx";

type ViewMode = "by-resource" | "by-agent";

function lineKey(url: string, line: ShareLine): string {
  return `${url}|${line.authIri}|${line.agent}`;
}

export function DashboardView({
  nodes,
  storageRoot,
  walking,
  onChanged,
}: {
  nodes: WalkedNode[];
  storageRoot: string | null;
  walking: boolean;
  onChanged: () => void;
}) {
  const session = useSession();
  const [view, setView] = useState<ViewMode>("by-resource");
  // Optimistic local overlay: lines removed / re-moded before the pod confirms.
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [modeOverrides, setModeOverrides] = useState<ReadonlyMap<string, WacMode[]>>(new Map());
  const { state, error, run } = useOptimistic();

  const resources = useMemo(() => byResource(nodes, session.webId), [nodes, session.webId]);
  const agents = useMemo(() => byAgent(nodes, session.webId), [nodes, session.webId]);

  const revokeLine = (url: string, line: ShareLine, aclUrl: string | undefined) => {
    if (!aclUrl) return;
    const key = lineKey(url, line);
    void run({
      apply: () => setRemoved((prev) => new Set(prev).add(key)),
      revert: () =>
        setRemoved((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        }),
      persist: async () => {
        await updateAclWithRetry(aclUrl, session.fetch, (dataset) => {
          if (line.agent === PUBLIC_AGENT) {
            removePublicFromEntry(dataset, line.authIri, session.webId);
          } else if (line.agent === AUTHENTICATED_AGENT) {
            removeAuthenticatedFromEntry(dataset, line.authIri, session.webId);
          } else {
            removeAgentFromEntry(dataset, line.authIri, line.agent, session.webId);
          }
        });
        onChanged();
      },
    });
  };

  const downgradeToRead = (url: string, line: ShareLine, aclUrl: string | undefined) => {
    if (!aclUrl || line.agent === PUBLIC_AGENT || line.agent === AUTHENTICATED_AGENT) return;
    const key = lineKey(url, line);
    void run({
      apply: () => setModeOverrides((prev) => new Map(prev).set(key, ["Read"])),
      revert: () =>
        setModeOverrides((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        }),
      persist: async () => {
        await updateAclWithRetry(aclUrl, session.fetch, (dataset) => {
          setAgentModes(dataset, aclUrl, line.authIri, line.agent, ["Read"], session.webId);
        });
        onChanged();
      },
    });
  };

  const renderLine = (
    url: string,
    line: ShareLine,
    aclUrl: string | undefined,
    showResource = false,
  ) => {
    const key = lineKey(url, line);
    if (removed.has(key)) return null;
    const modes = modeOverrides.get(key) ?? line.modes;
    const canDowngrade =
      line.agent !== PUBLIC_AGENT &&
      line.agent !== AUTHENTICATED_AGENT &&
      modes.some((m) => m !== "Read");
    return (
      <li key={key} className={line.inherited ? "share-line inherited" : "share-line"}>
        {showResource ? (
          <span className="resource-name">{resourceLabel(url, storageRoot)}</span>
        ) : (
          <AgentLabel agent={line.agent} fetchFn={session.fetch} />
        )}
        <ModeBadges modes={modes} />
        {line.inherited ? (
          <span className="origin-badge" title="Granted on an ancestor container (acl:default)">
            inherited
          </span>
        ) : (
          <span className="origin-badge direct" title="Granted on this resource (acl:accessTo)">
            direct
          </span>
        )}
        {canDowngrade ? (
          <button type="button" onClick={() => downgradeToRead(url, line, aclUrl)}>
            Limit to read
          </button>
        ) : null}
        <button
          type="button"
          className="danger"
          onClick={() => revokeLine(url, line, aclUrl)}
          data-testid={`revoke-${line.agent}`}
        >
          {line.agent === PUBLIC_AGENT ? "Remove public access" : "Revoke"}
        </button>
      </li>
    );
  };

  return (
    <section aria-label="Grant dashboard">
      <div className="view-toolbar">
        <div role="tablist" aria-label="Dashboard view">
          <button
            type="button"
            role="tab"
            aria-selected={view === "by-resource"}
            onClick={() => setView("by-resource")}
          >
            By resource
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "by-agent"}
            onClick={() => setView("by-agent")}
          >
            By agent
          </button>
        </div>
        {walking ? <span className="walking">Scanning your storage…</span> : null}
        <SavingIndicator state={state} error={error} />
      </div>

      {view === "by-resource" ? (
        resources.length === 0 && !walking ? (
          <p className="empty">Nothing in your storage is shared beyond you.</p>
        ) : (
          <ul className="resource-list">
            {resources.map((r) => (
              <li key={r.url} className={r.hasPublicAccess ? "resource public" : "resource"}>
                <div className="resource-head">
                  <span className="resource-name">{resourceLabel(r.url, storageRoot)}</span>
                  {r.hasPublicAccess ? <span className="public-flag">⚠ PUBLIC</span> : null}
                  {r.aclError ? (
                    <span className="acl-error">ACL unreadable ({r.aclError})</span>
                  ) : null}
                </div>
                <ul className="share-lines">
                  {r.shares.map((line) => renderLine(r.url, line, r.aclUrl))}
                </ul>
              </li>
            ))}
          </ul>
        )
      ) : agents.length === 0 && !walking ? (
        <p className="empty">No one else can access anything in your storage.</p>
      ) : (
        <ul className="agent-list">
          {agents.map((a) => (
            <li key={a.agent} className="agent-holding">
              <div className="agent-head">
                <AgentLabel agent={a.agent} fetchFn={session.fetch} />
                <span className="count">{a.resources.length} resource(s)</span>
              </div>
              <ul className="share-lines">
                {a.resources.map((r) => {
                  const node = nodes.find((n) => n.url === r.url);
                  return renderLine(
                    r.url,
                    {
                      agent: a.agent,
                      modes: r.modes,
                      authIri: r.authIri,
                      inherited: r.inherited,
                    },
                    node?.aclUrl,
                    true,
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
