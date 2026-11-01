// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button } from "@jeswr/suite-ui";
import { CapabilityProvider, SyncSheet } from "@jeswr/suite-ui/sync";
import { useMemo, useState } from "react";
import type { NotificationSource } from "@/shell/lib/notifications-model";
import { createDemoNotificationSource } from "@/shell/notifications/demo-source";
import styles from "@/shell/notifications/notifications.module.css";
import { NotificationsBell } from "@/shell/notifications/notifications-bell";
import { NotificationsTray } from "@/shell/notifications/notifications-tray";
import { NotificationSessionProvider, useNotifications } from "@/shell/notifications/provider";

type State = "populated" | "loading" | "error" | "empty" | "decision-error";
function Content({ fullPage, onOpenSync }: { fullPage: boolean; onOpenSync: () => void }) {
  const { refresh } = useNotifications();
  return (
    <>
      <div className={styles.fixtureControls}>
        <NotificationsBell onOpenSync={onOpenSync} />
        <NotificationsBell mobile />
        <Button variant="outline" onClick={() => void refresh()}>
          Refresh notifications
        </Button>
      </div>
      {fullPage && <NotificationsTray onOpenSync={onOpenSync} />}
    </>
  );
}
export default function Page() {
  const [state, setState] = useState<State>("populated");
  const [expiry, setExpiry] = useState(true);
  const [live, setLive] = useState(true);
  const [fullPage, setFullPage] = useState(false);
  const [sync, setSync] = useState(false);
  const [retry, setRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the fixture on demand
  const source = useMemo(() => {
    const demo = createDemoNotificationSource();
    let decisionFailed = false;
    return {
      ...demo,
      async list(signal) {
        if (state === "loading")
          return new Promise<never>((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
          );
        if (state === "error") {
          throw new Error("Fixture failure");
        }
        if (state === "empty") return [];
        const items = await demo.list(signal);
        return [
          ...items,
          {
            id: "fixture-conflict",
            kind: "sync-conflict" as const,
            title: "Project plan changed somewhere else",
            createdAt: new Date(),
            read: true,
          },
        ];
      },
      async decide(request, decision) {
        if (state === "decision-error" && !decisionFailed) {
          decisionFailed = true;
          throw new Error("Fixture decision failure");
        }
        await demo.decide(request, decision);
      },
    } satisfies NotificationSource & Pick<typeof demo, "decide">;
  }, [state, retry]);
  const sources = useMemo(() => [source], [source]);
  return (
    <main id="main-content" tabIndex={-1} className={styles.fixture}>
      <h1>Notifications tray</h1>
      <a href="/dev/components">All component fixtures</a>
      <div className={styles.fixtureControls}>
        <label>
          Fixture state{" "}
          <select value={state} onChange={(event) => setState(event.target.value as State)}>
            {["populated", "loading", "error", "empty", "decision-error"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={expiry}
            onChange={(event) => setExpiry(event.target.checked)}
          />
          Expiring access
        </label>
        <label>
          <input
            type="checkbox"
            checked={live}
            onChange={(event) => setLive(event.target.checked)}
          />
          Live updates
        </label>
        <label>
          <input
            type="checkbox"
            checked={fullPage}
            onChange={(event) => setFullPage(event.target.checked)}
          />
          Show list
        </label>
        <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>
          Reset fixture
        </Button>
      </div>
      <CapabilityProvider
        capabilities={{ grantExpiry: expiry, liveUpdates: live, accessRequests: true }}
      >
        <NotificationSessionProvider
          key={`${state}:${retry}`}
          accountId="fixture"
          sources={sources}
          decider={source}
          liveUpdates={live}
        >
          <Content fullPage={fullPage} onOpenSync={() => setSync(true)} />
        </NotificationSessionProvider>
      </CapabilityProvider>
      <SyncSheet
        open={sync}
        onOpenChange={setSync}
        snapshot={{
          online: true,
          reconnecting: false,
          pending: [],
          conflicts: [
            {
              id: "conflict",
              name: "Project plan",
              where: "Documents",
              summary: "Changed somewhere else",
              changedAt: new Date(),
            },
          ],
        }}
        onRetryAll={() => {}}
        onRetry={() => {}}
        onResolve={() => {}}
      />
    </main>
  );
}
