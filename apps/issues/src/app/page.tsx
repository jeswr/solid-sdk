"use client";

import { useSolidSession } from "@/lib/session-context";
import { LoginScreen } from "@/components/login-screen";
import { IssuesView } from "@/components/issues-view";
import { Loader2 } from "lucide-react";

export default function Home() {
  const { status } = useSolidSession();

  if (status === "initialising") {
    return (
      <main className="flex flex-1 items-center justify-center" aria-busy="true">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </main>
    );
  }

  if (status === "logged-in") {
    return <IssuesView />;
  }

  return <LoginScreen />;
}
