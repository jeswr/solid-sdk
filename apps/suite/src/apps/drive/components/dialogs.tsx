// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
"use client";
/**
 * Drive dialogs (04-drive §2.9): New folder, Rename (with the extension
 * prompt), Move to… (lazy folder tree), Delete for ever, Empty trash and the
 * upload conflict prompt. One `DriveDialogs` instance renders whichever the
 * UI state asks for.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@jeswr/suite-ui";
import { ChevronRight, Folder, HardDrive } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { type DriveItem, nameOf, parentOf } from "../lib/client/client";
import { formatFileSize } from "../lib/files";
import { getMoveValidity } from "../lib/list";
import { extensionChange, isHidden, validateName } from "../lib/operations/operations";
import { useDrive } from "../state/drive-context";
import { useDriveActions, useDriveUi } from "../state/ui";

export function DriveDialogs() {
  const { dialog, closeDialog } = useDriveUi();
  const onOpenChange = (open: boolean) => {
    if (!open) closeDialog();
  };
  return (
    <>
      <NameDialog
        open={dialog?.kind === "new-folder" || dialog?.kind === "rename"}
        onOpenChange={onOpenChange}
      />
      <MoveDialog open={dialog?.kind === "move"} onOpenChange={onOpenChange} />
      <TrashConfirmDialog
        open={dialog?.kind === "delete-forever" || dialog?.kind === "empty-trash"}
        onOpenChange={onOpenChange}
      />
      <UploadConflictDialog />
    </>
  );
}

function NameDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { dialog, closeDialog, restoreDialogFocus } = useDriveUi();
  const actions = useDriveActions();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const rename = dialog?.kind === "rename" ? dialog.item : undefined;
  const parent = dialog?.kind === "new-folder" ? dialog.parent : undefined;
  const initial = rename?.name ?? "Untitled folder";
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmExt, setConfirmExt] = useState<{ from: string; to: string }>();

  useEffect(() => {
    if (!open) return;
    setValue(initial);
    setError(undefined);
    setConfirmExt(undefined);
    // Select the stem so typing replaces the name but keeps the extension (§2.9).
    requestAnimationFrame(() => {
      const element = input.current;
      if (!element) return;
      element.focus();
      const dot = rename?.kind === "file" ? initial.lastIndexOf(".") : -1;
      element.setSelectionRange(0, dot > 0 ? dot : initial.length);
    });
  }, [open, initial, rename?.kind]);

  const commit = async (name: string) => {
    setBusy(true);
    if (rename) await actions.rename(rename, name);
    else if (parent) await actions.newFolder(parent, name);
    setBusy(false);
    closeDialog();
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validateName(value);
    if (problem) {
      setError(problem);
      return;
    }
    const name = value.trim();
    if (rename && name === rename.name) return closeDialog();
    const change = rename?.kind === "file" ? extensionChange(rename.name, name) : undefined;
    if (change?.from) {
      setConfirmExt(change);
      return;
    }
    await commit(name);
  };

  if (confirmExt && rename) {
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent onCloseAutoFocus={restoreDialogFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmExt.to
                ? `Change the file type to .${confirmExt.to}?`
                : "Remove the file type?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Apps may open the file differently after the change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={(event) => {
                event.preventDefault();
                const stem = value.trim().replace(/\.[^.]*$/, "");
                void commit(`${stem}.${confirmExt.from}`);
              }}
            >
              Keep .{confirmExt.from}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void commit(value.trim())}>Change</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="drv-dialog-sm" onCloseAutoFocus={restoreDialogFocus}>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{rename ? "Rename" : "New folder"}</DialogTitle>
            <DialogDescription className="sr-only">
              {rename ? `Enter a new name for ${rename.name}` : "Enter a name for the new folder"}
            </DialogDescription>
          </DialogHeader>
          <div className="drv-field">
            <Label htmlFor={inputId}>{rename ? "Name" : "Folder name"}</Label>
            <Input
              id={inputId}
              ref={input}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError(undefined);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${inputId}-error` : undefined}
              autoComplete="off"
            />
            {error ? (
              <p id={`${inputId}-error`} className="drv-field-error">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeDialog}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {rename ? "Rename" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface TreeNode {
  url: string;
  name: string;
  children?: TreeNode[];
}

function MoveDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { dialog, closeDialog, restoreDialogFocus } = useDriveUi();
  const { client, driveRoot } = useDrive();
  const actions = useDriveActions();
  const items = dialog?.kind === "move" ? dialog.items : [];
  const [nodes, setNodes] = useState<Record<string, TreeNode[] | "loading">>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<string>();
  const [busy, setBusy] = useState(false);
  const tree = useRef<HTMLDivElement>(null);

  const load = async (url: string) => {
    if (nodes[url]) return;
    setNodes((current) => ({ ...current, [url]: "loading" }));
    const children = await client.list(url).catch(() => []);
    setNodes((current) => ({
      ...current,
      [url]: children
        .filter((child) => child.kind === "folder" && !isHidden(child))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((child) => ({ url: child.url, name: child.name })),
    }));
  };

  useEffect(() => {
    if (!open || !driveRoot) return;
    setNodes({});
    setExpanded(new Set([driveRoot]));
    setTarget(undefined);
    void (async () => {
      setNodes({ [driveRoot]: "loading" });
      const children = await client.list(driveRoot).catch(() => []);
      setNodes({
        [driveRoot]: children
          .filter((child) => child.kind === "folder" && !isHidden(child))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((child) => ({ url: child.url, name: child.name })),
      });
    })();
  }, [open, driveRoot, client]);

  const validity = (url: string): { valid: true } | { valid: false; reason: string } => {
    if (items.length === 0) return { valid: false, reason: "none" };
    if (items.every((item) => parentOf(item.url) === url))
      return { valid: false, reason: "same-parent" };
    try {
      return getMoveValidity(
        items.map((item) => ({
          url: item.url,
          kind: item.kind === "folder" ? "container" : "resource",
        })),
        { url, kind: "container" },
      );
    } catch {
      return { valid: false, reason: "unsupported" };
    }
  };
  const targetValidity = target ? validity(target) : undefined;
  const canMove = targetValidity?.valid === true;

  const toggle = (url: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(url)) next.delete(url);
      else {
        next.add(url);
        void load(url);
      }
      return next;
    });
  };

  const visibleOrder = (): string[] => {
    if (!driveRoot) return [];
    const out: string[] = [];
    const walk = (url: string) => {
      out.push(url);
      const children = nodes[url];
      if (expanded.has(url) && Array.isArray(children))
        for (const child of children) walk(child.url);
    };
    walk(driveRoot);
    return out;
  };

  const onTreeKey = (event: KeyboardEvent) => {
    const order = visibleOrder();
    if (!target) {
      if (event.key === "ArrowDown" || event.key === "Home") {
        event.preventDefault();
        setTarget(order[0]);
      }
      return;
    }
    const index = order.indexOf(target);
    const go = (url: string | undefined) => {
      if (!url) return;
      event.preventDefault();
      setTarget(url);
      requestAnimationFrame(() =>
        tree.current?.querySelector<HTMLElement>(`[data-node="${CSS.escape(url)}"]`)?.focus(),
      );
    };
    if (event.key === "ArrowDown") go(order[index + 1]);
    else if (event.key === "ArrowUp") go(order[index - 1]);
    else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (!expanded.has(target)) toggle(target);
      else {
        const children = nodes[target];
        if (Array.isArray(children)) go(children[0]?.url);
      }
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (expanded.has(target) && target !== driveRoot) toggle(target);
      else if (target !== driveRoot) go(parentOf(target));
    } else if (event.key === "Home") go(order[0]);
    else if (event.key === "End") go(order[order.length - 1]);
  };

  const renderNode = (url: string, name: string, level: number) => {
    const children = nodes[url];
    const isOpen = expanded.has(url);
    const valid = validity(url).valid;
    return (
      <div
        key={url}
        role="treeitem"
        aria-level={level}
        aria-expanded={isOpen}
        aria-selected={target === url}
        aria-disabled={!valid || undefined}
        data-node={url}
        tabIndex={target === url || (!target && level === 1) ? 0 : -1}
        className="drv-tree-item"
        onClick={(event) => {
          event.stopPropagation();
          setTarget(url);
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" && canMove) {
            event.preventDefault();
            void submit();
          }
        }}
      >
        <span className="drv-tree-row" style={{ paddingInlineStart: `${(level - 1) * 16 + 4}px` }}>
          <button
            type="button"
            tabIndex={-1}
            className="drv-tree-twisty"
            aria-label={isOpen ? `Collapse ${name}` : `Expand ${name}`}
            data-open={isOpen || undefined}
            onClick={(event) => {
              event.stopPropagation();
              toggle(url);
            }}
          >
            <ChevronRight aria-hidden="true" size={16} />
          </button>
          {level === 1 ? (
            <HardDrive aria-hidden="true" size={16} />
          ) : (
            <Folder aria-hidden="true" size={16} />
          )}
          <span>{name}</span>
        </span>
        {isOpen ? (
          // biome-ignore lint/a11y/useSemanticElements: ARIA tree group, not a form fieldset
          <div role="group">
            {children === "loading" || children === undefined ? (
              <div className="drv-tree-loading">Loading…</div>
            ) : (
              children.map((child) => renderNode(child.url, child.name, level + 1))
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const submit = async () => {
    if (!target || !canMove) return;
    setBusy(true);
    await actions.move(items, target);
    setBusy(false);
    closeDialog();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="drv-dialog-md" onCloseAutoFocus={restoreDialogFocus}>
        <DialogHeader>
          <DialogTitle>
            Move {items.length === 1 ? `"${items[0]?.name}"` : `${items.length} items`}
          </DialogTitle>
          <DialogDescription>
            {target
              ? `To ${target === driveRoot ? "My Drive" : nameOf(target)}`
              : "Choose a folder"}
          </DialogDescription>
        </DialogHeader>
        {driveRoot ? (
          <div
            ref={tree}
            role="tree"
            aria-label="Folders"
            className="drv-tree"
            onKeyDown={onTreeKey}
          >
            {renderNode(driveRoot, "My Drive", 1)}
          </div>
        ) : null}
        {targetValidity && !targetValidity.valid ? (
          <p className="drv-field-error" role="status">
            {targetValidity.reason === "same-parent"
              ? "The items are already in this folder"
              : targetValidity.reason === "unsupported"
                ? "These items can't be moved here"
                : "A folder can't be moved into itself"}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={closeDialog}>
            Cancel
          </Button>
          <Button type="button" disabled={!canMove || busy} onClick={() => void submit()}>
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TrashConfirmDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { dialog, closeDialog, restoreDialogFocus } = useDriveUi();
  const actions = useDriveActions();
  const entries =
    dialog?.kind === "delete-forever" || dialog?.kind === "empty-trash" ? dialog.entries : [];
  const total = entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
  const empty = dialog?.kind === "empty-trash";
  const first = entries[0];
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent onCloseAutoFocus={restoreDialogFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {empty
              ? "Empty trash?"
              : entries.length === 1 && first
                ? `Delete ${first.name} for ever?`
                : `Delete ${entries.length} items for ever?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {empty
              ? `${entries.length} ${entries.length === 1 ? "item" : "items"} (${formatFileSize(total)}) will be deleted for ever.`
              : "This can't be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              closeDialog();
              void actions.removeForever(entries);
            }}
          >
            {empty ? "Empty trash" : "Delete for ever"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function UploadConflictDialog() {
  const { uploads } = useDrive();
  const conflicts = uploads.tasks.filter((task) => task.status === "conflict");
  const [current] = conflicts;
  const [applyAll, setApplyAll] = useState(false);
  const checkboxId = useId();
  const previousFocus = useRef<HTMLElement | null>(null);
  if (!current) return null;
  const choose = (choice: "keep-both" | "replace" | "skip") => {
    uploads.resolve(current.id, choice, applyAll);
    setApplyAll(false);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && choose("skip")}>
      <DialogContent
        className="drv-dialog-sm"
        onOpenAutoFocus={() => {
          previousFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const listing = document.querySelector<HTMLElement>("[data-drive-listing]");
          const target = previousFocus.current?.isConnected ? previousFocus.current : listing;
          target?.focus();
          if (document.activeElement !== target) listing?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Upload options</DialogTitle>
          <DialogDescription>A file named "{current.name}" already exists</DialogDescription>
        </DialogHeader>
        {conflicts.length > 1 ? (
          <div className="drv-checkbox-row">
            <Checkbox
              id={checkboxId}
              checked={applyAll}
              onCheckedChange={(checked) => setApplyAll(checked === true)}
            />
            <Label htmlFor={checkboxId}>Apply to all</Label>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => choose("skip")}>
            Skip
          </Button>
          <Button variant="outline" onClick={() => choose("replace")}>
            Replace
          </Button>
          <Button onClick={() => choose("keep-both")}>Keep both</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { DriveItem };
