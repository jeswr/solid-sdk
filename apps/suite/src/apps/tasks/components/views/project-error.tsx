// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, ErrorState } from "@jeswr/suite-ui";
import type { ReactNode } from "react";
import { classifyError } from "../../lib/model/errors";

/** A project read can be retried even when the shared error category has no Retry action. */
export function ProjectError({
  error,
  retry,
  children,
}: {
  error: unknown;
  retry: () => void;
  children?: ReactNode;
}) {
  return (
    <ErrorState error={classifyError(error)}>
      {children}
      <Button onClick={retry}>Retry</Button>
    </ErrorState>
  );
}
