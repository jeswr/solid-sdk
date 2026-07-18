/**
 * THE document (single edit surface): apps/tour/content/walkthrough.json drives the
 * whole site. `parseWalkthrough` validates the schema, every cross-reference, and the
 * editorial budgets at module load — a broken document fails fast, everywhere at once.
 */
import { parseWalkthrough } from "@jeswr/solid-showcase";
import walkthroughJson from "../content/walkthrough.json";

export const walkthrough = parseWalkthrough(walkthroughJson);
