// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, EmptyState, FilterChips, LoadingSkeleton } from "@jeswr/suite-ui";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useHomeSession } from "@/apps/home/components/home-app";
import { AppHeading } from "@/shell/app-frame";
import { appLabel, sharedApps } from "./items";
import { SharedList } from "./shared-list";
import { useSharedItems } from "./use-shared-items";

export function SharedPage() {
  const data = useSharedItems(useHomeSession());
  const initialApp = useSearchParams().get("app");
  const queryApps = initialApp && sharedApps.some((app) => app === initialApp) ? [initialApp] : [];
  const [filter, setFilter] = useState({ query: initialApp, apps: queryApps });
  const apps = filter.query === initialApp ? filter.apps : queryApps;
  const items = data.items.filter((item) => !apps.length || apps.includes(item.app));
  const [removed, setRemoved] = useState("");
  return (
    <div className="hm-page shared-page">
      <AppHeading>Shared with me</AppHeading>
      <p className="hm-muted">Everything people have shared with you, across your apps.</p>
      <FilterChips
        label="Filter shared items by app"
        options={sharedApps.map((id) => ({ id, label: appLabel(id) }))}
        value={apps}
        onChange={(apps) => setFilter({ query: initialApp, apps })}
        resultCount={items.length}
      />
      <p className="hm-muted">
        Newest first. Sender and role are reported by the share announcement.
      </p>
      {data.error ? (
        <p role="alert">
          Couldn't load shared announcements.{" "}
          <Button variant="outline" onClick={data.refresh}>
            Retry
          </Button>
        </p>
      ) : null}
      {data.loading ? (
        <LoadingSkeleton preset="list" count={4} label="Loading shared items" />
      ) : items.length ? (
        <SharedList
          items={items}
          remove={(url) => {
            data.remove(url);
            setRemoved("Removed from Shared with me");
          }}
        />
      ) : (
        <EmptyState
          title={apps.length ? "No shared items for these apps" : "Nothing shared with you yet"}
          body="Shared announcements and links you've opened will appear here."
        />
      )}
      <p role="status" aria-live="polite">
        {removed}
      </p>
    </div>
  );
}
