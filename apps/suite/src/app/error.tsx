// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button } from "@jeswr/suite-ui";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { reportProblemUrl } from "@/shell/lib/report-problem";
import { appForPath } from "@/shell/registry";
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const route = usePathname();
  const [errorId, setErrorId] = useState<string>();
  useEffect(() => {
    const id = crypto.randomUUID();
    setErrorId(id);
    console.error(id, error);
  }, [error]);
  return (
    <main id="main-content" className="shell-error-page">
      <h1>Something went wrong</h1>
      <div className="shell-error-actions">
        <Button onClick={reset}>Reload</Button>
        <Button asChild variant="outline">
          <a
            href={reportProblemUrl({
              app: appForPath(route)?.name ?? "Solid Suite",
              route,
              error: error.message,
              ...(errorId ? { errorId } : {}),
            })}
            rel="noopener noreferrer"
          >
            Report a problem
          </a>
        </Button>
      </div>
    </main>
  );
}
