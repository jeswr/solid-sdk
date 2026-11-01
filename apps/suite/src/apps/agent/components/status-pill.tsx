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
import { useAgentQuery, useAgentWorkspace } from "../lib/hooks";
import { loadedRecords, readControl, readHeartbeat } from "../lib/readers";
import { type AgentStatus, agentStatus } from "../lib/status";

export function useDaemonStatus() {
  const { client, session } = useAgentWorkspace();
  const [now, setNow] = useState(Date.now);
  const query = useAgentQuery(client.paths.control, async (c) => ({
    heartbeat: await readHeartbeat(c),
    controls: await readControl(c),
  }));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const status = agentStatus({
    heartbeatAt: query.status === "ready" ? loadedRecords(query.data.heartbeat)[0]?.at : undefined,
    controls: query.status === "ready" ? loadedRecords(query.data.controls) : [],
    now,
    loading: query.status === "loading",
    owner: session.webId,
  });
  return { ...status, query };
}
export function StatusPill({ status }: { status: AgentStatus }) {
  const labels = {
    running: "Agent running",
    paused: "Paused",
    stopped: "Stopped",
    offline: "Agent offline",
    unknown: "Checking agent status",
  };
  const elapsed = status.lastSeen
    ? Math.max(0, Math.floor((Date.now() - Date.parse(status.lastSeen)) / 60_000))
    : undefined;
  return (
    <div className="agent-status">
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
      {status.lastSeen && (
        <small>last seen {elapsed === 0 ? "just now" : `${elapsed} minutes ago`}</small>
      )}
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
