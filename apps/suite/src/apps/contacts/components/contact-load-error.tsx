// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { ErrorState } from "@jeswr/suite-ui";

export function ContactLoadError({ onRetry }: { onRetry(): void }) {
  return (
    <ErrorState error="unreachable" actions={{ retry: onRetry }}>
      <p>We couldn't load your contacts. Check your connection and try again.</p>
    </ErrorState>
  );
}
