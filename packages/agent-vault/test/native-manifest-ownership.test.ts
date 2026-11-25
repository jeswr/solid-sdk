// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { afterEach, expect, it, vi } from "vitest";

const argv = process.argv;
const exitCode = process.exitCode;
afterEach(() => {
  process.argv = argv;
  process.exitCode = exitCode;
  vi.doUnmock("fs");
  vi.restoreAllMocks();
  vi.resetModules();
});

async function generate(
  owners: Record<string, number>,
  output = "/trusted/output",
  store = "/trusted/store",
) {
  const uid = 1001;
  vi.spyOn(process, "geteuid").mockReturnValue(uid);
  // A different real uid must not weaken the effective-uid boundary.
  vi.spyOn(process, "getuid").mockReturnValue(2001);
  const visited: string[] = [];
  const write = vi.fn();
  const canonical = vi.fn((path: string) => path);
  // Replace the script's existing fs imports; no chown, privileges or real store are needed.
  vi.doMock("fs", () => ({
    lstatSync: (path: string) => {
      visited.push(path);
      return {
        uid: owners[path] ?? uid,
        mode: path.endsWith("/output") || path.endsWith("/store") ? 0o700 : 0o755,
        isDirectory: () => true,
        isSymbolicLink: () => false,
      };
    },
    realpathSync: canonical,
    writeFileSync: write,
  }));
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  process.exitCode = 0;
  process.argv = [
    process.execPath,
    "native-manifest.mjs",
    "--extension-id",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "--output-dir",
    output,
    "--store-dir",
    store,
  ];
  await vi.importActual("../scripts/native-manifest.mjs");
  return { write, visited, canonical, code: process.exitCode };
}

it.each([
  "output",
  "store",
])("rejects a private %s leaf beneath a foreign-owned ancestor before writing", async (target) => {
  // The two leaves are private and self-owned; their parent is replaceable by another uid.
  const result = await generate(
    { "/foreign": 3001 },
    target === "output" ? "/foreign/output" : "/trusted/output",
    target === "store" ? "/foreign/store" : "/trusted/store",
  );
  expect(result.code).toBe(1);
  expect(result.write).not.toHaveBeenCalled();
});

it.each([
  0, 1001,
])("accepts uid %i ancestors through the filesystem root with effective-uid-owned leaves", async (owner) => {
  const result = await generate({ "/": owner, "/trusted": owner });
  expect(result.code).toBe(0);
  expect(result.visited).toEqual([
    "/trusted/output",
    "/trusted",
    "/",
    "/trusted/store",
    "/trusted",
    "/",
  ]);
  expect(result.canonical.mock.calls).toEqual([["/trusted/output"], ["/trusted/store"]]);
  expect(result.write).toHaveBeenCalledTimes(3);
});

it("rejects a foreign-owned filesystem root even beneath self-owned ancestors", async () => {
  const result = await generate({ "/": 3001 });
  expect(result.code).toBe(1);
  expect(result.write).not.toHaveBeenCalled();
});
