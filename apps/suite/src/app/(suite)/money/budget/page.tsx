// AUTHORED-BY Codex GPT-6.1-Sol
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { Suspense } from "react";
import { BudgetScreen } from "@/apps/money/components/budget";
export default function Page() {
  return (
    <Suspense
      fallback={
        <>
          <h1>Budget</h1>
          <LoadingSkeleton preset="table" label="Loading budget" />
        </>
      }
    >
      <BudgetScreen />
    </Suspense>
  );
}
