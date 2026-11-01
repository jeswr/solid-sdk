// AUTHORED-BY Codex GPT-6.1-Sol
import type { ControlStatement } from "@jeswr/agent-model";
export interface AgentStatus {
  state: "running" | "paused" | "stopped" | "offline" | "unknown";
  lastSeen?: string;
}
export function agentStatus({
  heartbeatAt,
  controls,
  now,
  loading = false,
  owner,
}: {
  heartbeatAt?: string | undefined;
  controls: readonly ControlStatement[];
  now: number;
  loading?: boolean;
  owner?: string;
}): AgentStatus {
  if (loading) return { state: "unknown" };
  const latest = controls
    .filter(
      (c) =>
        (c.kind === "Halt" || c.kind === "Resume") &&
        Date.parse(c.expires) > now &&
        Date.parse(c.createdAt) <= now &&
        (owner === undefined || c.attributedTo === owner),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const seen = heartbeatAt === undefined ? {} : { lastSeen: heartbeatAt };
  if (latest?.kind === "Halt") return { state: "stopped", ...seen };
  const at = Date.parse(heartbeatAt ?? "");
  return {
    state: !Number.isFinite(at) || now - at > 120_000 || at > now ? "offline" : "running",
    ...seen,
  };
}
