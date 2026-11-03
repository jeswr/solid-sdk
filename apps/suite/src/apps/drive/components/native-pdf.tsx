// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * The native shell's PDF preview (MOB-P3 E5): `frame-src 'none'` blocks the web build's iframe and
 * Android's WebView has no PDF viewer, so Drive hands the file to the platform viewer instead.
 * Oversized files are refused from the listing size before any read, and the read itself stops
 * at the cap.
 */
import { Button } from "@jeswr/suite-ui";
import { Download, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAccounts } from "@/shell/session/accounts-provider";
import type { DriveItem } from "../lib/client/client";
import { useDrive } from "../state/drive-context";
import { useDriveActions } from "../state/ui";

/** Matches the native cap (suite-native PDF_PREVIEW_MAX_BYTES); kept here so the web build never loads that package. */
export const PDF_PREVIEW_LIMIT = 25 * 1024 * 1024;

type HandoffState = "idle" | "opening" | "too-large" | "no-viewer" | "failed";

const MESSAGES: Record<Exclude<HandoffState, "idle" | "opening">, string> = {
  "too-large": "Too large to preview; download it instead",
  "no-viewer": "No PDF viewer is installed; download it instead",
  failed: "Can't preview this file",
};

/** Opens the bridge lazily: only native builds ever load @capacitor/core. */
async function handOff(name: string, bytes: Uint8Array, signal: AbortSignal): Promise<void> {
  const [{ filesPlugin }, { openPdf }] = await Promise.all([
    import("@jeswr/suite-native/capacitor"),
    import("@jeswr/suite-native"),
  ]);
  await openPdf(filesPlugin, name, bytes, signal);
}

function codeOf(error: unknown): HandoffState {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "too-large" || code === "no-viewer" ? code : "failed";
}

export function NativePdfHandoff({ item }: { item: DriveItem }) {
  const { client } = useDrive();
  const actions = useDriveActions();
  const [state, setState] = useState<HandoffState>(
    item.size !== undefined && item.size > PDF_PREVIEW_LIMIT ? "too-large" : "idle",
  );
  // Leaving the preview, or the account changing under it, stops the transfer before its next
  // native call, so one account's file never opens after the shell cleared previews (sst-8wx.18).
  const activeId = useAccounts().active?.id;
  const transfer = useRef<AbortController | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the cleanup must run when the account changes.
  useEffect(() => () => transfer.current?.abort(), [activeId]);
  const open = async () => {
    transfer.current?.abort();
    const controller = new AbortController();
    transfer.current = controller;
    setState("opening");
    try {
      const blob = await client.readLimited(item.url, PDF_PREVIEW_LIMIT);
      if (controller.signal.aborted) return;
      if (!blob) {
        setState("too-large");
        return;
      }
      await handOff(item.name, new Uint8Array(await blob.arrayBuffer()), controller.signal);
      setState("idle");
    } catch (error) {
      if (!controller.signal.aborted) setState(codeOf(error));
    }
  };
  const message = state === "idle" || state === "opening" ? undefined : MESSAGES[state];
  return (
    <div className="drv-state">
      <div className="drv-state-icon" aria-hidden="true">
        <FileText size={48} />
      </div>
      <h2>{item.name}</h2>
      {message ? <p role="status">{message}</p> : null}
      {state === "idle" || state === "opening" ? (
        <Button onClick={() => void open()} disabled={state === "opening"}>
          <FileText aria-hidden="true" size={16} /> {state === "opening" ? "Opening…" : "Open PDF"}
        </Button>
      ) : (
        <>
          {state === "failed" ? (
            <Button variant="outline" onClick={() => void open()}>
              Try again
            </Button>
          ) : null}
          <Button onClick={() => void actions.download(item)}>
            <Download aria-hidden="true" size={16} /> Download
          </Button>
        </>
      )}
    </div>
  );
}
