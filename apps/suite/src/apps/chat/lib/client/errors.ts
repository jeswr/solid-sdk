// AUTHORED-BY Codex GPT-6.1-Sol
/** Interim translation to suite-ui recovery categories until the SDK façade lands. */
export function classifyChatError(error: unknown) {
  const status =
    typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
  switch (status) {
    case 401:
      return "reauth";
    case 403:
      return "forbidden";
    case 404:
    case 410:
      return "not-found";
    case 412:
      return "conflict";
    case 507:
      return "quota";
    case 413:
      return "too-large";
    case 429:
      return "unreachable";
    default:
      return (typeof status === "number" && status >= 500) || error instanceof TypeError
        ? "unreachable"
        : "unknown";
  }
}
