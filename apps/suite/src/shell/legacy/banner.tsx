// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Alert, AlertDescription, AlertTitle } from "@jeswr/suite-ui";
import { useEffect, useState } from "react";
import { legacyWarning } from "./presentation";
import { useLegacy } from "./provider";
export function LegacyBanner() {
  const { session } = useLegacy();
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  const message = session?.snapshot?.plan && legacyWarning(session.snapshot.plan, session.now());
  if (!message) return null;
  return (
    <Alert>
      <AlertTitle>Recovery &amp; legacy</AlertTitle>
      <AlertDescription>
        {message} <a href="/settings/legacy">Review your legacy plan</a>
      </AlertDescription>
    </Alert>
  );
}
