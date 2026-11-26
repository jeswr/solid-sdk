// AUTHORED-BY Codex GPT-6.1-Sol
/** Successor connections keep the original pod resources and per-container run lock. */
export function connectorStorageId(adapterId: string): string {
  return adapterId === "google-health" ? "fitbit" : adapterId;
}
