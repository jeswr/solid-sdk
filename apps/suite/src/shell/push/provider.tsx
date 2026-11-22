// AUTHORED-BY Codex GPT-6
"use client";
import { isNativeApp } from "@jeswr/suite-native";
import type { PushRegistrarState, PushStatus } from "@jeswr/suite-native/push";
import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAccounts } from "../session/accounts-context";
import type { AccountsContextValue } from "../session/accounts-provider";
import { onBeforeSignOut } from "../session/sign-out-cleanup";
import type { SuiteAccount } from "../session/types";
import { pushRelayUrl } from "./config";
import {
  consumePushDestination,
  createPushRuntime,
  type PushDestination,
  type PushRuntime,
  signedIn,
} from "./runtime";

interface PushContextValue {
  state: PushRegistrarState | null;
  status: PushStatus | null;
  busy: ReadonlySet<string>;
  errors: Readonly<Record<string, string>>;
  setEnabled(account: SuiteAccount, enabled: boolean): Promise<void>;
}
const Context = createContext<PushContextValue | null>(null);
export function useNativePush() {
  return useContext(Context);
}
type Factory = (options: { accounts: () => AccountsContextValue }) => Promise<PushRuntime | null>;

export function NativePushProvider({
  children,
  createRuntime = createPushRuntime,
}: {
  children: ReactNode;
  createRuntime?: Factory;
}) {
  const accounts = useAccounts();
  const latest = useRef(accounts);
  latest.current = accounts;
  const pending = useRef<Promise<PushRuntime | null> | null>(null);
  const [runtime, setRuntime] = useState<PushRuntime | null>(null);
  const [state, setState] = useState<PushRegistrarState | null>(null);
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const refresh = useCallback(async (service: PushRuntime) => {
    setState(await service.registrar.snapshot());
    setStatus(await service.push.status());
  }, []);

  useEffect(() => {
    if (!isNativeApp() || !pushRelayUrl()) return;
    let live = true;
    pending.current ??= createRuntime({ accounts: () => latest.current });
    void pending.current
      .then(async (service) => {
        if (!service || !live) return;
        setRuntime(service);
        await refresh(service);
      })
      .catch(() => {
        if (live)
          setErrors({
            system: "Push notifications are unavailable. Try again after reopening Solid Suite.",
          });
      });
    const stop = onBeforeSignOut(async (account) => {
      const service = await pending.current;
      if (service) {
        await service.registrar.remove(account.id);
        if (live) setState(await service.registrar.snapshot());
      }
    });
    return () => {
      live = false;
      stop();
    };
  }, [createRuntime, refresh]);

  const resume = useCallback(
    async (expectedAccounts = latest.current.accounts) => {
      if (!runtime || latest.current.status === "loading") return;
      if (latest.current.accounts !== expectedAccounts) return;
      try {
        await runtime.resume();
        setErrors((current) => ({ ...current, system: "" }));
      } catch {
        setErrors((current) => ({
          ...current,
          system: "Some notifications need renewal. Open Notifications settings to try again.",
        }));
      } finally {
        await refresh(runtime).catch(() => {});
      }
    },
    [runtime, refresh],
  );

  useEffect(() => {
    if (accounts.status !== "loading") void resume(accounts.accounts);
  }, [resume, accounts.status, accounts.accounts]);
  useEffect(() => {
    if (!runtime) return;
    const run = () => {
      void resume();
    };
    const visible = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("resume", run);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", run);
    window.addEventListener("online", run);
    window.addEventListener("suite-push-topics-changed", run);
    return () => {
      document.removeEventListener("resume", run);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", run);
      window.removeEventListener("online", run);
      window.removeEventListener("suite-push-topics-changed", run);
    };
  }, [runtime, resume]);

  const setEnabled = async (account: SuiteAccount, enabled: boolean) => {
    if (!runtime || busy.has(account.id)) return;
    setBusy((current) => new Set(current).add(account.id));
    setErrors((current) => ({ ...current, [account.id]: "" }));
    try {
      if (enabled) await runtime.enable(account);
      else await runtime.registrar.remove(account.id);
    } catch {
      setErrors((current) => ({
        ...current,
        [account.id]: enabled
          ? "Couldn't turn notifications on. Check permission and your connection, then try again."
          : "Notifications are silenced. Cleanup will retry when you reopen Solid Suite.",
      }));
    } finally {
      await refresh(runtime).catch(() => {});
      setBusy((current) => {
        const next = new Set(current);
        next.delete(account.id);
        return next;
      });
    }
  };
  return (
    <Context value={runtime ? { state, status, busy, errors, setEnabled } : null}>
      <Suspense>
        <PushLaunch runtime={runtime} />
      </Suspense>
      {children}
    </Context>
  );
}

/** Poll only the local launch slot while visible: SuitePush has no foreground-tap event. */
export function PushLaunch({ runtime }: { runtime: PushRuntime | null }) {
  const accounts = useAccounts();
  const latest = useRef(accounts);
  latest.current = accounts;
  const router = useRouter();
  const [destination, setDestination] = useState<PushDestination | null>(null);
  useEffect(() => {
    if (!runtime || accounts.status === "loading") return;
    let live = true;
    let reading = false;
    const consume = async () => {
      if (!live || reading || document.visibilityState === "hidden") return;
      reading = true;
      try {
        const next = await consumePushDestination(runtime, latest.current);
        if (live && next) setDestination(next);
      } catch {
        /* Untrusted or unavailable native launch data never controls navigation. */
      } finally {
        reading = false;
      }
    };
    void consume();
    const run = () => {
      void consume();
    };
    const timer = setInterval(run, 2_000);
    document.addEventListener("resume", run);
    document.addEventListener("visibilitychange", run);
    window.addEventListener("focus", run);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("resume", run);
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener("focus", run);
    };
  }, [runtime, accounts.status]);
  useEffect(() => {
    if (!destination) return;
    const current = accounts;
    if (destination.accountId && signedIn(current, destination.accountId)) {
      if (current.active?.id !== destination.accountId) {
        current.switchTo(destination.accountId);
        return; // Wait for the account provider to render the selected account.
      }
      if (current.status !== "ready" || !current.isActiveAccount(destination.accountId)) return;
      router.push(destination.route);
    } else router.push("/notifications");
    setDestination(null);
  }, [destination, accounts, router]);
  return null;
}
