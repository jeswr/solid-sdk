// AUTHORED-BY Codex GPT-6.1-Sol

import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { storageCases } from "./cases.js";
import { runTarget } from "./harness.js";
import { writeReports } from "./report.js";
import { selectTargets } from "./targets/index.js";
import type { TargetReport } from "./types.js";

/** Run selected targets and persist reports even when assertions fail. Return a shell exit code. */
export async function main(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args: args[0] === "--" ? args.slice(1) : args,
    options: { target: { type: "string" }, output: { type: "string" } },
    strict: true,
  });
  const targets = selectTargets(values.target ?? process.env.TARGET);
  const reports: TargetReport[] = [];
  for (const target of targets) {
    const report = await runTarget(target, storageCases);
    reports.push(report);
    const counts = { pass: 0, fail: 0, skip: 0 };
    for (const row of report.results) counts[row.status]++;
    process.stdout.write(
      `${target.name}: ${counts.pass} pass, ${counts.fail} fail, ${counts.skip} skip\n`,
    );
  }
  await writeReports(reports, values.output ?? fileURLToPath(new URL("../", import.meta.url)));
  return reports.some((report) => report.results.some((row) => row.status === "fail")) ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch {
    process.stderr.write("Conformance invocation failed\n");
    process.exitCode = 1;
  }
}
