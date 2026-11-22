// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { createUndoStack, type UndoEntry, type UndoResult } from "@jeswr/suite-sdk/undo";
import { toast } from "@jeswr/suite-ui";
import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useContext, useLayoutEffect, useMemo, useRef } from "react";
import { useAccounts } from "../session/accounts-provider";

export type ScopedUndoEntry = Omit<UndoEntry, "scope">;
interface UndoActions {
  push(entry: ScopedUndoEntry): string;
  undo(): Promise<UndoResult>;
  redo(): Promise<UndoResult>;
}
const UndoContext = createContext<{
  push(entry: UndoEntry): string;
  undo(scope: string): Promise<UndoResult>;
  redo(scope: string): Promise<UndoResult>;
} | null>(null);
export function undoScope(pathname: string | null): string {
  return pathname?.split("/").filter(Boolean)[0] ?? "home";
}

/** One usable account session owns history; old actions lose authority after replacement. */
export function UndoProvider({ children }: { children: ReactNode }) {
  const accounts = useAccounts();
  const accountId = accounts.active?.id;
  const webId = accounts.active?.webId;
  const ready = accounts.status === "ready";
  const active = useRef<object | null>(null);
  const latest = useRef(accounts);
  useLayoutEffect(() => {
    latest.current = accounts;
  });
  const session = useMemo(() => {
    const stack = createUndoStack();
    const token = { webId };
    const toasts = new Set<string | number>();
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
      active.current === token && ready && !!accountId && latest.current.isActiveAccount(accountId);
    const report = async (
      operation: () => Promise<UndoResult>,
      redo = false,
    ): Promise<UndoResult> => {
      if (!usable()) return { status: "nothing" };
      const result = await operation();
      if (!usable()) return result;
      if (result.status === "done") show("success", redo ? "Redone" : "Undone");
      else if (result.status === "failed")
        show("error", redo ? "Couldn't redo this change." : "Couldn't undo this change.");
      else if (result.status === "expired") show("message", "This change can no longer be undone.");
      return result;
    };
    return {
      token,
      clear() {
        stack.clear();
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
                void report(() => stack.undoById(id));
              },
            },
          });
          return id;
        },
        undo: (scope: string) => report(() => stack.undo(scope)),
        redo: (scope: string) => report(() => stack.redo(scope), true),
      },
    };
  }, [accountId, webId, ready]);
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
        undo: () => context.undo(scope),
        redo: () => context.redo(scope),
      },
    [context, scope],
  );
}
export function useUndo(): UndoActions {
  const actions = useOptionalUndo();
  if (!actions) throw new Error("useUndo requires UndoProvider");
  return actions;
}
