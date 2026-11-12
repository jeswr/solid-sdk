// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import { useT } from "@jeswr/suite-i18n/react";
import { useState } from "react";
import { useAccounts } from "../session/accounts-context";

/** Shared by the welcome demo action and walkthrough links. */
export function useDemoStart() {
  const t = useT();
  const { signInDemo } = useAccounts();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const start = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await signInDemo();
      return true;
    } catch {
      setFailed(true);
      return false;
    } finally {
      setBusy(false);
    }
  };
  // Translated at render, so the message follows a language change.
  return { busy, error: failed ? t("signin.demoFailed") : "", start };
}
