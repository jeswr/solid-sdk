// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import type { PublishRepository } from "@jeswr/solid-publish";
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
import { connectPublish } from "../lib/data/connect";
import { createPublishWorkspace, type PublishWorkspace } from "./workspace";

interface PublishContextValue {
  session: PodSession;
  repository: PublishRepository;
  workspace: PublishWorkspace;
}
const Context = createContext<PublishContextValue | null>(null);
export function PublishProvider({
  session,
  children,
  fallback,
}: {
  session: PodSession;
  children: ReactNode;
  fallback: (error: boolean, retry: () => void) => ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [connection, setConnection] = useState<{
    session: PodSession;
    repository?: PublishRepository;
    error?: boolean;
  }>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries a failed connection
  useEffect(() => {
    let alive = true;
    setConnection(undefined);
    void connectPublish(session).then(
      (repository) => {
        if (alive) setConnection({ session, repository });
      },
      () => {
        if (alive) setConnection({ session, error: true });
      },
    );
    return () => {
      alive = false;
    };
  }, [session, attempt]);
  if (connection?.session !== session || !connection.repository)
    return fallback(Boolean(connection?.error), () => setAttempt((n) => n + 1));
  return (
    <Connected
      key={`${session.webId}:${attempt}`}
      session={session}
      repository={connection.repository}
    >
      {children}
    </Connected>
  );
}
function Connected({
  session,
  repository,
  children,
}: {
  session: PodSession;
  repository: PublishRepository;
  children: ReactNode;
}) {
  const workspace = useMemo(
    () => createPublishWorkspace(repository, session.storageUrl, (message) => toast.error(message)),
    [repository, session],
  );
  useEffect(() => {
    void workspace.load();
    return () => {
      workspace.dispose();
    };
  }, [workspace]);
  return <Context value={{ session, repository, workspace }}>{children}</Context>;
}
export function usePublish() {
  const value = useContext(Context);
  if (!value) throw new Error("Publish needs its workspace provider.");
  const snapshot = useSyncExternalStore(
    value.workspace.subscribe,
    value.workspace.getSnapshot,
    value.workspace.getSnapshot,
  );
  return { ...value, snapshot };
}
