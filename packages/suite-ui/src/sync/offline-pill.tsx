// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { CloudOff, CloudUpload, RefreshCw, TriangleAlert } from "lucide-react";
import { StatusDot } from "../components/atoms/status-dot.js";
import { Button } from "../components/ui/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { waitingLabel } from "./lib/status.js";
import { syncStatus } from "./status.js";
import type { SyncSnapshot } from "./types.js";

export interface OfflinePillProps {
  snapshot: SyncSnapshot;
  onOpen: () => void;
  variant?: "pill" | "icon";
}
export function OfflinePill({ snapshot, onOpen, variant = "pill" }: OfflinePillProps) {
  const { kind, label } = syncStatus(snapshot);
  if (kind === "hidden") return null;
  const accessibleLabel =
    kind === "offline" && snapshot.pending.length
      ? `${label}, ${waitingLabel(snapshot.pending.length)}`
      : label;
  const Icon =
    kind === "conflict"
      ? TriangleAlert
      : kind === "reconnecting"
        ? RefreshCw
        : kind === "waiting"
          ? CloudUpload
          : CloudOff;
  const button = (
    <Button
      variant="outline"
      className="suite-offline-pill"
      data-sync-kind={kind}
      data-sync-variant={variant}
      aria-label={accessibleLabel}
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      {variant === "icon" && <Icon size={20} strokeWidth={1.75} aria-hidden="true" />}
      <StatusDot
        status={kind === "conflict" ? "destructive" : kind === "reconnecting" ? "info" : "warning"}
        label={accessibleLabel}
      />
      {variant === "pill" && <span aria-hidden="true">{label}</span>}
    </Button>
  );
  if (variant === "pill") return button;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{accessibleLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
/** The shell's SyncStatus and OfflinePill share the same props and behavior. */
export const SyncStatus = OfflinePill;
