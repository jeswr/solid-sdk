// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { FullConfig } from "@playwright/test";

export default async function warmShell(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("The live CSS harness requires a suite baseURL");
  // HTTP loopback authentication needs next dev. Compile the routes before browser
  // assertions start so cold webpack work cannot hide a completed popup sign-in.
  for (const path of ["/home", "/drive", "/drive/search?q=warm", "/signin"]) {
    const response = await fetch(new URL(path, baseURL), {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`Cannot warm ${path}: HTTP ${response.status}`);
    await response.text();
  }
}
