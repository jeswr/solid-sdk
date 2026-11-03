// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  StatusDot,
} from "@jeswr/suite-ui";
import { useEffect, useState } from "react";
import { formatRelativeTime } from "../lib/format";
import { useAgentClock, useAgentInvalidate, useAgentQuery, useAgentWorkspace } from "../lib/hooks";
import { loadedRecords, readControl, readHeartbeat } from "../lib/readers";
import { type AgentStatus, agentStatus } from "../lib/status";
import { createAgentVerifier } from "../lib/verify";
import { AgentControl } from "./agent-control";

/** Heartbeats land without a change notice on some sessions, so status re-reads on a timer. */
export const STATUS_REFRESH_MS = 30_000;
export function useDaemonStatus() {
  const { session, client } = useAgentWorkspace();
  const invalidate = useAgentInvalidate();
  useEffect(() => {
    const timer = setInterval(() => invalidate(client.paths.heartbeat, true), STATUS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [invalidate, client]);
  const now = useAgentClock();
  const query = useAgentQuery(session.storageUrl, async (c) => ({
    heartbeat: await readHeartbeat(c),
    controls: await readControl(c, createAgentVerifier(session)),
  }));
  const status = agentStatus({
    heartbeatAt: query.status === "ready" ? loadedRecords(query.data.heartbeat)[0]?.at : undefined,
    controls: query.status === "ready" ? loadedRecords(query.data.controls) : [],
    now,
    loading: query.status === "loading",
    owner: session.webId,
    controlsComplete: query.status !== "ready" || query.data.controls.complete,
  });
  return { ...status, query };
}
export function StatusPill({ status }: { status: AgentStatus }) {
  const labels = {
    running: "Agent running",
    paused: "Paused",
    stopped: "Stopped",
    offline: "Agent offline",
    unknown: status.controlLimit ? "Status unknown" : "Checking agent status",
  };
  const now = useAgentClock();
  return (
    <div className="agent-status">
      <AgentControl
        stopped={status.state === "stopped"}
        unknown={status.controlLimit === true}
        triggerLabel={`Agent status: ${labels[status.state]}`}
        trigger={
          <StatusDot
            status={
              status.state === "running"
                ? "success"
                : status.state === "stopped"
                  ? "warning"
                  : "neutral"
            }
            label={labels[status.state]}
          />
        }
      />
      {status.controlLimit && (
        <p role="status">Too many control records to check. Check the agent's computer.</p>
      )}
      {status.lastSeen && <small>last seen {formatRelativeTime(status.lastSeen, now)}</small>}
    </div>
  );
}
export function OfflineBanner({ status }: { status: AgentStatus }) {
  const [open, setOpen] = useState(false);
  if (status.state !== "offline") return null;
  return (
    <div className="agent-banner" role="status">
      <p>
        Your agent hasn't checked in since{" "}
        {status.lastSeen
          ? new Date(status.lastSeen).toLocaleString()
          : "its last recorded check-in"}
      </p>
      <Button variant="outline" onClick={() => setOpen(true)}>
        How to start it
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom">
          <SheetTitle>How to start your agent</SheetTitle>
          <SheetDescription>Run this command on the computer hosting your agent.</SheetDescription>
          <pre>awp run</pre>
        </SheetContent>
      </Sheet>
    </div>
  );
}
