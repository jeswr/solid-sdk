#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { CredentialStore } from "@jeswr/agent-credentials";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "fs";
import { isAbsolute } from "path";
import { fileURLToPath } from "url";
import type { z } from "zod";
import { KeepAlive } from "./keepalive.js";
import { nativeConfigSchema, validateNativeCaller } from "./native-config.js";
import { NativeVault, runNativeHost } from "./native-host.js";
import { Profiles } from "./profiles.js";
import { boundary, parse, VaultError } from "./safe.js";
import { SessionStore } from "./sessions.js";
import { EncryptedRecords } from "./storage.js";

export async function nativeMain(args: string[]): Promise<void> {
  return boundary(async () => {
    // Reject accidental interactive launches; argv is not same-user process authentication.
    if (process.stdin.isTTY || process.stdout.isTTY) throw new VaultError("denied");
    if (args[0] !== "--config" || !args[1] || !isAbsolute(args[1])) throw new VaultError("invalid");
    const fd = openSync(args[1], constants.O_RDONLY | constants.O_NOFOLLOW);
    let config: z.infer<typeof nativeConfigSchema>;
    try {
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.size > 16384 ||
        stat.mode & 0o077 ||
        (process.getuid && stat.uid !== process.getuid())
      )
        throw new VaultError("invalid");
      config = parse(nativeConfigSchema, JSON.parse(readFileSync(fd, "utf8")));
    } finally {
      closeSync(fd);
    }
    validateNativeCaller(config, args[2]);
    const { createNodeGuardedFetch } = await import("@jeswr/guarded-fetch/node");
    const store = new CredentialStore({ dir: config.storeDir });
    // Chrome profiles sharing a store must not start independent refresh owners.
    await store.withLock(
      "native-messaging-owner",
      async () => {
        const profiles = new Profiles(store);
        const sessions = new SessionStore(new EncryptedRecords(store), {
          cookieDomains: config.cookieDomains,
        });
        const transport = createNodeGuardedFetch({ maxBytes: 65536, timeoutMs: 15000 });
        const scheduler = new KeepAlive({
          sessions,
          clock: {
            now: Date.now,
            set: (callback, delay) => setTimeout(callback, delay),
            clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
          },
          transport: async (url, init) => {
            const response = await transport(url, init);
            return {
              status: response.status,
              text: () => response.text(),
              setCookies: response.headers.getSetCookie(),
            };
          },
        });
        const active = new Map<string, { site: string; account: string }>();
        const captured = async (site: string, account: string) => {
          const route = profiles.route(site, account);
          if (!route) return;
          active.set(JSON.stringify([site, account]), { site, account });
          await scheduler.start(site, account, route, {
            frequent: config.frequentSites.some((value) => new URL(value).origin === site),
          });
        };
        try {
          for (const account of profiles.accounts()) await captured(account.site, account.id);
          await runNativeHost(
            process.stdin,
            process.stdout,
            new NativeVault({
              profiles,
              sessions,
              cookieDomains: config.cookieDomains,
              captured,
              beginning: (site, account) => scheduler.stop(site, account),
            }),
          );
        } finally {
          for (const { site, account } of active.values()) scheduler.stop(site, account);
        }
      },
      { waitMs: 1000 },
    );
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // No stdout except framed protocol messages; no paths, payloads or external error causes.
  process.stdout.on("error", () => {
    process.exitCode = 1;
    process.stdin.destroy();
  });
  void nativeMain(process.argv.slice(2)).catch(() => {
    process.exitCode = 1;
    process.stdin.destroy();
  });
}
