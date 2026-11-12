// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { MCP } from "@jeswr/mcp-connections";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
} from "@jeswr/suite-ui";
import { useEffect, useState } from "react";
import { boundedRead } from "@/lib/session/bounded-read";
import type { PodSession } from "@/lib/session/types";
import { dpvPurposeLabel } from "@/shell/lib/dpv-labels";
import { useOnline } from "@/shell/lib/use-online";
import {
  type AssistantConnection,
  connectionName,
  connectionStatus,
  disconnectConnection,
  listConnections,
} from "./connections";

type Result = Awaited<ReturnType<typeof listConnections>>;
export function ConnectedAssistants({
  session,
  onNames,
}: {
  session: PodSession;
  onNames?: (value: { session: PodSession; names: Record<string, string> }) => void;
}) {
  const online = useOnline();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    session: PodSession;
    attempt: number;
    result?: Result;
    error?: boolean;
  }>();
  const [selected, setSelected] = useState<{ session: PodSession; row: AssistantConnection }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!online) {
      onNames?.({ session, names: {} });
      return;
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
    let live = true;
    setState(undefined);
    onNames?.({ session, names: {} });
    void boundedRead(() => listConnections(session, signal), 10000, signal).then(
      (result) => {
        if (!live) return;
        setState({ session, attempt, result });
        // Use the newest connection name for a client, including previously disconnected rows.
        onNames?.({
          session,
          names: Object.fromEntries(
            [...result.rows].reverse().map(({ record }) => [record.client, connectionName(record)]),
          ),
        });
      },
      () => {
        if (live) setState({ session, attempt, error: true });
      },
    );
    return () => {
      live = false;
      controller.abort();
    };
  }, [session, attempt, online, onNames]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset account-bound dialog state on account and connectivity changes.
  useEffect(() => {
    setSelected(undefined);
    setError("");
    setBusy(false);
  }, [session, online]);
  const current = state?.session === session && state.attempt === attempt ? state : undefined;
  const rows = current?.result?.rows ?? [];
  const active = rows.filter(({ record }) => connectionStatus(record) === "Active");
  const previous = rows.filter(({ record }) => connectionStatus(record) !== "Active");
  const choice = selected?.session === session ? selected.row : undefined;
  // A session switch/offline transition aborts any pending edit and prevents stale UI updates.
  useEffect(() => {
    if (!busy || !choice || !online) return;
    let live = true;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
    void boundedRead(() => disconnectConnection(session, choice.url, signal), 10000, signal).then(
      () => {
        if (live) {
          setBusy(false);
          setSelected(undefined);
          setAttempt((value) => value + 1);
        }
      },
      () => {
        if (live) {
          setBusy(false);
          setError("Couldn't disconnect. Try again.");
        }
      },
    );
    return () => {
      live = false;
      controller.abort();
    };
  }, [busy, choice, online, session]);
  function list(items: AssistantConnection[], label: string) {
    return (
      <ul className="assistant-connections" aria-label={label}>
        {items.map((row) => {
          const { record } = row;
          const client = new URL(record.client);
          const cimd =
            client.protocol === "https:" &&
            !(
              client.origin === new URL(record.resource).origin &&
              client.pathname.startsWith("/clients/")
            );
          return (
            <li key={row.url}>
              <h3>{connectionName(record)}</h3>
              {!cimd && record.title && <small>Name given by the app</small>}
              <dl>
                <dt>Client ID</dt>
                <dd>{record.client}</dd>
                {record.redirectOrigin && (
                  <>
                    <dt>Redirect origin</dt>
                    <dd>{new URL(record.redirectOrigin).origin}</dd>
                  </>
                )}
                <dt>Server</dt>
                <dd>{new URL(record.resource).host}</dd>
                <dt>Connected</dt>
                <dd>
                  <time dateTime={record.created.toISOString()}>
                    {record.created.toISOString().slice(0, 10)}
                  </time>
                </dd>
                <dt>Last used</dt>
                <dd>{record.lastUsed?.toISOString().slice(0, 10) ?? "Not used yet"}</dd>
                <dt>Access</dt>
                <dd>{record.access === `${MCP}ReadOnly` ? "Read only" : "Read and write"}</dd>
                <dt>Personal data</dt>
                <dd>
                  {record.personalDataMode === `${MCP}OwnerPolicy`
                    ? "Owner policy"
                    : record.personalDataMode === `${MCP}Mandate`
                      ? "Mandate"
                      : "No personal data"}
                  {record.purposes?.length
                    ? ` · ${record.purposes.map((p) => dpvPurposeLabel(p) ?? "Other purpose").join(", ")}`
                    : ""}
                </dd>
                <dt>Status</dt>
                <dd>{connectionStatus(record)}</dd>
              </dl>
              {connectionStatus(record) === "Active" && (
                <Button
                  variant="outline"
                  disabled={!online || busy}
                  onClick={() => {
                    setError("");
                    setSelected({ session, row });
                  }}
                >
                  Disconnect {connectionName(record)}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <section aria-labelledby="connected-assistants">
      <h2 id="connected-assistants">Connected assistants</h2>
      {!online ? (
        <EmptyState
          variant="not-available-offline"
          body="Reconnect to manage connected assistants."
        />
      ) : !current ? (
        <LoadingSkeleton preset="list" label="Loading connected assistants" />
      ) : current.error ? (
        <ErrorState
          error="unreachable"
          actions={{ retry: () => setAttempt((value) => value + 1) }}
        />
      ) : (
        <>
          {!!current.result?.unreadable && (
            <p role="status">{current.result.unreadable} connection records couldn't be read.</p>
          )}
          {current.result?.truncated && (
            <p role="status">Showing the first 100 connection records.</p>
          )}
          {!rows.length && (
            <EmptyState
              title="No connected assistants"
              body="Assistants you connect with OAuth will appear here."
            />
          )}
          {!!active.length && list(active, "Active assistants")}
          {!!previous.length && (
            <>
              <h3>Previously connected</h3>
              {list(previous, "Previously connected assistants")}
            </>
          )}
        </>
      )}
      <AlertDialog
        open={!!choice && online}
        onOpenChange={(open) => {
          if (!open && !busy) setSelected(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect {choice ? connectionName(choice.record) : "assistant"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              It loses access to your pod immediately. You can connect it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p role="alert">{error}</p>}
          <AlertDialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setSelected(undefined)}>
              Cancel
            </Button>
            <Button disabled={busy || !online} onClick={() => setBusy(true)}>
              {busy ? "Disconnecting…" : "Disconnect"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
