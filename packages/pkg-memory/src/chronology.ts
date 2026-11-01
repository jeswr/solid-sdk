// AUTHORED-BY Codex GPT-6.1-Sol
/** Compare validated dateTimes, retaining the model's six fractional digits. */
export function compareDateTimes(left: string, right: string): number {
  const milliseconds = Date.parse(left) - Date.parse(right);
  if (milliseconds !== 0) return milliseconds;
  const remainder = (value: string) =>
    Number((/\.(\d+)/.exec(value)?.[1] ?? "").padEnd(6, "0").slice(3, 6));
  return remainder(left) - remainder(right);
}
