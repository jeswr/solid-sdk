// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { spawnSync } from "child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { expect, it } from "vitest";
import { nativeMain } from "../src/native-cli.js";
import { setup } from "./helpers.js";

it("generates an exact-ID manifest and an executable launcher with quoted absolute paths", () => {
  const { dir } = setup();
  const output = join(dir, "host ' fixture");
  const storeDir = join(dir, "unused ' store");
  const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const command = [
    resolve(import.meta.dirname, "../scripts/native-manifest.mjs"),
    "--extension-id",
    extensionId,
    "--store-dir",
    storeDir,
    "--output-dir",
    output,
  ];
  const generated = spawnSync(process.execPath, command, { encoding: "utf8" });
  expect(generated.status).toBe(0);
  expect(generated.stderr).toBe("");
  const manifest = JSON.parse(readFileSync(join(output, "org.jeswr.agent_vault.json"), "utf8"));
  expect(manifest).toMatchObject({
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
    path: join(output, "agent-vault-native"),
  });
  expect(statSync(join(output, "host-config.json")).mode & 0o777).toBe(0o600);
  const rejected = spawnSync(manifest.path, ["https://shop.test"], { encoding: "utf8" });
  expect(rejected.status).toBe(1);
  expect(rejected.stdout).toBe("");
  expect(rejected.stderr).toBe("");
  expect(existsSync(storeDir)).toBe(false);
  expect(spawnSync(process.execPath, command, { encoding: "utf8" }).status).toBe(1);
});

it("sanitizes malformed config errors before opening a credential store", async () => {
  const { dir } = setup();
  const path = join(dir, "invalid-config.json");
  writeFileSync(path, "fixture-secret-invalid-json", { mode: 0o600 });
  await expect(nativeMain(["--config", path, "https://shop.test"])).rejects.toThrow(
    "Vault unavailable.",
  );
});
