// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button } from "@jeswr/suite-ui";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { DemoButton } from "@/shell/public/demo-button";
import { useRegistration } from "@/shell/registration/use-registration";
export default function Page() {
  return (
    <Suspense>
      <Welcome />
    </Suspense>
  );
}
function Welcome() {
  const registration = useRegistration();
  const next = useSearchParams().get("next");
  return (
    <>
      <h1>Your documents, files and tasks — kept in a pod you control</h1>
      <p>One place for your data, with you in charge of who can use it.</p>
      <div className="shell-public-actions">
        <Button asChild>
          <a href="/signin">Sign in</a>
        </Button>
        {registration.available && (
          <Button variant="outline" asChild>
            <a href="/signup">Create account</a>
          </Button>
        )}
        <DemoButton next={next} />
      </div>
      <a href="/signin">Works with your own pod</a>
    </>
  );
}
