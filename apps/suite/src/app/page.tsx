// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { START_PAGE } from "@/shell/lib/next";
import { useAccounts } from "@/shell/session/accounts-provider";
export default function Page() {
  const { status } = useAccounts();
  const router = useRouter();
  useEffect(() => {
    if (status !== "loading") router.replace(status === "signed-out" ? "/welcome" : START_PAGE);
  }, [status, router]);
  return (
    <main id="main-content" className="shell-loading">
      <LoadingSkeleton label="Loading Solid Suite" />
    </main>
  );
}
