// AUTHORED-BY Codex
import { SolidUpdateStore } from "@jeswr/y-solid";
import { applyUpdate, Doc } from "yjs";
import { DocumentReplacedError } from "./incarnation";

class IncompleteLogError extends Error {}
export class InactiveLogError extends Error {}

/** Validate each resource BEFORE merging: Y.Map conflict resolution can hide a
 * foreign identity in a merged log. Also check identities assembled by deltas. */
export function assertUpdateIdentities(updates: readonly Uint8Array[], instanceId?: string) {
  let expected: unknown = instanceId;
  const inspect = (parts: readonly Uint8Array[]) => {
    const identity = new Doc();
    try {
      for (const update of parts) applyUpdate(identity, update);
      const recorded = identity.getMap("document").get("instanceId");
      // Missing identity predates this guard; retain legacy and pending deltas.
      if (recorded !== undefined) {
        if (expected !== undefined && recorded !== expected)
          throw new Error("The update log belongs to a different document");
        expected = recorded;
      }
    } finally {
      identity.destroy();
    }
  };
  for (const update of updates) inspect([update]);
  if (updates.length > 1) inspect(updates);
}

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
  override async listUpdateUrls() {
    await this.checkActive();
    return super.listUpdateUrls();
  }
  override async readUpdate(url: string) {
    await this.checkActive();
    const update = await super.readUpdate(url);
    if (!update) throw new IncompleteLogError("An update disappeared during loading");
    await this.checkActive();
    // Incremental sync calls readUpdate directly, bypassing loadUpdates.
    assertUpdateIdentities([update], this.instanceId);
    return update;
  }
  override async loadUpdates() {
    for (let attempt = 0; ; attempt++) {
      try {
        const updates = await super.loadUpdates();
        if (!updates.length && !this.allowEmpty)
          throw new IncompleteLogError("The document's update log is empty");
        assertUpdateIdentities(
          updates.map(({ update }) => update),
          this.instanceId,
        );
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
    try {
      await this.checkActive();
    } catch (error) {
      if (error instanceof InactiveLogError || error instanceof DocumentReplacedError)
        await super.deleteUpdate(result.url).catch(() => {});
      throw error;
    }
    return result;
  }
}
