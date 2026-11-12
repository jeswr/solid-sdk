// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { toast } from "@jeswr/suite-ui";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PodSession } from "@/lib/session/pod-session";
import {
  folderIriFromKey,
  isMissing,
  MailClient,
  type MessageView,
  mailErrorMessage,
  type ThreadPage,
  type ThreadRow,
  type ThreadView,
} from "../lib/client";

interface Patch {
  id: number;
  thread: string;
  fields: Partial<ThreadRow> & { archived?: boolean };
  confirmedAt?: number;
}
interface MailContextValue {
  client: MailClient;
  session: PodSession;
  account: string;
  setAccount: (account: string) => void;
  version: number;
  invalidate: () => void;
  patches: Patch[];
  mutate: (thread: string, fields: Patch["fields"], work: () => Promise<void>) => Promise<boolean>;
}
const Context = createContext<MailContextValue | null>(null);
export function MailProvider({ session, children }: { session: PodSession; children: ReactNode }) {
  const client = useMemo(
    () => new MailClient(session.fetch, session.storageUrl, session.webId, session.mode),
    [session],
  );
  const [account, choose] = useState("imported");
  const [version, setVersion] = useState(0);
  const versionRef = useRef(0);
  const nextId = useRef(0);
  const accountChoice = useRef(0);
  const queue = useRef(Promise.resolve());
  const [patches, setPatches] = useState<Patch[]>([]);
  const invalidate = useCallback(() => {
    versionRef.current++;
    setVersion(versionRef.current);
  }, []);
  const setAccount = useCallback((value: string) => {
    accountChoice.current++;
    choose(value);
    try {
      localStorage.setItem("suite.mail.account", value);
    } catch {
      /* Private browsing may disable storage. */
    }
  }, []);
  useEffect(() => {
    let live = true;
    const choice = accountChoice.current;
    void client.accounts().then(
      (accounts) => {
        if (!live || accountChoice.current !== choice) return;
        let saved: string | null = null;
        try {
          saved = localStorage.getItem("suite.mail.account");
        } catch {
          /* Use the first account. */
        }
        choose(saved && accounts.includes(saved) ? saved : (accounts[0] ?? "imported"));
      },
      () => {
        /* useAccounts exposes a retryable error in the sidebar. */
      },
    );
    return () => {
      live = false;
    };
  }, [client]);
  useEffect(() => {
    const root = new URL("mail/", session.storageUrl).href;
    let timer: ReturnType<typeof setTimeout>;
    const unsubscribe = session.subscribe((url) => {
      if (!url.startsWith(root)) return;
      clearTimeout(timer);
      timer = setTimeout(invalidate, 80);
    });
    const focus = () => invalidate();
    window.addEventListener("focus", focus);
    return () => {
      unsubscribe();
      clearTimeout(timer);
      window.removeEventListener("focus", focus);
    };
  }, [session, invalidate]);
  const mutate = useCallback(
    async (thread: string, fields: Patch["fields"], work: () => Promise<void>) => {
      const id = ++nextId.current;
      setPatches((current) => [...current, { id, thread, fields }]);
      let success = false;
      const operation = queue.current.then(async () => {
        try {
          await work();
          const confirmedAt = versionRef.current + 1;
          setPatches((current) =>
            current.map((patch) => (patch.id === id ? { ...patch, confirmedAt } : patch)),
          );
          success = true;
        } catch (error) {
          setPatches((current) => current.filter((patch) => patch.id !== id));
          toast.error(mailErrorMessage(error));
        } finally {
          invalidate();
        }
      });
      queue.current = operation;
      await operation;
      return success;
    },
    [invalidate],
  );
  const value = useMemo(
    () => ({ client, session, account, setAccount, version, invalidate, patches, mutate }),
    [client, session, account, setAccount, version, invalidate, patches, mutate],
  );
  return <Context value={value}>{children}</Context>;
}
export function useMail() {
  const value = useContext(Context);
  if (!value) throw new Error("MailProvider is required");
  return value;
}
export interface AsyncMail<T> {
  status: "loading" | "ready" | "error";
  data: T | undefined;
  error: unknown;
  retry: () => void;
  loadedVersion: number;
}
function useResource<T>(load: () => Promise<T>, key: string, requestArgs = ""): AsyncMail<T> {
  const { version } = useMail();
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const [state, setState] = useState<{
    key: string;
    status: AsyncMail<T>["status"];
    data?: T | undefined;
    error?: unknown;
    loadedVersion: number;
  }>({ key, status: "loading", loadedVersion: -1 });
  // The stable key describes arguments; version and attempt explicitly invalidate the request.
  // biome-ignore lint/correctness/useExhaustiveDependencies: load's closure is represented by key
  useEffect(() => {
    const request = ++generation.current;
    setState((old) => ({
      ...old,
      key,
      data: old.key === key ? old.data : undefined,
      status: "loading",
      error: undefined,
    }));
    void load().then(
      (data) => {
        if (generation.current === request)
          setState({ key, status: "ready", data, loadedVersion: version });
      },
      (error: unknown) => {
        if (generation.current === request)
          setState({ key, status: "error", error, loadedVersion: version });
      },
    );
    return () => {
      generation.current++;
    };
  }, [key, requestArgs, version, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return {
    status: state.key === key ? state.status : "loading",
    data: state.key === key ? state.data : undefined,
    error: state.error,
    retry,
    loadedVersion: state.loadedVersion,
  };
}
export function useAccounts() {
  const { client, session } = useMail();
  return useResource(() => client.accounts(), `accounts:${session.webId}`);
}
export function useFolders() {
  const { client, account } = useMail();
  return useResource(() => client.folders(account), `folders:${account}`);
}
function patched(row: ThreadRow, patches: Patch[], loadedVersion: number) {
  const value = { ...row, archived: false };
  for (const patch of patches) {
    if (
      patch.thread === row.iri &&
      (patch.confirmedAt === undefined || patch.confirmedAt > loadedVersion)
    )
      Object.assign(value, patch.fields);
  }
  return value;
}

export function useThreads(key: string, pageSize = 50) {
  const { client, account, patches } = useMail();
  const identity = `${account}:${key}:${pageSize}`;
  const [paging, setPaging] = useState({ key: identity, limit: pageSize });
  const limit = paging.key === identity ? paging.limit : pageSize;
  const result = useResource<ThreadPage>(
    () => client.threads(account, folderIriFromKey(client.root(account), key), 0, limit),
    `threads:${identity}`,
    String(limit),
  );
  const items = result.data?.items
    .map((row) => patched(row, patches, result.loadedVersion))
    .filter((row) => !(row.archived && key === "inbox"));
  return {
    ...result,
    data: result.data && { ...result.data, items: items ?? [] },
    loadMore: () => setPaging({ key: identity, limit: limit + pageSize }),
  };
}
export function useThread(iri: string) {
  const { client, patches, session } = useMail();
  const result = useResource<ThreadView>(
    () => client.thread(iri),
    `thread:${session.webId}:${iri}`,
  );
  const active = patches.filter(
    (p) =>
      p.thread === iri && (p.confirmedAt === undefined || p.confirmedAt > result.loadedVersion),
  );
  const fields: Patch["fields"] = {};
  for (const patch of active) Object.assign(fields, patch.fields);
  const data = result.data && {
    ...result.data,
    messages: result.data.messages.map((message) => ({
      ...message,
      ...(fields.unread === undefined ? {} : { read: !fields.unread }),
      ...(fields.starred === undefined ? {} : { starred: fields.starred }),
    })),
  };
  return { ...result, data };
}
export function useMailSearch(query: string) {
  const { client, account, patches } = useMail();
  const result = useResource(() => client.search(account, query), `search:${account}:${query}`);
  return {
    ...result,
    data: result.data?.map((row) => patched(row, patches, result.loadedVersion)),
  };
}
function checkBatch(result: Awaited<ReturnType<MailClient["markRead"]>>) {
  if (result.failed.length) throw result.failed[0]?.error;
}
export function useMailActions() {
  const { client, mutate, invalidate } = useMail();
  const markRead = (iris: string[], read: boolean, thread: string) =>
    mutate(thread, { unread: !read }, async () => {
      checkBatch(await client.markRead(iris, read));
    });
  const star = (iris: string[], on: boolean, thread: string) =>
    mutate(thread, { starred: on }, async () => {
      for (const iri of iris) await client.star(iri, on);
    });
  const archiveMessages = async (messages: MessageView[], thread: string) => {
    const changes = messages.flatMap((message) => {
      const root = message.iri.slice(0, message.iri.indexOf("/messages/") + 1);
      const inbox = folderIriFromKey(root, "inbox");
      const archive = folderIriFromKey(root, "archive");
      const hadInbox = message.labels.includes(inbox);
      const hadArchive = message.labels.includes(archive);
      return hadInbox || !hadArchive
        ? [{ iri: message.iri, inbox, archive, hadInbox, hadArchive }]
        : [];
    });
    if (!changes.length) return;
    const result = await client.archive(changes.map((change) => change.iri));
    // Failed cross-document operations may have applied some memberships too.
    // Retain every original membership so Undo can repair either outcome.
    toast(result.failed.length ? "Archive incomplete" : "Mail archived", {
      duration: 8000,
      action: {
        label: "Undo",
        onClick: () => {
          void mutate(thread, { archived: false }, async () => {
            for (const change of changes) {
              if (change.hadInbox) await client.label(change.iri, change.inbox, true);
              if (!change.hadArchive) {
                try {
                  await client.label(change.iri, change.archive, false);
                } catch (error) {
                  // The destination may never have been created by the failed archive.
                  if (!isMissing(error)) throw error;
                }
              }
            }
          });
        },
      },
    });
    checkBatch(result);
  };
  const archive = (iris: string[], thread: string) =>
    mutate(thread, { archived: true }, async () => {
      const view = await client.thread(thread);
      await archiveMessages(
        view.messages.filter((message) => iris.includes(message.iri)),
        thread,
      );
    });
  const forRows = (rows: ThreadRow[], kind: "read" | "star" | "archive", on = true) =>
    Promise.all(
      rows.map((row) =>
        mutate(
          row.iri,
          kind === "read"
            ? { unread: !on }
            : kind === "star"
              ? { starred: on }
              : { archived: true },
          async () => {
            const view = await client.thread(row.iri);
            const iris = view.messages.map((m) => m.iri);
            if (kind === "read") checkBatch(await client.markRead(iris, on));
            if (kind === "star") for (const iri of iris) await client.star(iri, on);
            if (kind === "archive") await archiveMessages(view.messages, row.iri);
          },
        ),
      ),
    );
  return { markRead, star, archive, forRows, refresh: invalidate };
}
