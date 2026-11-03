// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * The shell's offline layer (02-suite-shell §10): connection state for the OfflinePill, the
 * active account's outbox, the once-per-account offline hint and the recent-items index.
 *
 * Connection state lives in one monitor per page (it survives the shell remounting between
 * routes). Components outside `OfflineProvider` (dev fixtures, tests) fall back to
 * `navigator.onLine`.
 */
import { toast } from "@jeswr/suite-ui";
import { usePathname } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type ConnectionState,
  type Connectivity,
  createConnectivity,
  probeReachable,
  probeTarget,
} from "../lib/connectivity";
import {
  type ConflictChoice,
  createLocalOutbox,
  EMPTY_OUTBOX,
  type Outbox,
  type OutboxSnapshot,
  outboxKey,
} from "../lib/outbox";
import {
  clearRecentItems,
  isRecordablePath,
  parseRecentItems,
  recentItemsKey,
  recordRecentItem,
} from "../lib/recent-items";
import { useAccounts } from "../session/accounts-provider";
import type { SuiteAccount } from "../session/types";
import { useAllPreferences } from "../settings/preferences";
import { rememberPage } from "./service-worker";

export const OFFLINE_HINT =
  "You're offline. Changes are saved on this device and sync when you reconnect.";

const timers = {
  setTimeout: (callback: () => void, ms: number) => window.setTimeout(callback, ms),
  clearTimeout: (handle: unknown) => window.clearTimeout(handle as number),
  now: () => Date.now(),
};
let monitor: Connectivity | null = null;
let probeAccount: Pick<SuiteAccount, "kind" | "storageUrl"> | null = null;

function connectivity(): Connectivity {
  if (monitor) return monitor;
  const created = createConnectivity({
    online: navigator.onLine,
    probe: () =>
      probeReachable(fetch.bind(window), probeTarget(probeAccount, location.origin), timers),
    timers,
  });
  addEventListener("online", () => created.online());
  addEventListener("offline", () => created.offline());
  monitor = created;
  return created;
}
const subscribeShell = (onChange: () => void) => connectivity().subscribe(onChange);
const shellState = () => connectivity().getState();
const browserState = (): ConnectionState => (navigator.onLine ? "online" : "offline");
function subscribeBrowser(onChange: () => void) {
  addEventListener("online", onChange);
  addEventListener("offline", onChange);
  return () => {
    removeEventListener("online", onChange);
    removeEventListener("offline", onChange);
  };
}

/** The seam for the SDK outbox: maps an account to its outbox. */
export type OutboxFactory = (accountId: string) => Outbox;
const outboxes = new Map<string, Outbox>();
export const localOutboxFactory: OutboxFactory = (accountId) => {
  const existing = outboxes.get(accountId);
  if (existing) return existing;
  let storage: Storage | null = null;
  try {
    storage = localStorage;
  } catch {
    /* Memory only. */
  }
  const created = createLocalOutbox({
    storage,
    key: outboxKey(accountId),
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
  });
  outboxes.set(accountId, created);
  return created;
};
export const OutboxFactoryContext = createContext<OutboxFactory>(localOutboxFactory);

interface OfflineContextValue {
  outbox: Outbox | null;
}
const OfflineContext = createContext<OfflineContextValue | null>(null);

const noSubscribe = () => () => {};
const emptySnapshot = () => EMPTY_OUTBOX;

/** "online", "offline" or "reconnecting" — the browser's view outside the shell. */
export function useConnectionState(): ConnectionState {
  const inShell = useContext(OfflineContext) !== null;
  return useSyncExternalStore(
    inShell ? subscribeShell : subscribeBrowser,
    inShell ? shellState : browserState,
    () => "online",
  );
}

export interface OutboxBinding {
  snapshot: OutboxSnapshot;
  enqueue(change: { label: string; where: string }): string | null;
  retry(id: string): Promise<void>;
  retryAll(): Promise<void>;
  resolve(conflictId: string, choice: ConflictChoice): Promise<void>;
}
/** The active account's outbox; empty and inert outside the shell or while signed out. */
export function useOutbox(): OutboxBinding {
  const outbox = useContext(OfflineContext)?.outbox ?? null;
  const [subscribe, getSnapshot] = useMemo(
    () =>
      outbox
        ? [(onChange: () => void) => outbox.subscribe(onChange), () => outbox.getSnapshot()]
        : [noSubscribe, emptySnapshot],
    [outbox],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, emptySnapshot);
  return {
    snapshot,
    enqueue: (change) => outbox?.enqueue(change) ?? null,
    retry: async (id) => outbox?.retry(id),
    retryAll: async () => outbox?.retryAll(),
    resolve: async (id, choice) => outbox?.resolve(id, choice),
  };
}

function OfflineEffects({ pageTitle, outbox }: { pageTitle?: string; outbox: Outbox | null }) {
  const { active, status } = useAccounts();
  const { preferences, update, ready } = useAllPreferences();
  const state = useConnectionState();
  const pathname = usePathname();
  const hinted = useRef("");
  // The page each account was last seen on, and a page opened under another account.
  const lastSeen = useRef({ accountId: "", pathname: "" });
  const inherited = useRef<string | null>(null);
  const accountId = active?.id ?? "";
  useEffect(() => {
    probeAccount = active ? { kind: active.kind, storageUrl: active.storageUrl } : null;
  }, [active]);
  // Send what is waiting once the storage answers again.
  useEffect(() => {
    if (state === "online") void outbox?.reconnected();
  }, [state, outbox]);
  useEffect(() => {
    if (!outbox || !accountId) return;
    const storage = (event: StorageEvent) => {
      if (event.key === outboxKey(accountId) || event.key === null) outbox.reload();
    };
    addEventListener("storage", storage);
    return () => removeEventListener("storage", storage);
  }, [outbox, accountId]);
  // The first time each account goes offline, explain what still works.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `update` is a fresh closure each render.
  useEffect(() => {
    if (state !== "offline" || !ready || !accountId || preferences.offlineHintSeen) return;
    if (hinted.current === accountId) return;
    hinted.current = accountId;
    toast(OFFLINE_HINT, { duration: 8000 });
    update("offlineHintSeen", true);
  }, [state, ready, accountId, preferences.offlineHintSeen]);
  // Titles and paths only: the index behind /offline.
  useEffect(() => {
    if (status !== "ready" || !accountId || !ready) return;
    // After an account switch or sign-out the open page belongs to the previous account:
    // never copy it (or its title, which can name a document) into the new account's list.
    const previous = lastSeen.current;
    if (previous.accountId && previous.accountId !== accountId && previous.pathname === pathname)
      inherited.current = pathname;
    else if (inherited.current !== pathname) inherited.current = null;
    lastSeen.current = { accountId, pathname };
    if (!preferences.offline) {
      try {
        clearRecentItems(localStorage, accountId);
      } catch {
        /* The index is a convenience; storage may be unavailable. */
      }
      return;
    }
    if (inherited.current === pathname || !isRecordablePath(pathname)) return;
    // Next may apply a route's title after its pathname changes, including streamed metadata.
    let recordedTitle: string | undefined;
    const record = () => {
      const title = pageTitle ?? document.title;
      if (title === recordedTitle) return;
      recordedTitle = title;
      try {
        const key = recentItemsKey(accountId);
        const next = recordRecentItem(
          parseRecentItems(localStorage.getItem(key)),
          { title, href: pathname },
          new Date(),
        );
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* The index is a convenience; storage may be unavailable. */
      }
    };
    const timer = window.setTimeout(record, 0);
    const observer = new MutationObserver(record);
    if (!pageTitle)
      observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    rememberPage(pathname);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [status, accountId, ready, preferences.offline, pageTitle, pathname]);
  return null;
}

function ConnectionAnnouncement() {
  const state = useConnectionState();
  const initial = useRef(state);
  const changed = useRef(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (state !== initial.current) changed.current = true;
    if (!changed.current && state === "online") return;
    const timer = window.setTimeout(() => {
      setMessage(
        state === "offline"
          ? "You're offline"
          : state === "reconnecting"
            ? "Reconnecting…"
            : "Back online",
      );
    }, 500);
    return () => window.clearTimeout(timer);
  }, [state]);
  return (
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </span>
  );
}

export function OfflineProvider({
  pageTitle,
  children,
}: {
  /** Recorded with the path in the recent-items index. */
  pageTitle?: string;
  children: ReactNode;
}) {
  const { active } = useAccounts();
  const factory = useContext(OutboxFactoryContext);
  const accountId = active?.id;
  const outbox = useMemo(() => (accountId ? factory(accountId) : null), [factory, accountId]);
  const value = useMemo(() => ({ outbox }), [outbox]);
  return (
    <OfflineContext.Provider value={value}>
      <OfflineEffects {...(pageTitle !== undefined ? { pageTitle } : {})} outbox={outbox} />
      <ConnectionAnnouncement />
      {children}
    </OfflineContext.Provider>
  );
}
