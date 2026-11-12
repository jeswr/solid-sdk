// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { PublicationError, type PublishRepository } from "@jeswr/solid-publish";
import { toast } from "@jeswr/suite-ui";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { useOptionalAccounts } from "@/shell/session/accounts-context";
import { connectPublish } from "../lib/data/connect";
import { createPublishWorkspace, type PublishWorkspace } from "./workspace";

interface PublishContextValue {
  session: PodSession;
  repository: PublishRepository;
  workspace: PublishWorkspace;
}
const Context = createContext<PublishContextValue | null>(null);
const accountKey = (session: PodSession) =>
  `${session.mode}\n${session.webId}\n${session.storageUrl}`;
// The account Publish last rendered, for standalone previews without the shell's accounts.
let renderedAccount: string | undefined;
export function PublishProvider({
  session,
  children,
  fallback,
}: {
  session: PodSession;
  children: ReactNode;
  fallback: (error: boolean, retry: () => void, message?: string) => ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [connection, setConnection] = useState<{
    session: PodSession;
    repository?: PublishRepository;
    error?: string;
  }>();
  useLayoutEffect(() => {
    renderedAccount = accountKey(session);
  }, [session]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries a failed connection
  useEffect(() => {
    let alive = true;
    setConnection(undefined);
    void connectPublish(session).then(
      (repository) => {
        if (alive) setConnection({ session, repository });
      },
      (error: unknown) => {
        if (alive)
          setConnection({
            session,
            error:
              error instanceof PublicationError
                ? error.message
                : "Couldn't open Publish. Check your connection and pod permissions, then retry.",
          });
      },
    );
    return () => {
      alive = false;
    };
  }, [session, attempt]);
  if (connection?.session !== session || !connection.repository)
    return fallback(Boolean(connection?.error), () => setAttempt((n) => n + 1), connection?.error);
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
  const accounts = useOptionalAccounts();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the accounts value changes on every shell render; bind once per session, which changes with its account
  const workspace = useMemo(() => {
    const key = accountKey(session);
    // Captured with this session; the shell check reads live state and survives route unmount.
    const id = accounts?.active?.id;
    const version = accounts?.sessionVersion;
    const isCurrent = () =>
      renderedAccount === key &&
      (!accounts || (id !== undefined && accounts.isActiveAccount(id, version)));
    return createPublishWorkspace(
      repository,
      session.storageUrl,
      (message) => toast.error(message),
      isCurrent,
    );
  }, [repository, session]);
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
