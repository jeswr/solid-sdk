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

/** A single outstanding automatic snapshot per runtime; errors never reject a save. */
export class AutomaticVersions {
  private pending: Promise<void> | undefined;
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
    const latest = (await store.list())[0];
    if (latest ? now - Date.parse(latest.created) < 30 * 60 * 1000 : !hasContent) return;
    await store.create(doc, { kind: "automatic", creator, now: new Date(now) });
  }
}
