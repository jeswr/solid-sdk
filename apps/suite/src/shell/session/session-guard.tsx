// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { useAccounts } from "./accounts-provider";
import { ReauthDialog } from "./reauth-dialog";

export function SessionGuard({ children }: { children: ReactNode }) {
  const { status } = useAccounts();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const router = useRouter();
  useEffect(() => {
    if (status === "signed-out")
      router.replace(`/signin?next=${encodeURIComponent(pathname + (search ? `?${search}` : ""))}`);
  }, [status, pathname, search, router]);
  if (status === "loading" || status === "signed-out")
    return (
      <main id="main-content" className="shell-loading">
        <LoadingSkeleton label="Loading Solid Suite" />
      </main>
    );
  return (
    <>
      <div inert={status === "expired"}>{children}</div>
      {status === "expired" && <ReauthDialog />}
    </>
  );
}
