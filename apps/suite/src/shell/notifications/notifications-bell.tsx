// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useT } from "@jeswr/suite-i18n/react";
import { CountBadge, IconButton, Popover, PopoverContent, PopoverTrigger } from "@jeswr/suite-ui";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./notifications.module.css";
import { NotificationsTray } from "./notifications-tray";
import { useNotifications } from "./provider";

/** Desktop button in the rail; the mobile TopBar slot renders a native page link. */
export function NotificationsBell({
  mobile = false,
  onOpenSync,
}: {
  mobile?: boolean;
  onOpenSync?: (() => void) | undefined;
}) {
  const t = useT();
  const { unread, loading } = useNotifications();
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const previous = useRef<number | null>(null);
  useEffect(() => {
    if (!loading) {
      if (previous.current !== null && unread > previous.current)
        setAnnouncement(t("notifications.new", { count: unread - previous.current }));
      else setAnnouncement("");
      previous.current = unread;
    }
  }, [unread, loading, t]);
  const label = t("notifications.unread", { count: unread });
  const content = (
    <>
      <Bell size={20} strokeWidth={1.75} aria-hidden="true" />
      {unread > 0 && (
        <span className={styles.badge}>
          <CountBadge count={unread} />
        </span>
      )}
    </>
  );
  if (mobile)
    return (
      <span className={styles.mobileBell}>
        <Link
          className="suite-shell-icon-button"
          href="/notifications"
          aria-label={label}
          title={label}
        >
          {content}
        </Link>
        <span role="status" aria-live="polite" className="suite-sr-only">
          {announcement}
        </span>
      </span>
    );
  return (
    <span className={styles.bell}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <IconButton variant="ghost" label={label}>
            {content}
          </IconButton>
        </PopoverTrigger>
        <PopoverContent
          className={styles.panel}
          side="right"
          align="end"
          aria-label={t("notifications.title")}
        >
          <NotificationsTray
            onOpenSync={() => {
              setOpen(false);
              onOpenSync?.();
            }}
          />
        </PopoverContent>
      </Popover>
      <span role="status" aria-live="polite" className="suite-sr-only">
        {announcement}
      </span>
    </span>
  );
}
