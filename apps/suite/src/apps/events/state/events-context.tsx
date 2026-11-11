// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { createEventsRepository } from "@jeswr/solid-events";
import { Button, toast } from "@jeswr/suite-ui";
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
import { ensureEventsSample } from "../demo/sample";
import { EventsController } from "./controller";

const Context = createContext<{ session: PodSession; controller: EventsController } | null>(null);
export function EventsProvider({
  session,
  children,
}: {
  session: PodSession;
  children: ReactNode;
}) {
  const controller = useMemo(
    () =>
      new EventsController(
        createEventsRepository({
          fetch: session.fetch,
          storageRoot: session.storageUrl,
          owner: session.webId,
          demo: session.mode === "demo",
        }),
        () =>
          toast.error("Couldn't save your invitation. Please reconnect or refresh and try again."),
      ),
    [session],
  );
  useEffect(() => {
    controller.activate();
    return () => controller.dispose();
  }, [controller]);
  const [attempt, setAttempt] = useState(0);
  const [bootError, setBootError] = useState(false);
  useEffect(() => {
    let live = true;
    setBootError(false);
    void ensureEventsSample(session).then(
      () => {
        if (live) void controller.refresh();
      },
      () => {
        if (live) setBootError(true);
      },
    );
    return () => {
      live = false;
    };
  }, [session, controller]);
  // Retrying a seed failure uses the same bounded controller and session.
  useEffect(() => {
    if (!attempt) return;
    let live = true;
    void ensureEventsSample(session).then(
      () => {
        if (!live) return;
        setBootError(false);
        void controller.refresh();
      },
      () => {
        if (live) setBootError(true);
      },
    );
    return () => {
      live = false;
    };
  }, [attempt, session, controller]);
  useEffect(() => {
    const refresh = () => {
      if (!controller.snapshot().saving) void controller.refresh();
    };
    const stop = session.subscribe(refresh);
    window.addEventListener("online", refresh);
    return () => {
      stop();
      window.removeEventListener("online", refresh);
    };
  }, [session, controller]);
  return (
    <Context value={{ session, controller }}>
      {bootError ? (
        <div className="ev-page" role="alert">
          <p>Couldn't prepare your event invitations.</p>
          <Button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      ) : (
        children
      )}
    </Context>
  );
}
export function useEvents() {
  const value = useContext(Context);
  if (!value) throw new Error("EventsProvider is required");
  const state = useSyncExternalStore(
    value.controller.subscribe,
    value.controller.snapshot,
    value.controller.snapshot,
  );
  return { ...value, ...state };
}
