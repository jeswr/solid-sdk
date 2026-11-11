// AUTHORED-BY Codex GPT-6
import { ProviderRejectedError } from "../errors.js";

/** Trusted account configuration, never inferred from provider error descriptions. */
export type GmailTenant = "ODI" | "google_workspace";
type SetupErrorCode = "admin_policy_enforced" | "access_denied";

/** Explicit refusal requiring account setup; carries no provider body or credentials. */
export class GmailSetupRequiredError extends ProviderRejectedError {
  readonly state = "setup-required";
  readonly code: SetupErrorCode;
  readonly detail: string;

  constructor(code: SetupErrorCode, tenant?: GmailTenant) {
    const detail =
      code === "admin_policy_enforced"
        ? `ask ${tenant === "ODI" ? "ODI" : "Google Workspace"} admin to allow-list client id`
        : "Google access denied; review consent for the configured account";
    super(`setup-required: ${detail}`);
    this.name = "GmailSetupRequiredError";
    this.code = code;
    this.detail = detail;
  }
}

/** Map an exact OAuth code or { error: code }; unrelated failures remain unclassified. */
export function mapGmailError(
  error: unknown,
  tenant?: GmailTenant,
): GmailSetupRequiredError | undefined {
  const code =
    error !== null && typeof error === "object" && !Array.isArray(error)
      ? (error as { error?: unknown }).error
      : error;
  if (code === "admin_policy_enforced" || code === "access_denied")
    return new GmailSetupRequiredError(code, tenant);
  return undefined;
}
