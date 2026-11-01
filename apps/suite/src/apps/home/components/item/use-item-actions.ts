// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
"use client";
import { toast } from "@jeswr/suite-ui";
import { useEffect, useSyncExternalStore } from "react";
import { type DomainItem, nameFromUrl } from "../../lib/model/discovery";
import { itemTitle } from "../../state/presentation";
import { domainStore, type HomeSession } from "../../state/use-domain-items";
import { createDeleteController, UNDO_MS } from "./delete-controller";

type DeleteController = ReturnType<typeof createDeleteController>;
const controllers = new WeakMap<HomeSession, DeleteController>();
/** Controllers whose resumed deletions already have an Undo toast on this page. */
const announced = new WeakSet<DeleteController>();
const empty: ReadonlySet<string> = new Set();
const deleteFailed = () => toast.error("Couldn't delete this item. Please try again.");
/** Browser storage keeps only the address, never the item's title or content. */
const deletingMessage = (url: string) =>
  `Deleting ${nameFromUrl(url).replace(/\.(?:ttl|jsonld)$/i, "")}`;

export function deletionStore(session: HomeSession) {
  let controller = controllers.get(session);
  if (!controller) {
    const created = createDeleteController(
      session,
      () => domainStore(session).refresh(),
      deleteFailed,
      // A deletion another tab claimed and abandoned is this page's own again: offer Undo.
      (url, deleteAt) => offerUndo(created, url, deletingMessage(url), deleteAt - Date.now()),
    );
    controller = created;
    controllers.set(session, controller);
  }
  return controller;
}

/**
 * Show the Undo toast for a pending deletion and let it drive the deletion: Sonner pauses
 * its timer while the toast is hovered or focused, so the DELETE runs when the toast
 * closes (on its own or dismissed), never while its Undo button is still on screen. If
 * the deletion starts some other way, the toast is dismissed; a late Undo says so.
 */
export function offerUndo(
  controller: DeleteController,
  url: string,
  message: string,
  duration = UNDO_MS,
): void {
  let id: string | number | undefined;
  const release = () => controller.release(url);
  if (
    !controller.hold(url, () => {
      if (id !== undefined) toast.dismiss(id);
    })
  )
    return;
  id = toast.success(message, {
    duration: Math.max(1, duration),
    onAutoClose: release,
    onDismiss: release,
    action: {
      label: "Undo",
      onClick: () => {
        void controller
          .undo(url)
          .then((undone) => {
            if (!undone) toast.error("Too late to undo");
          })
          .catch(() => toast.error("Couldn't restore this item. Please try again."));
      },
    },
  });
}

/** Offer Undo, once per page, for deletions resumed from before a reload. */
export function offerResumedUndo(controller: DeleteController, now = Date.now()): void {
  if (announced.has(controller)) return;
  announced.add(controller);
  for (const entry of controller.pendingDeletes())
    if (entry.resumed)
      offerUndo(controller, entry.url, deletingMessage(entry.url), entry.deleteAt - now);
}

export function useItemActions(session: HomeSession) {
  const controller = deletionStore(session);
  const hidden = useSyncExternalStore(controller.subscribe, controller.getSnapshot, () => empty);
  useEffect(() => {
    // After mount, so the page's toaster is listening.
    const timer = setTimeout(() => offerResumedUndo(controller), 0);
    return () => clearTimeout(timer);
  }, [controller]);
  return {
    hidden,
    deleteItem: async (item: DomainItem, afterDelete?: () => void) => {
      try {
        const removed = await controller.remove(item, deleteFailed);
        if (!removed) {
          toast.error("This item can't be deleted");
          return;
        }
        offerUndo(controller, item.url, `Deleted ${itemTitle(item)}`);
        afterDelete?.();
      } catch {
        deleteFailed();
      }
    },
  };
}
