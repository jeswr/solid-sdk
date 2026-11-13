#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { lstatSync, mkdirSync, writeFileSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";
import { NATIVE_HOST_NAME } from "../dist/browser.js";
import { nativeConfigSchema, validateNativeCaller } from "../dist/native-config.js";

try {
  const { values } = parseArgs({
    options: {
      "extension-id": { type: "string" },
      "store-dir": { type: "string" },
      "output-dir": { type: "string" },
      "cookie-domain": { type: "string", multiple: true },
      "frequent-site": { type: "string", multiple: true },
    },
  });
  if (
    !values["store-dir"] ||
    !values["output-dir"] ||
    !isAbsolute(values["store-dir"]) ||
    !isAbsolute(values["output-dir"])
  )
    throw 0;
  const parsed = nativeConfigSchema.safeParse({
    extensionId: values["extension-id"],
    storeDir: values["store-dir"],
    cookieDomains: values["cookie-domain"] ?? [],
    frequentSites: values["frequent-site"] ?? [],
  });
  if (!parsed.success) throw 0;
  const config = parsed.data;
  validateNativeCaller(config, `chrome-extension://${config.extensionId}/`);
  const output = values["output-dir"];
  mkdirSync(output, { recursive: true, mode: 0o700 });
  const directory = lstatSync(output);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    directory.mode & 0o077 ||
    (process.getuid && directory.uid !== process.getuid())
  )
    throw 0;
  const configPath = join(output, "host-config.json");
  const launcher = join(output, "agent-vault-native");
  const cli = fileURLToPath(new URL("../dist/native-cli.js", import.meta.url));
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  writeFileSync(
    launcher,
    `#!/bin/sh\nexec ${quote(resolve(process.execPath))} ${quote(cli)} --config ${quote(configPath)} "$@"\n`,
    { mode: 0o700, flag: "wx" },
  );
  writeFileSync(
    join(output, `${NATIVE_HOST_NAME}.json`),
    `${JSON.stringify({ name: NATIVE_HOST_NAME, description: "Agent vault sign-in sharing", path: launcher, type: "stdio", allowed_origins: [`chrome-extension://${config.extensionId}/`] }, null, 2)}\n`,
    { mode: 0o600, flag: "wx" },
  );
  process.stdout.write("Native host files created. Register the manifest with Chrome.\n");
} catch {
  process.stderr.write(
    "Native host setup failed: check arguments and use a new private output directory.\n",
  );
  process.exitCode = 1;
}
