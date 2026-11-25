// AUTHORED-BY Codex GPT-6
import { createPodScopedFetch, readBoundedText } from "@jeswr/guarded-fetch";
import { type MusicPreferences, MusicWriteError, parsePreferences } from "../model";
import { musicRoot, requireEtag } from "./library";
export interface PreferencesSnapshot {
  value: MusicPreferences;
  etag: string | null;
}
export interface PreferencesStore {
  load(): Promise<PreferencesSnapshot>;
  save(current: PreferencesSnapshot, value: MusicPreferences): Promise<PreferencesSnapshot>;
}
/** Preferences are small; refuse bodies beyond this while streaming. */
const MAX_PREFERENCES_BYTES = 256 * 1024;

export function preferencesStore(
  fetch: typeof globalThis.fetch,
  storage: string,
): PreferencesStore {
  const scoped = createPodScopedFetch(storage, { fetch, maxRedirects: 0 });
  const url = new URL("preferences.json", musicRoot(storage)).href;
  return {
    async load() {
      const response = await scoped(url);
      if (response.status === 404) return { value: parsePreferences(null), etag: null };
      if (!response.ok) throw new MusicWriteError(response.status, response.headers.get("etag"));
      return {
        value: parsePreferences(JSON.parse(await readBoundedText(response, MAX_PREFERENCES_BYTES))),
        etag: requireEtag(response.headers.get("etag")),
      };
    },
    async save(current, value) {
      const checked = parsePreferences(value);
      const headers = new Headers({ "Content-Type": "application/json" });
      if (current.etag === null) headers.set("If-None-Match", "*");
      else headers.set("If-Match", requireEtag(current.etag));
      const response = await scoped(url, { method: "PUT", headers, body: JSON.stringify(checked) });
      if (!response.ok) throw new MusicWriteError(response.status, response.headers.get("etag"));
      return { value: checked, etag: requireEtag(response.headers.get("etag")) };
    },
  };
}
