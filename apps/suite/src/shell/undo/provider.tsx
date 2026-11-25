// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { createUndoStack, type UndoEntry, type UndoResult } from "@jeswr/suite-sdk/undo";
import { toast } from "@jeswr/suite-ui";
import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useContext, useLayoutEffect, useMemo, useRef } from "react";
import { isRetryableUndoError } from "../notifications/controller";
import { useAccounts } from "../session/accounts-provider";

export type ScopedUndoEntry = Omit<UndoEntry, "scope">;
/** Shell-level actions (the notification tray) are undoable from any app. */
export const SHELL_UNDO_SCOPE = "shell";
export interface UndoActions {
  push(entry: ScopedUndoEntry): string;
  /** File an entry under the shell scope, which every route's shortcut also consults. */
  pushShell(entry: ScopedUndoEntry): string;
  undo(): Promise<UndoResult>;
  redo(): Promise<UndoResult>;
  /** True when this route's scope or the shell scope has a live entry to run. */
  canUndo(): boolean;
  canRedo(): boolean;
}
interface UndoContextValue {
  push(entry: UndoEntry): string;
  undo(scopes: readonly string[]): Promise<UndoResult>;
  redo(scopes: readonly string[]): Promise<UndoResult>;
  canUndo(scopes: readonly string[]): boolean;
  canRedo(scopes: readonly string[]): boolean;
}
const UndoContext = createContext<UndoContextValue | null>(null);
export function undoScope(pathname: string | null): string {
  return pathname?.split("/").filter(Boolean)[0] ?? "home";
}

/** One usable account session owns history; old actions lose authority after replacement. */
export function UndoProvider({ children }: { children: ReactNode }) {
  const accounts = useAccounts();
  const accountId = accounts.active?.id;
  const webId = accounts.active?.webId;
  const ready = accounts.status === "ready";
  const version = accounts.sessionVersion;
  const active = useRef<object | null>(null);
  const latest = useRef(accounts);
  useLayoutEffect(() => {
    latest.current = accounts;
  });
  const session = useMemo(() => {
    const stack = createUndoStack({ isRetryable: isRetryableUndoError });
    const token = { webId };
    const toasts = new Set<string | number>();
    const entryToasts = new Map<string, string | number>();
    const show = (
      kind: "message" | "success" | "error",
      message: string,
      options: Parameters<typeof toast>[1] = {},
    ) => {
      let id: string | number;
      const release = () => {
        toasts.delete(id);
      };
      id = (kind === "message" ? toast : toast[kind])(message, {
        ...options,
        onAutoClose: release,
        onDismiss: release,
      });
      toasts.add(id);
      return id;
    };
    const usable = () =>
      active.current === token &&
      ready &&
      !!accountId &&
      latest.current.isActiveAccount(accountId, version);
    const first = (scopes: readonly string[], can: (scope: string) => boolean) =>
      scopes.find(can) ?? scopes[0] ?? SHELL_UNDO_SCOPE;
    const report = async (
      operation: () => Promise<UndoResult>,
      redo = false,
    ): Promise<UndoResult> => {
      if (!usable()) return { status: "nothing" };
      const result = await operation();
      if (!usable()) return result;
      if (result.status === "done") {
        // An entry undone from the keyboard must not leave its own Undo button behind.
        const original = entryToasts.get(result.id);
        if (!redo && original !== undefined) {
          toast.dismiss(original);
          toasts.delete(original);
        }
        entryToasts.delete(result.id);
        show("success", `${redo ? "Redone" : "Undone"}: ${result.label}`);
      } else if (result.status === "failed")
        show(
          "error",
          `${redo ? "Couldn't redo this change." : "Couldn't undo this change."}${
            isRetryableUndoError(result.error) ? " Try again." : ""
          }`,
        );
      else if (result.status === "expired") show("message", "This change can no longer be undone.");
      return result;
    };
    return {
      token,
      clear() {
        stack.clear();
        entryToasts.clear();
        for (const id of toasts) toast.dismiss(id);
        toasts.clear();
      },
      actions: {
        push(entry: UndoEntry) {
          if (!usable()) return "";
          const id = stack.push(entry);
          const toastId = show("message", entry.label, {
            action: {
              label: "Undo",
              onClick: () => {
                toasts.delete(toastId);
                entryToasts.delete(id);
                void report(() => stack.undoById(id));
              },
            },
          });
          entryToasts.set(id, toastId);
          return id;
        },
        undo: (scopes: readonly string[]) => report(() => stack.undo(first(scopes, stack.canUndo))),
        redo: (scopes: readonly string[]) =>
          report(() => stack.redo(first(scopes, stack.canRedo)), true),
        canUndo: (scopes: readonly string[]) => usable() && scopes.some(stack.canUndo),
        canRedo: (scopes: readonly string[]) => usable() && scopes.some(stack.canRedo),
      },
    };
  }, [accountId, webId, ready, version]);
  useLayoutEffect(() => {
    active.current = session.token;
    return () => {
      active.current = null;
      session.clear();
    };
  }, [session]);
  return <UndoContext.Provider value={session.actions}>{children}</UndoContext.Provider>;
}
/** Standalone notification fixtures can run without the account-owned shell stack. */
export function useOptionalUndo(): UndoActions | null {
  const context = useContext(UndoContext);
  const scope = undoScope(usePathname());
  return useMemo(
    () =>
      context && {
        push: (entry: ScopedUndoEntry) => context.push({ ...entry, scope }),
        pushShell: (entry: ScopedUndoEntry) => context.push({ ...entry, scope: SHELL_UNDO_SCOPE }),
        undo: () => context.undo([scope, SHELL_UNDO_SCOPE]),
        redo: () => context.redo([scope, SHELL_UNDO_SCOPE]),
        canUndo: () => context.canUndo([scope, SHELL_UNDO_SCOPE]),
        canRedo: () => context.canRedo([scope, SHELL_UNDO_SCOPE]),
      },
    [context, scope],
  );
}
export function useUndo(): UndoActions {
  const actions = useOptionalUndo();
  if (!actions) throw new Error("useUndo requires UndoProvider");
  return actions;
}
