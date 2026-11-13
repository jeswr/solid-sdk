// AUTHORED-BY Claude Opus 5.5
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export async function checkReference(
  directory: string,
): Promise<{ validated_submissions: number }> {
  const result = await promisify(execFile)(
    "python3",
    [
      fileURLToPath(new URL("./check-reference.py", import.meta.url)),
      fileURLToPath(new URL("../../../.webarena-verified-ref", import.meta.url)),
      directory,
    ],
    { timeout: 10_000 },
  );
  return JSON.parse(result.stdout);
}
