// AUTHORED-BY Codex
"use client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@jeswr/suite-ui";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { AccessChange, AccessChoice, ConfirmAccess } from "../lib/client/access";
import { nameOf } from "../lib/client/client";

interface Pending {
  id: number;
  change: AccessChange;
  resolve: (choice: AccessChoice) => void;
}
/** Queue confirmations across drag/drop, dialogs, paste and reverse moves. */
export function useAccessConfirmation() {
  const queue = useRef<Pending[]>([]);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const [pending, setPending] = useState<Pending>();
  const cancel = useRef<HTMLButtonElement>(null);
  const confirmAccess: ConfirmAccess = useCallback(
    (change) =>
      new Promise((resolve) => {
        if (!mounted.current) {
          resolve("cancel");
          return;
        }
        const next = { change, resolve, id: ++sequence.current };
        queue.current.push(next);
        setPending(queue.current[0]);
      }),
    [],
  );
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const request of queue.current.splice(0)) request.resolve("cancel");
    };
  }, []);
  const settle = (choice: AccessChoice) => {
    if (!pending || queue.current[0] !== pending) return;
    queue.current.shift();
    pending.resolve(choice);
    setPending(queue.current[0]);
  };
  const dialog = (
    <AlertDialog
      open={!!pending}
      onOpenChange={(open) => {
        if (!open) settle("cancel");
      }}
    >
      <AlertDialogContent
        key={pending?.id}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Change who can access?</AlertDialogTitle>
          <AlertDialogDescription>
            Moving {pending && nameOf(pending.change.from)} may give access to:{" "}
            {pending?.change.gains.join("; ")}. Choose whether to use the destination’s access or
            keep current access.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancel} onClick={() => settle("cancel")}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction disabled={!pending?.change.canKeep} onClick={() => settle("keep")}>
            Move and keep current access
          </AlertDialogAction>
          <AlertDialogAction onClick={() => settle("move")}>Move</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { confirmAccess, dialog };
}
