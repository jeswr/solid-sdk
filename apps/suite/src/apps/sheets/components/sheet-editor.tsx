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
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EditableText,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
} from "@jeswr/suite-ui";
import { ArrowLeft, ChevronDown, Table2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { useNeedsConnection } from "../../../shell/sync/requires-online";
import { useWorkbook } from "../hooks/use-workbook";
import type { SaveStatus } from "../lib/autosave";
import {
  type SheetEngine,
  type Snapshot,
  WorkbookLinkError,
  WorkbookNotFoundError,
} from "../lib/contract";
import { loadEngine } from "../lib/engine";
import { pendingSaves } from "../lib/pending-saves";
import { useWorkbookService } from "../state/service";
import { WorkbookComments } from "./cell-comments";
import { ShareWorkbook } from "./share-workbook";
import { SheetsSidebar, workbookHref } from "./sheets-sidebar";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-conditional-formatting/lib/index.css";
import "@univerjs/preset-sheets-data-validation/lib/index.css";

declare global {
  interface Window {
    // biome-ignore lint/style/useNamingConvention: explicitly contracted development fixture
    __sheetsEngine?: SheetEngine;
  }
}

const statusText: Record<SaveStatus, string> = {
  saved: "Saved to your pod",
  saving: "Saving…",
  unsaved: "Unsaved changes",
  offline: "Offline — changes will save when you reconnect",
  conflict: "Unsaved changes",
  error: "Couldn't save",
};

export function SheetNotFound() {
  return (
    <div className="sht-state">
      <h1>Can't open this spreadsheet</h1>
      <p>It may have moved or you may not have access.</p>
      <Link href="/sheets">Back to spreadsheets</Link>
    </div>
  );
}

function Grid({
  snapshot,
  onChange,
  engineRef,
  readOnly,
  onReady,
}: {
  onReady: (engine: SheetEngine | null) => void;
  snapshot: Snapshot;
  onChange: (read: () => Snapshot) => void;
  engineRef: { current: SheetEngine | null };
  readOnly: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const latestSnapshot = useRef(snapshot);
  latestSnapshot.current = snapshot;
  const { resolvedTheme } = useTheme();
  const dark = useRef(resolvedTheme === "dark");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const viewOnly = useRef(readOnly);
  viewOnly.current = readOnly;
  useEffect(() => {
    engineRef.current?.setReadOnly(readOnly);
  }, [readOnly, engineRef]);
  useEffect(() => {
    dark.current = resolvedTheme === "dark";
    engineRef.current?.setDark(dark.current);
  }, [resolvedTheme, engineRef]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries the engine mount
  useEffect(() => {
    let live = true;
    let engine: SheetEngine | undefined;
    let unsubscribe: (() => void) | undefined;
    setFailed(false);
    setReady(false);
    void (async () => {
      const mount = await loadEngine();
      if (!live || !host.current) return;
      engine = await mount(host.current, {
        snapshot: latestSnapshot.current,
        dark: dark.current,
        compact: matchMedia("(max-width: 639px)").matches,
        readOnly: viewOnly.current,
        commentsLoading: true,
      });
      if (!live) {
        engine.dispose();
        return;
      }
      engineRef.current = engine;
      onReady(engine);
      engine.setDark(dark.current);
      engine.setReadOnly(viewOnly.current);
      const active = engine;
      unsubscribe = engine.onChange(() => {
        if (!viewOnly.current) onChange(() => active.snapshot());
      });
      if (process.env.NEXT_PUBLIC_DEV_FIXTURES === "1") window.__sheetsEngine = engine;
      setReady(true);
    })().catch(() => {
      if (live) setFailed(true);
    });
    return () => {
      live = false;
      unsubscribe?.();
      if (window.__sheetsEngine === engine) delete window.__sheetsEngine;
      engineRef.current = null;
      onReady(null);
      engine?.dispose();
    };
  }, [engineRef, onChange, onReady, attempt]);
  return (
    <section
      className="sht-grid-region"
      aria-label="Spreadsheet grid"
      aria-describedby="sht-grid-note"
    >
      <p id="sht-grid-note" className="sr-only">
        This grid is rendered by the spreadsheet engine. Screen reader cell navigation is limited.
      </p>
      {!ready && (
        <div className="sht-grid-loading">
          {failed ? (
            <div role="alert">
              <p>Couldn't load the spreadsheet engine</p>
              <Button onClick={() => setAttempt((value) => value + 1)}>Retry</Button>
            </div>
          ) : (
            <div className="sht-skeleton" role="status" aria-label="Loading spreadsheet grid">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
      )}
      <div className="sht-univer" ref={host} data-testid="univer-container" />
    </section>
  );
}

export function SheetEditor({ container }: { container: string }) {
  const state = useWorkbook(container);
  const sharingConnection = useNeedsConnection();
  const service = useWorkbookService();
  const router = useRouter();
  const engine = useRef<SheetEngine | null>(null);
  const [commentEngine, setCommentEngine] = useState<SheetEngine | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const fileTrigger = useRef<HTMLButtonElement>(null);
  const loadTheirVersion = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<"import" | "delete" | "share">();
  const [mode, setMode] = useState<"new-sheet" | "replace-active">("new-sheet");
  const [csvFile, setCsvFile] = useState<File>();
  const [importError, setImportError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [returnConflictFocus, setReturnConflictFocus] = useState(false);
  const [grid, setGrid] = useState<{ container: string; revision: number }>();
  if (state.workbook?.container === container && grid?.container !== container)
    setGrid({ container, revision: 0 });
  useEffect(() => {
    if (returnConflictFocus && !busy && state.status !== "conflict" && fileTrigger.current) {
      if (fileTrigger.current.disabled) return;
      fileTrigger.current.focus();
      setReturnConflictFocus(false);
    }
  }, [returnConflictFocus, busy, state.status]);
  const title = state.metadata?.title ?? "Untitled spreadsheet";
  const action = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } catch {
      toast.error("Couldn't complete this action. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    if (!engine.current) return;
    const csv = engine.current.exportCsv();
    const name = `${title} - ${engine.current.activeSheet().name}.csv`.replace(/[\\/]/g, "-");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const downloadExcel = () =>
    action(async () => {
      if (!engine.current) return;
      const { writeXlsx } = await import("../lib/xlsx");
      const data = writeXlsx(engine.current.snapshot());
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(data)], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title}.xlsx`.replace(/[\\/]/g, "-");
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    });
  const importCsv = async (file: File) => {
    try {
      const result = engine.current?.importCsv(await file.text(), {
        mode,
        name: file.name.replace(/\.csv$/i, ""),
      });
      if (result?.status !== "imported") {
        setImportError(
          result?.status === "blocked" && result.reason === "read-only"
            ? "You need Write access to import a CSV."
            : "Comments are loading. Try importing again when they finish.",
        );
        return;
      }
      if (input.current) input.current.value = "";
      setCsvFile(undefined);
      setImportError(undefined);
      setDialog(undefined);
    } catch {
      setImportError("Couldn't import this CSV. Try again.");
    }
  };
  if (state.error instanceof WorkbookNotFoundError && state.error.reason === "missing")
    return <SheetNotFound />;
  if (state.error)
    return (
      <div className="sht-state" role="alert">
        <h1>Couldn't open this spreadsheet</h1>
        {state.error instanceof WorkbookLinkError && <p>{state.error.message}</p>}
        <Button onClick={state.retryOpen}>Retry</Button>
        <Link href="/sheets">Back to spreadsheets</Link>
      </div>
    );
  return (
    <SuiteFrame
      app="sheets"
      sidebar={<SheetsSidebar />}
      context={
        <div className="sht-context">
          <Link className="sht-back" href="/sheets" aria-label="Back to spreadsheets">
            <ArrowLeft size={20} aria-hidden="true" />
          </Link>
          <Table2 className="sht-icon sht-title-icon" size={24} aria-hidden="true" />
          <div className="sht-title">
            <EditableText
              label="Spreadsheet title"
              value={title}
              onCommit={state.rename}
              disabled={!state.workbook || state.readOnly}
              validate={(value) => (value.trim() ? undefined : "Enter a name")}
            />
            <div className="sht-save" aria-live="polite">
              <span>{state.readOnly ? "View only" : statusText[state.status]}</span>
              {state.status === "error" && !state.readOnly && (
                <Button variant="ghost" size="sm" onClick={() => void state.retry()}>
                  Retry
                </Button>
              )}
            </div>
          </div>
        </div>
      }
      actions={
        <div className="sht-actions">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button ref={fileTrigger} variant="ghost" disabled={!state.workbook || busy}>
                File
                <ChevronDown size={14} aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href="/sheets/new">New spreadsheet</Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={state.readOnly || commentsLoading}
                onSelect={() => setDialog("import")}
              >
                Import CSV
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={download}>Download current sheet as CSV</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void downloadExcel()}>
                Download as Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  void action(async () => {
                    if (!engine.current) return;
                    const copy = await service.create({
                      title: `${title} (copy)`,
                      snapshot: engine.current.snapshot(),
                    });
                    router.push(workbookHref(copy.container));
                  })
                }
              >
                Make a copy
              </DropdownMenuItem>
              <DropdownMenuItem disabled={state.readOnly} onSelect={() => setDialog("delete")}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* biome-ignore lint/a11y/noNoninteractiveTabindex: focusable wrapper gives keyboard users the disabled control's tooltip */}
                <span tabIndex={0}>
                  <Button
                    disabled={!state.workbook || state.readOnly || sharingConnection.disabled}
                    variant="outline"
                    aria-haspopup="dialog"
                    onClick={() => setDialog("share")}
                  >
                    Share
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {sharingConnection.disabled
                  ? sharingConnection.reason
                  : state.readOnly
                    ? "Ask the owner to change sharing"
                    : "Share this spreadsheet and all its sheets"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      }
    >
      <div className="sht-editor">
        <h1 className="sr-only">{title}</h1>
        {state.workbook && (
          <WorkbookComments
            container={container}
            engine={commentEngine}
            onLoadingChange={setCommentsLoading}
          />
        )}
        {state.workbook ? (
          <Grid
            key={grid?.revision ?? 0}
            snapshot={state.workbook.snapshot}
            onChange={state.scheduleSave}
            engineRef={engine}
            onReady={setCommentEngine}
            readOnly={state.readOnly}
          />
        ) : (
          <div className="sht-skeleton" role="status" aria-label="Opening spreadsheet">
            <span />
            <span />
          </div>
        )}
      </div>
      {dialog === "share" && (
        <ShareWorkbook container={container} title={title} onClose={() => setDialog(undefined)} />
      )}
      <Dialog
        open={dialog === "import"}
        onOpenChange={(open) => {
          if (!open) setDialog(undefined);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            fileTrigger.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Import CSV</DialogTitle>
            <DialogDescription>
              CSV fields are imported as text, including values that start with an equals sign.
            </DialogDescription>
          </DialogHeader>
          <fieldset className="sht-import-options" disabled={state.readOnly || commentsLoading}>
            <legend>Where should the data go?</legend>
            <label>
              <input
                type="radio"
                name="csv-mode"
                checked={mode === "new-sheet"}
                onChange={() => setMode("new-sheet")}
              />
              Insert as new sheet
            </label>
            <label>
              <input
                type="radio"
                name="csv-mode"
                checked={mode === "replace-active"}
                onChange={() => setMode("replace-active")}
              />
              Replace current sheet
            </label>
          </fieldset>
          {commentsLoading && (
            <p role="status">Comments are loading. Try importing again when they finish.</p>
          )}
          {importError && !commentsLoading && <p role="alert">{importError}</p>}
          {csvFile && <p>{csvFile.name}</p>}
          <Button
            disabled={state.readOnly || commentsLoading}
            onClick={() => input.current?.click()}
          >
            Choose CSV file
          </Button>
          <input
            ref={input}
            className="sr-only"
            tabIndex={-1}
            type="file"
            aria-label="CSV file to import"
            accept=".csv,text/csv"
            disabled={state.readOnly || commentsLoading}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (!file || state.readOnly) return;
              setCsvFile(file);
              setImportError(undefined);
              void importCsv(file);
            }}
          />
          {csvFile && importError && (
            <Button
              disabled={state.readOnly || commentsLoading}
              onClick={() => void importCsv(csvFile)}
            >
              Retry import
            </Button>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={dialog === "delete"}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(undefined);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            fileTrigger.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete spreadsheet?</AlertDialogTitle>
            <AlertDialogDescription>This removes “{title}” from your pod.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || state.readOnly}
              onClick={(event) => {
                event.preventDefault();
                void action(async () => {
                  await state.flush();
                  await service.remove(container);
                  pendingSaves.drop(container);
                  router.push("/sheets");
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={state.status === "conflict" && !state.readOnly}>
        <AlertDialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            loadTheirVersion.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            setReturnConflictFocus(true);
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>This spreadsheet changed somewhere else</AlertDialogTitle>
            <AlertDialogDescription>
              Choose which version to keep. Your local changes stay here until you choose.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              ref={loadTheirVersion}
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void action(async () => {
                  const snapshot = await state.reload();
                  if (engine.current) engine.current.load(snapshot);
                  else
                    setGrid((current) => ({
                      container,
                      revision: (current?.revision ?? 0) + 1,
                    }));
                });
              }}
            >
              Load their version
            </AlertDialogCancel>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  if (!engine.current) return;
                  const copy = await service.create({
                    title: `${title} (my copy)`,
                    snapshot: engine.current.snapshot(),
                  });
                  state.discard();
                  router.push(workbookHref(copy.container));
                })
              }
            >
              Save mine as a copy
            </Button>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void action(async () => {
                  if (engine.current)
                    state.scheduleSave(() => {
                      if (!engine.current) throw new Error("Grid closed");
                      return engine.current.snapshot();
                    });
                  await state.retry(true);
                });
              }}
            >
              Keep mine
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SuiteFrame>
  );
}
