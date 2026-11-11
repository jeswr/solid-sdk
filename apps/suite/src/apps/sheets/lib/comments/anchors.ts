// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { z } from "zod";
import type { Snapshot } from "../model/snapshot";
import type { StructuralEdit } from "../refs/model";
import { type CellAnchor, formatCellSelector, shiftCellAnchor } from "./selector";

const address = z.strictObject({ sheetId: z.string(), cell: z.string() }).refine((value) => {
  try {
    formatCellSelector({ ...value, deleted: false });
    return true;
  } catch {
    return false;
  }
});
export const commentAnchorsSchema = z.strictObject({
  version: z.literal(1),
  anchors: z.record(z.string().min(1), z.union([address, z.literal("deleted")])),
});
type Anchors = z.infer<typeof commentAnchorsSchema>["anchors"];
export interface DraftAnchor {
  current(): CellAnchor;
  commit(annotationId: string): void;
  dispose(): void;
}
export interface AnchorDeletions {
  revision: number;
  anchors: Record<string, { sheetId: string; cell: string }>;
  drafts: Record<string, CellAnchor>;
}

/** The selector is creation provenance; workbook state owns the current address. */
export function currentCommentAnchor(
  snapshot: Snapshot,
  id: string,
  selector: CellAnchor,
): CellAnchor {
  const value = snapshot.commentAnchors as z.infer<typeof commentAnchorsSchema> | undefined;
  const anchor = value?.anchors[id];
  return anchor === "deleted"
    ? { ...selector, deleted: true }
    : anchor
      ? { ...anchor, deleted: false }
      : selector;
}

/** Changes are synchronous engine state; only cell deletions need undo history. */
export class WorkbookCommentAnchors {
  private anchors: Anchors = {};
  private drafts = new Map<string, CellAnchor>();
  private publishedDrafts = new Map<string, string>();
  private revision = 0;
  constructor(snapshot: Snapshot) {
    this.load(snapshot);
  }
  load(snapshot: Snapshot) {
    ++this.revision;
    this.publishedDrafts.clear();
    this.anchors =
      snapshot.commentAnchors === undefined
        ? {}
        : commentAnchorsSchema.parse(snapshot.commentAnchors).anchors;
    // A draft from a discarded revision must never target a replacement cell.
    for (const [id, anchor] of this.drafts) this.drafts.set(id, { ...anchor, deleted: true });
  }
  snapshot(): { commentAnchors?: { version: 1; anchors: Anchors } } {
    return Object.keys(this.anchors).length
      ? { commentAnchors: { version: 1, anchors: structuredClone(this.anchors) } }
      : {};
  }
  register(anchors: Record<string, CellAnchor>) {
    let changed = false;
    for (const [id, anchor] of Object.entries(anchors)) {
      if (Object.hasOwn(this.anchors, id)) continue;
      changed = true;
      formatCellSelector(anchor);
      this.anchors[id] = anchor.deleted
        ? "deleted"
        : { sheetId: anchor.sheetId, cell: anchor.cell };
    }
    return changed;
  }
  track(anchor: CellAnchor): DraftAnchor {
    const id = crypto.randomUUID();
    this.drafts.set(id, { ...anchor });
    return {
      current: () => this.drafts.get(id) as CellAnchor,
      commit: (annotationId) => {
        this.register({ [annotationId]: this.drafts.get(id) as CellAnchor });
        // Existing undo entries still know this thread by its draft identity.
        this.publishedDrafts.set(id, annotationId);
      },
      dispose: () => {
        this.drafts.delete(id);
      },
    };
  }
  shift(edit: StructuralEdit): AnchorDeletions {
    const deleted: AnchorDeletions = { revision: this.revision, anchors: {}, drafts: {} };
    for (const [id, anchor] of Object.entries(this.anchors)) {
      if (anchor === "deleted") continue;
      const next = shiftCellAnchor({ ...anchor, deleted: false }, edit);
      if (next.deleted) deleted.anchors[id] = anchor;
      this.anchors[id] = next.deleted ? "deleted" : { sheetId: next.sheetId, cell: next.cell };
    }
    for (const [id, anchor] of this.drafts) {
      const next = shiftCellAnchor(anchor, edit);
      if (!anchor.deleted && next.deleted) deleted.drafts[id] = anchor;
      this.drafts.set(id, next);
    }
    return deleted;
  }
  revive(deleted: AnchorDeletions) {
    if (deleted.revision !== this.revision) return;
    for (const [id, anchor] of Object.entries(deleted.anchors)) {
      if (this.anchors[id] === "deleted") this.anchors[id] = anchor;
    }
    for (const [id, anchor] of Object.entries(deleted.drafts)) {
      if (this.drafts.get(id)?.deleted) this.drafts.set(id, anchor);
      const annotationId = this.publishedDrafts.get(id);
      if (annotationId && this.anchors[annotationId] === "deleted")
        this.anchors[annotationId] = { sheetId: anchor.sheetId, cell: anchor.cell };
    }
  }
}
