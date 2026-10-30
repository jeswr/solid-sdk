// AUTHORED-BY Codex
import { SolidPersistence } from "@jeswr/y-solid";
import { mergeUpdates } from "yjs";

/** Compaction output must pass through sync's validated, echo-free application.
 * The SDK's compact() marks that output known without applying unseen inputs. */
export class DocumentProvider extends SolidPersistence {
  override async compact() {
    if (this.destroyed) return undefined;
    await this.flush();
    const stored = await this.store.loadUpdates();
    const created =
      stored.length > 1
        ? await this.store.compact(
            mergeUpdates(stored.map(({ update }) => update)),
            stored.map(({ url }) => url),
          )
        : undefined;
    await this.sync();
    return created;
  }
}
