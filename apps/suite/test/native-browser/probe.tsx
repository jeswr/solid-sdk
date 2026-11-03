// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { encodeRef } from "@/lib/refs";
import { useRouteParams } from "@/lib/route-params";

const href = (folder: string) => `/drive/f/${encodeRef(`https://native-browser.pod/${folder}/`)}/`;

/** Staged around the real folder view, at page scope, so local state detects remounts. */
export function NativeRouteProbe({ children }: { children: ReactNode }) {
  const params = useRouteParams<{ ref: string }>("/drive/f/[ref]");
  const router = useRouter();
  const [value, setValue] = useState("");
  return (
    <>
      <nav aria-label="Browser test navigation">
        <Link href={href("beta")} prefetch={false}>
          Open beta
        </Link>
        <button type="button" onClick={() => router.push(href("gamma"))}>
          Push gamma
        </button>
        <button type="button" onClick={() => router.prefetch(href("gamma"))}>
          Prefetch gamma
        </button>
      </nav>
      <label>
        Route state
        <input value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <output data-testid="route-ref">{params?.ref ?? "Loading"}</output>
      {children}
    </>
  );
}
