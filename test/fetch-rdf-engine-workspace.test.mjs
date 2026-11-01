// AUTHORED-BY Codex GPT-6.1-Sol
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("schedules the real-engine integration suite without a workspace cycle", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../node_modules/turbo/bin/turbo", import.meta.url)),
      "run",
      "build",
      "typecheck",
      "test",
      "--filter=@jeswr/fetch-rdf-engine-tests",
      "--dry=json",
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const plan = JSON.parse(result.stdout);
  const tasks = new Map(plan.tasks.map((task) => [task.taskId, task]));
  const integration = "@jeswr/fetch-rdf-engine-tests";
  expect(tasks.get(`${integration}#build`).dependencies).toEqual(
    expect.arrayContaining(["@jeswr/fetch-rdf#build", "@jeswr/rdf-engine#build"]),
  );
  expect(tasks.get(`${integration}#typecheck`).dependencies).toContain(`${integration}#build`);
  expect(tasks.get(`${integration}#test`).dependencies).toContain(`${integration}#typecheck`);
});
