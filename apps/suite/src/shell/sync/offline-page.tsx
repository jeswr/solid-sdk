// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * `/offline` (02-suite-shell §10): what the service worker shows for a page that is not saved
 * on this device. It lists the active account's recent items from the local index. The account
 * is read from this browser's account list, so no session restore (and no network) is needed.
 */
import { Button, EmptyState, LoadingSkeleton } from "@jeswr/suite-ui";
import { useEffect, useState } from "react";
import { ACCOUNTS_KEY, parseAccounts } from "../lib/accounts-store";
import { parseRecentItems, type RecentItem, recentItemsKey } from "../lib/recent-items";
import { useConnectionState } from "./offline-provider";

function readRecentItems(): RecentItem[] {
  try {
    const { activeId } = parseAccounts(localStorage.getItem(ACCOUNTS_KEY));
    return activeId ? parseRecentItems(localStorage.getItem(recentItemsKey(activeId))) : [];
  } catch {
    return [];
  }
}

export function OfflinePage() {
  const [items, setItems] = useState<RecentItem[] | null>(null);
  const online = useConnectionState() === "online";
  useEffect(() => setItems(readRecentItems()), []);
  const viewed = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  return (
    <main id="main-content" className="shell-public">
      <div className="shell-public-card">
        <h1>You're offline — open something you've viewed before</h1>
        {items === null ? (
          <LoadingSkeleton preset="list" label="Loading recent items" />
        ) : items.length ? (
          <section aria-labelledby="offline-recent">
            <h2 id="offline-recent">Recent items</h2>
            <ul className="shell-offline-recent">
              {items.map((item) => (
                <li key={item.href}>
                  {/* A full navigation, so the service worker can answer from its saved copy. */}
                  <a href={item.href}>{item.title}</a>
                  <time dateTime={item.viewedAt}>
                    Viewed {viewed.format(new Date(item.viewedAt))}
                  </time>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <EmptyState
            variant="not-available-offline"
            title="Nothing saved on this device yet"
            body="Pages you open while connected appear here."
          />
        )}
        <p role="status">{online ? "You're back online." : ""}</p>
        <div className="shell-public-actions">
          <Button onClick={() => location.reload()}>Try again</Button>
        </div>
      </div>
    </main>
  );
}
