// AUTHORED-BY Codex GPT-6.1-Sol
import { createNodeGuardedFetch, nodeGuardedFetch } from "@jeswr/guarded-fetch/node";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { resolve } from "path";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { pathToFileURL } from "url";
import { type AuditFetch, runAuditCli } from "../dist/index.js";

const usage = "Usage: pnpm --filter @jeswr/agent-audit demo [--base <prepared-pod-root/>]";
const scenarios = [
  { name: "approved", breaches: [] },
  { name: "forged-approval", breaches: ["forged-approval"] },
  { name: "out-of-scope", breaches: ["out-of-scope"] },
  { name: "revoked-at-time", breaches: ["revoked-at-time"] },
  { name: "missing-prov", breaches: ["missing-prov"] },
];

/** Public, read-only replay; require each case's exact breach set and exit code. */
export async function replay(base: string, io: AuditFetch, print: (line: string) => void) {
  let ok = true;
  for (const { name, breaches: expectedBreaches } of scenarios) {
    for (let number = 1; number <= (name === "approved" ? 2 : 1); number++) {
      const proposal = new URL(`demos/d3/${name}/agent/proposals/${number}.ttl`, base).href;
      print(`\nCASE ${name}${name === "approved" ? ` ${number}` : ""}: audit ${proposal}`);
      const lines: string[] = [];
      const result = await runAuditCli(
        [proposal],
        (line) => {
          lines.push(line);
          print(line);
        },
        { fetch: io },
      );
      const breaches = lines
        .filter((line) => line.startsWith("BREACH "))
        .map((line) => line.slice("BREACH ".length));
      const expected =
        result === (expectedBreaches.length === 0 ? 0 : 1) &&
        breaches.length === expectedBreaches.length &&
        expectedBreaches.every((breach) => breaches.includes(breach));
      ok &&= expected;
      print(`${expected ? "EXPECTED" : "UNEXPECTED"} ${name}: audit exit ${result}`);
    }
  }
  print(
    "Status evidence is current, not an authoritative historical archive; hash chains do not prove tail completeness.",
  );
  print(
    ok
      ? "D-3 PASS: two approved audits and four named breaches"
      : "D-3 FAIL: unexpected audit result",
  );
  return ok ? 0 : 1;
}

export async function runDemo(
  args: readonly string[],
  print: (line: string) => void,
): Promise<number> {
  if (args.length === 1 && args[0] === "--help") {
    print(usage);
    return 0;
  }
  if (args.length !== 0 && !(args.length === 2 && args[0] === "--base")) {
    print(usage);
    return 1;
  }
  try {
    if (args.length === 2) {
      const base = new URL(args[1] as string);
      if (
        !["http:", "https:"].includes(base.protocol) ||
        base.username ||
        base.password ||
        base.search ||
        base.hash ||
        !base.pathname.endsWith("/")
      )
        throw new Error("Invalid base");
      // Loopback relaxation is confined to an explicitly local base; production stays DNS-pinned.
      let io: AuditFetch = nodeGuardedFetch;
      if (["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) {
        const localIo = createNodeGuardedFetch({ allowLoopback: true, maxRedirects: 0 });
        io = (input, init) => {
          if (new URL(String(input)).origin !== base.origin)
            throw new Error("Local replay request outside configured server");
          return localIo(input, init);
        };
      }
      print("D-3 read-only replay of a prepared pod; zero credentials");
      return await replay(base.href, io, print);
    }
    const { startCss, seedOwner } = await import("./css.ts");
    const css = await startCss();
    try {
      print("D-3 local in-memory CSS; generated identities and keys; in-memory delivery sink");
      const owner = await seedOwner(css.origin, css.anonymous);
      const { seedWalkthrough } = await import("./scenario.ts");
      await seedWalkthrough({
        pod: owner.root,
        owner: owner.owner,
        io: owner.authenticated,
        anonymous: css.anonymous,
        print,
      });
      print(`REPLAY BASE ${owner.root} (ephemeral; removed when this command exits)`);
      return await replay(owner.root, css.anonymous, print);
    } finally {
      await css.stop();
    }
  } catch {
    // Do not echo arguments, HTTP responses or crypto/account errors containing secrets.
    print("D-3 FAIL: invalid configuration or demo provisioning failed");
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = await runDemo(process.argv.slice(2), console.log);
