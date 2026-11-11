// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  createLegacyStore,
  evaluatePlan,
  type LegacyPlan,
  type LegacySnapshot,
  recordActivity,
} from "@jeswr/pod-legacy";
import { createPodClient, type StorageClient } from "@jeswr/storage-client";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { addLocalNotification } from "../notifications/local-store";
import { useAccounts } from "../session/accounts-provider";
import type { SuiteAccount } from "../session/types";
import { legacyWarning } from "./presentation";

interface LegacySession {
  account: SuiteAccount;
  storage: StorageClient;
  store: ReturnType<typeof createLegacyStore>;
  fetch: typeof fetch;
  snapshot: LegacySnapshot | null;
  save(plan: LegacyPlan): Promise<void>;
}
const Context = createContext<{ session: LegacySession | null; error: string; loading: boolean }>({
  session: null,
  error: "",
  loading: false,
});

/** Account-scoped, abortable activity recording. Merely opening the suite never creates a plan. */
export function LegacyProvider({ children }: { children: ReactNode }) {
  const accounts = useAccounts();
  const latest = useRef(accounts);
  latest.current = accounts;
  const account = accounts.active;
  const ready = accounts.status === "ready";
  const [session, setSession] = useState<LegacySession | null>(null);
  const [failure, setFailure] = useState<{ account: SuiteAccount; message: string } | null>(null);
  useEffect(() => {
    if (!ready || !account) return;
    const controller = new AbortController();
    const current = () =>
      !controller.signal.aborted &&
      latest.current.active === account &&
      latest.current.isActiveAccount(account.id);
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (!current()) throw new Error("The account changed. Sign in again.");
      const result = await latest.current.fetch(input, { ...init, signal: controller.signal });
      if (!current()) throw new Error("The account changed. Sign in again.");
      return result;
    };
    void (async () => {
      const { storage } = await createPodClient({
        fetch,
        storage: account.storageUrl,
        signal: controller.signal,
      });
      const store = createLegacyStore({ storage, fetch, owner: account.webId });
      let snapshot = await store.load();
      if (!current()) return;
      if (snapshot) {
        const now = new Date();
        const message = legacyWarning(snapshot.plan, now);
        if (message && snapshot.plan.notifyMeBy.includes("tray")) {
          await addLocalNotification(account.id, {
            id: `legacy:${snapshot.plan.lastActivity.toISOString()}:${evaluatePlan(snapshot.plan, now).level ?? "due"}`,
            kind: "system",
            title: "Your legacy plan needs attention",
            body: message,
            href: "/settings/legacy",
            createdAt: now,
            read: false,
          });
        }
        const updated = recordActivity(snapshot.plan, now);
        if (updated !== snapshot.plan) snapshot = await store.save(updated, snapshot.etag);
      }
      if (!current()) return;
      const opened: LegacySession = {
        account,
        storage,
        store,
        snapshot,
        fetch,
        async save(plan) {
          if (!current()) throw new Error("The account changed. Reload before saving.");
          const saved = await store.save(plan, opened.snapshot?.etag ?? null);
          if (!current()) return;
          opened.snapshot = saved;
          setSession({ ...opened });
        },
      };
      setSession(opened);
    })().catch((error: unknown) => {
      if (current())
        setFailure({
          account,
          message:
            error instanceof Error
              ? error.message
              : "Could not read your legacy plan. Try reloading.",
        });
    });
    return () => controller.abort();
  }, [account, ready]);
  const visible = ready && session?.account === account ? session : null;
  const error = ready && failure?.account === account ? failure.message : "";
  useEffect(() => {
    if (!visible?.snapshot) return;
    const session = visible;
    const plan = visible.snapshot.plan;
    const issued = new Set<string>();
    const check = () => {
      const now = new Date();
      const message = legacyWarning(plan, now);
      const level = String(evaluatePlan(plan, now).level ?? "due");
      if (
        !message ||
        !plan.notifyMeBy.includes("tray") ||
        issued.has(level) ||
        latest.current.active !== session.account ||
        !latest.current.isActiveAccount(session.account.id)
      )
        return;
      issued.add(level);
      void addLocalNotification(session.account.id, {
        id: `legacy:${plan.lastActivity.toISOString()}:${level}`,
        kind: "system",
        title: "Your legacy plan needs attention",
        body: message,
        href: "/settings/legacy",
        createdAt: now,
        read: false,
      }).catch(() => {
        issued.delete(level);
      });
    };
    // Initial sign-in warnings are recorded above before activity resets the schedule.
    // This timer catches a later warning boundary while the suite stays open.
    const timer = setInterval(check, 60000);
    return () => clearInterval(timer);
  }, [visible]);

  return (
    <Context.Provider value={{ session: visible, error, loading: ready && !visible && !error }}>
      {children}
    </Context.Provider>
  );
}
export function useLegacy() {
  return useContext(Context);
}
