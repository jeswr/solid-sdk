// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { Suspense } from "react";
import { MusicSearchRoute } from "@/apps/music/components/native-routes";
export default function Page() {
  return (
    <Suspense fallback={<LoadingSkeleton label="Loading Music search" preset="table" />}>
      <MusicSearchRoute />
    </Suspense>
  );
}
