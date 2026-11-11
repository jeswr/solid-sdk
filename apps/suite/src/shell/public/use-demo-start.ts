// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useState } from "react";
import { useAccounts } from "../session/accounts-context";

/** Shared by the welcome demo action and walkthrough links. */
export function useDemoStart() {
  const { signInDemo } = useAccounts();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const start = async () => {
    setBusy(true);
    setError("");
    try {
      await signInDemo();
      return true;
    } catch {
      setError("We couldn't open the demo pod. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, start };
}
