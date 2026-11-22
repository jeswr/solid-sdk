// AUTHORED-BY Codex GPT-6.1-Sol

import { LoadingSkeleton } from "@jeswr/suite-ui";
import { Suspense } from "react";
import { DiaryView } from "@/apps/health/components/diary-view";
export default function DiaryPage() {
  return (
    <Suspense fallback={<LoadingSkeleton label="Loading diary" />}>
      <DiaryView />
    </Suspense>
  );
}
