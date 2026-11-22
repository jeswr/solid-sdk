// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { toast } from "@jeswr/suite-ui";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { openDemoFormsStore } from "../lib/data/demo-store";
import type { FormsStore } from "../lib/data/store";
import { formRuntime } from "../lib/runtime";
import { FormsController } from "./controller";

interface FormsContextValue {
  session: PodSession;
  controller: FormsController;
}
const Context = createContext<FormsContextValue | null>(null);

/** The host can inject the real runtime-backed store without changing any view. */
export function FormsProvider({
  session,
  store,
  children,
  unavailable,
}: {
  session: PodSession;
  store?: FormsStore;
  children: ReactNode;
  unavailable: ReactNode;
}) {
  const [opened, setOpened] = useState<FormsStore>();
  const [failed, setFailed] = useState(false);
  const supported = session.mode === "demo" || !!(formRuntime.current && formRuntime.openStore);
  useEffect(() => {
    let live = true;
    if (store) return;
    const opening =
      session.mode === "demo"
        ? openDemoFormsStore(session)
        : formRuntime.current && formRuntime.openStore
          ? formRuntime.openStore(session, formRuntime.current)
          : undefined;
    if (!opening) return;
    void opening.then(
      (result) => {
        if (live) setOpened(result);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [session, store]);
  const active = store ?? opened;
  const controller = useMemo(
    () =>
      active
        ? new FormsController(active, () =>
            toast.error("Couldn't save your form. Your draft is still open; try saving again."),
          )
        : undefined,
    [active],
  );
  useEffect(() => {
    if (controller) void controller.load();
  }, [controller]);
  if (failed) return <div role="alert">Couldn't open your forms. Reload to try again.</div>;
  if (!controller) return supported ? <p role="status">Opening your forms…</p> : unavailable;
  return <Context value={{ session, controller }}>{children}</Context>;
}
export function useForms() {
  const value = useContext(Context);
  if (!value) throw new Error("FormsProvider is required");
  return value;
}
export function useFormsState() {
  const { controller } = useForms();
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}
