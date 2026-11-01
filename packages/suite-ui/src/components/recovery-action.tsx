// AUTHORED-BY Claude Opus 5.5
// Internal: shared by ErrorState and SurfaceFeedback; not re-exported from the package index.
import { type ErrorAction, errorActionLabels } from "./async-copy.js";

export function RecoveryAction({
  name,
  action,
  disabled = false,
}: {
  name: ErrorAction;
  action: (() => void) | string;
  disabled?: boolean;
}) {
  if (typeof action === "string" && !disabled) {
    // Use native links for navigation; never expose non-HTTP executable schemes.
    if (!/^(?:\/(?!\/)|https?:\/\/)/i.test(action)) return null;
    return (
      <a className="suite-async-action" href={action} rel="noopener noreferrer">
        {errorActionLabels[name]}
      </a>
    );
  }
  return (
    <button
      type="button"
      className="suite-async-action"
      disabled={disabled}
      onClick={typeof action === "function" ? action : undefined}
    >
      {errorActionLabels[name]}
    </button>
  );
}
