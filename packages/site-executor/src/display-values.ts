// AUTHORED-BY Codex GPT-6.1-Sol
// Conservative display coercion for list rows. Never interpret a symbol as currency.
export function displayDecimal(text: string): string | undefined {
  const value = text
    .trim()
    .replace(/^(?:[A-Z]{3}|[$€£¥])\s*|\s*(?:[A-Z]{3}|[$€£¥])$/g, "")
    .trim();
  if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) return value;
  if (/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d{2})?$/.test(value)) return value.replace(/,/g, "");
  if (/^[+-]?\d{1,3}(?:\.\d{3})+,\d{2}$/.test(value))
    return value.replace(/\./g, "").replace(",", ".");
  if (/^[+-]?\d+,\d{2}$/.test(value)) return value.replace(",", ".");
  if (/^[+-]?\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{2})?$/.test(value))
    return value.replace(/[ \u00a0\u202f]/g, "").replace(",", ".");
  return undefined;
}
export function displayDateTime(text: string): string | undefined {
  const value = text.replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T");
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))?$/.exec(
      value,
    );
  if (!match) return undefined;
  const [, y = 0, m = 0, d = 0, h = 0, min = 0, sec = 0] = match.map(Number);
  if (
    !y ||
    !m ||
    !d ||
    m > 12 ||
    d > new Date(Date.UTC(y, m, 0)).getUTCDate() ||
    h > 23 ||
    min > 59 ||
    sec > 59
  )
    return undefined;
  return value;
}
