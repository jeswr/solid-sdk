// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { loadHistory } from "@/apps/music/lib/data/history";
import type { PodSession } from "@/lib/session/pod-session";

export async function readMusicHistory(session: PodSession, range: { start: Date; end: Date }) {
  const months =
    (range.end.getUTCFullYear() - range.start.getUTCFullYear()) * 12 +
    range.end.getUTCMonth() -
    range.start.getUTCMonth() +
    1;
  const history = await loadHistory(session.fetch, session.storageUrl, range.end, months);
  return [...new Map(history.map((play) => [play.iri, play])).values()];
}
export { ensureSample as seedMusic } from "@/apps/music/demo/sample";
export { loadMusic, saveMusic } from "@/apps/music/lib/model/io";
