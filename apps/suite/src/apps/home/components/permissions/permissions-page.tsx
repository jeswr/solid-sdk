// AUTHORED-BY Codex GPT-6
"use client";

import {
  EmptyState,
  ErrorState,
  Input,
  LoadingSkeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from "@jeswr/suite-ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { failureNotice, type PermissionsView, visibleRows } from "../../lib/permissions/view";
import {
  type PermissionsBinding,
  readPermissionsView,
  technicalDetailsEnabled,
  usePermissions,
  writePermissionsView,
} from "../../state/permissions";
import { useRequestCaps, useRequests } from "../../state/requests";
import { useHomeSession } from "../home-app";
import { PermissionAccessRow } from "./permission-access";

export function usePermissionPreferences() {
  const [view, setView] = useState<PermissionsView>("overview");
  const [technical, setTechnical] = useState(false);
  useEffect(() => {
    const sync = () => {
      setView(readPermissionsView());
      setTechnical(technicalDetailsEnabled());
    };
    sync();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return {
    view,
    technical,
    changeView: (next: string) => {
      if (next === "overview" || next === "advanced") {
        setView(next);
        writePermissionsView(next);
      }
    },
  };
}

export function PermissionViewToggle({
  view,
  onChange,
}: {
  view: PermissionsView;
  onChange: (view: string) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={view}
      onValueChange={onChange}
      aria-label="Permission view"
      variant="outline"
    >
      <ToggleGroupItem value="overview">Overview</ToggleGroupItem>
      <ToggleGroupItem value="advanced">Advanced</ToggleGroupItem>
    </ToggleGroup>
  );
}

export function PermissionNotices({ binding }: { binding: PermissionsBinding }) {
  return (
    <>
      {!binding.online && (
        <p role="status" className="hm-permission-notice">
          Showing saved copies. Reconnect to change access.
        </p>
      )}
      {binding.failures.length > 0 && (
        <p role="status" className="hm-permission-muted">
          {failureNotice(binding.failures)}
        </p>
      )}
      {binding.truncated && (
        <p role="status" className="hm-permission-muted">
          Some access hasn't been checked yet. This list may be incomplete.
        </p>
      )}
    </>
  );
}

/**
 * Requests is a route, not a tab panel: it sits beside the tablist so arrow keys never
 * land on a tab without a panel. HM-08 supplies the pending count.
 */
export function RequestsLink({ pending = 0 }: { pending?: number }) {
  return (
    <Link className="hm-permission-requests" href="/permissions/requests">
      Requests
      {pending > 0 && (
        <span className="hm-permission-count">
          {pending}
          <span className="sr-only"> pending</span>
        </span>
      )}
    </Link>
  );
}

/** The Requests link with the live pending count; mounted only when requests are available. */
function PendingRequestsLink() {
  const { pending, unreadable } = useRequests();
  return <RequestsLink pending={pending.length + unreadable.length} />;
}

export function PermissionsPage() {
  const binding = usePermissions();
  const caps = useRequestCaps();
  const session = useHomeSession();
  const preferences = usePermissionPreferences();
  const [tab, setTab] = useState("people");
  const [search, setSearch] = useState("");
  return (
    <div className="hm-page hm-permissions-page">
      <header>
        <h1>Permissions</h1>
        <p className="hm-permission-muted">Who can see or change the data in your pod.</p>
      </header>
      <Tabs value={tab} onValueChange={setTab}>
        <div className="hm-permission-toolbar">
          <TabsList aria-label="Permissions" variant="line">
            <TabsTrigger value="people">People</TabsTrigger>
            <TabsTrigger value="apps">Apps</TabsTrigger>
          </TabsList>
          {caps.accessRequests && <PendingRequestsLink />}
          <Input
            className="hm-permission-search"
            aria-label="Search permissions"
            placeholder="Search by name or data type"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <PermissionViewToggle view={preferences.view} onChange={preferences.changeView} />
        </div>
        <PermissionNotices binding={binding} />
        {(["people", "apps"] as const).map((kind) => {
          const rows = visibleRows(binding.rows, kind, search, session.storageUrl);
          return (
            <TabsContent key={kind} value={kind}>
              {binding.status === "loading" ? (
                <LoadingSkeleton preset="list" count={5} label="Loading permissions" />
              ) : binding.status === "error" ? (
                <ErrorState error="unreachable" actions={{ retry: () => void binding.refresh() }} />
              ) : rows.length ? (
                <div className="hm-permission-list">
                  {rows.map((row) => (
                    <PermissionAccessRow
                      key={row.key}
                      row={row}
                      binding={binding}
                      storage={session.storageUrl}
                      view={preferences.view}
                      technical={preferences.technical}
                    />
                  ))}
                </div>
              ) : search.trim() ? (
                <EmptyState
                  variant="filtered-empty"
                  query={search}
                  onClearFilters={() => setSearch("")}
                />
              ) : (
                <EmptyState
                  title={
                    kind === "people"
                      ? "You haven't shared anything yet."
                      : "No apps have access to your pod."
                  }
                  body={kind === "people" ? "Share from any item's menu." : ""}
                />
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
