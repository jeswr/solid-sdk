// AUTHORED-BY Codex GPT-6
"use client";
import { Button, LoadingSkeleton, PodMeter } from "@jeswr/suite-ui";
import Link from "next/link";
import type { DomainItem } from "../lib/model/discovery";
import { sortItems } from "../lib/model/discovery";
import { greeting, itemTitle, relativeTime } from "../state/presentation";

export interface HomeHeaderProps {
  displayName: string;
  items: readonly DomainItem[];
  used: number;
  status: "loading" | "ready" | "error";
  now: number;
  quota?: number;
  access?: { apps: number; people: number; publicItems: number };
  onRetry: () => void;
}

export function HomeHeader({
  displayName,
  items,
  used,
  status,
  now,
  quota,
  access,
  onRetry,
}: HomeHeaderProps) {
  const latest = sortItems(items.filter((item) => item.modified))[0];
  return (
    <header className="hm-header">
      <h1>{greeting(new Date(now), displayName)}</h1>
      <p className="hm-muted">Here's what's in your pod and who can see it.</p>
      <section className="hm-pod" aria-label="Your pod">
        <h2>Your pod</h2>
        {status === "loading" ? (
          <LoadingSkeleton preset="detail" count={3} label="Loading your pod" />
        ) : (
          <div className="hm-pod-columns">
            <div>
              {status === "error" ? (
                <>
                  <p>Couldn't read your storage</p>
                  <Button variant="outline" onClick={onRetry}>
                    Retry
                  </Button>
                </>
              ) : (
                <>
                  <PodMeter used={used} {...(quota === undefined ? {} : { quota })} />
                  {quota === undefined ? (
                    <p className="hm-muted">Your storage doesn't report a limit</p>
                  ) : null}
                </>
              )}
            </div>
            <div className="hm-access">
              <Link href="/permissions">
                {access
                  ? `${access.apps} ${access.apps === 1 ? "app" : "apps"} and ${access.people} ${access.people === 1 ? "person" : "people"} have access`
                  : "See who has access"}
              </Link>
              {access ? (
                access.publicItems > 0 ? (
                  <p className="hm-warning">
                    Anyone with the link can see {access.publicItems}{" "}
                    {access.publicItems === 1 ? "item" : "items"}
                  </p>
                ) : null
              ) : (
                <p className="hm-muted">Checking who has access…</p>
              )}
            </div>
            <div className="hm-last-change">
              {latest?.modified ? (
                <p>
                  Last change {relativeTime(latest.modified, now)} · {itemTitle(latest)}
                </p>
              ) : (
                <p>No changes yet</p>
              )}
            </div>
          </div>
        )}
      </section>
    </header>
  );
}
