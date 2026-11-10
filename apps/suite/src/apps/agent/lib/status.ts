// AUTHORED-BY Codex GPT-6.1-Sol
import type { DisplayControl } from "./readers";
export interface AgentStatus {
  state: "running" | "paused" | "stopped" | "offline" | "unknown";
  lastSeen?: string;
  controlLimit?: boolean;
}
export function agentStatus({
  heartbeatAt,
  controls,
  now,
  loading = false,
  owner,
  controlsComplete = true,
}: {
  heartbeatAt?: string | undefined;
  controls: readonly DisplayControl[];
  now: number;
  loading?: boolean;
  owner?: string;
  controlsComplete?: boolean;
}): AgentStatus {
  if (loading) return { state: "unknown" };
  if (!controlsComplete) return { state: "unknown", controlLimit: true };
  const latest = controls
    .filter(
      (c) =>
        c.verification === "verified" &&
        (c.kind === "Halt" || c.kind === "Resume") &&
        Date.parse(c.expires) > now &&
        Date.parse(c.createdAt) <= now &&
        (owner === undefined || c.attributedTo === owner),
    )
    .sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.kind === "Halt" ? -1 : 1),
    )[0];
  const seen = heartbeatAt === undefined ? {} : { lastSeen: heartbeatAt };
  if (latest?.kind === "Halt") return { state: "stopped", ...seen };
  const at = Date.parse(heartbeatAt ?? "");
  return {
    state: !Number.isFinite(at) || now - at > 120_000 || at > now ? "offline" : "running",
    ...seen,
  };
}
