// AUTHORED-BY Codex GPT-6.1-Sol
import { isSafeAbsoluteIri } from "@jeswr/model-runtime";
import { type Nanopublications, parseNanopublications } from "@jeswr/pkg-memory";
import { HealthGraphError } from "./types.js";

/** Read locally, retaining whole valid nanopubs. Apply purpose policy before projection. */
export async function importHealthExport(
  text: string,
  options: { owner: string },
): Promise<{
  value: Nanopublications;
  skipped: { count: number; reasons: Record<string, number> };
}> {
  if (!isSafeAbsoluteIri(options.owner) || !/^https?:/.test(options.owner))
    throw new HealthGraphError("invalid-input");
  try {
    const { dataset, nanopubs, skipped } = await parseNanopublications(text, { invalid: "skip" });
    const reasons: Record<string, number> = {};
    for (const { errorClass } of skipped) reasons[errorClass] = (reasons[errorClass] ?? 0) + 1;
    return { value: { dataset, nanopubs }, skipped: { count: skipped.length, reasons } };
  } catch {
    throw new HealthGraphError("read-failed");
  }
}
