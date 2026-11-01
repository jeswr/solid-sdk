// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button } from "@jeswr/suite-ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSuiteEnvironment } from "../environment";
import { safeNext } from "../lib/next";
import { useAccounts } from "../session/accounts-provider";
export function DemoButton({ next }: { next?: string | null }) {
  const { signInDemo } = useAccounts();
  const router = useRouter();
  const env = useSuiteEnvironment();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!env.NEXT_PUBLIC_SUITE_DEMO) return null;
  return (
    <>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await signInDemo();
            router.replace(safeNext(next));
          } catch {
            setError("We couldn't open the demo pod. Please try again.");
            setBusy(false);
          }
        }}
      >
        Try it with a demo pod
      </Button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
