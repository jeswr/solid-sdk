/**
 * Single-sourced registry data: this app's name, theme, modelled-on framing, and
 * honesty content all come from the SAME walkthrough document the tour renders —
 * apps and tour can never disagree.
 */
import walkthroughJson from "@__CSD_SLUG__/app-tour/content/walkthrough.json";
import { parseWalkthrough, registeredApp } from "@jeswr/solid-showcase";

export const walkthrough = parseWalkthrough(walkthroughJson);
export const app = registeredApp(walkthrough.registry, "__CSD_APP_SLUG__");
