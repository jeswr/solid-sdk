// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Alert, AlertDescription, AlertTitle } from "@jeswr/suite-ui";
import { useEffect, useState } from "react";
import { legacyWarning } from "./presentation";
import { useLegacy } from "./provider";
export function LegacyBanner() {
  const { session } = useLegacy();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  const message = session?.snapshot && legacyWarning(session.snapshot.plan, now);
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
