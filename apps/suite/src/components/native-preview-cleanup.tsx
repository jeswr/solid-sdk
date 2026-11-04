// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * Native shell only (sst-8wx.18): Drive's "Open PDF" leaves a copy of the file in the app cache
 * for the platform viewer. When the active account changes away from a signed-in one (sign-out,
 * sign-out-all or a switch), clear every cached preview so the next account never sees it.
 */
import { useEffect, useRef } from "react";
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

/** Loads the bridge lazily, so only native builds ever load @capacitor/core. */
export async function clearNativePdfPreviews(): Promise<void> {
  try {
    const [{ filesPlugin }, { clearPdfPreviews }] = await Promise.all([
      import("@jeswr/suite-native/capacitor"),
      import("@jeswr/suite-native"),
    ]);
    await clearPdfPreviews(filesPlugin);
  } catch {
    // Best effort: native code also empties the cache on the next launch.
  }
}

/** Stops in-flight Drive transfers first, then clears what native code already holds. */
function onAccountChange() {
  bumpAccountEpoch();
  void clearNativePdfPreviews();
}

export function NativePreviewCleanup() {
  const { active } = useAccounts();
  return <ClearOnAccountChange activeId={active?.id} clear={onAccountChange} />;
}
