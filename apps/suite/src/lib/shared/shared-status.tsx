// AUTHORED-BY Claude Sonnet 5.5
"use client";
import type { SharedInboxFailure } from "@jeswr/suite-sdk/shared";
import { Button, ErrorState } from "@jeswr/suite-ui";

/**
 * A failed inbox read is never shown as an empty one. Unreachable and forbidden reads offer
 * Retry; storages that cannot list announcements at all say so, and Retry would not help.
 */
export function SharedFailure({
  failure,
  retry,
}: {
  failure: SharedInboxFailure;
  retry: () => void;
}) {
  if (failure === "lws-no-ldn" || failure === "outside-storage")
    return (
      <ErrorState error="unsupported">
        <p className="hm-muted">
          This storage can't list announcements of shared items, so only items you've opened or
          added are shown here.
        </p>
      </ErrorState>
    );
  if (failure === "forbidden")
    return (
      <ErrorState error="forbidden">
        <p className="hm-muted">We couldn't read the inbox where people announce shares to you.</p>
        <Button variant="outline" onClick={retry}>
          Retry
        </Button>
      </ErrorState>
    );
  return <ErrorState error="unreachable" actions={{ retry }} />;
}

/** Shown when the inbox holds more than the bound read; older announcements may be missing. */
export function SharedTruncated({ limit }: { limit: number }) {
  return (
    <p className="hm-muted" role="status">
      Showing the most recent {limit} inbox notifications. Older shares may not be listed.
    </p>
  );
}
