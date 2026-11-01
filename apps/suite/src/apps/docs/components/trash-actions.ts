// AUTHORED-BY Codex
import { toast } from "@jeswr/suite-ui";
import type { PodSession } from "@/lib/session/pod-session";
import type { BatchResult } from "../../drive/lib/operations/operations";
import { deleteDocument, restoreDocument } from "../editor/operations";

function completed<T>(result: BatchResult<T>, failure: string): boolean {
  for (const warning of result.warnings ?? []) toast.error(warning.message);
  if (result.failed.length || !result.done.length) toast.error(failure);
  return !!result.done.length && !result.failed.length && !result.warnings?.length;
}
/** Both Docs entry points report the whole batch and retain its records for Undo. */
export async function trashDocumentWithUndo(
  url: string,
  session: PodSession,
  onRestored: (restoredUrl: string | undefined) => void | Promise<void>,
): Promise<boolean> {
  const result = await deleteDocument(url, session);
  if (
    !completed(
      result,
      "Couldn't move the whole document to trash. Open Drive Trash to recover any moved items.",
    )
  )
    return false;
  toast("Moved to trash", {
    duration: 8000,
    action: {
      label: "Undo",
      onClick: async () => {
        try {
          const restored = await restoreDocument(result.done, session);
          const complete = completed(
            restored,
            "Couldn't restore the whole document. Open Drive Trash to recover the remaining items.",
          );
          if (complete) toast.success("Restored document");
          // Restore may allocate a new name when the original URL is occupied.
          // Only a complete restore supplies a document that can be reopened.
          await onRestored(
            complete ? restored.done.find(({ entry }) => entry.original === url)?.url : undefined,
          );
        } catch {
          toast.error("Couldn't restore the document. Open Drive Trash to try again.");
        }
      },
    },
  });
  return true;
}
