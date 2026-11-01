// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { type Capabilities, useCapabilities } from "@jeswr/suite-ui/sync";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { shouldNotifyDesktop } from "../lib/notifications-delivery";
import type { AccessDecider, NotificationSource } from "../lib/notifications-model";
import { startNotificationUpdates } from "../lib/notifications-scheduler";
import { useAccounts } from "../session/accounts-provider";
import { createNotificationsController, type NotificationsController } from "./controller";
import { createDemoNotificationSource } from "./demo-source";
import { accountPreferences, showDesktopNotification } from "./desktop";
import { localNotificationSource } from "./local-store";

const NotificationsContext = createContext<NotificationsController | null>(null);
const emptySources: readonly NotificationSource[] = [];

/** Standalone seam for fixtures and future SDK adapters; remount when the account changes. */
export function NotificationSessionProvider({
  accountId,
  sources,
  decider,
  liveUpdates = false,
  children,
}: {
  accountId: string;
  sources: readonly NotificationSource[];
  decider?: AccessDecider | undefined;
  liveUpdates?: boolean;
  children: ReactNode;
}) {
  const controller = useMemo(
    () =>
      createNotificationsController(sources, decider, (item) => {
        if (shouldNotifyDesktop(item.kind, accountPreferences(accountId), new Date()))
          void showDesktopNotification(item).catch(() => {
            /* Delivery failure never interrupts the tray. */
          });
      }),
    [sources, decider, accountId],
  );
  useEffect(() => {
    const stop = startNotificationUpdates(sources, liveUpdates, document, () => {
      void controller.refresh();
    });
    return () => {
      stop();
      controller.stop();
    };
  }, [controller, liveUpdates, sources]);
  return (
    <NotificationsContext.Provider value={controller}>{children}</NotificationsContext.Provider>
  );
}
function AccountNotifications({
  accountId,
  demo,
  sources,
  decider,
  capabilities,
  children,
}: {
  accountId: string;
  demo: boolean;
  sources: readonly NotificationSource[];
  decider?: AccessDecider | undefined;
  capabilities: Capabilities;
  children: ReactNode;
}) {
  const [synthetic] = useState(() => (demo ? createDemoNotificationSource() : undefined));
  const configuration = useMemo(() => {
    return {
      sources: [
        ...sources,
        ...(accountId ? [localNotificationSource(accountId)] : []),
        ...(synthetic ? [synthetic] : []),
      ],
      decider: decider ?? synthetic,
    };
  }, [sources, decider, synthetic, accountId]);
  return (
    <NotificationSessionProvider
      accountId={accountId}
      sources={configuration.sources}
      decider={configuration.decider}
      liveUpdates={capabilities.liveUpdates === true}
    >
      {children}
    </NotificationSessionProvider>
  );
}
export function NotificationsProvider({
  children,
  sources = emptySources,
  decider,
}: {
  children: ReactNode;
  sources?: readonly NotificationSource[];
  decider?: AccessDecider;
}) {
  const { active } = useAccounts();
  const caps = useCapabilities();
  return (
    <AccountNotifications
      key={active?.id ?? "signed-out"}
      accountId={active?.id ?? ""}
      demo={active?.kind === "demo"}
      sources={sources}
      decider={decider}
      capabilities={caps}
    >
      {children}
    </AccountNotifications>
  );
}
export function useNotifications() {
  const controller = useContext(NotificationsContext);
  if (!controller) throw new Error("useNotifications requires NotificationsProvider");
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return {
    ...snapshot,
    refresh: controller.refresh,
    markAllRead: controller.markAllRead,
    markRead: controller.markRead,
    dismiss: controller.dismiss,
    decide: controller.decide,
  };
}
