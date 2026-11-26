// AUTHORED-BY Codex GPT-6.1-Sol
import { spawnSync } from "node:child_process";
import { execPath } from "node:process";
import { expect, it } from "vitest";

it("loads the published vault entry without Node, framework, environment or pod dependencies", () => {
  const entry = new URL("../dist/vault.js", import.meta.url).href;
  const code = `
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, next) {
      if (specifier.startsWith('node:') || specifier.includes('mcp-oauth') || specifier.includes('core/') || specifier.includes('react')) throw new Error('Forbidden import');
      return next(specifier, context);
    }});
    globalThis.fetch = () => { throw new Error('Unexpected network'); };
    const { ConnectorTokenVault, generateBrowserVaultKey, MemoryVaultStore } = await import(${JSON.stringify(entry)});
    const vault = new ConnectorTokenVault(await generateBrowserVaultKey(), new MemoryVaultStore());
    await vault.put({ connectorId: 'spotify', account: 'fixture' }, { refreshToken: 'synthetic', obtainedAt: 1 });
    if ((await vault.list()).length !== 1) throw new Error('Round trip failed');
  `;
  const result = spawnSync(execPath, ["--input-type=module", "-e", code], { encoding: "utf8" });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});
