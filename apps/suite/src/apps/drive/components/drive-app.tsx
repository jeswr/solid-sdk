// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
/**
 * Drive's app frame: the account session, Drive state, the shared suite
 * frame with Drive's sidebar, the details pane, dialogs, preview, upload dock,
 * toasts and Drive-scope keyboard shortcuts (04-drive §8).
 */

import { Button, IconButton, Toaster, toast } from "@jeswr/suite-ui";
import { Info } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { AppFrame, AppHeading, AppSessionGuard } from "@/shell/app-frame";
import { measureUsage, purgeExpired, trashFolderOf } from "../lib/operations/operations";
import { DriveFocusBoundary } from "../state/app-focus";
import { DriveProvider, DriveRootDiscoveryError, useDrive } from "../state/drive-context";
import { claimPurge } from "../state/purge-marker";
import { DriveUiProvider, errorMessage, reportFailure, useDriveUi } from "../state/ui";
import { DetailsPane } from "./details";
import { DriveDialogs } from "./dialogs";
import { PreviewDialog } from "./preview";
import { isTyping } from "./shortcut-targets";
import { DriveSidebar, NewMenu } from "./sidebar";
import { UploadDock } from "./upload-dock";

function DriveChrome({ children }: { children: ReactNode }) {
  const { client, driveRoot, rootError, changes, invalidate } = useDrive();
  const ui = useDriveUi();
  const [usage, setUsage] = useState<number>();
  const [usageFailed, setUsageFailed] = useState(false);
  const [usageAttempt, setUsageAttempt] = useState(0);
  const [newOpen, setNewOpen] = useState(false);
  const { setDetailsOpen, requestUpload, openDialog, currentFolder } = ui;

  // Once per session: purge trash older than 30 days (04-drive §4.9).
  useEffect(() => {
    if (!driveRoot || !claimPurge(driveRoot)) return;
    void purgeExpired(client, driveRoot)
      .then(
        (result) => {
          for (const warning of result.warnings ?? []) toast.error(warning.message);
          for (const { error } of result.failed)
            reportFailure(error, "Couldn't delete an expired Trash item", client, invalidate);
          if (result.done.length > 0)
            console.debug(`Drive purged ${result.done.length} expired items`);
        },
        (error: unknown) =>
          reportFailure(error, "Couldn't finish clearing expired Trash", client, invalidate),
      )
      // Purge can finish deletes before its bookkeeping fails. Refresh every
      // Trash subscriber on settlement, including pods without notifications.
      .finally(() => invalidate(trashFolderOf(driveRoot)));
  }, [client, driveRoot, invalidate]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: usageAttempt retries the complete measurement
  useEffect(() => {
    if (!driveRoot) return;
    let live = true;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      const request = ++generation;
      void measureUsage(client, driveRoot).then(
        (bytes) => {
          if (!live || request !== generation) return;
          setUsage(bytes);
          setUsageFailed(false);
        },
        () => {
          if (live && request === generation) setUsageFailed(true);
        },
      );
    };
    const unsubscribe = changes.subscribeSubtree(driveRoot, () => {
      // Invalidate pending measurements immediately and coalesce mutation bursts.
      ++generation;
      clearTimeout(timer);
      timer = setTimeout(measure, 200);
    });
    setUsage(undefined);
    setUsageFailed(false);
    measure();
    return () => {
      live = false;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [client, driveRoot, changes, usageAttempt]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isTyping(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
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
    <AppFrame
      app="drive"
      sidebar={
        <DriveSidebar
          usage={usage}
          usageFailed={usageFailed}
          onRetryUsage={() => setUsageAttempt((attempt) => attempt + 1)}
          newMenuOpen={newOpen}
          onNewMenuOpenChange={setNewOpen}
        />
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
          <AppHeading>Can't open your Drive</AppHeading>
          <p>
            {rootError instanceof DriveRootDiscoveryError
              ? rootError.message
              : errorMessage(rootError, "The storage didn't respond.")}
          </p>
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
    </AppFrame>
  );
}

function SessionGate({ children }: { children: ReactNode }) {
  const state = usePodSessionState();
  if (state.status === "signed-out") {
    return (
      <div className="drv-boot" role="status">
        <AppHeading>Sign in to open your Drive</AppHeading>
        <p>Sign-in is not available in this preview build.</p>
      </div>
    );
  }
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
        <AppHeading>Can't open your Drive</AppHeading>
        <p>
          {state.mode === "extension"
            ? "This browser couldn't open your pod through the Solid extension."
            : "This browser couldn't open the demo pod's storage."}
        </p>
      </div>
    );
  }
  return (
    <DriveProvider
      key={JSON.stringify([state.session.mode, state.session.webId, state.session.storageUrl])}
      session={state.session}
    >
      <DriveUiProvider>
        <DriveChrome>{children}</DriveChrome>
      </DriveUiProvider>
    </DriveProvider>
  );
}

export function DriveApp({ children }: { children: ReactNode }) {
  return (
    <AppSessionGuard>
      <PodSessionProvider>
        <DriveFocusBoundary>
          <SessionGate>{children}</SessionGate>
          <Toaster position="bottom-center" />
        </DriveFocusBoundary>
      </PodSessionProvider>
    </AppSessionGuard>
  );
}
