// AUTHORED-BY Codex GPT-6.1-Sol
import type { ChangeEvent, FileActivity } from "./types";
import { isText, requireValid, validateTime, validateUrl } from "./validation";

/** Validate and detach input records before ordering; exact event replays are ignored. */
export function orderedEvents(events: readonly ChangeEvent[]): ChangeEvent[] {
  requireValid(Array.isArray(events), "invalid-events");
  const unique = new Map<string, ChangeEvent>();
  for (const event of events) {
    requireValid(
      typeof event === "object" && event !== null && !Array.isArray(event),
      "invalid-event",
    );
    requireValid(isText(event.id) && isText(event.fileId), "invalid-event");
    requireValid(event.kind === "resource" || event.kind === "container", "invalid-event");
    requireValid(
      ["created", "updated", "moved", "deleted", "shared"].includes(event.type),
      "invalid-event",
    );
    validateUrl(event.url);
    validateUrl(event.actor, true);
    validateTime(event.at);
    const base = {
      id: event.id,
      fileId: event.fileId,
      url: event.url,
      kind: event.kind,
      actor: event.actor,
      at: event.at,
    };
    let copy: ChangeEvent;
    if (event.type === "moved") {
      validateUrl(event.fromUrl);
      requireValid(event.fromUrl !== event.url, "inconsistent-history");
      copy = { ...base, type: event.type, fromUrl: event.fromUrl };
    } else {
      requireValid(!("fromUrl" in event), "invalid-event");
      copy = { ...base, type: event.type };
    }
    const previous = unique.get(event.id);
    requireValid(
      !previous || JSON.stringify(previous) === JSON.stringify(copy),
      "conflicting-event",
    );
    unique.set(event.id, copy);
  }
  // ECMAScript stable sort makes equal timestamps follow the supplied stream order.
  return [...unique.values()].sort((a, b) => a.at - b.at);
}

/** Fold a complete supplied stream. Partial histories are supported, but never guessed. */
export function foldActivity(events: readonly ChangeEvent[]): Map<string, FileActivity> {
  const files = new Map<string, FileActivity>();
  const occupants = new Map<string, string>();
  for (const event of orderedEvents(events)) {
    const previous = files.get(event.fileId);
    const source = event.type === "moved" ? event.fromUrl : event.url;
    if (previous) {
      requireValid(
        !previous.deleted &&
          event.type !== "created" &&
          previous.kind === event.kind &&
          previous.url === source,
        "inconsistent-history",
      );
    }
    const sourceOccupant = occupants.get(source);
    const destinationOccupant = occupants.get(event.url);
    requireValid(
      (sourceOccupant === undefined || sourceOccupant === event.fileId) &&
        (destinationOccupant === undefined || destinationOccupant === event.fileId),
      "inconsistent-history",
    );
    occupants.delete(source);
    if (event.type !== "deleted") occupants.set(event.url, event.fileId);
    files.set(event.fileId, {
      fileId: event.fileId,
      url: event.url,
      kind: event.kind,
      deleted: event.type === "deleted",
      lastActivityAt: event.at,
      events: [...(previous?.events ?? []), event],
    });
  }
  return files;
}

/** Latest activity first; stable file ID breaks ties independently of input order. */
export function recentFiles(events: readonly ChangeEvent[], limit = 50): FileActivity[] {
  requireValid(Number.isInteger(limit) && limit >= 0 && limit <= 50, "invalid-limit");
  return [...foldActivity(events).values()]
    .filter((file) => !file.deleted && file.kind === "resource")
    .sort((a, b) =>
      a.lastActivityAt !== b.lastActivityAt
        ? b.lastActivityAt - a.lastActivityAt
        : a.fileId < b.fileId
          ? -1
          : 1,
    )
    .slice(0, limit);
}
