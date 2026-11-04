// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useState } from "react";
import styles from "@/shell/notifications/notifications.module.css";
import { NotificationsTray } from "@/shell/notifications/notifications-tray";
import { SuiteShell } from "@/shell/suite-shell";
import { ShellSyncSheet } from "@/shell/sync/shell-sync-sheet";
export default function Page() {
  const [open, setOpen] = useState(false);
  return (
    <SuiteShell app="home" pageTitle="Notifications">
      <div className={styles.page}>
        <NotificationsTray page onOpenSync={() => setOpen(true)} />
        <ShellSyncSheet open={open} onOpenChange={setOpen} />
      </div>
    </SuiteShell>
  );
}
