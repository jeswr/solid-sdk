// AUTHORED-BY Claude Opus 4.8
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readInbox, type InboxNotification } from "@/lib/inbox";
import { activityLabel, notificationTitle, hostOf, formatPublished } from "@/lib/inbox-display";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ArrowUpRight, Bell, Inbox as InboxIcon, RefreshCw } from "lucide-react";

/**
 * The LDN inbox view (Linked Data Notifications). Reads the signed-in user's
 * `ldp:inbox` (own-pod-validated), lists + parses each notification, and renders
 * them newest-first. READ-only: posting to inboxes is out of scope.
 *
 * `ownStorageUrls` is the SSRF allow-list (the user's pim:storage roots). A
 * foreign inbox URL is rejected upstream (inbox.ts) → the empty state shows, the
 * app never fetches a foreign inbox with the user's token. `actor` WebIDs are
 * shown as their host only — we do NOT auto-dereference foreign actor profiles.
 */
export function InboxView({
  webId,
  ownStorageUrls,
}: {
  webId: string;
  ownStorageUrls: readonly string[];
}) {
  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [inboxUrl, setInboxUrl] = useState<string | undefined>(undefined);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Monotonic load sequence: a slow earlier load must never clobber a newer one.
  const loadSeq = useRef(0);
  // Stable key so the load effect doesn't re-run on a fresh array of same values.
  const ownStorageKey = ownStorageUrls.join("\n");

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const ownStorage = ownStorageKey ? ownStorageKey.split("\n") : [];
      const result = await readInbox(webId, ownStorage);
      if (seq !== loadSeq.current) return;
      setNotifications(result.notifications);
      setInboxUrl(result.inboxUrl);
      setTruncated(result.truncated);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(e instanceof Error ? e.message : "Could not read your inbox.");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [webId, ownStorageKey]);

  useEffect(() => {
    // Mount/refresh load. `load` flips `setLoading(true)` synchronously before its
    // first await — the same pattern the issue-list effects use (use-issues.ts).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <section aria-label="Notifications inbox" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Bell className="size-5 text-primary" aria-hidden /> Inbox
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Notifications delivered to your pod (assignments, mentions, announcements).
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden /> Refresh
        </Button>
      </div>

      {loading ? (
        <ul className="space-y-3" aria-busy="true" aria-label="Loading notifications">
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <Card>
                <CardContent className="flex flex-col gap-2 py-4">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : error ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center"
        >
          <AlertCircle className="size-8 text-destructive" aria-hidden />
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed p-12 text-center">
          <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <InboxIcon className="size-6" />
          </span>
          <div>
            <p className="font-medium">No notifications</p>
            <p className="text-sm text-muted-foreground">
              {inboxUrl
                ? "When someone assigns or mentions you, it shows up here."
                : "Your profile doesn't advertise an inbox on this pod yet."}
            </p>
          </div>
        </div>
      ) : (
        <>
          {truncated && (
            <p
              role="status"
              className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground"
            >
              Your inbox is large — showing a limited set of notifications. Some,
              possibly including recent ones, may not be listed here.
            </p>
          )}
          <ul className="space-y-3">
            {notifications.map((n) => (
              <li key={n.url}>
                <NotificationCard notification={n} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function NotificationCard({ notification: n }: { notification: InboxNotification }) {
  const when = formatPublished(n.published);
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="capitalize">
            {activityLabel(n.types)}
          </Badge>
          {when && <span className="text-xs text-muted-foreground tabular-nums">{when}</span>}
        </div>
        <p className="text-sm font-medium text-balance">{notificationTitle(n)}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {/* The actor WebID is shown as host only — never auto-dereferenced. */}
          {n.actor && (
            <span className="truncate" title={n.actor}>
              From {hostOf(n.actor)}
            </span>
          )}
          {n.object && (
            <a
              href={n.object}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
              title={n.object}
            >
              Open {hostOf(n.object)}
              <ArrowUpRight className="size-3" aria-hidden />
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
