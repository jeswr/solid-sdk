// AUTHORED-BY Claude Opus 5.5
"use client";
import { type ReactNode, useSyncExternalStore } from "react";
import { missingPlatformFeatures, type StartupScope } from "@/lib/native/startup-check";

const noSubscription = () => () => {};
let checked: string | undefined;
// One answer per page load; the platform's features do not change while it runs.
const clientSnapshot = () => {
  checked ??= missingPlatformFeatures(globalThis as StartupScope).join(" ");
  return checked;
};
const serverSnapshot = () => null;

/**
 * Renders the app only once the startup check passes (MOB-P3 E6). The exported HTML holds
 * nothing below the gate, so no page code, and no pod-auth, runs before the check.
 */
export function NativeStartupGate({ children }: { children: ReactNode }) {
  const missing = useSyncExternalStore(noSubscription, clientSnapshot, serverSnapshot);
  if (missing === null) return null;
  if (missing === "") return children;
  return (
    <main id="main-content" className="native-update" data-missing={missing}>
      <h1>Update needed</h1>
      <p>
        This device's web view is missing features Solid Suite needs to keep your sign-in safe.
        Update the system (and, on Android, Android System WebView), then open the app again.
      </p>
    </main>
  );
}
