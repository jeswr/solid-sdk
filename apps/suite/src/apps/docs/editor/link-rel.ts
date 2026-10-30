// AUTHORED-BY Codex
/** Link attributes from HTML or stored JSON cannot opt back into window.opener. */
export function protectiveLinkRel(value: unknown): string {
  const tokens = typeof value === "string" ? value.toLowerCase().split(/\s+/).filter(Boolean) : [];
  return [
    ...new Set(["noopener", "noreferrer", ...tokens.filter((token) => token !== "opener")]),
  ].join(" ");
}
