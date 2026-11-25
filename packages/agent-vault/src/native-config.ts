// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { isAbsolute } from "path";
import { z } from "zod";
import { cookieDomainAllowed } from "./browser.js";
import { origin, VaultError } from "./safe.js";

export const nativeConfigSchema = z.strictObject({
  extensionId: z.string().regex(/^[a-p]{32}$/),
  storeDir: z.string().min(1),
  cookieDomains: z
    .array(z.string().regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/))
    .max(100)
    .default([]),
  frequentSites: z.array(z.string()).max(100).default([]),
});
export function validateNativeCaller(
  config: z.infer<typeof nativeConfigSchema>,
  caller: string | undefined,
): void {
  if (
    caller !== `chrome-extension://${config.extensionId}/` &&
    caller !== `chrome-extension://${config.extensionId}`
  )
    throw new VaultError("denied");
  if (!isAbsolute(config.storeDir)) throw new VaultError("invalid");
  for (const domain of config.cookieDomains)
    if (!cookieDomainAllowed(`capture.${domain}`, domain, false, [domain]))
      throw new VaultError("invalid");
  for (const site of config.frequentSites) origin(site);
}
