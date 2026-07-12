// AUTHORED-BY GPT-5.6
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const INLINED_DECLARATION_REFERENCE = /(["'])@jeswr\/solid-session-restore(?:\/[^"']*)?\1/;
const DECLARATION_FILE = /\.d\.(?:ts|mts|cts)$/;

/** Fail if declarations expose the workspace-only dependency in the mirror API. */
export function assertDeclarationsSelfContained(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      assertDeclarationsSelfContained(path);
    } else if (
      DECLARATION_FILE.test(entry.name) &&
      INLINED_DECLARATION_REFERENCE.test(readFileSync(path, "utf8"))
    ) {
      throw new Error(
        `${path} references inlined dependency @jeswr/solid-session-restore; ` +
          "re-declare the leaked type locally so mirror consumers remain self-contained",
      );
    }
  }
}
