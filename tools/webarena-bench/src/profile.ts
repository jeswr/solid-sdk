// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeSiteModel } from "@jeswr/site-model";
import { type Demonstration, profileSite } from "@jeswr/site-profiler";
import type { BenchConfig } from "./config.js";
import { writeJson } from "./run.js";
import type { Site } from "./types.js";

type DemoStep =
  | { action: "goto"; path: string }
  | { action: "click"; selector: string }
  | { action: "fill" | "select" | "press"; selector: string; value: string }
  | { action: "waitForURL"; path: string };
interface DemoRecording {
  site: Site;
  scope: "site-generic";
  demonstrations: { name: string; description: string; steps: DemoStep[] }[];
}

/** A recording has no task IDs, dataset context, API docs or task answers. */
export async function loadDemonstrations(path: string, site: Site, baseUrl: string) {
  const text = await readFile(path, "utf8");
  const recording: DemoRecording = JSON.parse(text);
  if (
    recording.scope !== "site-generic" ||
    recording.site !== site ||
    !Array.isArray(recording.demonstrations)
  )
    throw new Error("Demonstration must be a site-generic recording for this site.");
  const demonstrations: Demonstration[] = recording.demonstrations.map((demo) => {
    if (!demo.name || !demo.description || !Array.isArray(demo.steps))
      throw new Error("Invalid demonstration.");
    for (const step of demo.steps) {
      if (!["goto", "click", "fill", "select", "press", "waitForURL"].includes(step.action))
        throw new Error("Unknown demonstration step.");
      if ("path" in step) {
        const url = new URL(step.path, `${baseUrl}/`);
        if (url.origin !== new URL(baseUrl).origin || url.username || url.password)
          throw new Error("Demonstrations must stay on site.");
      } else if (typeof step.selector !== "string" || !step.selector)
        throw new Error("Missing demonstration selector.");
      if (
        ["fill", "select", "press"].includes(step.action) &&
        (!("value" in step) || typeof step.value !== "string")
      )
        throw new Error("Missing demonstration value.");
    }
    return {
      name: demo.name,
      description: demo.description,
      async run(page) {
        for (const step of demo.steps) {
          switch (step.action) {
            case "goto":
              await page.goto(new URL(step.path, `${baseUrl}/`).href);
              break;
            case "click":
              await page.locator(step.selector).click();
              break;
            case "fill":
              await page.locator(step.selector).fill(step.value);
              break;
            case "select":
              await page.locator(step.selector).selectOption(step.value);
              break;
            case "press":
              await page.locator(step.selector).press(step.value);
              break;
            case "waitForURL":
              await page.waitForURL(new URL(step.path, `${baseUrl}/`).href);
              break;
          }
        }
      },
    };
  });
  return { demonstrations, sha256: createHash("sha256").update(text).digest("hex") };
}

export async function profileBenchmark(config: BenchConfig, site: Site): Promise<string> {
  const settings = config.sites[site];
  const recorded = settings.demonstrations
    ? await loadDemonstrations(settings.demonstrations, site, settings.baseUrl)
    : undefined;
  const result = await profileSite({
    startUrl:
      settings.startPath === undefined
        ? settings.baseUrl
        : new URL(settings.startPath, `${settings.baseUrl}/`).href,
    login: settings.login ?? undefined,
    maxPages: config.maxPages,
    maxProfileMs: config.profileTimeoutMs,
    modelId: `urn:webarena-bench:model:${site}`,
    demonstrations: recorded?.demonstrations,
  });
  if (
    settings.login &&
    (!result.model.login?.some((l) => l.method === "password") ||
      result.warnings.some((w) => w.startsWith("login:")))
  )
    throw new Error("Profiling login failed; no benchmark model was saved.");
  const loginOperations = new Set(result.model.login?.map((l) => l.operation));
  if (
    result.model.operations.some(
      (o) =>
        o.request.method !== "GET" &&
        !loginOperations.has(o.id) &&
        o.provenance.method !== "demonstration",
    )
  )
    throw new Error("Profiler returned an undemonstrated write.");
  await mkdir(config.modelsDir, { recursive: true, mode: 0o700 });
  const path = join(config.modelsDir, `${site}.ttl`);
  await writeFile(path, await writeSiteModel(result.model), { mode: 0o600 });
  await writeJson(join(config.modelsDir, `${site}.profile.json`), {
    site,
    baseUrl: settings.baseUrl,
    generatedAt: result.model.generatedAt,
    maxPages: config.maxPages,
    warnings: result.warnings,
    writeResponses: result.writeResponses,
    demonstrations: recorded
      ? {
          scope: "site-generic",
          sha256: recorded.sha256,
          names: recorded.demonstrations.map((d) => d.name),
        }
      : null,
  });
  return path;
}
