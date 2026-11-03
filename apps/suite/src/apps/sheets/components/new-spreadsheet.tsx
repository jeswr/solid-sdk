// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button } from "@jeswr/suite-ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { decodeRef } from "@/lib/refs";
import { usePodSessionState } from "@/lib/session/pod-session";
import { useWorkbookService } from "../state/service";
import { workbookHref } from "./sheets-sidebar";

export function NewSpreadsheet({ src }: { src?: string }) {
  const service = useWorkbookService();
  const session = usePodSessionState();
  const router = useRouter();
  const creation = useRef<Promise<string> | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries creation
  useEffect(() => {
    if (session.status !== "ready") return;
    let live = true;
    setError(false);
    creation.current ??= (async () => {
      if (!src) return (await service.create({ title: "Untitled spreadsheet" })).container;
      // Drive may supply a base64url ref or a URL encoded in the query string.
      const url = new URL(/^https?:\/\//.test(src) ? src : decodeRef(src));
      if (!/^https?:$/.test(url.protocol)) throw new Error("Invalid CSV URL");
      const response = await session.session.fetch(url.href);
      if (!response.ok) throw new Error("Couldn't read this CSV from your pod");
      const title = decodeURIComponent(url.pathname.split("/").at(-1) || "Imported spreadsheet");
      return (await service.createFromCsv({ title, csv: await response.text() })).container;
    })();
    void creation.current.then(
      (container) => {
        if (live) router.replace(workbookHref(container));
      },
      () => {
        if (live) setError(true);
      },
    );
    return () => {
      live = false;
    };
  }, [service, session, router, src, attempt]);
  return (
    <div className="sht-state">
      {error ? (
        <>
          <h1>Couldn't create this spreadsheet</h1>
          <Button
            onClick={() => {
              creation.current = null;
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </Button>
          <Link href="/sheets">Back to spreadsheets</Link>
        </>
      ) : (
        <p role="status">Creating your spreadsheet…</p>
      )}
    </div>
  );
}
