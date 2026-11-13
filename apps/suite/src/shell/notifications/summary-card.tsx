// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { digestGroupKey } from "@jeswr/suite-sdk/digest";
import { Button } from "@jeswr/suite-ui";
import { useId } from "react";
import type { SuiteNotification } from "../lib/notifications-model";
import { digestNotification } from "./digest";
import type { StoredDigest } from "./digest-store";
import styles from "./notifications.module.css";
import { useNotificationDigest, useNotifications } from "./provider";

/**
 * Live records in the card's groups. Stored id lists are capped, so groups match by key,
 * limited to the digest's receipts so later arrivals in the same group stay unread.
 */
export function summaryItems(
  digest: StoredDigest,
  items: readonly SuiteNotification[],
): SuiteNotification[] {
  const groups = digest.sections.flatMap((section) => section.items);
  const keys = new Set(groups.flatMap((group) => (group.key ? [group.key] : [])));
  const ids = new Set(groups.flatMap((group) => (group.key ? [] : group.notificationIds)));
  const receipts = new Set(digest.digestedIds);
  return items.filter(
    (n) => ids.has(n.id) || (receipts.has(n.id) && keys.has(digestGroupKey(digestNotification(n)))),
  );
}

export function SummaryCard() {
  const digest = useNotificationDigest();
  const { items, markRead, markManyRead } = useNotifications();
  const id = useId();
  if (!digest?.count) return null;
  const included = summaryItems(digest, items);
  if (!included.length) return null;
  const byId = new Map(included.map((n) => [n.id, n]));
  return (
    <section className={styles.summary} aria-labelledby={id}>
      <h3 id={id}>Summary</h3>
      <p>{digest.headline}</p>
      {digest.sections.map((section) => (
        <div key={section.app}>
          <h4>{section.app === "agent" ? "Your agent" : section.app}</h4>
          <ul>
            {section.items.map((item) => {
              const target = item.notificationIds.find((key) => byId.has(key));
              return target ? (
                <li key={item.id}>
                  <a
                    href={`#notification-${encodeURIComponent(target)}`}
                    onClick={() => void markRead(target)}
                  >
                    {item.text}
                  </a>
                </li>
              ) : null;
            })}
          </ul>
        </div>
      ))}
      {digest.omitted > 0 && <p>{digest.omitted} more notifications in the tray</p>}
      <Button
        variant="outline"
        size="sm"
        disabled={!included.some((n) => !n.read)}
        onClick={() => void markManyRead(included.map((n) => n.id))}
      >
        Mark all as read
      </Button>
    </section>
  );
}
