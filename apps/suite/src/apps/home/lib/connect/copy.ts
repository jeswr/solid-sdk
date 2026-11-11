// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { IntegrationError } from "@jeswr/pod-connectors";
export function connectorErrorCopy(error: unknown, service: string): string {
  if (
    error instanceof IntegrationError &&
    !/(?:https?:|urn:|[/\\]|RDF|container|Type Index)/i.test(error.message)
  )
    return error.message;
  return `Couldn't import your ${service} data. Please try again.`;
}
export function addedCopy(count: number, domain: string): string {
  return `Added ${count} ${count === 1 ? "item" : "items"} to ${domain}`;
}
export function skippedCopy(count: number): string {
  if (!count) return "";
  return count === 1
    ? "1 item couldn't be read and was skipped"
    : `${count} items couldn't be read and were skipped`;
}
export function progressCopy(count: number, total?: number, collection = "items"): string {
  return total === undefined
    ? `Imported ${count} ${collection}`
    : `Imported ${count} of ${total} ${collection}`;
}
/** Most adapters report steps (`done` completed of `total`): name the step in progress, never a
 * count of data. Item-counting adapters (Gmail, Google Drive, Contacts) only send a total in
 * their final `done === total` report, so a finished or empty total reads as neutral copy. */
export function stepCopy(done: number, total: number): string {
  if (!Number.isFinite(total) || total < 1 || !(done < total)) return "Finishing…";
  const steps = Math.ceil(total);
  return `Step ${Math.min(steps, Math.max(1, Math.floor(done) + 1))} of ${steps}`;
}
export function relativeSync(value: string | undefined, now: number): string {
  const elapsed = value ? now - Date.parse(value) : Number.NaN;
  if (!Number.isFinite(elapsed)) return "Not synced yet";
  const minutes = Math.max(0, Math.floor(elapsed / 60000));
  if (!minutes) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `Synced ${days} ${days === 1 ? "day" : "days"} ago`;
}

const scopeLabels: Readonly<Record<string, string>> = {
  "user-top-read": "Your top music",
  "playlist-read-private": "Your private playlists",
  "playlist-read-collaborative": "Your shared playlists",
  "user-library-read": "Saved tracks",
  "user-follow-read": "Artists you follow",
  "user-read-recently-played": "Listening history",
  "read:user": "Your developer profile",
  repo: "Your repositories",
  read: "Your profile",
  "activity:read": "Your activities",
  identity: "Your profile",
  history: "Saved posts",
  mysubreddits: "Your communities",
  identify: "Your profile",
  guilds: "Your communities",
  "user:read:follows": "Channels you follow",
  "files.metadata.read": "Your file details",
  "account_info.read": "Your account details",
  "read:recovery": "Recovery and daily vitals",
  "read:cycles": "Daily activity and energy",
  "read:sleep": "Sleep and stages",
  "read:workout": "Workouts",
  offline: "Keep the connection available",
};
export function scopeLabel(scope: string): string {
  return scopeLabels[scope] ?? "Service data";
}
