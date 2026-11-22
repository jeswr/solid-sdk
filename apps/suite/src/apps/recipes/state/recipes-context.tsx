// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { openRecipeStore } from "@jeswr/solid-recipe";
import { ErrorState, LoadingSkeleton, toast } from "@jeswr/suite-ui";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { ensureSample } from "../demo/sample";
import { createRecipeState, type RecipeState } from "./recipe-state";

const Context = createContext<RecipeState | null>(null);
export function RecipesProvider({
  session,
  children,
}: {
  session: PodSession;
  children: ReactNode;
}) {
  const [state, setState] = useState<RecipeState>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries opening a failed store.
  useEffect(() => {
    let live = true;
    let opened: RecipeState | undefined;
    let stop: (() => void) | undefined;
    setState(undefined);
    setError(false);
    void openRecipeStore({
      ...session,
      ...(session.mode === "demo" ? { protocol: "solid" as const } : {}),
    })
      .then(async (store) => {
        if (!live) return;
        await ensureSample(session, store);
        if (!live) return;
        if (store.registrationError)
          toast.error(
            "Recipes work, but your pod's Type Index could not be updated. Reopen Recipes to try again.",
          );
        opened = createRecipeState(store, () =>
          toast.error("Couldn't save that change. Your previous recipe is safe. Please try again."),
        );
        setState(opened);
        stop = session.subscribe(() => {
          void opened?.refresh();
        });
        await opened.refresh();
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
      stop?.();
      opened?.dispose();
    };
  }, [session, attempt]);
  if (error)
    return (
      <ErrorState error="unreachable" actions={{ retry: () => setAttempt((value) => value + 1) }} />
    );
  if (!state) return <LoadingSkeleton preset="grid" label="Preparing your recipe box" />;
  return <Context value={state}>{children}</Context>;
}
export function useRecipes() {
  const state = useContext(Context);
  if (!state) throw new Error("RecipesProvider is required");
  const snapshot = useSyncExternalStore(state.subscribe, state.getSnapshot, state.getSnapshot);
  return { ...snapshot, actions: state };
}
