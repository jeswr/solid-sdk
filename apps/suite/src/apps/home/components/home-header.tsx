// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
"use client";
import { useT } from "@jeswr/suite-i18n/react";
import { Button, LoadingSkeleton, PodMeter } from "@jeswr/suite-ui";
import Link from "next/link";
import { AppHeading } from "@/shell/app-frame";
import type { DomainItem } from "../lib/model/discovery";
import { sortItems } from "../lib/model/discovery";
import {
  asOfTime,
  firstName,
  greetingPeriod,
  itemTitle,
  relativeTime,
} from "../state/presentation";
import type { HomeAccess } from "../state/use-home-access";

export interface HomeHeaderProps {
  displayName: string;
  items: readonly DomainItem[];
  used: number | undefined;
  status: "loading" | "ready" | "error" | "offline";
  now: number;
  quota?: number;
  access?: HomeAccess | undefined;
  /** The browser is offline: what's shown is the copy read at `asOf`. */
  offline?: boolean;
  /** When the shown copy was read from the pod (ms). */
  asOf?: number | undefined;
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
  offline = false,
  asOf,
  onRetry,
}: HomeHeaderProps) {
  const t = useT();
  const period = greetingPeriod(new Date(now));
  const name = firstName(displayName);
  const latest = sortItems(items.filter((item) => item.modified))[0];
  return (
    <header className="hm-header">
      <AppHeading>{name ? t(`home.${period}`, { name }) : t(`home.${period}NoName`)}</AppHeading>
      <p className="hm-muted">{t("home.intro")}</p>
      {offline && asOf !== undefined ? (
        <p className="hm-muted">You're offline. This is your pod as of {asOfTime(asOf)}.</p>
      ) : null}
      <section className="hm-pod" aria-label={t("home.pod")}>
        <h2>{t("home.pod")}</h2>
        {status === "loading" ? (
          <LoadingSkeleton preset="detail" count={3} label="Loading your pod" />
        ) : (
          <div className="hm-pod-columns">
            <div>
              {status === "error" || status === "offline" ? (
                <>
                  <p>
                    {status === "offline"
                      ? "Storage is unavailable offline"
                      : "Couldn't read your storage"}
                  </p>
                  <Button variant="outline" onClick={onRetry}>
                    Retry
                  </Button>
                </>
              ) : (
                <>
                  {used === undefined ? (
                    <p>Storage usage unavailable</p>
                  ) : (
                    <PodMeter used={used} {...(quota === undefined ? {} : { quota })} />
                  )}
                  {used !== undefined && quota === undefined ? (
                    <p className="hm-muted">Your storage doesn't report a limit</p>
                  ) : null}
                </>
              )}
            </div>
            <div className="hm-access">
              <Link href="/permissions">
                {access && access !== "failed"
                  ? access.apps + access.people + access.publicItems === 0
                    ? "Only you have access"
                    : `${access.apps} ${access.apps === 1 ? "app" : "apps"} and ${access.people} ${access.people === 1 ? "person" : "people"} have access`
                  : "See who has access"}
              </Link>
              {access && access !== "failed" ? (
                access.publicItems > 0 ? (
                  <p className="hm-warning">
                    Anyone with the link can see {access.publicItems}{" "}
                    {access.publicItems === 1 ? "item" : "items"}
                  </p>
                ) : null
              ) : (
                <p className="hm-muted">
                  {access === "failed"
                    ? "Couldn't check who has access."
                    : "Checking who has access…"}
                </p>
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
