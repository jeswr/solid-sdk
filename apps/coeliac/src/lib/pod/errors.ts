// AUTHORED-BY Codex GPT-6.1-Sol
import { StorageError } from "@jeswr/storage-client";

/** Keep SDK diagnostics in the error, and short stable messages in the UI/outbox. */
export function podErrorMessage(error: unknown): string {
  if (error instanceof StorageError) {
    if (error.status !== null) return `HTTP ${error.status}`;
    switch (error.code) {
      case "network": return "Failed to fetch";
      case "scope": return "Storage location is outside this pod";
      case "unsupported": return "Unsupported storage operation";
      case "invalid-response": return "Invalid response from pod";
      case "not-rdf": return "Invalid RDF response from pod";
      case "bad-request": return "Invalid storage request";
      default: return "Pod operation failed";
    }
  }
  // Discovery errors arrive through createPodClient; no direct capabilities dependency.
  if (error instanceof Error && error.name === "CapabilitiesError") {
    if ("status" in error && typeof error.status === "number") return `HTTP ${error.status}`;
    return "code" in error && error.code === "network"
      ? "Failed to fetch" : "Couldn't discover pod storage";
  }
  return error instanceof Error ? error.message : "Pod operation failed";
}
