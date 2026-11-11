// AUTHORED-BY Codex GPT-6.1-Sol
import type { Doc } from "yjs";
import type { DocumentVersionStore } from "../model/versions";

export function versionDisabledReason(
  saved: boolean,
  readOnly: boolean,
  online: boolean,
): string | undefined {
  if (!saved) return "Save this document to your pod before naming or restoring versions.";
  if (readOnly) return "Read-only documents cannot name or restore versions.";
  if (!online) return "Reconnect to name or restore versions.";
  return undefined;
}

const AUTOMATIC_INTERVAL = 30 * 60 * 1000;

/** A single outstanding automatic snapshot per runtime; errors never reject a save.
 * The newest version time is cached, so ordinary saves never re-read the history;
 * it is listed again only once a new automatic version could be due. */
export class AutomaticVersions {
  private pending: Promise<void> | undefined;
  /** undefined: not yet listed; null: no versions exist. */
  private latest: number | null | undefined;
  afterSave(
    store: DocumentVersionStore,
    doc: Doc,
    hasContent: boolean,
    creator: string,
    now = Date.now(),
  ): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = this.run(store, doc, hasContent, creator, now)
      .catch((error: unknown) => {
        console.warn("Automatic document version failed", error);
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  private async run(
    store: DocumentVersionStore,
    doc: Doc,
    hasContent: boolean,
    creator: string,
    now: number,
  ) {
    if (this.latest === null && !hasContent) return;
    if (typeof this.latest === "number" && now - this.latest < AUTOMATIC_INTERVAL) return;
    // Another collaborator may have saved a version meanwhile: confirm before writing.
    const newest = (await store.list())[0];
    this.latest = newest ? Date.parse(newest.created) : null;
    if (this.latest === null ? !hasContent : now - this.latest < AUTOMATIC_INTERVAL) return;
    const created = await store.create(doc, { kind: "automatic", creator, now: new Date(now) });
    this.latest = Date.parse(created.created);
  }
}
