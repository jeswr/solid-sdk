// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { Suspense } from "react";
import { CategoriesScreen } from "@/apps/money/components/categories";
import { MoneyOpening } from "@/apps/money/components/money-states";
export default function Page() {
  return (
    <Suspense fallback={<MoneyOpening />}>
      <CategoriesScreen />
    </Suspense>
  );
}
