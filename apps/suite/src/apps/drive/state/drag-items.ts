// AUTHORED-BY Codex
import type { DriveClient, DriveItem } from "../lib/client/client";

export const DRIVE_ITEMS_TYPE = "application/x-solid-drive-items";

// The browser carries only an opaque token. Keep validators and synchronous
// discovery assertions together, scoped to the client that started the drag.
const captures = new WeakMap<
  DriveClient,
  { readonly token: string; readonly items: readonly DriveItem[] }
>();

export function captureDragItems(client: DriveClient, items: readonly DriveItem[]): string {
  const token = crypto.randomUUID();
  captures.set(client, { token, items: items.map((item) => Object.freeze({ ...item })) });
  return token;
}

/** A listing refresh or drop-time read cannot replace the drag's confirmation. */
export function takeDragItems(client: DriveClient, token: string): readonly DriveItem[] {
  const captured = captures.get(client);
  if (!captured || captured.token !== token) return [];
  captures.delete(client);
  return captured.items;
}

export function clearDragItems(client: DriveClient): void {
  captures.delete(client);
}
