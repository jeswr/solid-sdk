// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@jeswr/suite-ui";
import { useState } from "react";
import { useAccounts } from "./accounts-provider";

export function ReauthDialog() {
  const { reauth, signOut } = useAccounts();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog open>
      <AlertDialogContent onEscapeKeyDown={(event) => event.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Your session ended — sign in again to continue</AlertDialogTitle>
          <AlertDialogDescription>
            Your work will stay here while you sign in.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert">{error}</p>}
        <AlertDialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => void act(() => signOut())}>
            Sign out
          </Button>
          <Button disabled={busy} onClick={() => void act(reauth)}>
            Sign in again
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
