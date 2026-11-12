// AUTHORED-BY Codex GPT-6.1-Sol
import { historyShard, loadMusic, MusicWriteError, type Playback, readHistory } from "../model";
import { recordPlay } from "./history";
import { musicRoot } from "./library";

export const SOLID_SUITE_AGENT = "https://solid-suite.app/music";
/** Actual listening seconds, excluding paused time and seeking. Unknown lengths use 30 s. */
export function shouldRecordPlay(listened: number, duration: number | undefined): boolean {
  return (
    Number.isFinite(listened) &&
    listened >=
      Math.min(
        30,
        duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration / 2 : 30,
      )
  );
}
/** Stable occurrence IDs make retries safe, including a successful write with a lost response. */
export async function recordOwnedPlay(
  fetch: typeof globalThis.fetch,
  storage: string,
  play: Playback,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await recordPlay(fetch, storage, { ...play, agent: SOLID_SUITE_AGENT });
      return;
    } catch (error) {
      if (!(error instanceof MusicWriteError) || error.status !== 412) throw error;
      const doc = await loadMusic(fetch, historyShard(musicRoot(storage), play.startTime));
      if (
        readHistory(doc.dataset).some(
          (saved) =>
            saved.iri === play.iri &&
            saved.trackIri === play.trackIri &&
            saved.startTime.getTime() === play.startTime.getTime(),
        )
      )
        return;
      if (attempt >= 2) throw error;
    }
  }
}
