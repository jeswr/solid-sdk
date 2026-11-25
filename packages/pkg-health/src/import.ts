// AUTHORED-BY Codex GPT-6.1-Sol
import { isSafeAbsoluteIri } from "@jeswr/model-runtime";
import { type Nanopublications, parseNanopublicationsTolerant } from "@jeswr/pkg-memory";
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
  let parsed: Awaited<ReturnType<typeof parseNanopublicationsTolerant>>;
  try {
    parsed = await parseNanopublicationsTolerant(text);
  } catch (error) {
    // The parser refuses an export with too many heads before reading any graph.
    throw new HealthGraphError(
      error instanceof Error && error.message === "Too many nanopublications"
        ? "too-large"
        : "read-failed",
    );
  }
  const { dataset, nanopubs, skipped, affected, skippedTargets, skippedTargetsOverflow } = parsed;
  const reasons: Record<string, number> = {};
  for (const { errorClass } of skipped) reasons[errorClass] = (reasons[errorClass] ?? 0) + 1;
  return {
    value: {
      dataset,
      nanopubs,
      affected,
      skippedTargets,
      ...(skippedTargetsOverflow ? { skippedTargetsOverflow } : {}),
    },
    skipped: { count: skipped.length, reasons },
  };
}
