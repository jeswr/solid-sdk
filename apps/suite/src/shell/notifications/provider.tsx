// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import type { Digest } from "@jeswr/suite-sdk/digest";
import { type Capabilities, useCapabilities } from "@jeswr/suite-ui/sync";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { demoNotificationDate } from "../../lib/demo-pod/seed-notifications";
import type { AccessDecider, NotificationSource } from "../lib/notifications-model";
import { startNotificationUpdates } from "../lib/notifications-scheduler";
import type { Preferences } from "../lib/settings-preferences";
import { type AccountsContextValue, useAccounts } from "../session/accounts-provider";
import type { SuiteAccount } from "../session/types";
import { useOptionalPreferences } from "../settings/preferences";
import { createNotificationsController, type NotificationsController } from "./controller";
import { createDemoNotificationSource } from "./demo-source";
import { accountPreferences, showDesktopNotification } from "./desktop";
import { immediateDesktopNotification, notifyImmediately } from "./digest";
import { localNotificationSource } from "./local-store";
import { createPodNotificationSource } from "./pod-source";
import { createNotificationReadState } from "./read-state";
import { useDigest } from "./use-digest";

const NotificationsContext = createContext<NotificationsController | null>(null);
const DigestContext = createContext<Digest | null>(null);
const emptySources: readonly NotificationSource[] = [];

type AccountPodSource = {
  key: string;
  source: NotificationSource | null;
  agent?: NotificationSource | undefined;
};

/** Only this producer remounts on session changes; editors below the provider keep their state. */
function PodNotificationSource({
  account,
  ready,
  sessionKey,
  latest,
  onSource,
}: {
  account: SuiteAccount | null;
  ready: boolean;
  sessionKey: string;
  latest: RefObject<AccountsContextValue>;
  onSource: (source: AccountPodSource) => void;
}) {
  useEffect(() => {
    let disposed = false;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const usable = () =>
        !disposed &&
        account !== null &&
        latest.current.active === account &&
        latest.current.status === "ready" &&
        latest.current.isActiveAccount(account.id);
      if (!usable()) throw new Error("Sign in to read notifications");
      const response = await latest.current.fetch(input, init);
      if (!usable()) throw new Error("Sign in to read notifications");
      return response;
    };
    const pod =
      ready && account?.webId && account.kind !== "demo"
        ? createPodNotificationSource({ webId: account.webId, fetch })
        : undefined;
    onSource({
      key: sessionKey,
      source: pod ?? null,
      agent:
        pod && account
          ? {
              id: `agent:${account.id}`,
              async list(signal) {
                const { createAgentNotificationSource } = await import("./agent-source");
                signal.throwIfAborted();
                return createAgentNotificationSource(account, fetch).list(signal);
              },
            }
          : undefined,
    });
    return () => {
      disposed = true;
      pod?.dispose();
    };
  }, [account, ready, sessionKey, latest, onSource]);
  return null;
}

/** Standalone seam for fixtures and future SDK adapters; remount when the account changes. */
export function NotificationSessionProvider({
  accountId,
  sources,
  decider,
  liveUpdates = false,
  preferences,
  children,
}: {
  accountId: string;
  sources: readonly NotificationSource[];
  decider?: AccessDecider | undefined;
  liveUpdates?: boolean;
  preferences?: Preferences | undefined;
  children: ReactNode;
}) {
  const saved = useMemo(
    () => preferences ?? accountPreferences(accountId),
    [preferences, accountId],
  );
  const latestPreferences = useRef(saved);
  latestPreferences.current = saved;
  const controller = useMemo(
    () =>
      createNotificationsController(
        sources,
        decider,
        (item) => {
          if (notifyImmediately(item, latestPreferences.current, new Date()))
            void showDesktopNotification(immediateDesktopNotification(item)).catch(() => {
              /* Delivery failure never interrupts the tray. */
            });
        },
        createNotificationReadState(accountId),
      ),
    [sources, decider, accountId],
  );
  const digest = useDigest(accountId, controller, saved);
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
    <NotificationsContext.Provider value={controller}>
      <DigestContext.Provider value={digest}>{children}</DigestContext.Provider>
    </NotificationsContext.Provider>
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
  const preferences = useOptionalPreferences();
  const accounts = useAccounts();
  const latest = useRef(accounts);
  latest.current = accounts;
  const sessionKey = JSON.stringify([
    accounts.active?.id,
    accounts.active?.webId,
    accounts.active?.kind,
    accounts.status,
  ]);
  const [pod, setPod] = useState<AccountPodSource>();
  // Hide the retired source synchronously, before the new producer's effect runs.
  const agentSource = pod?.key === sessionKey ? pod.agent : undefined;
  const podSource = pod?.key === sessionKey ? pod.source : null;
  const [synthetic] = useState(() =>
    demo ? createDemoNotificationSource(demoNotificationDate(accountId), true) : undefined,
  );
  const configuration = useMemo(() => {
    return {
      sources: [
        ...sources,
        ...(accountId ? [localNotificationSource(accountId)] : []),
        ...(synthetic ? [synthetic] : []),
        ...(podSource ? [podSource] : []),
        ...(agentSource ? [agentSource] : []),
      ],
      decider: decider ?? synthetic,
    };
  }, [sources, decider, synthetic, accountId, podSource, agentSource]);
  return (
    <>
      <PodNotificationSource
        key={sessionKey}
        account={accounts.active}
        ready={accounts.status === "ready"}
        sessionKey={sessionKey}
        latest={latest}
        onSource={setPod}
      />
      <NotificationSessionProvider
        accountId={accountId}
        sources={configuration.sources}
        decider={configuration.decider}
        liveUpdates={capabilities.liveUpdates === true}
        preferences={preferences?.preferences}
      >
        {children}
      </NotificationSessionProvider>
    </>
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
    markManyRead: controller.markManyRead,
    dismiss: controller.dismiss,
    decide: controller.decide,
  };
}

export function useNotificationDigest() {
  return useContext(DigestContext);
}
