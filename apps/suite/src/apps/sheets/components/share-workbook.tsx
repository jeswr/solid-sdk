// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useMemo } from "react";
import { usePodSessionState } from "@/lib/session/pod-session";
import { ShareDialog, wacShareCapabilities } from "../../../shell/share";
import { WorkbookSharingAdapter } from "../lib/sharing";
import { workbookHref } from "./sheets-sidebar";

/** Snapshots and the edit log live inside the shared container, so they share its audience. */
export const SHARE_HISTORY_NOTICE =
  "People with access can also see earlier versions and past edits of this spreadsheet, including content that has since been deleted.";

export function ShareWorkbook({
  container,
  title,
  onClose,
}: {
  container: string;
  title: string;
  onClose: () => void;
}) {
  const state = usePodSessionState();
  const session = state.status === "ready" ? state.session : undefined;
  const adapter = useMemo(() => session && new WorkbookSharingAdapter(session), [session]);
  if (!adapter) return null;
  return (
    <ShareDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      groupSession={session}
      url={container}
      name={title}
      kind="folder"
      adapter={adapter}
      notice={SHARE_HISTORY_NOTICE}
      caps={wacShareCapabilities}
      suiteHref={new URL(workbookHref(container), window.location.href).href}
    />
  );
}
