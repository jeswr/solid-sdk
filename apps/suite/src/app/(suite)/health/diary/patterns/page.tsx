// AUTHORED-BY Codex GPT-6.1-Sol
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { Suspense } from "react";
import { DiaryPatterns } from "@/apps/health/components/diary-patterns";
export default function DiaryPatternsPage() {
  return (
    <Suspense fallback={<LoadingSkeleton label="Loading diary patterns" />}>
      <DiaryPatterns />
    </Suspense>
  );
}
