// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { SyncSheet } from "@jeswr/suite-ui/sync";
import { useState } from "react";
import styles from "@/shell/notifications/notifications.module.css";
import { NotificationsTray } from "@/shell/notifications/notifications-tray";
import { SuiteShell } from "@/shell/suite-shell";
import { useSyncSnapshot } from "@/shell/sync/online";
export default function Page() {
  const [open, setOpen] = useState(false);
  const snapshot = useSyncSnapshot();
  return (
    <SuiteShell app="home" pageTitle="Notifications">
      <div className={styles.page}>
        <NotificationsTray page onOpenSync={() => setOpen(true)} />
        <SyncSheet
          open={open}
          onOpenChange={setOpen}
          snapshot={snapshot}
          onRetryAll={() => {}}
          onRetry={() => {}}
          onResolve={() => {}}
        />
      </div>
    </SuiteShell>
  );
}
