// AUTHORED-BY Codex GPT-6
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { profileSite } from "@jeswr/site-profiler";
import { expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { profileBenchmark } from "../src/profile.js";
import { emptyModel, fixtureConfig } from "./helpers.js";

vi.mock("@jeswr/site-profiler", async (original) => ({
  ...(await original<object>()),
  profileSite: vi.fn(),
}));
it("keeps the environment origin while applying a per-site start path and profile deadline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bench-start-"));
  try {
    const raw = fixtureConfig();
    raw.modelsDir = join(directory, "models");
    raw.sites.shopping_admin = {
      baseUrl: "http://127.0.0.1:7780",
      startPath: "/admin",
      login: null,
    };
    raw.profileTimeoutMs = 30000;
    const path = join(directory, "config.json");
    await writeFile(path, JSON.stringify(raw));
    const config = await loadConfig(path);
    vi.mocked(profileSite).mockResolvedValue({ model: emptyModel(), trace: [], warnings: [] });
    await profileBenchmark(config, "shopping_admin");
    expect(profileSite).toHaveBeenCalledWith(
      expect.objectContaining({ startUrl: "http://127.0.0.1:7780/admin", maxProfileMs: 30000 }),
    );
    for (const startPath of [
      "https://away.test/admin",
      "//away.test/admin",
      "http://user:password@127.0.0.1:7780/admin",
    ]) {
      raw.sites.shopping_admin.startPath = startPath;
      await writeFile(path, JSON.stringify(raw));
      await expect(loadConfig(path)).rejects.toThrow("stay on site");
    }
    raw.sites.shopping_admin.startPath = "/admin";
    raw.profileTimeoutMs = 0;
    await writeFile(path, JSON.stringify(raw));
    await expect(loadConfig(path)).rejects.toThrow("positive integer");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
