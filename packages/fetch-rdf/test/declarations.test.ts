import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

it("typechecks a downstream consumer using only production dependencies", () => {
  const consumer = mkdtempSync(join(tmpdir(), "fetch-rdf-declarations-"));
  try {
    const installed = join(consumer, "node_modules/@jeswr/fetch-rdf");
    mkdirSync(installed, { recursive: true });
    cpSync(join(packageRoot, "dist"), join(installed, "dist"), { recursive: true });
    cpSync(join(packageRoot, "package.json"), join(installed, "package.json"));
    const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    // Copy the package rather than linking it: its declarations must resolve
    // solely against production dependencies, without workspace ambient types.
    for (const dependency of Object.keys(manifest.dependencies)) {
      const target = join(installed, "node_modules", dependency);
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(realpathSync(join(packageRoot, "node_modules", dependency)), target, "dir");
    }
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: { "@jeswr/fetch-rdf": "0.1.0" },
      }),
    );
    writeFileSync(
      join(consumer, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2023",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2023", "DOM", "DOM.AsyncIterable"],
          strict: true,
          // Match workspace consumers: transitive packages use multiple Node
          // type versions. The fixture below still proves Store is not `any`.
          skipLibCheck: true,
          types: [],
          noEmit: true,
        },
        include: ["index.ts"],
      }),
    );
    writeFileSync(
      join(consumer, "index.ts"),
      `import { fetchRdf, parseRdf, type FetchedRdf } from "@jeswr/fetch-rdf";
const fetched: FetchedRdf = await fetchRdf("https://example.org/resource");
const parsed = await parseRdf("", "text/turtle");
const size: number = fetched.dataset.size + parsed.size;
fetched.dataset.addQuads(parsed.getQuads(null, null, null, null));
// @ts-expect-error N3 Store requires an iterable of quads, not a number.
fetched.dataset.addQuads(123);
// @ts-expect-error The parseRdf return type must also retain N3 Store typing.
parsed.addQuads(123);
void size;
`,
    );
    const typecheck = () =>
      spawnSync(
        process.execPath,
        [join(packageRoot, "node_modules/typescript/lib/tsc.js"), "-p", "tsconfig.json"],
        { cwd: consumer, encoding: "utf8" },
      );
    const result = typecheck();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    // Prove the fixture cannot borrow @types/n3 from the workspace or consumer.
    rmSync(join(installed, "node_modules/@types/n3"));
    const missingTypes = typecheck();
    expect(missingTypes.status).not.toBe(0);
    expect(missingTypes.stdout).toContain("Unused '@ts-expect-error' directive");
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
});
