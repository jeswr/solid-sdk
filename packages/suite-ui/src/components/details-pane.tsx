// AUTHORED-BY Codex GPT-6.1-Sol
import { FileText } from "lucide-react";
import type { ReactNode } from "react";
import { formatBytes, plainText, SurfaceFeedback, type SurfaceState } from "./content.js";

/** Structural subset of ShareClient.get; identity URLs are used for counting, never displayed. */
export interface AccessSummary {
  grants: readonly {
    agent:
      | { kind: "webid"; webId: string }
      | { kind: "public" }
      | { kind: "authenticated" }
      | { kind: "group"; url: string }
      | { kind: "app"; clientId: string };
    role: "viewer" | "commenter" | "editor" | "manager";
    inherited: boolean;
    source: string;
  }[];
  canManage: boolean;
}
export function accessSummaryText(access: AccessSummary, ownerId?: string): string {
  if (access.grants.some((grant) => grant.agent.kind === "public")) return "Anyone with the link";
  if (access.grants.some((grant) => grant.agent.kind === "authenticated"))
    return "Anyone signed in";
  const people = new Set(
    access.grants.flatMap(({ agent }) =>
      agent.kind === "webid" && agent.webId !== ownerId ? [agent.webId] : [],
    ),
  );
  const groups = access.grants.some(({ agent }) => agent.kind === "group");
  const apps = access.grants.some(({ agent }) => agent.kind === "app");
  if (groups || apps)
    return `Shared with ${[people.size ? `${people.size} ${people.size === 1 ? "person" : "people"}` : "", groups ? "groups" : "", apps ? "apps" : ""].filter(Boolean).join(", ")}`;
  return people.size
    ? `Shared with ${people.size} ${people.size === 1 ? "person" : "people"}`
    : "Only you";
}
export interface DetailsPaneProps {
  title?: string;
  metadata?: readonly { label: string; value: ReactNode }[];
  access?: AccessSummary;
  accessState?: SurfaceState;
  ownerId?: string;
  /** Pre-resolved profile names, keyed by agent identifier. */
  people?: Readonly<Record<string, string>>;
  actions?: ReactNode;
  onManageAccess?: () => void;
  selection?: { count: number; totalSize: number };
  state?: SurfaceState;
}
export function DetailsPane({
  title,
  metadata = [],
  access,
  accessState,
  ownerId,
  people = {},
  actions,
  onManageAccess,
  selection,
  state,
}: DetailsPaneProps) {
  const ready = (!state || state.status === "ready") && title;
  const ids = [
    ...new Set(
      access?.grants.flatMap(({ agent }) =>
        agent.kind === "webid" && agent.webId !== ownerId ? [agent.webId] : [],
      ) ?? [],
    ),
  ];
  return (
    <aside className="suite-details-pane" aria-label="Details">
      {selection && selection.count > 1 ? (
        <p role="status">
          {selection.count} items selected · {formatBytes(selection.totalSize)}
        </p>
      ) : ready ? (
        <>
          <div className="suite-detail-title">
            <FileText aria-hidden="true" size={24} strokeWidth={1.5} />
            <h2>{plainText(title)}</h2>
          </div>
          {actions && <div className="suite-actions">{actions}</div>}
          <h3 className="suite-section-label">Who has access</h3>
          {access && (!accessState || accessState.status === "ready") ? (
            <>
              <div className="suite-people" aria-hidden="true">
                {ids.slice(0, 5).map((id) => (
                  <span className="suite-avatar" key={id}>
                    {plainText(people[id] ?? "Person")
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((name) => name[0])
                      .join("")}
                  </span>
                ))}
                {ids.length > 5 && <span>+{ids.length - 5}</span>}
              </div>
              <p>{accessSummaryText(access, ownerId)}</p>
              {access.grants.some((grant) => grant.inherited) && (
                <p className="suite-muted">Includes access from the parent folder</p>
              )}
              {access.canManage && onManageAccess && (
                <button type="button" onClick={onManageAccess}>
                  Manage access
                </button>
              )}
            </>
          ) : (
            <SurfaceFeedback state={accessState ?? { status: "loading" }} />
          )}
          <h3 className="suite-section-label">Details</h3>
          <dl className="suite-metadata">
            {metadata.map(({ label, value }) => (
              <div key={label}>
                <dt>{plainText(label)}</dt>
                <dd>{typeof value === "string" ? plainText(value) : value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <SurfaceFeedback
          state={state ?? { status: "empty" }}
          empty="Select an item to see its details"
          action="Select an item"
        />
      )}
    </aside>
  );
}
