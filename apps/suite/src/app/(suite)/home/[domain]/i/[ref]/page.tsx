// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { Suspense } from "react";
import { HomeItemRoute } from "@/apps/home/components/native-routes";

// Staging sets this literal to false; the web target retains on-demand routes.
export const dynamicParams = true;
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? [{ domain: "__", ref: "__" }] : [];
}
export default function Page() {
  return (
    <Suspense>
      <HomeItemRoute />
    </Suspense>
  );
}
