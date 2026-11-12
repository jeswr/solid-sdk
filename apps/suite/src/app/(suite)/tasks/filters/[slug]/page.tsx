// AUTHORED-BY Codex GPT-6.1-Sol
import { Suspense } from "react";
import { FilterRoute } from "@/apps/tasks/components/native-routes";

export const dynamicParams = true;
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? [{ slug: "__" }] : [];
}
export const metadata = { title: "Filters · Tasks · Solid Suite" };
export default function FilterPage() {
  return (
    <Suspense>
      <FilterRoute />
    </Suspense>
  );
}
