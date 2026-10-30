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
import { useDialogFocus } from "../hooks/use-dialog-focus";
export function DeleteDialog({
  open,
  busy,
  onOpenChange,
  onConfirm,
  focusFallback,
}: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  focusFallback?: () => HTMLElement | null;
}) {
  const focus = useDialogFocus(focusFallback);
  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent {...focus}>
        <AlertDialogHeader>
          <AlertDialogTitle>Move this document to trash?</AlertDialogTitle>
          <AlertDialogDescription>
            The document, its versions and images will be kept in Trash and can be restored.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {busy && <p role="status">Moving to trash…</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            Move to trash
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
