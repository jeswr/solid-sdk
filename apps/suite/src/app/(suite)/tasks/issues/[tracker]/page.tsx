// AUTHORED-BY Codex GPT-6.1-Sol
import { Suspense } from "react";
import { IssuesRoute } from "@/apps/tasks/components/issues/issues-view";
export const metadata = { title: "Issues · Tasks · Solid Suite" };
export const dynamicParams = true;
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? [{ tracker: "__" }] : [];
}
export default function TrackerIssuesPage() {
  return (
    <Suspense>
      <IssuesRoute />
    </Suspense>
  );
}
