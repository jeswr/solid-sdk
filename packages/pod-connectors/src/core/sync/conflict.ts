// AUTHORED-BY Codex GPT-6.1-Sol
import type { ConflictPolicy } from "./types.js";

export const DEFAULT_SKEW_GUARD_MS = 120_000;
/** Missing/ambiguous server times fail closed to manual; ties never silently discard an edit. */
export function resolveConflict(
  policy: ConflictPolicy = "lww",
  remoteModified?: string,
  podModified?: string,
  skewGuardMs = DEFAULT_SKEW_GUARD_MS,
): "remote" | "pod" | "manual" {
  if (!Number.isSafeInteger(skewGuardMs) || skewGuardMs < 0)
    throw new RangeError("Invalid skew guard.");
  if (policy === "remote-wins") return "remote";
  if (policy === "pod-wins") return "pod";
  if (policy === "manual") return "manual";
  if (policy !== "lww") throw new Error("Invalid conflict policy.");
  const remote = Date.parse(remoteModified ?? "");
  const pod = Date.parse(podModified ?? "");
  if (!Number.isFinite(remote) || !Number.isFinite(pod) || Math.abs(remote - pod) <= skewGuardMs)
    return "manual";
  return remote > pod ? "remote" : "pod";
}
