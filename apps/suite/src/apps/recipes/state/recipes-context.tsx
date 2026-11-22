// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
"use client";
import { openRecipeStore, RecipePrivacyError } from "@jeswr/solid-recipe";
import { StorageError } from "@jeswr/storage-client";
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
        opened = createRecipeState(store, (error) => {
          if (error instanceof RecipePrivacyError) toast.error(error.message);
          else if (error instanceof StorageError && error.code === "precondition-failed")
            toast.error("This recipe changed. Reload it and reopen the editor before saving.");
          else toast.error("Couldn't save that change. Please try again.");
        });
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
