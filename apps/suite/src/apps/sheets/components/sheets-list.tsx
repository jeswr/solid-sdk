// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
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
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Input,
  toast,
} from "@jeswr/suite-ui";
import { MoreHorizontal, Plus, Table2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { TemplateLauncher } from "@/components/templates/template-picker";
import { useNeedsConnection } from "../../../shell/sync/requires-online";
import type { WorkbookSummary } from "../lib/contract";
import { pendingSaves } from "../lib/pending-saves";
import { useWorkbookService } from "../state/service";
import { ShareWorkbook } from "./share-workbook";
import { SheetsSidebar, workbookHref } from "./sheets-sidebar";

function relativeTime(date: Date) {
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return "Just now";
  if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (Math.abs(seconds) < 86400) return formatter.format(Math.round(seconds / 3600), "hour");
  return formatter.format(Math.round(seconds / 86400), "day");
}

export function SheetsList() {
  const sharingConnection = useNeedsConnection();
  const service = useWorkbookService();
  const router = useRouter();
  const [rows, setRows] = useState<WorkbookSummary[]>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<{
    kind: "rename" | "delete" | "share";
    row: WorkbookSummary;
  }>();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt refreshes after mutations or retries
  useEffect(() => {
    let live = true;
    setFailed(false);
    void service.list().then(
      (items) => live && setRows(items),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [service, attempt]);
  const refresh = () => setAttempt((value) => value + 1);
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    (trigger.current?.isConnected
      ? trigger.current
      : document.getElementById("main-content")
    )?.focus();
  };
  const mutate = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      setDialog(undefined);
      refresh();
    } catch {
      toast.error("Couldn't update this spreadsheet. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <SuiteFrame app="sheets" sidebar={<SheetsSidebar />} context={<span>Sheets</span>}>
      <section className="sht-list" aria-labelledby="sht-list-title">
        <h1 id="sht-list-title">All spreadsheets</h1>
        <TemplateLauncher app="sheets" />
        {failed ? (
          <div className="sht-state" role="alert">
            <h2>Couldn't load your spreadsheets</h2>
            <Button onClick={refresh}>Retry</Button>
          </div>
        ) : !rows ? (
          <div className="sht-skeleton" role="status" aria-label="Loading spreadsheets">
            <span />
            <span />
            <span />
          </div>
        ) : rows.length === 0 ? (
          <div className="sht-state">
            <Table2 className="sht-icon" size={40} aria-hidden="true" />
            <h2>No spreadsheets yet</h2>
            <p>Make room for your next idea.</p>
            <Button onClick={() => router.push("/sheets/new")}>New spreadsheet</Button>
          </div>
        ) : (
          <table className="sht-table">
            <caption className="sr-only">Your spreadsheets</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col" className="sht-owner">
                  Owner
                </th>
                <th scope="col" className="sht-modified">
                  Last modified
                </th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.container}>
                  <td>
                    <Link className="sht-name" href={workbookHref(row.container)}>
                      <Table2 className="sht-icon" size={22} aria-hidden="true" />
                      <span>
                        {row.title}
                        <time className="sht-mobile-time" dateTime={row.modified.toISOString()}>
                          {relativeTime(row.modified)}
                        </time>
                      </span>
                    </Link>
                  </td>
                  <td className="sht-owner">me</td>
                  <td className="sht-modified">
                    <time dateTime={row.modified.toISOString()}>{relativeTime(row.modified)}</time>
                  </td>
                  <td>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          label={`Actions for ${row.title}`}
                          variant="ghost"
                          onPointerDown={(event) => {
                            trigger.current = event.currentTarget;
                          }}
                          onKeyDown={(event) => {
                            trigger.current = event.currentTarget;
                          }}
                        >
                          <MoreHorizontal aria-hidden="true" size={18} />
                        </IconButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={workbookHref(row.container)}>Open</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={sharingConnection.disabled}
                          onSelect={() => setDialog({ kind: "share", row })}
                        >
                          Share
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            setName(row.title);
                            setDialog({ kind: "rename", row });
                          }}
                        >
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            void mutate(async () => {
                              const copy = await service.copy(row.container, `${row.title} (copy)`);
                              router.push(workbookHref(copy.container));
                            });
                          }}
                        >
                          Make a copy
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setDialog({ kind: "delete", row })}>
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {dialog?.kind === "share" && (
        <ShareWorkbook
          container={dialog.row.container}
          title={dialog.row.title}
          onClose={() => {
            setDialog(undefined);
            trigger.current?.focus();
          }}
        />
      )}
      <Dialog
        open={dialog?.kind === "rename"}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(undefined);
        }}
      >
        <DialogContent onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>Rename spreadsheet</DialogTitle>
            <DialogDescription>Choose a name for your spreadsheet.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (dialog && name.trim())
                void mutate(async () => {
                  const opened = await service.open(dialog.row.container);
                  await service.rename(dialog.row.container, name.trim(), opened.version);
                });
            }}
          >
            <label htmlFor="sht-rename">Name</label>
            <Input
              id="sht-rename"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setDialog(undefined)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(undefined);
        }}
      >
        <AlertDialogContent onCloseAutoFocus={restoreFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete spreadsheet?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes “{dialog?.row.title}” from your pod.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                if (dialog)
                  void mutate(async () => {
                    await service.remove(dialog.row.container);
                    pendingSaves.drop(dialog.row.container);
                  });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="sht-fab-slot">
        <button
          type="button"
          className="sht-fab"
          aria-label="New spreadsheet"
          onClick={() => router.push("/sheets/new")}
        >
          <Plus aria-hidden="true" size={24} />
        </button>
      </div>
    </SuiteFrame>
  );
}
