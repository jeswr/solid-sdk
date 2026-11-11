// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { toast } from "@jeswr/suite-ui";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { ensureWalletSample } from "../demo/sample";
import { openWallet } from "../lib/data/client";
import { createWalletState, type WalletState } from "./wallet-state";

const WalletContext = createContext<{ session: PodSession; state: WalletState } | null>(null);
export function WalletProvider({
  session,
  children,
}: {
  session: PodSession;
  children: ReactNode;
}) {
  const [result, setResult] = useState<{ state?: WalletState; error?: unknown }>({});
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt restarts private storage initialisation
  useEffect(() => {
    let live = true;
    let controller: WalletState | undefined;
    let unsubscribe: (() => void) | undefined;
    setResult({});
    void (async () => {
      await ensureWalletSample(session);
      if (!live) return;
      const { repository } = await openWallet(session);
      if (!live) return;
      await repository.initialise();
      if (!live) return;
      controller = createWalletState(repository, () =>
        toast.error(
          "Couldn't save to your pod. Your change was rolled back. Check your connection and permissions, then try again.",
        ),
      );
      setResult({ state: controller });
      await controller.refresh();
      if (!live) return;
      const state = controller;
      unsubscribe = session.subscribe(() => {
        if (state.getSnapshot().busy.length === 0) void state.refresh();
      });
    })().catch((error) => {
      if (live) setResult({ error });
    });
    return () => {
      live = false;
      unsubscribe?.();
      controller?.dispose();
    };
  }, [session, attempt]);
  if (!result.state)
    return <WalletBoot error={result.error} retry={() => setAttempt((value) => value + 1)} />;
  return <WalletContext value={{ session, state: result.state }}>{children}</WalletContext>;
}

import { ErrorState, LoadingSkeleton } from "@jeswr/suite-ui";

function WalletBoot({ error, retry }: { error?: unknown; retry: () => void }) {
  return error ? (
    <ErrorState error="unreachable" actions={{ retry }}>
      <p>
        Wallet needs private storage. Its permissions may be shared or unavailable. Check Wallet and
        Settings in Permissions, then try again.
      </p>
    </ErrorState>
  ) : (
    <LoadingSkeleton preset="grid" label="Opening your private wallet" />
  );
}
export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("Wallet provider is required");
  return {
    ...context,
    snapshot: useSyncExternalStore(
      context.state.subscribe,
      context.state.getSnapshot,
      context.state.getSnapshot,
    ),
  };
}
