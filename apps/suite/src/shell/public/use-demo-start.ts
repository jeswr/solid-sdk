// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useT } from "@jeswr/suite-i18n/react";
import { useState } from "react";
import { useAccounts } from "../session/accounts-context";

/** Shared by the welcome demo action and walkthrough links. */
export function useDemoStart() {
  const t = useT();
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
      setError(t("signin.demoFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, start };
}
