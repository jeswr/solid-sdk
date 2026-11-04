// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { Suspense } from "react";
import { LabelRoute } from "@/apps/tasks/components/native-routes";

// Staging sets this literal to false; the web target retains on-demand routes.
export const dynamicParams = true;
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? [{ label: "__" }] : [];
}
export async function generateMetadata({ params }: { params: Promise<{ label: string }> }) {
  // The native export has one placeholder page for every label.
  if (process.env.NEXT_PUBLIC_SUITE_TARGET === "native")
    return { title: "Label · Tasks · Solid Suite" };
  const { label } = await params;
  return { title: `@${label} · Tasks · Solid Suite` };
}
export default function LabelPage() {
  return (
    <Suspense>
      <LabelRoute />
    </Suspense>
  );
}
