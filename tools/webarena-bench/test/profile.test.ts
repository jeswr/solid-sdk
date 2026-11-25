// AUTHORED-BY Claude Opus 5.5
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSiteModel } from "@jeswr/site-model";
import { type Demonstration, profileSite } from "@jeswr/site-profiler";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDemonstrations, profileBenchmark } from "../src/profile.js";
import { fixtureConfig } from "./helpers.js";
import { login, shopModel } from "./shop-model.js";

vi.mock("@jeswr/site-profiler", async (original) => ({
  ...(await original<object>()),
  profileSite: vi.fn(),
}));
const directories: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

describe("read-only profiling and generic demonstration seam", () => {
  it("profiles without demonstrations by default, passes login and page bound, and roundtrips TTL", async () => {
    const config = fixtureConfig();
    config.sites.shopping.login = login;
    config.modelsDir = await mkdtemp(join(tmpdir(), "webarena-profile-"));
    directories.push(config.modelsDir);
    const model = shopModel(config.sites.shopping.baseUrl);
    const writeResponses = {
      "urn:fixture:write": {
        createdLocationPattern: "/items/{id}",
        redirectCount: 1,
        finalStatus: 200,
      },
    };
    vi.mocked(profileSite).mockResolvedValue({ model, trace: [], writeResponses, warnings: [] });
    const path = await profileBenchmark(config, "shopping");
    expect(profileSite).toHaveBeenCalledWith(
      expect.objectContaining({
        startUrl: config.sites.shopping.baseUrl,
        login,
        maxPages: 4,
        demonstrations: undefined,
      }),
    );
    expect((await readSiteModel(await readFile(path, "utf8"))).operations).toHaveLength(4);
    const manifest = await readFile(join(config.modelsDir, "shopping.profile.json"), "utf8");
    expect(manifest).not.toContain(login.password);
    expect(JSON.parse(manifest).demonstrations).toBeNull();
    expect(JSON.parse(manifest).writeResponses).toEqual(writeResponses);
  });
  it("rejects failed login and undemonstrated writes", async () => {
    const config = fixtureConfig();
    config.sites.shopping.login = login;
    config.modelsDir = await mkdtemp(join(tmpdir(), "webarena-profile-"));
    directories.push(config.modelsDir);
    const model = shopModel(config.sites.shopping.baseUrl);
    vi.mocked(profileSite).mockResolvedValue({
      model,
      trace: [],
      writeResponses: {},
      warnings: ["login: failed"],
    });
    await expect(profileBenchmark(config, "shopping")).rejects.toThrow("login failed");
    const write = model.operations.find((o) => o.label === "Add to basket");
    if (!write) throw new Error("Missing write fixture.");
    write.provenance = { ...write.provenance, method: "form" };
    vi.mocked(profileSite).mockResolvedValue({
      model,
      trace: [],
      writeResponses: {},
      warnings: [],
    });
    await expect(profileBenchmark(config, "shopping")).rejects.toThrow("undemonstrated");
  });
  it("replays an immutable generic UI recording, hashes it, and refuses wrong-site recordings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "webarena-demo-"));
    directories.push(directory);
    const path = join(directory, "generic.json");
    await writeFile(
      path,
      JSON.stringify({
        site: "shopping",
        scope: "site-generic",
        demonstrations: [
          {
            name: "edit-basket",
            description: "Add/remove a disposable basket item",
            steps: [
              { action: "goto", path: "/" },
              { action: "fill", selector: "#q", value: "example" },
              { action: "press", selector: "#q", value: "Enter" },
              { action: "click", selector: "#item" },
              { action: "select", selector: "#qty", value: "1" },
              { action: "waitForURL", path: "/cart" },
            ],
          },
        ],
      }),
    );
    const recording = await loadDemonstrations(path, "shopping", "https://shop.test");
    expect(recording.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(recording.sha256).toBe(
      (await loadDemonstrations(path, "shopping", "https://shop.test")).sha256,
    );
    const steps: string[] = [];
    const page = {
      goto: async (url: string) => {
        steps.push(`goto ${url}`);
      },
      waitForURL: async (url: string) => {
        steps.push(`wait ${url}`);
      },
      locator: (selector: string) => ({
        fill: async (value: string) => {
          steps.push(`fill ${selector} ${value}`);
        },
        press: async () => {},
        click: async () => {},
        selectOption: async () => {},
      }),
    } as unknown as Parameters<Demonstration["run"]>[0];
    await recording.demonstrations[0]?.run(page);
    expect(steps).toEqual([
      "goto https://shop.test/",
      "fill #q example",
      "wait https://shop.test/cart",
    ]);
    await expect(loadDemonstrations(path, "reddit", "https://reddit.test")).rejects.toThrow(
      "site-generic",
    );
    await writeFile(
      path,
      JSON.stringify({
        site: "shopping",
        scope: "site-generic",
        demonstrations: [
          {
            name: "bad",
            description: "off site",
            steps: [{ action: "goto", path: "https://other.test" }],
          },
        ],
      }),
    );
    await expect(loadDemonstrations(path, "shopping", "https://shop.test")).rejects.toThrow(
      "stay on site",
    );
  });
});
