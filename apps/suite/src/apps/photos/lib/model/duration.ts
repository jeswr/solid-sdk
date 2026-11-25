// AUTHORED-BY Codex GPT-6.1-Sol
/** Fixed-length ISO 8601 durations only: days, hours, minutes and fractional seconds. */
export function parseDuration(value: string): number | undefined {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/u.exec(value);
  if (!match || value.endsWith("T") || !match.slice(1).some((part) => part !== undefined))
    return undefined;
  const seconds =
    Number(match[1] ?? 0) * 86400 +
    Number(match[2] ?? 0) * 3600 +
    Number(match[3] ?? 0) * 60 +
    Number(match[4] ?? 0);
  return Number.isFinite(seconds) && seconds <= Number.MAX_SAFE_INTEGER ? seconds : undefined;
}

/** Seconds-only form avoids calendar units and preserves fractional movie timescales. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > Number.MAX_SAFE_INTEGER)
    throw new TypeError("Expected a finite, non-negative video duration");
  // JS uses exponents for tiny numbers; xsd:duration requires ordinary decimals.
  const decimal = String(seconds).replace(
    /^(\d)(?:\.(\d+))?e-(\d+)$/u,
    (_match, integer: string, fraction: string | undefined, exponent: string) =>
      `0.${"0".repeat(Number(exponent) - 1)}${integer}${fraction ?? ""}`,
  );
  return `PT${decimal}S`;
}
