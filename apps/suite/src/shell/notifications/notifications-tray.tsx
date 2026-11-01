// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, EmptyState, LoadingSkeleton } from "@jeswr/suite-ui";
import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { groupNotifications } from "../lib/notifications-model";
import { NotificationItem } from "./notification-item";
import styles from "./notifications.module.css";
import { useNotifications } from "./provider";

export function NotificationsTray({
  onOpenSync,
  page = false,
}: {
  onOpenSync?: (() => void) | undefined;
  page?: boolean;
}) {
  const { items, loading, error, refresh, markAllRead, markRead, dismiss, decide } =
    useNotifications();
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // Regroup at local midnight, including while the panel stays open overnight.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = setTimeout(() => setNow(new Date()), next.getTime() - Date.now());
    return () => clearTimeout(timer);
  }, [now]);
  const dismissAndFocus = (id: string) => {
    const controls = [
      ...(list.current?.querySelectorAll<HTMLButtonElement>('button[aria-label^="Dismiss "]') ??
        []),
    ];
    const index = controls.indexOf(document.activeElement as HTMLButtonElement);
    const next = controls[index + 1] ?? controls[index - 1];
    dismiss(id);
    if (index >= 0) {
      if (next) next.focus();
      else list.current?.focus();
    }
  };
  return (
    <div className={styles.tray}>
      <header className={styles.header}>
        <h2>Notifications</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void markAllRead()}
          disabled={!items.some((item) => !item.read)}
        >
          Mark all read
        </Button>
      </header>
      <div className={styles.list} ref={list} tabIndex={-1} aria-busy={loading}>
        {loading && !items.length ? (
          <LoadingSkeleton preset="list" label="Loading notifications" count={3} />
        ) : null}
        {error && (
          <div role="alert" className={styles.error}>
            <p>{error}</p>
            <Button variant="outline" onClick={() => void refresh()}>
              Retry
            </Button>
          </div>
        )}
        {!loading && !error && !items.length && (
          <EmptyState
            title="You're all caught up"
            body="New notifications will appear here."
            icon={<Bell size={24} aria-hidden="true" />}
          />
        )}
        {groupNotifications(items, now).map((group) => (
          <section key={group.label} aria-label={group.label}>
            {page ? (
              <h2 className={styles.group}>{group.label}</h2>
            ) : (
              <h3 className={styles.group}>{group.label}</h3>
            )}
            <ul>
              {group.items.map((item) => (
                <NotificationItem
                  key={item.id}
                  item={item}
                  onMarkRead={markRead}
                  onDismiss={dismissAndFocus}
                  onDecide={decide}
                  onOpenSync={onOpenSync}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
