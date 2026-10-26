// AUTHORED-BY Codex GPT-6.1-Sol
import { cn } from "../../lib/utils.js";
export type CountBadgeProps = { count: number; label?: string; className?: string };
export function CountBadge({ count, label = "unread", className }: CountBadgeProps) {
  if (!Number.isSafeInteger(count) || count < 0)
    throw new RangeError("CountBadge requires a nonnegative safe integer");
  return (
    <span className={cn("suite-count", className)} role="status" aria-label={`${count} ${label}`}>
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
    </span>
  );
}
