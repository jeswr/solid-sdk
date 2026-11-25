// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { isTriggerSlug, type TriggerSlug } from "@jeswr/solid-health-diary";
import { NS } from "@jeswr/suite-vocab";
import { LiteralAs, LiteralFrom, OptionalAs, OptionalFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { emptyHealthDocument } from "../model";
import { createHealthDataStore } from "./store";

export interface DiaryPreferences {
  enabled: boolean;
  trigger: TriggerSlug;
}
export const DEFAULT_DIARY_PREFERENCES: DiaryPreferences = { enabled: false, trigger: "gluten" };
class DiaryPreferenceFields extends TermWrapper {
  get enabled() {
    return (
      OptionalFrom.subjectPredicate(this, `${NS.HEALTH}diaryTrackIntolerance`, LiteralAs.boolean) ??
      false
    );
  }
  set enabled(value: boolean) {
    OptionalAs.object(this, `${NS.HEALTH}diaryTrackIntolerance`, value, LiteralFrom.boolean);
  }
  get trigger() {
    return (
      OptionalFrom.subjectPredicate(this, `${NS.HEALTH}diaryTriggerClass`, LiteralAs.string) ??
      "gluten"
    );
  }
  set trigger(value: string) {
    OptionalAs.object(this, `${NS.HEALTH}diaryTriggerClass`, value, LiteralFrom.string);
  }
}
/** Preferences share Health's privacy and conditional-write store. Unreadable data is never replaced. */
export function createDiaryPreferencesStore(
  fetch: typeof globalThis.fetch,
  storage: string,
  owner: string,
) {
  const store = createHealthDataStore(fetch, storage, owner);
  const url = `${store.base}diary-settings.ttl`;
  async function document() {
    try {
      return await store.read(url);
    } catch (error) {
      if (error instanceof RdfFetchError && error.status === 404)
        return { document: emptyHealthDocument(), etag: null, missing: true };
      throw error;
    }
  }
  async function read(): Promise<DiaryPreferences> {
    const loaded = await document();
    const fields = new DiaryPreferenceFields(`${url}#it`, loaded.document, DataFactory);
    if (!isTriggerSlug(fields.trigger)) throw new TypeError("Invalid diary trigger class");
    return { enabled: fields.enabled, trigger: fields.trigger };
  }
  async function save(preferences: DiaryPreferences) {
    if (typeof preferences.enabled !== "boolean" || !isTriggerSlug(preferences.trigger))
      throw new TypeError("Invalid diary preferences");
    const loaded = await document();
    // A present resource without a strong ETag must never be treated as a create.
    if (!("missing" in loaded) && loaded.etag === null)
      throw new TypeError("Refresh diary settings before saving");
    const fields = new DiaryPreferenceFields(`${url}#it`, loaded.document, DataFactory);
    fields.enabled = preferences.enabled;
    fields.trigger = preferences.trigger;
    await store.initialize();
    await store.write(
      url,
      loaded.document,
      "missing" in loaded ? { create: true } : { etag: loaded.etag as string },
    );
    return preferences;
  }
  return { read, save, url };
}
