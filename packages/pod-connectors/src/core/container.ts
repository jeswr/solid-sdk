// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { assertWithinPodScope } from "@jeswr/guarded-fetch";

/** Successor connections keep the original pod resources and per-container run lock. */
export function connectorStorageId(adapterId: string): string {
  return adapterId === "google-health" ? "fitbit" : adapterId;
}

/**
 * Where a connector's checkpoint lives, for every state writer (CLI and scheduler):
 * `integrations/<container>/state.json`, or `state-<id>.json` for a successor connector
 * that writes into its predecessor's container (Google Health → `integrations/fitbit/`).
 */
export function connectorStateLocation(
  podRoot: string,
  adapterId: string,
): { readonly root: string; readonly file: string; readonly url: string } {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(adapterId)) throw new Error("Invalid connector id");
  const storage = connectorStorageId(adapterId);
  const root = assertWithinPodScope(podRoot, new URL(`integrations/${storage}/`, podRoot).href, {
    allowRoot: false,
  });
  const file = storage === adapterId ? "state.json" : `state-${adapterId}.json`;
  return { root, file, url: assertWithinPodScope(root, new URL(file, root).href) };
}
