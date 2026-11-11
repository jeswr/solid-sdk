// AUTHORED-BY Codex GPT-6.1-Sol
import { Suspense } from "react";
import { IssuesView } from "@/apps/tasks/components/issues/issues-view";
export const metadata = { title: "Issues · Tasks · Solid Suite" };
export default function IssuesPage() {
  return (
    <Suspense>
      <IssuesView />
    </Suspense>
  );
}
