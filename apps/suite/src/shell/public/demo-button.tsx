// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useT } from "@jeswr/suite-i18n/react";
import { Button } from "@jeswr/suite-ui";
import { useRouter } from "next/navigation";
import { useSuiteEnvironment } from "../environment";
import { safeNext } from "../lib/next";
import { useDemoStart } from "./use-demo-start";
export function DemoButton({ next }: { next?: string | null }) {
  const t = useT();
  const { busy, error, start } = useDemoStart();
  const router = useRouter();
  const env = useSuiteEnvironment();
  if (!env.NEXT_PUBLIC_SUITE_DEMO) return null;
  return (
    <>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={async () => {
          if (await start()) router.replace(safeNext(next));
        }}
      >
        {t("signin.demo")}
      </Button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
