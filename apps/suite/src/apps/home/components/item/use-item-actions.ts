// AUTHORED-BY Codex GPT-6
"use client";
import { toast } from "@jeswr/suite-ui";
import { useSyncExternalStore } from "react";
import type { DomainItem } from "../../lib/model/discovery";
import { itemTitle } from "../../state/presentation";
import { domainStore, type HomeSession } from "../../state/use-domain-items";
import { createDeleteController, UNDO_MS } from "./delete-controller";

const controllers = new WeakMap<HomeSession, ReturnType<typeof createDeleteController>>();
const empty: ReadonlySet<string> = new Set();
export function deletionStore(session: HomeSession) {
  let controller = controllers.get(session);
  if (!controller) {
    controller = createDeleteController(session, () => domainStore(session).refresh());
    controllers.set(session, controller);
  }
  return controller;
}
export function useItemActions(session: HomeSession) {
  const controller = deletionStore(session);
  const hidden = useSyncExternalStore(controller.subscribe, controller.getSnapshot, () => empty);
  return {
    hidden,
    deleteItem: async (item: DomainItem, afterDelete?: () => void) => {
      try {
        const removed = await controller.remove(item, () =>
          toast.error("Couldn't delete this item. Please try again."),
        );
        if (!removed) {
          toast.error("This item can't be deleted");
          return;
        }
        toast.success(`Deleted ${itemTitle(item)}`, {
          duration: UNDO_MS,
          action: {
            label: "Undo",
            onClick: () => {
              void controller
                .undo(item.url)
                .catch(() => toast.error("Couldn't restore this item. Please try again."));
            },
          },
        });
        afterDelete?.();
      } catch {
        toast.error("Couldn't delete this item. Please try again.");
      }
    },
  };
}
