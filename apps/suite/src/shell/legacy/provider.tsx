// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  boundedNow,
  createLegacyStore,
  evaluatePlan,
  type LegacyPlan,
  type LegacySnapshot,
  recordActivity,
} from "@jeswr/pod-legacy";
import { createPodClient, type StorageClient, StorageError } from "@jeswr/storage-client";
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
  now(): Date;
  save(plan: LegacyPlan): Promise<void>;
  delete(): Promise<void>;
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
    let clock: { time: number; observed: number } | undefined;
    const planUrl = new URL("settings/legacy-plan.ttl", account.storageUrl).href;
    const now = () =>
      boundedNow(
        new Date(),
        new Date(clock ? clock.time + Math.max(0, performance.now() - clock.observed) : NaN),
      );
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (!current()) throw new Error("The account changed. Sign in again.");
      const result = await latest.current.fetch(input, { ...init, signal: controller.signal });
      if (!current()) throw new Error("The account changed. Sign in again.");
      const target = input instanceof Request ? input.url : String(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (target === planUrl && method.toUpperCase() === "GET") {
        const date = Date.parse(result.headers.get("date") ?? "");
        const modified = Date.parse(result.headers.get("last-modified") ?? "");
        const time = Number.isFinite(date) ? date : modified;
        clock = Number.isFinite(time) ? { time, observed: performance.now() } : undefined;
      }
      return result;
    };
    void (async () => {
      const { storage } = await createPodClient({
        fetch,
        storage: account.storageUrl,
        signal: controller.signal,
      });
      const store = createLegacyStore({ storage, fetch, owner: account.webId });
      const snapshot = await store.load();
      if (!current()) return;
      if (snapshot?.plan) {
        const time = now();
        const message = legacyWarning(snapshot.plan, time);
        if (message && snapshot.plan.notifyMeBy.includes("tray")) {
          await addLocalNotification(account.id, {
            id: `legacy:${snapshot.plan.lastActivity.toISOString()}:${evaluatePlan(snapshot.plan, time).level ?? "due"}`,
            kind: "system",
            title: "Your legacy plan needs attention",
            body: message,
            href: "/settings/legacy",
            createdAt: time,
            read: false,
          });
        }
      }
      if (!current()) return;
      const opened: LegacySession = {
        account,
        storage,
        store,
        snapshot,
        fetch,
        now,
        async save(plan) {
          if (!current()) throw new Error("The account changed. Reload before saving.");
          if (!opened.snapshot) {
            const fresh = await store.load();
            if (fresh?.plan) throw new Error("The legacy plan changed. Reload before saving.");
            opened.snapshot = fresh;
          }
          // Activity is maintained by this session; an older editor draft must not roll it back.
          const saved = await store.save(
            { ...plan, lastActivity: opened.snapshot?.plan?.lastActivity ?? plan.lastActivity },
            opened.snapshot?.etag ?? null,
          );
          if (!current()) return;
          opened.snapshot = saved;
          setSession({ ...opened });
        },
        async delete() {
          if (!current()) throw new Error("The account changed. Reload before deleting.");
          if (!opened.snapshot) return;
          await store.delete(opened.snapshot.etag);
          if (!current()) return;
          opened.snapshot = null;
          setSession({ ...opened });
        },
      };
      setSession(opened);
      let recording = false;
      const activity = (event: Event) => {
        if (!event.isTrusted || recording || !current() || !opened.snapshot?.plan) return;
        const updated = recordActivity(opened.snapshot.plan, now());
        if (updated === opened.snapshot.plan) return;
        recording = true;
        void store
          .save(updated, opened.snapshot.etag)
          .then(
            (saved) => {
              if (current()) {
                opened.snapshot = saved;
                setSession({ ...opened });
              }
            },
            async (error: unknown) => {
              if (error instanceof StorageError && error.code === "precondition-failed") {
                const fresh = await store.load();
                if (current()) {
                  opened.snapshot = fresh;
                  setSession({ ...opened });
                }
                return; // Observe the winner; never retry this heartbeat.
              }
              throw error;
            },
          )
          .catch((error: unknown) => {
            if (current())
              setFailure({
                account,
                message: error instanceof Error ? error.message : "Could not record activity.",
              });
          })
          .finally(() => {
            recording = false;
          });
      };
      window.addEventListener("pointerdown", activity);
      window.addEventListener("keydown", activity);
      controller.signal.addEventListener(
        "abort",
        () => {
          window.removeEventListener("pointerdown", activity);
          window.removeEventListener("keydown", activity);
        },
        { once: true },
      );
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
    if (!visible?.snapshot?.plan) return;
    const session = visible;
    const plan = visible.snapshot.plan;
    const issued = new Set<string>();
    const check = () => {
      const now = session.now();
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
    // Initial warnings are recorded above; restoring a session does not record activity.
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
