// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { assertWithinPodScope, normalizePodBase } from "@jeswr/guarded-fetch";
import { ChatModelError, httpIri, isoDate, segment } from "./validation";

export function roomContainer(value: string): string {
  const parsed = new URL(httpIri(value));
  if (parsed.search || parsed.hash) throw new ChatModelError("invalid-input");
  return normalizePodBase(value);
}
export function roomIndex(room: string): string {
  return `${roomContainer(room)}index.ttl`;
}
export function joinedRoomsUrl(storage: string): string {
  return assertWithinPodScope(roomContainer(storage), "chat/rooms.ttl");
}
/** UTC, zero padded; the instant's local timezone never changes its shard. */
export function dayKey(at: Date): string {
  return isoDate(at).slice(0, 10).replaceAll("-", "/");
}
export function dayUrl(room: string, at: Date): string {
  return `${roomContainer(room)}${dayKey(at)}.ttl`;
}
export function messageSubject(room: string, at: Date, id: string): string {
  return `${dayUrl(room, at)}#${segment(id)}`;
}
export function messageResource(room: string, subject: string): string {
  const target = new URL(httpIri(subject));
  const base = roomContainer(room);
  const url = assertWithinPodScope(base, subject);
  if (
    target.search ||
    !/^#[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(target.hash) ||
    !/^\d{4}\/\d{2}\/\d{2}\.ttl$/.test(url.slice(base.length, url.indexOf("#")))
  )
    throw new ChatModelError("invalid-input");
  target.hash = "";
  return target.href;
}
export interface DayPage {
  urls: string[];
  next: Date | null;
}
/** Bounded backwards pagination, inclusive of before and since. Empty days still consume budget. */
export function dayPage(room: string, before: Date, since: Date, days: number): DayPage {
  dayKey(before);
  dayKey(since);
  if (!Number.isSafeInteger(days) || days < 1 || days > 366)
    throw new ChatModelError("invalid-input");
  const cursor = new Date(`${isoDate(before).slice(0, 10)}T00:00:00Z`);
  const lower = dayKey(since);
  const urls: string[] = [];
  while (urls.length < days && cursor.getUTCFullYear() > 0 && dayKey(cursor) >= lower) {
    urls.push(dayUrl(room, cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return { urls, next: cursor.getUTCFullYear() > 0 && dayKey(cursor) >= lower ? cursor : null };
}
