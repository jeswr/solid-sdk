// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, ErrorState, LoadingSkeleton } from "@jeswr/suite-ui";
import { AgentControl } from "./agent-control";
import { useApprovalDevice } from "./approval-key-setup-sheet";
import { Screen } from "./states";
import { StatusPill, useDaemonStatus } from "./status-pill";
export function SettingsScreen() {
  const status = useDaemonStatus();
  const device = useApprovalDevice();
  return (
    <Screen title="Settings">
      <h2>Agent status</h2>
      {status.query.status === "loading" && <LoadingSkeleton />}
      {status.query.status === "error" && (
        <ErrorState error="unreachable" actions={{ retry: status.query.reload }} />
      )}
      <StatusPill status={status} />
      <AgentControl
        stopped={status.ownerHalted === true}
        localStop={status.state === "stopped" && status.ownerHalted !== true}
      />
      <article className="agent-card">
        <h2>Approval key on this device</h2>
        <p>
          {device.status === "ready"
            ? "Key ready"
            : device.status === "none"
              ? "No key"
              : device.status === "checking"
                ? "Checking this device…"
                : "This device cannot approve"}
        </p>
        <Button variant="outline" onClick={device.setup}>
          {device.status === "unavailable"
            ? "Set up this device again"
            : device.status === "ready"
              ? "Set up a new key"
              : "Set up this device"}
        </Button>
      </article>
      <article className="agent-card">
        <h2>Working hours</h2>
        <p>Working hours and quiet hours are coming soon.</p>
        <p>Your agent currently follows the schedule set on its host.</p>
      </article>
    </Screen>
  );
}
