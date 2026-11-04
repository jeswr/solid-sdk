// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * The `requiresOnline` convention (02-suite-shell §10): controls that need a connection —
 * share changes, registration, connector sign-in, purging the trash — are disabled while the
 * shell is offline or reconnecting, with the tooltip "You're offline. This needs a connection."
 *
 *   <RequiresOnline><Button onClick={purge}>Empty trash</Button></RequiresOnline>
 *
 * Use `useNeedsConnection()` when a control is disabled by other means (a fieldset, a `disabled`
 * prop) and only needs the flag.
 */
import { OFFLINE_REASON, OnlineGate } from "@jeswr/suite-ui/sync";
import type { ReactNode } from "react";
import { useConnectionState } from "./offline-provider";

export function useNeedsConnection(): { disabled: boolean; reason: string } {
  return { disabled: useConnectionState() !== "online", reason: OFFLINE_REASON };
}

export function RequiresOnline({ children }: { children: ReactNode }) {
  const { disabled } = useNeedsConnection();
  return <OnlineGate online={!disabled}>{children}</OnlineGate>;
}
