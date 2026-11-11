// AUTHORED-BY Codex (GPT-6.1 Sol)
import { loadHistory } from "@/apps/music/lib/model/io";
import type { PodSession } from "@/lib/session/pod-session";

export function readMusicHistory(session: PodSession, range: { start: Date; end: Date }) {
  const months: Date[] = [];
  for (
    let at = new Date(Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth(), 1));
    at <= range.end;
    at = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))
  )
    months.push(at);
  return loadHistory(session.fetch, new URL("music/", session.storageUrl).href, months);
}
export { ensureSample as seedMusic } from "@/apps/music/demo/sample";
export { loadMusic, saveMusic } from "@/apps/music/lib/model/io";
