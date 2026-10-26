// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
"use client";
/**
 * Drive's app frame: the account session, Drive state, the interim suite
 * frame with Drive's sidebar, the details pane, dialogs, preview, upload dock,
 * toasts and Drive-scope keyboard shortcuts (04-drive §8).
 */

import { Button, IconButton, Toaster } from "@jeswr/suite-ui";
import { Info } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { measureUsage, purgeExpired } from "../lib/operations/operations";
import { DriveProvider, useDrive } from "../state/drive-context";
import { DriveUiProvider, useDriveUi } from "../state/ui";
import { DetailsPane } from "./details";
import { DriveDialogs } from "./dialogs";
import { PreviewDialog } from "./preview";
import { DriveSidebar, NewMenu } from "./sidebar";
import { UploadDock } from "./upload-dock";

function isTyping(target: EventTarget | null): boolean {
  return Boolean(
    (target as HTMLElement | null)?.closest?.(
      "input, textarea, select, [contenteditable='true'], [role='dialog']",
    ),
  );
}

function DriveChrome({ children }: { children: ReactNode }) {
  const { client, driveRoot, rootError, changes } = useDrive();
  const ui = useDriveUi();
  const [usage, setUsage] = useState<number>();
  const [newOpen, setNewOpen] = useState(false);
  const { setDetailsOpen, requestUpload, openDialog, currentFolder } = ui;

  // Once per session: purge trash older than 30 days (04-drive §4.9).
  useEffect(() => {
    if (!driveRoot || sessionStorage.getItem("suite.drive.purged") === driveRoot) return;
    sessionStorage.setItem("suite.drive.purged", driveRoot);
    void purgeExpired(client, driveRoot).then(
      (result) =>
        result.done.length > 0 && console.debug(`Drive purged ${result.done.length} expired items`),
      () => undefined,
    );
  }, [client, driveRoot]);

  useEffect(() => {
    if (!driveRoot) return;
    let live = true;
    const measure = () =>
      void measureUsage(client, driveRoot).then(
        (bytes) => live && setUsage(bytes),
        () => undefined,
      );
    measure();
    const unsubscribe = changes.subscribe(driveRoot, measure);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [client, driveRoot, changes]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "c") {
        event.preventDefault();
        setNewOpen(true);
      } else if (event.key === "U" && event.shiftKey && currentFolder) {
        event.preventDefault();
        requestUpload(false);
      } else if (event.key === "F" && event.shiftKey && currentFolder) {
        event.preventDefault();
        openDialog({ kind: "new-folder", parent: currentFolder });
      } else if (event.key === "]") {
        event.preventDefault();
        setDetailsOpen((open) => !open);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [currentFolder, requestUpload, openDialog, setDetailsOpen]);

  return (
    <SuiteFrame
      app="drive"
      sidebar={
        <DriveSidebar usage={usage} newMenuOpen={newOpen} onNewMenuOpenChange={setNewOpen} />
      }
      search={{ placeholder: "Search in Drive", action: "/drive/search", scopeLabel: "in Drive" }}
      actions={
        <IconButton
          label={ui.detailsOpen ? "Hide details" : "Show details"}
          variant="ghost"
          aria-pressed={ui.detailsOpen}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          <Info aria-hidden="true" size={20} />
        </IconButton>
      }
      details={ui.detailsOpen ? <DetailsPane onClose={() => setDetailsOpen(false)} /> : undefined}
      onDetailsClose={() => setDetailsOpen(false)}
    >
      {rootError ? (
        <div className="drv-state" role="alert">
          <h1>Can't open your Drive</h1>
          <p>The storage didn't respond.</p>
          <Button variant="outline" onClick={() => location.reload()}>
            Retry
          </Button>
        </div>
      ) : (
        children
      )}
      <div className="drv-fab-slot">
        <NewMenu fab />
      </div>
      <UploadDock />
      <DriveDialogs />
      <PreviewDialog />
    </SuiteFrame>
  );
}

function SessionGate({ children }: { children: ReactNode }) {
  const state = usePodSessionState();
  if (state.status === "loading") {
    return (
      <div className="drv-boot" role="status">
        Opening your Drive…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="drv-boot" role="alert">
        <h1>Can't open your Drive</h1>
        <p>This browser couldn't open the demo pod's storage.</p>
      </div>
    );
  }
  return (
    <DriveProvider session={state.session}>
      <DriveUiProvider>
        <DriveChrome>{children}</DriveChrome>
      </DriveUiProvider>
    </DriveProvider>
  );
}

export function DriveApp({ children }: { children: ReactNode }) {
  return (
    <PodSessionProvider>
      <SessionGate>{children}</SessionGate>
      <Toaster position="bottom-center" />
    </PodSessionProvider>
  );
}
