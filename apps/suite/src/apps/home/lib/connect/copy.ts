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
};
export function scopeLabel(scope: string): string {
  return scopeLabels[scope] ?? "Service data";
}
