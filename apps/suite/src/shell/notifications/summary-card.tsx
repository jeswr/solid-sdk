// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button } from "@jeswr/suite-ui";
import { useId } from "react";
import styles from "./notifications.module.css";
import { useNotificationDigest, useNotifications } from "./provider";

export function SummaryCard() {
  const digest = useNotificationDigest();
  const { items, markRead, markManyRead } = useNotifications();
  const id = useId();
  if (!digest?.count) return null;
  const ids = new Set(
    digest.sections.flatMap((section) => section.items.flatMap((item) => item.notificationIds)),
  );
  const included = items.filter((n) => ids.has(n.id));
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
