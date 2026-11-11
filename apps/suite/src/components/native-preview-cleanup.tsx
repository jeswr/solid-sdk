// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * Native shell only (sst-8wx.18): Drive's "Open PDF" leaves a copy of the file in the app cache
 * for the platform viewer. When the active account changes away from a signed-in one (sign-out,
 * sign-out-all or a switch), clear every cached preview so the next account never sees it. If the
 * clear fails, the app stays blocked until a retry succeeds.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { bumpAccountEpoch } from "@/lib/native/account-epoch";
import { useAccounts } from "@/shell/session/accounts-provider";

/**
 * Calls `clear` each time `activeId` changes away from a signed-in account. Never on mount or on
 * the first sign-in: a recreated view must not delete a file the viewer is reading.
 */
export function ClearOnAccountChange({
  activeId,
  clear,
}: {
  activeId: string | undefined;
  clear: () => void;
}) {
  const previous = useRef(activeId);
  useEffect(() => {
    const before = previous.current;
    previous.current = activeId;
    if (before !== undefined && before !== activeId) clear();
  }, [activeId, clear]);
  return null;
}

/** Loads the bridge lazily, so only native builds ever load @capacitor/core. Rejects on failure. */
export async function clearNativePdfPreviews(): Promise<void> {
  const [{ filesPlugin }, { clearPdfPreviews }] = await Promise.all([
    import("@jeswr/suite-native/capacitor"),
    import("@jeswr/suite-native"),
  ]);
  await clearPdfPreviews(filesPlugin);
}

/**
 * Clears previews on each account change and fails closed: until a clear succeeds, a modal covers
 * the app so the next account can't be used while the previous account's previews may remain
 * readable. Only the latest clear decides the state, so a slow earlier result never unblocks.
 */
export function PreviewIsolation({
  activeId,
  clear,
}: {
  activeId: string | undefined;
  clear: () => Promise<void>;
}) {
  const [state, setState] = useState<"idle" | "failed" | "retrying">("idle");
  const latest = useRef(0);
  const run = useCallback(async () => {
    const attempt = ++latest.current;
    setState((current) => (current === "idle" ? current : "retrying"));
    let ok = true;
    try {
      await clear();
    } catch {
      ok = false;
    }
    if (attempt === latest.current) setState(ok ? "idle" : "failed");
  }, [clear]);
  const onChange = useCallback(() => {
    void run();
  }, [run]);
  return (
    <>
      <ClearOnAccountChange activeId={activeId} clear={onChange} />
      {state === "idle" ? null : (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="preview-isolation-title"
          aria-describedby="preview-isolation-body"
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-background/95 p-6"
        >
          <div className="max-w-sm space-y-3 text-center">
            <h2 id="preview-isolation-title" className="text-lg font-semibold">
              Can't clear the previous account's files
            </h2>
            <p id="preview-isolation-body" className="text-sm text-muted-foreground">
              PDFs opened by the previous account are still on this device. Clear them before
              continuing.
            </p>
            <button
              type="button"
              className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              disabled={state === "retrying"}
              onClick={() => void run()}
            >
              {state === "retrying" ? "Clearing…" : "Try again"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Stops in-flight Drive transfers first, then clears what native code already holds. */
async function onAccountChange(): Promise<void> {
  bumpAccountEpoch();
  await clearNativePdfPreviews();
}

export function NativePreviewCleanup() {
  const { active } = useAccounts();
  return <PreviewIsolation activeId={active?.id} clear={onAccountChange} />;
}
