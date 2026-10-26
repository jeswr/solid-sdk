// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { z } from "zod";
import { advanceReadMarker, type ReadMarker } from "../unread";
import { roomContainer } from "./paths";
import { isoDate } from "./validation";

/** Passed to the later preference hook; persistence, caching and account selection stay outside the model. */
export const CHAT_READ_PREFERENCE_KEY = "chat.lastRead";
export const readPreferencesSchema = z.array(
  z
    .object({
      roomId: z.url({ protocol: /^https?$/ }),
      lastRead: z.number().int().min(-62_135_596_800_000).max(253_402_300_799_999).nullable(),
    })
    .strict(),
);
export type ReadPreferences = z.infer<typeof readPreferencesSchema>;
export function markRoomRead(
  preferences: ReadPreferences,
  room: string,
  at: Date,
): ReadPreferences {
  readPreferencesSchema.parse(preferences);
  isoDate(at);
  const roomId = roomContainer(room);
  let marker: ReadMarker = { roomId, lastRead: at.getTime() };
  const rest: ReadPreferences = [];
  for (const current of preferences) {
    if (current.roomId === roomId) marker = advanceReadMarker(marker, current);
    else rest.push({ ...current });
  }
  return [...rest, marker].sort((a, b) => a.roomId.localeCompare(b.roomId));
}
export type { ReadMarker, UnreadSnapshot } from "../unread";
export { advanceReadMarker, countUnread } from "../unread";
