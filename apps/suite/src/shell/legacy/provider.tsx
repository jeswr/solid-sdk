// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  boundedNow,
  createLegacyStore,
  evaluatePlan,
  type LegacyPlan,
  LegacyPrivacyError,
  type LegacySnapshot,
  recordActivity,
  samePlan,
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
  /** Increments when another tab or device changed the content, or the plan was deleted. */
  revision: number;
  /** Why the editor was last remounted; shown when it mounts. */
  notice: string;
  now(): Date;
  /** `base` is the snapshot the draft was edited from; a changed plan refuses the save. */
  save(plan: LegacyPlan, base: LegacySnapshot | null): Promise<void>;
  delete(base: LegacySnapshot | null): Promise<void>;
}
interface LegacyContextValue {
  session: LegacySession | null;
  error: string;
  loading: boolean;
  /** Offered when privacy cannot be verified: conditionally deletes exactly the plan resource. */
  withdraw?: (() => Promise<void>) | undefined;
}
const Context = createContext<LegacyContextValue>({ session: null, error: "", loading: false });
export const LEGACY_CHANGED_ELSEWHERE =
  "Your legacy plan was changed in another tab or device. The latest saved version is shown; unsaved changes were not kept.";
export const LEGACY_DELETED = "Legacy plan deleted. Nothing has been shared.";
export const LEGACY_CONFLICT =
  "Your legacy plan was changed in another tab or device. Review the latest version, then save again.";

const blank = (snapshot: LegacySnapshot | null) =>
  !snapshot || (!snapshot.plan && !snapshot.invalid);
/**
 * Same plan content, heartbeat timestamps excluded. A missing resource and an empty placeholder
 * both hold no plan, so they match each other; two unreadable resources match each other.
 */
export function sameContent(a: LegacySnapshot | null, b: LegacySnapshot | null): boolean {
  if (blank(a) || blank(b)) return blank(a) && blank(b);
  if (!a?.plan || !b?.plan) return !a?.plan && !b?.plan;
  return samePlan(a.plan, b.plan, { ignoreTimes: true });
}
const conflict = (error: unknown) =>
  error instanceof StorageError && error.code === "precondition-failed";

/** Account-scoped, abortable activity recording. Merely opening the suite never creates a plan. */
export function LegacyProvider({ children }: { children: ReactNode }) {
  const accounts = useAccounts();
  const latest = useRef(accounts);
  latest.current = accounts;
  const account = accounts.active;
  const ready = accounts.status === "ready";
  const [session, setSession] = useState<LegacySession | null>(null);
  const [failure, setFailure] = useState<{
    account: SuiteAccount;
    message: string;
    withdraw?: (() => Promise<void>) | undefined;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!ready || !account) return;
    void attempt; // A successful withdrawal re-runs the load for the same account.
    const controller = new AbortController();
    const current = () =>
      !controller.signal.aborted &&
      latest.current.active === account &&
      latest.current.isActiveAccount(account.id);
    // Server Date minus the device clock, from an exposed Date header on a plan response.
    // Cross-origin servers usually hide Date; then the device clock is used unbounded.
    // Last-Modified is never current time: it is only the store's load-time sanity bound.
    // A wall-clock offset survives sleep, unlike a performance.now() delta.
    let offset: number | undefined;
    const planUrl = new URL("settings/legacy-plan.ttl", account.storageUrl).href;
    const now = () => {
      const device = new Date();
      if (offset === undefined) return device;
      const bounded = boundedNow(device, new Date(device.getTime() + offset));
      return Number.isFinite(bounded.getTime()) ? bounded : device;
    };
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (!current()) throw new Error("The account changed. Sign in again.");
      const result = await latest.current.fetch(input, { ...init, signal: controller.signal });
      if (!current()) throw new Error("The account changed. Sign in again.");
      const target = input instanceof Request ? input.url : String(input);
      if (target === planUrl) {
        const date = Date.parse(result.headers.get("date") ?? "");
        if (Number.isFinite(date)) offset = date - Date.now();
      }
      return result;
    };
    let store: ReturnType<typeof createLegacyStore> | undefined;
    void (async () => {
      const { storage } = await createPodClient({
        fetch,
        storage: account.storageUrl,
        signal: controller.signal,
      });
      // The account's own root: an assumed origin root (or any other) is refused before any request.
      store = createLegacyStore({
        storage,
        fetch,
        owner: account.webId,
        expectedRoot: account.storageUrl,
        now,
      });
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
      const loaded = store;
      /** Observe the winner of a conflict; a content change remounts the editor. */
      const observe = (fresh: LegacySnapshot | null) => {
        if (!current()) return;
        if (!sameContent(fresh, opened.snapshot)) {
          opened.revision++;
          opened.notice = LEGACY_CHANGED_ELSEWHERE;
        }
        opened.snapshot = fresh;
        setSession({ ...opened });
      };
      const opened: LegacySession = {
        account,
        storage,
        store: loaded,
        snapshot,
        revision: 0,
        notice: "",
        fetch,
        now,
        async save(plan, base) {
          if (!current()) throw new Error("The account changed. Reload before saving.");
          // A draft edited from another version must never overwrite what replaced it.
          if (!sameContent(opened.snapshot, base)) throw new Error(LEGACY_CONFLICT);
          if (!opened.snapshot) {
            const fresh = await loaded.load();
            if (fresh?.plan) throw new Error("The legacy plan changed. Reload before saving.");
            opened.snapshot = fresh;
          }
          let saved: LegacySnapshot & { plan: LegacyPlan };
          try {
            // Activity is maintained by this session; an older editor draft must not roll it back.
            saved = await loaded.save(
              { ...plan, lastActivity: opened.snapshot?.plan?.lastActivity ?? plan.lastActivity },
              opened.snapshot?.etag ?? null,
            );
          } catch (error) {
            if (!conflict(error)) throw error;
            observe(await loaded.load()); // Never retried automatically.
            throw new Error(LEGACY_CONFLICT);
          }
          if (!current()) return;
          opened.snapshot = saved;
          setSession({ ...opened });
        },
        async delete(base) {
          if (!current()) throw new Error("The account changed. Reload before deleting.");
          if (!sameContent(opened.snapshot, base)) throw new Error(LEGACY_CONFLICT);
          if (!opened.snapshot) return;
          try {
            await loaded.delete(opened.snapshot.etag);
          } catch (error) {
            if (!conflict(error)) throw error;
            observe(await loaded.load()); // Never retried automatically.
            throw new Error(LEGACY_CONFLICT);
          }
          if (!current()) return;
          // Reset the editor: the deleted plan must not linger as an unsaved draft.
          opened.snapshot = null;
          opened.revision++;
          opened.notice = LEGACY_DELETED;
          setSession({ ...opened });
        },
      };
      setFailure((previous) => (previous?.account === account ? null : previous));
      setSession(opened);
      let recording = false;
      const activity = (event: Event) => {
        if (!event.isTrusted || recording || !current() || !opened.snapshot?.plan) return;
        const updated = recordActivity(opened.snapshot.plan, now());
        if (updated === opened.snapshot.plan) return;
        recording = true;
        void loaded
          .save(updated, opened.snapshot.etag)
          .then(
            (saved) => {
              if (current()) {
                opened.snapshot = saved;
                setSession({ ...opened });
              }
            },
            async (error: unknown) => {
              if (!conflict(error)) throw error;
              observe(await loaded.load()); // Observe the winner; never retry this heartbeat.
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
      if (!current()) return;
      // Deleting discloses nothing, so a plan that fails the privacy proof stays removable.
      const etag = error instanceof LegacyPrivacyError ? error.etag : undefined;
      const unverified = store;
      setFailure({
        account,
        message:
          error instanceof Error
            ? error.message
            : "Could not read your legacy plan. Try reloading.",
        withdraw:
          etag && unverified
            ? async () => {
                if (!current()) throw new Error("The account changed. Reload before deleting.");
                await unverified.delete(etag);
                if (!current()) return;
                setFailure(null);
                setAttempt((value) => value + 1);
              }
            : undefined,
      });
    });
    return () => controller.abort();
  }, [account, ready, attempt]);
  const visible = ready && session?.account === account ? session : null;
  const shown = ready && failure?.account === account ? failure : null;
  const error = shown?.message ?? "";
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
    <Context.Provider
      value={{
        session: visible,
        error,
        loading: ready && !visible && !error,
        withdraw: visible ? undefined : shown?.withdraw,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useLegacy() {
  return useContext(Context);
}
