// AUTHORED-BY Codex
export const DOCX_FORMATTING_WARNING = "Some formatting may differ from the original";

export interface SkippedItem {
  label: string;
  count: number;
}

export function reportSkipped(skipped: SkippedItem[], label: string) {
  const item = skipped.find((item) => item.label === label);
  if (item) item.count++;
  else skipped.push({ label, count: 1 });
}
