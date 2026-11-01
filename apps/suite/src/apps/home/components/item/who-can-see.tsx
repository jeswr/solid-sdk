// AUTHORED-BY Codex GPT-6
"use client";
import { Button, LoadingSkeleton } from "@jeswr/suite-ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { loadPermissions, type PermissionsSnapshot } from "../../lib/permissions";
import type { HomeSession } from "../../state/use-domain-items";
import { accessSummary } from "./data";
import { openShare } from "./open-share";

export function WhoCanSee({
  url,
  session,
  online,
}: {
  url: string;
  session: HomeSession;
  online: boolean;
}) {
  const [snapshot, setSnapshot] = useState<PermissionsSnapshot>();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit retry reloads the resource
  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    setFailed(false);
    loadPermissions({
      fetch: session.fetch,
      storage: session.storageUrl,
      webId: session.webId,
      signal: controller.signal,
    }).then(
      (result) => {
        if (!controller.signal.aborted) setSnapshot(result);
      },
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );
    return () => controller.abort();
  }, [session, online, retry]);
  const summary = snapshot && accessSummary(snapshot.rows, url, session.webId);
  const incomplete = snapshot && (snapshot.failures.length > 0 || snapshot.truncated);
  return (
    <section className="hm-item-access" id="access" aria-labelledby="hm-access-heading">
      <h2 id="hm-access-heading">Who can see this</h2>
      {summary ? (
        <>
          <p>
            {incomplete && summary.text === "Only you"
              ? "Access summary unavailable"
              : summary.text}
          </p>
          {incomplete ? (
            <p className="hm-muted">Some access settings couldn't be checked.</p>
          ) : null}
          {summary.people.length ? (
            <ul className="hm-item-people" aria-label="People with access">
              {summary.people.map((person) => (
                <li key={person.id}>
                  <span className="hm-item-initials" aria-hidden="true">
                    {(person.name ?? "Person")
                      .split(/\s+/)
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <span>{person.name && !/http/i.test(person.name) ? person.name : "Person"}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {summary.apps.length ? (
            <p className="hm-muted">
              {summary.apps.length} {summary.apps.length === 1 ? "app also has" : "apps also have"}{" "}
              access
            </p>
          ) : null}
        </>
      ) : failed || !online ? (
        <p>{online ? "Couldn't check who has access." : "Reconnect to check who has access."}</p>
      ) : (
        <LoadingSkeleton preset="detail" count={1} label="Checking who has access" />
      )}
      {failed || incomplete ? (
        <Button variant="outline" onClick={() => setRetry((value) => value + 1)} disabled={!online}>
          Retry
        </Button>
      ) : null}
      <Button variant="outline" asChild>
        <Link href={openShare(url)}>Manage</Link>
      </Button>
    </section>
  );
}
