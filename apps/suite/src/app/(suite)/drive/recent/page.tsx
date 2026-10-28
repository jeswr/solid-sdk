// AUTHORED-BY Claude Opus 5.5
"use client";
import { Suspense } from "react";
import { RecentView } from "@/apps/drive/components/views";

export default function Page() {
  return (
    <Suspense>
      <RecentView />
    </Suspense>
  );
}
