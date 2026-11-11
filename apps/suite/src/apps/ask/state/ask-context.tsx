// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { createContext, useContext, useSyncExternalStore } from "react";
import type { AskController } from "./controller";

export const AskContext = createContext<AskController | null>(null);
export function useAsk() {
  const controller = useContext(AskContext);
  if (!controller) throw new Error("Ask requires an active pod session");
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return { controller, state };
}
