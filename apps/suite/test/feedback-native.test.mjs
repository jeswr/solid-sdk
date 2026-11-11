// AUTHORED-BY Codex GPT-6.1-Sol
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkNative } from "../scripts/check-native.mjs";
import { createManifest } from "../scripts/route-manifest.mjs";
import { includeNativeSource } from "../scripts/stage-native.mjs";

it("excludes API handlers from the native source graph and manifest, keeping the feedback page", async () => {
  const root = await mkdtemp(join(tmpdir(), "feedback-native-"));
  try {
    for (const route of ["api/feedback/turn", "dev/test", ".well-known", "feedback"]) {
      await mkdir(join(root, "src/app", route), { recursive: true });
      await writeFile(
        join(root, "src/app", route, route === "feedback" ? "page.tsx" : "route.ts"),
        "export function POST() {}",
      );
    }
    await cp(join(root, "src"), join(root, "stage/src"), {
      recursive: true,
      filter: (path) => includeNativeSource(path, root),
    });
    await mkdir(join(root, "www/feedback"), { recursive: true });
    await writeFile(join(root, "www/feedback/index.html"), "");
    const manifest = await createManifest({
      appDir: join(root, "stage/src/app"),
      sourceRoot: join(root, "stage/src"),
      exportDir: join(root, "www"),
    });
    expect(manifest.routes.map((r) => r.pattern)).toEqual(["/feedback"]);
    expect(await readFile(join(root, "stage/src/app/feedback/page.tsx"), "utf8")).toContain("POST");
    await mkdir(join(root, "www/api"));
    await expect(checkNative(join(root, "www"))).rejects.toThrow("Server API routes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
