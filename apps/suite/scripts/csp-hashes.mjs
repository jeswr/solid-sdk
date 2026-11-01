// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { filesUnder } from "./route-manifest.mjs";

const origins = ["https://localhost", "capacitor://localhost"];
const staticSources = origins.map((origin) => `${origin}/_next/static/`).join(" ");
const hash = (body) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`;

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
  // The attribute parser must account for every script start tag; anything it cannot parse
  // would otherwise go unhashed and unchecked.
  const starts = html.match(/<script\b/gi)?.length ?? 0;
  const closed =
    html.match(/<script\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>[\s\S]*?<\/script\s*>/gi)?.length ?? 0;
  if (starts !== closed) throw new Error("Unparseable script element");
  for (const body of inlineBodies(html, "script")) {
    if (!scripts.includes(hash(body))) throw new Error("Missing inline-script CSP hash");
  }
  if (policy.includes("'self'") || !policy.includes("frame-src 'none'"))
    throw new Error("Unsafe native CSP");
}

export function addCsp(html) {
  if (/http-equiv=["']Content-Security-Policy/i.test(html)) throw new Error("CSP already exists");
  const scriptHashes = [...new Set(inlineBodies(html, "script").map(hash))].join(" ");
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
    // Radix's scroll lock (react-style-singleton) and Sonner insert <style> elements at
    // runtime, and the scroll lock's body holds computed pixel values, so no build-time hash
    // can match it. Any hash or nonce would also disable 'unsafe-inline'. Inline styles are
    // therefore allowed; scripts stay hash-locked, and img/connect already allow https:, so
    // CSS gives an injected page nothing script and image loads do not.
    `style-src ${staticSources} 'unsafe-inline'`,
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
  for (const path of await filesUnder(exportDir)) {
    if (!path.endsWith(".html")) continue;
    await writeFile(path, addCsp(await readFile(path, "utf8")));
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) await writeCsp(process.argv[2]);
