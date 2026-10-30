// AUTHORED-BY Codex GPT-6.1-Sol
export type ErrorCategory =
  | "reauth"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "name-taken"
  | "unsupported"
  | "offline"
  | "unreachable"
  | "quota"
  | "too-large"
  | "unknown";
const statusCodes: Record<number, string> = {
  401: "unauthenticated",
  403: "forbidden",
  404: "not-found",
  410: "not-found",
  412: "precondition-failed",
  409: "conflict",
  413: "payload-too-large",
  429: "rate-limited",
  507: "insufficient-storage",
};
/** Structural A-7 mapping, independent of the future SDK façade. */
export function classifyError(error: unknown, online = true): ErrorCategory {
  const value = error as { code?: string; status?: number } | null;
  const code =
    value?.code ??
    (value?.status === undefined
      ? "invalid-response"
      : (statusCodes[value.status] ?? (value.status >= 500 ? "server" : "invalid-response")));
  const categories: Record<string, ErrorCategory> = {
    unauthenticated: "reauth",
    forbidden: "forbidden",
    "not-found": "not-found",
    "precondition-failed": "conflict",
    conflict: "name-taken",
    unsupported: "unsupported",
    server: "unreachable",
    "rate-limited": "unreachable",
    "insufficient-storage": "quota",
    "payload-too-large": "too-large",
  };
  return code === "network"
    ? online
      ? "unreachable"
      : "offline"
    : (categories[code] ?? "unknown");
}
export class ModelError extends Error {
  readonly code: string;
  constructor(
    readonly status: number,
    readonly url: string,
    readonly etag: string | null = null,
    options?: ErrorOptions,
  ) {
    super(`Tasks resource request failed (${status}).`, options);
    this.name = "ModelError";
    this.code =
      statusCodes[status] ??
      (status === 0 ? "network" : status >= 500 ? "server" : "invalid-response");
  }
  get category(): ErrorCategory {
    return classifyError(this);
  }
}
