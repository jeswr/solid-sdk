// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { ErrorState, LoadingSkeleton } from "@jeswr/suite-ui";
import { Screen } from "./states";
import { StatusPill, useDaemonStatus } from "./status-pill";
export function SettingsScreen() {
  const status = useDaemonStatus();
  return (
    <Screen title="Settings">
      <h2>Agent status</h2>
      {status.query.status === "loading" ? (
        <LoadingSkeleton />
      ) : status.query.status === "error" ? (
        <ErrorState error="unreachable" actions={{ retry: status.query.reload }} />
      ) : (
        <StatusPill status={status} />
      )}
      <article className="agent-card">
        <h2>Working hours</h2>
        <p>Working hours and quiet hours are coming soon.</p>
        <p>Your agent currently follows the schedule set on its host.</p>
      </article>
    </Screen>
  );
}
