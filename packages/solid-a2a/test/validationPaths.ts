// AUTHORED-BY Codex GPT-6.1-Sol
import type { ValidationReport } from "../src/types.js";
import { validateIntent } from "../src/validate.js";
import { validateGraphs } from "../src/validationCore.js";
import { intentQuads, shapeQuads } from "../src/validationInputs.js";

// Run the full existing matrix directly against source core as well as the worker.
// Match the public never-throw envelope without routing core tests through dist.
const core: typeof validateIntent = async (intent, shape): Promise<ValidationReport> => {
  try {
    return await validateGraphs(intentQuads(intent), shapeQuads(shape));
  } catch (error) {
    return {
      conforms: false,
      results: [{ message: error instanceof Error ? error.message : String(error) }],
    };
  }
};
export const validationPaths = [
  ["source core", core],
  ["worker", validateIntent],
] as const;
