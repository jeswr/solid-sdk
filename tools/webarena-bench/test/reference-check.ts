// AUTHORED-BY Claude Opus 5.5
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const REFERENCE = fileURLToPath(new URL("../../../.webarena-verified-ref", import.meta.url));

/**
 * Validates submissions with the reference Python types when the local, never-committed copy of
 * webarena-verified is present (see README); returns undefined elsewhere, for example in CI.
 */
export async function checkReference(
  directory: string,
): Promise<{ validated_submissions: number } | undefined> {
  if (!existsSync(`${REFERENCE}/webarena_verified/core/utils/network_event_utils.py`))
    return undefined;
  const result = await promisify(execFile)(
    "python3",
    [fileURLToPath(new URL("./check-reference.py", import.meta.url)), REFERENCE, directory],
    { timeout: 10_000 },
  );
  return JSON.parse(result.stdout);
}
