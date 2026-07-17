// AUTHORED-BY Claude Fable 5
import { cn } from "@jeswr/app-shell";

export type ReceiptAction = "grant" | "revoke";

export interface ReceiptCardProps {
  action: ReceiptAction;
  /** WebID of the person who approved the change. */
  actor: string;
  /** WebID of the organisation whose access changed. */
  recipient: string;
  /** Pod resource covered by the consent change. */
  resource: string;
  /** ISO 8601 receipt timestamp. */
  issuedAt: string;
  className?: string | undefined;
}

/**
 * One app-level DPV consent receipt. The card deliberately calls itself an app receipt:
 * WAC enforces access, but neither WAC nor the Solid protocol supplies this audit trail.
 */
export function ReceiptCard({
  action,
  actor,
  recipient,
  resource,
  issuedAt,
  className,
}: ReceiptCardProps) {
  const label = action === "grant" ? "Access granted" : "Access revoked";
  return (
    <article
      className={cn("rounded-lg border border-border bg-card p-4", className)}
      data-receipt-action={action}
      data-receipt-card=""
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-card-foreground text-sm">{label}</h3>
        <time className="text-muted-foreground text-xs" dateTime={issuedAt}>
          {new Date(issuedAt).toLocaleString("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "UTC",
          })}
          {" UTC"}
        </time>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[7rem_1fr]">
        <dt className="font-medium text-muted-foreground">Approved by</dt>
        <dd className="m-0 break-all text-card-foreground">{actor}</dd>
        <dt className="font-medium text-muted-foreground">Organisation</dt>
        <dd className="m-0 break-all text-card-foreground">{recipient}</dd>
        <dt className="font-medium text-muted-foreground">Resource</dt>
        <dd className="m-0 break-all text-card-foreground">{resource}</dd>
      </dl>
      <p className="mt-3 text-muted-foreground text-xs">
        DPV consent record written by this application to the data subject&apos;s pod.
      </p>
    </article>
  );
}
