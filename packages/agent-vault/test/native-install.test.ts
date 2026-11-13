// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { spawnSync } from "child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { join, resolve } from "path";
import { afterEach, expect, it } from "vitest";
import { nativeMain } from "../src/native-cli.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function setup() {
  // /tmp is deliberately refused: every ancestor must be non-writable by group/others.
  const dir = mkdtempSync(resolve(import.meta.dirname, "../.native-install-"));
  dirs.push(dir);
  return { dir };
}
function generate(output: string, storeDir: string) {
  return spawnSync(
    process.execPath,
    [
      resolve(import.meta.dirname, "../scripts/native-manifest.mjs"),
      "--extension-id",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "--store-dir",
      storeDir,
      "--output-dir",
      output,
    ],
    { encoding: "utf8" },
  );
}

it("generates an exact-ID manifest and an executable launcher with quoted absolute paths", () => {
  const { dir } = setup();
  const output = join(dir, "host ' fixture");
  const storeDir = join(dir, "unused ' store");
  mkdirSync(output, { mode: 0o700 });
  mkdirSync(storeDir, { mode: 0o700 });
  const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const command = [
    resolve(import.meta.dirname, "../scripts/native-manifest.mjs"),
    "--extension-id",
    extensionId,
    "--store-dir",
    `${storeDir}/.`,
    "--output-dir",
    `${output}/.`,
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
  expect(statSync(manifest.path).mode & 0o777).toBe(0o700);
  expect(statSync(join(output, "org.jeswr.agent_vault.json")).mode & 0o777).toBe(0o600);
  expect(JSON.parse(readFileSync(join(output, "host-config.json"), "utf8")).storeDir).toBe(
    storeDir,
  );
  const rejected = spawnSync(manifest.path, ["https://shop.test"], { encoding: "utf8" });
  expect(rejected.status).toBe(1);
  expect(rejected.stdout).toBe("");
  expect(rejected.stderr).toBe("");
  expect(existsSync(join(storeDir, "vault"))).toBe(false);
  expect(spawnSync(process.execPath, command, { encoding: "utf8" }).status).toBe(1);
});

it.each([
  "output",
  "store",
])("rejects symlink/.. components in the %s path before writing", (target) => {
  const { dir } = setup();
  const safe = join(dir, "safe");
  const other = join(dir, "other");
  for (const path of [safe, other, join(safe, "host"), join(other, "host")])
    mkdirSync(path, { mode: 0o700 });
  symlinkSync(other, join(safe, "link"));
  // Keep the raw path: join would erase the attack's .. component before the CLI sees it.
  for (const unsafe of [`${safe}/link/../host`, `${safe}/link/host`, `${safe}/host/../host`]) {
    const result = generate(
      target === "output" ? unsafe : join(safe, "host"),
      target === "store" ? unsafe : other,
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(existsSync(join(safe, "host", "host-config.json"))).toBe(false);
    expect(existsSync(join(other, "host", "host-config.json"))).toBe(false);
  }
});

it.each([0o720, 0o702])("rejects writable ancestors (mode %o) for either directory", (mode) => {
  const { dir } = setup();
  const unsafe = join(dir, "unsafe");
  const leaf = join(unsafe, "leaf");
  mkdirSync(unsafe, { mode: 0o700 });
  mkdirSync(leaf, { mode: 0o700 });
  chmodSync(unsafe, mode);
  expect(generate(leaf, dir).status).toBe(1);
  expect(generate(dir, leaf).status).toBe(1);
  expect(existsSync(join(dir, "host-config.json"))).toBe(false);
  expect(existsSync(join(leaf, "host-config.json"))).toBe(false);
});

it("requires existing private directories and never overwrites an existing artifact", () => {
  const { dir } = setup();
  expect(generate(join(dir, "missing"), dir).status).toBe(1);
  expect(generate(dir, join(dir, "missing")).status).toBe(1);
  writeFileSync(join(dir, "host-config.json"), "fixture", { mode: 0o600 });
  expect(generate(dir, dir).status).toBe(1);
  expect(readFileSync(join(dir, "host-config.json"), "utf8")).toBe("fixture");
});

it.each([
  "stdin",
  "stdout",
] as const)("refuses a TTY on %s before opening the store", async (stream) => {
  const { dir } = setup();
  const configPath = join(dir, "config.json");
  const storeDir = join(dir, "unopened");
  writeFileSync(
    configPath,
    JSON.stringify({ extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", storeDir }),
    { mode: 0o600 },
  );
  const descriptor = Object.getOwnPropertyDescriptor(process[stream], "isTTY");
  Object.defineProperty(process[stream], "isTTY", { value: true, configurable: true });
  try {
    await expect(
      nativeMain(["--config", configPath, "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]),
    ).rejects.toThrow("Vault denied.");
    expect(existsSync(storeDir)).toBe(false);
  } finally {
    if (descriptor) Object.defineProperty(process[stream], "isTTY", descriptor);
    else Reflect.deleteProperty(process[stream], "isTTY");
  }
});

it("sanitizes malformed config errors before opening a credential store", async () => {
  const { dir } = setup();
  const path = join(dir, "invalid-config.json");
  writeFileSync(path, "fixture-secret-invalid-json", { mode: 0o600 });
  await expect(nativeMain(["--config", path, "https://shop.test"])).rejects.toThrow(
    "Vault unavailable.",
  );
});
