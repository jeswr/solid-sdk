// AUTHORED-BY Codex
import { SolidUpdateStore } from "@jeswr/y-solid";
import { applyUpdate, Doc } from "yjs";

class IncompleteLogError extends Error {}

/** Docs requires a complete load; a compactor may retire any listed resource. */
export class DocumentUpdateStore extends SolidUpdateStore {
  constructor(
    container: string,
    http: typeof fetch,
    private readonly checkActive: () => Promise<void>,
    private readonly allowEmpty: boolean,
    private readonly instanceId?: string,
  ) {
    super({ container, fetch: http });
  }
  override async readUpdate(url: string) {
    const update = await super.readUpdate(url);
    if (!update) throw new IncompleteLogError("An update disappeared during loading");
    return update;
  }
  override async loadUpdates() {
    for (let attempt = 0; ; attempt++) {
      try {
        const updates = await super.loadUpdates();
        if (!updates.length && !this.allowEmpty)
          throw new IncompleteLogError("The document's update log is empty");
        if (updates.length && this.instanceId) {
          const identity = new Doc();
          try {
            for (const { update } of updates) applyUpdate(identity, update);
            if (identity.getMap("document").get("instanceId") !== this.instanceId)
              throw new Error("The update log belongs to a different document");
          } finally {
            identity.destroy();
          }
        }
        return updates;
      } catch (error) {
        if (!(error instanceof IncompleteLogError) || attempt >= 2) throw error;
        // Relist the whole log. Never apply a partial listing or seed a snapshot.
      }
    }
  }
  override async appendUpdate(update: Uint8Array) {
    await this.checkActive();
    const result = await super.appendUpdate(update);
    // A pointer change racing the PUT must not count as a successful save.
    await this.checkActive();
    return result;
  }
}
