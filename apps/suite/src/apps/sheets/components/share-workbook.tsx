// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useMemo } from "react";
import { usePodSessionState } from "@/lib/session/pod-session";
import { ShareDialog, wacShareCapabilities } from "../../../shell/share";
import { WorkbookSharingAdapter } from "../lib/sharing";
import { workbookHref } from "./sheets-sidebar";

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
      caps={wacShareCapabilities}
      suiteHref={new URL(workbookHref(container), window.location.href).href}
    />
  );
}
