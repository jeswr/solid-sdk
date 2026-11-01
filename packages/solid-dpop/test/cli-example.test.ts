// AUTHORED-BY Codex GPT-6.1-Sol
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { ScriptTarget, transpile } from "typescript";
import { expect, it } from "vitest";

it("CLI diagnostics never print raw errors (finding 8)", async () => {
  const source = await readFile(new URL("../examples/cli-login.ts", import.meta.url), "utf8");
  // Run the shipped example with a failing login; preserve its actual catch/logging path.
  const script = transpile(source.replace(/^import .*;$/m, ""), { target: ScriptTarget.ES2022 });
  let output = "";
  let finish: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  runInNewContext(script, {
    cliLogin: async () => {
      throw new Error("REFRESH SECRET VERIFIER");
    },
    process: {
      argv: ["node", "cli-login.ts", "https://issuer.example/", "https://pod.example/"],
      stderr: {
        write: (value: string) => {
          output += value;
        },
      },
      exit: finish,
    },
  });
  await finished;
  expect(output).toBe("login failed. Check issuer configuration and try again.\n");
});
