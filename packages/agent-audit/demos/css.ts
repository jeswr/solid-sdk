// AUTHORED-BY Codex GPT-6.1-Sol
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fork } from "child_process";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { createHash, generateKeyPairSync, randomUUID, sign } from "crypto";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { once } from "events";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { createServer } from "net";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { dirname, join } from "path";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";
import { z } from "zod";
import type { AuditFetch } from "../dist/index.js";

/** No credentials leave this worker's ephemeral CSS origin. */
export async function startCss() {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const origin = `http://localhost:${port}/`;
  const directory = await mkdtemp(join(tmpdir(), "audit-demo-"));
  const css = dirname(fileURLToPath(import.meta.resolve("@solid/community-server/package.json")));
  const config = JSON.parse(await readFile(join(css, "config/file-root.json"), "utf8"));
  config.import = config.import.map((s: string) =>
    s
      .replace("storage/backend/file.json", "storage/backend/memory.json")
      .replace("util/resource-locker/file.json", "util/resource-locker/memory.json")
      .replace("identity/handler/no-accounts.json", "identity/handler/default.json"),
  );
  const configPath = join(directory, "memory.json");
  await writeFile(configPath, JSON.stringify(config));
  const child = fork(
    fileURLToPath(new URL("./css-process.mjs", import.meta.url)),
    [configPath, String(port)],
    {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      execArgv: [],
      env: { NODE_ENV: "production", PATH: process.env.PATH },
    },
  );
  async function stop() {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 5000);
      try {
        await exited;
      } finally {
        clearTimeout(force);
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CSS startup timed out")), 60000);
      child.once("message", () => {
        clearTimeout(timer);
        resolve();
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("CSS startup failed"));
      });
      child.once("error", () => {
        clearTimeout(timer);
        reject(new Error("CSS startup failed"));
      });
    });
    const localIo = createNodeGuardedFetch({ allowLoopback: true, maxRedirects: 0 });
    const anonymous: AuditFetch = (input, init) => {
      if (new URL(String(input)).origin !== new URL(origin).origin)
        throw new Error("CSS demo request outside local server");
      return localIo(input, init);
    };
    return { origin, anonymous, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** Generate a throwaway CSS account and DPoP key; never print or persist secrets. */
export async function seedOwner(origin: string, io: AuditFetch) {
  let cookie = "";
  async function json(url: string, body?: unknown) {
    if (new URL(url).origin !== new URL(origin).origin) throw new Error("Foreign account endpoint");
    const response = await io(url, {
      method: body === undefined ? "GET" : "POST",
      credentials: "omit",
      redirect: "manual",
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error("CSS account provisioning failed");
    const next = response.headers.get("set-cookie");
    if (next) cookie = next.split(";")[0] as string;
    return response.json();
  }
  await json(new URL(".account/account/", origin).href, {});
  const { controls } = z
    .object({
      controls: z.object({
        password: z.object({ create: z.string() }),
        account: z.object({ pod: z.string(), clientCredentials: z.string() }),
      }),
    })
    .parse(await json(new URL(".account/", origin).href));
  await json(controls.password.create, {
    email: `${randomUUID()}@example.org`,
    password: randomUUID(),
  });
  await json(controls.account.pod, { name: "owner" });
  const root = new URL("owner/", origin).href;
  const owner = new URL("profile/card#me", root).href;
  const cc = z
    .object({ id: z.string(), secret: z.string() })
    .parse(await json(controls.account.clientCredentials, { name: "auditor-demo", webId: owner }));
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  function proof(method: string, url: string, accessToken?: string) {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const input = `${encode({ alg: "ES256", typ: "dpop+jwt", jwk })}.${encode({
      htu: url,
      htm: method,
      jti: randomUUID(),
      iat: Math.floor(Date.now() / 1000),
      ...(accessToken ? { ath: createHash("sha256").update(accessToken).digest("base64url") } : {}),
    })}`;
    return `${input}.${sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  }
  const endpoint = new URL(".oidc/token", origin).href;
  const tokenResponse = await io(endpoint, {
    method: "POST",
    credentials: "omit",
    redirect: "manual",
    headers: {
      authorization: `Basic ${Buffer.from(`${encodeURIComponent(cc.id)}:${encodeURIComponent(cc.secret)}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      dpop: proof("POST", endpoint),
    },
    body: "grant_type=client_credentials&scope=webid",
  });
  if (!tokenResponse.ok) throw new Error("CSS token provisioning failed");
  const { access_token: accessToken } = z
    .object({ access_token: z.string().min(1) })
    .parse(await tokenResponse.json());
  const authenticated: AuditFetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.username || url.password || url.hash || !url.href.startsWith(root))
      throw new Error("Owner transport outside pod");
    const headers = new Headers(init?.headers);
    headers.set("authorization", `DPoP ${accessToken}`);
    headers.set("dpop", proof(init?.method ?? "GET", url.href, accessToken));
    return io(input, { ...init, headers, credentials: "omit", redirect: "manual" });
  };
  return { root, owner, authenticated };
}
