// AUTHORED-BY Codex GPT-6.1-Sol
import { createPodScopedFetch, refuseRedirects } from "@jeswr/guarded-fetch";
import {
  CHAT_READ_PREFERENCE_KEY,
  ChatIoError,
  markRoomRead,
  type ReadPreferences,
  readPreferencesSchema,
  roomContainer,
  strongEtag,
} from "../model";

/** Interim account-scoped JSON transport; replace this module when preferences ships. */
export class PreferencesStore {
  readonly url: string;
  private readonly fetch: typeof globalThis.fetch;
  constructor(fetch: typeof globalThis.fetch, storage: string) {
    const base = roomContainer(storage);
    this.url = `${base}settings/chat-preferences.json`;
    this.fetch = createPodScopedFetch(base, { fetch: refuseRedirects(fetch), maxRedirects: 0 });
  }
  async read(): Promise<{ data: ReadPreferences; etag: string | null }> {
    const response = await this.fetch(this.url);
    if (response.status === 404) return { data: [], etag: null };
    if (!response.ok) throw new ChatIoError(response.status, response.headers.get("etag"));
    const json = await response.json();
    return {
      data: readPreferencesSchema.parse(json[CHAT_READ_PREFERENCE_KEY]),
      etag: strongEtag(response.headers.get("etag")),
    };
  }
  async write(data: ReadPreferences, etag: string | null): Promise<void> {
    const validated = readPreferencesSchema.parse(data);
    const response = await this.fetch(this.url, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(etag === null ? { "if-none-match": "*" } : { "if-match": strongEtag(etag) }),
      },
      body: JSON.stringify({ [CHAT_READ_PREFERENCE_KEY]: validated }),
    });
    if (!response.ok) throw new ChatIoError(response.status, response.headers.get("etag"));
  }
  async markRead(room: string, at: Date): Promise<ReadPreferences> {
    const update = async () => {
      const current = await this.read();
      const data = markRoomRead(current.data, room, at);
      await this.write(data, current.etag);
      return data;
    };
    try {
      return await update();
    } catch (error) {
      if (!(error instanceof ChatIoError && error.status === 412)) throw error;
      return update();
    }
  }
}
