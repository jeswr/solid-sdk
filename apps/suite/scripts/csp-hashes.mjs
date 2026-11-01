// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { filesUnder } from "./route-manifest.mjs";

const origins = ["https://localhost", "capacitor://localhost"];
const staticSources = origins.map((origin) => `${origin}/_next/static/`).join(" ");
const hash = (body) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`;

/**
 * Inline styles that client code inserts at runtime, which no HTML scan can see. Sonner
 * (suite-ui's toaster) appends an empty <style> at module load and then fills it with its
 * stylesheet, so both the empty body and that stylesheet need hashes. The string is read
 * from the installed sonner build so an upgrade can never leave a stale hash; the native
 * browser run fails on any runtime style this list misses.
 */
export async function runtimeStyleBodies() {
  const require = createRequire(
    new URL("../../../packages/suite-ui/package.json", import.meta.url),
  );
  const source = await readFile(require.resolve("sonner"), "utf8");
  const literal = /__insertCSS\(("(?:[^"\\]|\\.)*")\)/.exec(source)?.[1];
  if (!literal) throw new Error("Cannot find sonner's injected stylesheet");
  return ["", JSON.parse(literal)];
}

function inlineBodies(html, tag) {
  // Consume quoted values as a whole, including any '>' or apparent attributes inside them.
  const attributes = `((?:[^"'<>]|"[^"]*"|'[^']*')*)`;
  return [...html.matchAll(new RegExp(`<${tag}\\b${attributes}>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi"))]
    .filter((match) => {
      const names = [
        ...match[1].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g),
      ].map((attribute) => attribute[1].toLowerCase());
      return tag !== "script" || !names.includes("src");
    })
    .map((match) => match[2]);
}

export function assertCspHashes(html) {
  const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"\s*\/?\s*>/i.exec(
    html,
  )?.[1];
  if (!policy) throw new Error("Missing Content-Security-Policy meta");
  const scripts = /(?:^|;)\s*script-src\s+([^;]+)/.exec(policy)?.[1]?.split(/\s+/) ?? [];
  for (const body of inlineBodies(html, "script")) {
    if (!scripts.includes(hash(body))) throw new Error("Missing inline-script CSP hash");
  }
  if (policy.includes("'self'") || !policy.includes("frame-src 'none'"))
    throw new Error("Unsafe native CSP");
}

export function addCsp(html, runtimeStyles = []) {
  if (/http-equiv=["']Content-Security-Policy/i.test(html)) throw new Error("CSP already exists");
  const scriptHashes = [...new Set(inlineBodies(html, "script").map(hash))].join(" ");
  const styleHashes = [
    ...new Set([...inlineBodies(html, "style"), ...runtimeStyles].map(hash)),
  ].join(" ");
  const nativeFiles = origins
    .flatMap((origin) =>
      ["_capacitor_file_", "_capacitor_content_"].map((prefix) => `${origin}/${prefix}/`),
    )
    .join(" ");
  const policy = [
    "default-src 'none'",
    `script-src ${staticSources} ${scriptHashes}`,
    "script-src-attr 'none'",
    `worker-src ${staticSources}`,
    `style-src ${staticSources} ${styleHashes}`,
    "style-src-attr 'unsafe-inline'",
    `font-src ${staticSources}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    `connect-src ${origins.join(" ")} https: http: wss: ws:`,
    `img-src ${origins.join(" ")} https: http: data: blob: ${nativeFiles}`,
    `media-src ${origins.join(" ")} https: http: blob: ${nativeFiles}`,
    "form-action 'none'",
  ].join("; ");
  // The policy precedes every script, including next-themes' bootstrap.
  if (!/<head(?:\s[^>]*)?>/i.test(html)) throw new Error("Missing HTML head for CSP");
  const result = html.replace(
    /<head(?:\s[^>]*)?>/i,
    (head) => `${head}<meta http-equiv="Content-Security-Policy" content="${policy}">`,
  );
  assertCspHashes(result);
  return result;
}

export async function writeCsp(exportDir) {
  const runtimeStyles = await runtimeStyleBodies();
  for (const path of await filesUnder(exportDir)) {
    if (!path.endsWith(".html")) continue;
    await writeFile(path, addCsp(await readFile(path, "utf8"), runtimeStyles));
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) await writeCsp(process.argv[2]);
