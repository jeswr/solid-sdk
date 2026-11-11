// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import {
  initialUi,
  readWalkthrough,
  type WalkthroughProgress,
  type WalkthroughUi,
  writeWalkthrough,
} from "./progress";

interface WalkthroughContext {
  progress: WalkthroughProgress;
  ui: WalkthroughUi;
  ready: boolean;
  start(): void;
  toggle(id: string): void;
  collapse(): void;
  dismiss(): void;
}
const Context = createContext<WalkthroughContext | null>(null);

export function WalkthroughProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({
    progress: { done: [] } as WalkthroughProgress,
    ui: initialUi,
  });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      setState(readWalkthrough(localStorage));
    } catch {
      /* Memory only. */
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      writeWalkthrough(localStorage, state.progress, state.ui);
    } catch {
      /* Memory only. */
    }
  }, [ready, state]);
  return (
    <Context.Provider
      value={{
        ...state,
        ready,
        start: () =>
          setState((s) => ({ ...s, ui: { started: true, dismissed: false, collapsed: false } })),
        toggle: (id) =>
          setState((s) => ({
            ...s,
            progress: {
              done: s.progress.done.includes(id)
                ? s.progress.done.filter((done) => done !== id)
                : [...s.progress.done, id],
            },
          })),
        collapse: () => setState((s) => ({ ...s, ui: { ...s.ui, collapsed: !s.ui.collapsed } })),
        dismiss: () => setState((s) => ({ ...s, ui: { ...s.ui, dismissed: true } })),
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useWalkthrough() {
  const value = useContext(Context);
  if (!value) throw new Error("WalkthroughProvider is required");
  return value;
}

/** Standalone frame previews can render without the application providers. */
export function useOptionalWalkthrough() {
  return useContext(Context);
}
