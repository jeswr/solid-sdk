// AUTHORED-BY Codex GPT-6.1-Sol
import { cn } from "../../lib/utils.js";
export const STATUS_DOT_LABELS = {
  success: "Saved",
  warning: "Pending",
  destructive: "Error",
  info: "Information",
  neutral: "Unavailable",
} as const;
export type StatusDotProps = {
  status: keyof typeof STATUS_DOT_LABELS;
  label?: string;
  className?: string;
};
export function StatusDot({
  status,
  label = STATUS_DOT_LABELS[status],
  className,
}: StatusDotProps) {
  return (
    <span className={cn("suite-status", className)} role="status">
      <span className="suite-status-dot" data-status={status} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
