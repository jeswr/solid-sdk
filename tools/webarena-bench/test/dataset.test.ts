// AUTHORED-BY Claude Opus 5.5
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluatorConfig, loadConfig } from "../src/config.js";
import { loadTasks, parseTaskIds, selectTasks, substituteUrls } from "../src/dataset.js";
import { SITES } from "../src/types.js";
import { fixtureConfig } from "./helpers.js";

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/dataset.json", import.meta.url), "utf8"),
);
const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

describe("WebArena task inputs", () => {
  it("filters by membership, retains multi-site tasks and skips unavailable sites", () => {
    const selected = selectTasks(fixture.tasks, fixtureConfig(), "shopping");
    expect(selected.tasks.map((t) => t.task_id)).toEqual([0, 1]);
    expect(selected.skipped.map((s) => s.taskId)).toEqual([2, 3]);
    expect(selected.tasks[0]?.intent).toBe("Find a fictional item at http://127.0.0.1:7770/search");
    expect(selected.tasks[1]?.start_urls).toEqual([
      "http://127.0.0.1:7770",
      "http://127.0.0.1:9999/new",
    ]);
    expect(JSON.stringify(selected)).not.toContain("ANSWER_SENTINEL");
    expect(selected.tasks[0]).not.toHaveProperty("eval");
  });
  it("supports explicit IDs, reports excluded IDs, rejects unknown/duplicate IDs", () => {
    expect(selectTasks(fixture.tasks, fixtureConfig(), "shopping", [0]).tasks).toHaveLength(1);
    expect(
      selectTasks(fixture.tasks, fixtureConfig(), "shopping", [4]).skipped[0]?.reason,
    ).toContain("does not use");
    expect(() => selectTasks(fixture.tasks, fixtureConfig(), "shopping", [1234])).toThrow("absent");
    expect(() =>
      selectTasks([fixture.tasks[0], fixture.tasks[0]], fixtureConfig(), "shopping"),
    ).toThrow("duplicate");
    expect(parseTaskIds("0,4,4")).toEqual([0, 4]);
    for (const bad of ["", "-1", "1,", "1.1", "foo", "9007199254740992"])
      expect(() => parseTaskIds(bad)).toThrow();
  });
  it("substitutes both admin and shopping without overlapping placeholders", () => {
    expect(substituteUrls("__SHOPPING_ADMIN__/x then __SHOPPING__/y", fixtureConfig())).toBe(
      "http://127.0.0.1:7780/admin/x then http://127.0.0.1:7770/y",
    );
  });
  it("loads local JSON, resolves paths relative to config, supports env credentials, and omits them from evaluator config", async () => {
    const directory = await mkdtemp(join(tmpdir(), "webarena-config-"));
    directories.push(directory);
    const path = join(directory, "bench.config.json");
    const sites = Object.fromEntries(
      SITES.map((s) => [
        s,
        {
          ...fixtureConfig().sites[s],
          login: { usernameEnv: "TEST_USER", passwordEnv: "TEST_PASSWORD" },
        },
      ]),
    );
    await writeFile(path, JSON.stringify({ dataset: "dataset.json", modelsDir: "models", sites }));
    await writeFile(join(directory, "dataset.json"), JSON.stringify(fixture.tasks));
    const config = await loadConfig(path, {
      TEST_USER: "alex@example.test",
      TEST_PASSWORD: "fixture-password",
    });
    expect(config.dataset).toBe(join(directory, "dataset.json"));
    expect(config.modelsDir).toBe(join(directory, "models"));
    expect(config.sites.shopping.login?.username).toBe("alex@example.test");
    expect(JSON.stringify(evaluatorConfig(config))).not.toContain("fixture-password");
    expect((await loadTasks(config, "shopping")).tasks).toHaveLength(2);
    await expect(loadConfig(path, {})).rejects.toThrow("Missing login");
    const shopping = sites.shopping;
    if (!shopping) throw new Error("Missing fixture site.");
    shopping.baseUrl = "http://shop.test";
    await writeFile(path, JSON.stringify({ dataset: "dataset.json", sites }));
    await expect(loadConfig(path, { TEST_USER: "Alex", TEST_PASSWORD: "example" })).rejects.toThrow(
      "https",
    );
  });
});
