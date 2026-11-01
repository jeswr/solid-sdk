// AUTHORED-BY Claude Opus 5.5
"use client";
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { useSearchParams } from "next/navigation";
import { usePageRouteParams } from "@/lib/route-params";
import { MusicScreen } from "./music-screen";

const PATTERNS = {
  album: "/music/a/[ref]",
  artist: "/music/ar/[ref]",
  playlist: "/music/p/[ref]",
} as const;

/** Read the ref on the client, so the native export's placeholder page works too. */
export function MusicRefRoute({ view }: { view: keyof typeof PATTERNS }) {
  const params = usePageRouteParams<{ ref: string }>(PATTERNS[view]);
  if (!params) return <LoadingSkeleton preset="grid" />;
  return <MusicScreen view={view} reference={params.ref} />;
}

/** The query comes from the URL on the client, so the page can be exported statically. */
export function MusicSearchRoute() {
  return <MusicScreen view="search" query={useSearchParams().get("q") ?? ""} />;
}
