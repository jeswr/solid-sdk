// AUTHORED-BY Codex GPT-6.1-Sol
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { forClientCredentials } from "@jeswr/pod-auth/node";
import { DataFactory as df, Writer } from "n3";

export const CSS = "https://localhost:3390/";
export const MCP = "https://127.0.0.1:3391";

/** Components.js needs an isolated flat dependency closure in a pnpm monorepo. */
function componentRoot(binary: string): string {
  const root = mkdtempSync(join(tmpdir(), "mcp-css-"));
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "package.json"), '{"name":"mcp-css-fixture","private":true}');
  let dir = dirname(realpathSync(binary));
  while (!existsSync(join(dir, "package.json"))) dir = dirname(dir);
  const queue = [dir];
  const linked = new Set<string>();
  for (let current = queue.shift(); current; current = queue.shift()) {
    const { name } = JSON.parse(readFileSync(join(current, "package.json"), "utf8")) as {
      name: string;
    };
    if (linked.has(name)) continue;
    linked.add(name);
    const target = join(root, "node_modules", name);
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(current, target, "dir");
    const siblings = resolve(current, name.startsWith("@") ? "../.." : "..");
    for (const entry of readdirSync(siblings)) {
      if (entry.startsWith(".")) continue;
      const entries = entry.startsWith("@")
        ? readdirSync(join(siblings, entry)).map((scoped) => join(entry, scoped))
        : [entry];
      for (const dep of entries)
        if (!linked.has(dep)) queue.push(realpathSync(join(siblings, dep)));
    }
  }
  return root;
}

export async function startCss() {
  try {
    await fetch(CSS, { signal: AbortSignal.timeout(500) });
    throw new Error("CSS fixture port is occupied");
  } catch (error) {
    if (error instanceof Error && error.message.includes("occupied")) throw error;
  }
  const binary = createRequire(import.meta.url).resolve("@solid/community-server/bin/server.js");
  const root = componentRoot(binary);
  const keyPath = join(root, "server.key");
  const certPath = join(root, "server.crt");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-keyout",
      keyPath,
      "-out",
      certPath,
    ],
    { stdio: "ignore" },
  );
  const tls = { key: readFileSync(keyPath), cert: readFileSync(certPath) };
  const previousCAs = getCACertificates("default");
  setDefaultCACertificates([...previousCAs, tls.cert.toString()]);
  const configuration = JSON.parse(
    readFileSync(resolve(dirname(binary), "../config/default.json"), "utf8"),
  ) as { import: string[] };
  configuration.import = configuration.import.map((path) =>
    path.replace("server-factory/http.json", "server-factory/https.json"),
  );
  const configPath = join(root, "config.json");
  writeFileSync(configPath, JSON.stringify(configuration));
  const child = spawn(
    process.execPath,
    [
      binary,
      "-p",
      "3390",
      "-b",
      CSS,
      "-m",
      root,
      "-c",
      configPath,
      "--httpsKey",
      keyPath,
      "--httpsCert",
      certPath,
      "-l",
      "error",
    ],
    { stdio: "ignore", env: { ...process.env, NODE_EXTRA_CA_CERTS: certPath } },
  );
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(timer);
    }
    await rm(root, { force: true, recursive: true });
    setDefaultCACertificates(previousCAs);
  };
  try {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error("Local CSS exited during startup");
      try {
        const response = await fetch(`${CSS}.account/`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(1000),
        });
        const data = (await response.json()) as { controls?: unknown };
        if (response.ok && data.controls) return { stop, tls };
      } catch {
        /* Probe the CSS-specific account API until ready. */
      }
      await delay(150);
    }
    throw new Error("Local CSS account API did not become ready");
  } catch (error) {
    await stop();
    throw error;
  }
}

export class CookieJar {
  private readonly values = new Map<string, string>();
  get header() {
    return [...this.values].map(([key, value]) => `${key}=${value}`).join("; ");
  }
  absorb(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0] ?? "";
      const index = pair.indexOf("=");
      this.values.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
}

export async function cssAccount() {
  const pod = `mcp-${randomUUID()}`;
  const webId = `${CSS}${pod}/profile/card#me`;
  const podRoot = `${CSS}${pod}/`;
  const jar = new CookieJar();
  const json = async <T = unknown>(url: string, data?: unknown): Promise<T> => {
    if (new URL(url).origin !== new URL(CSS).origin)
      throw new Error("Account API escaped local CSS");
    const response = await fetch(url, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        accept: "application/json",
        cookie: jar.header,
        ...(data === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      redirect: "manual",
    });
    jar.absorb(response);
    if (!response.ok) throw new Error(`CSS account API status ${response.status}`);
    return response.json() as Promise<T>;
  };
  await json(`${CSS}.account/account/`, {});
  const { controls } = await json<{
    controls: { password: { create: string }; account: { pod: string; clientCredentials: string } };
  }>(`${CSS}.account/`);
  await json(controls.password.create, { email: `${pod}@example.org`, password: randomUUID() });
  await json(controls.account.pod, { name: pod });
  const cc = await json<{ id: string; secret: string }>(controls.account.clientCredentials, {
    name: "mcp-e2e",
    webId,
  });
  const credentials = { issuer: CSS, id: cc.id as string, secret: cc.secret as string };
  let podToken: string | undefined;
  const auth = await forClientCredentials({
    issuer: CSS,
    clientId: cc.id,
    clientSecret: cc.secret,
    boundary: [podRoot],
    fetch: (input, init) => {
      const request = new Request(input, init);
      if (new URL(request.url).origin !== new URL(CSS).origin)
        throw new Error("CSS fixture transport escaped local CSS");
      const authorization = request.headers.get("authorization");
      if (authorization?.startsWith("DPoP ")) podToken = authorization.slice(5);
      return fetch(request, { redirect: "manual" });
    },
  });
  const fetcher = auth.fetch;
  // Seed required profile data through a Writer; no interpolated Turtle syntax.
  const writer = new Writer();
  const person = df.namedNode(webId);
  writer.addQuad(
    person,
    df.namedNode("http://www.w3.org/ns/solid/terms#oidcIssuer"),
    df.namedNode(CSS),
  );
  writer.addQuad(
    person,
    df.namedNode("http://www.w3.org/ns/pim/space#storage"),
    df.namedNode(podRoot),
  );
  writer.addQuad(
    person,
    df.namedNode("http://xmlns.com/foaf/0.1/name"),
    df.literal("MCP test owner"),
  );
  const profile = await new Promise<string>((resolve, reject) =>
    writer.end((error, text) => (error ? reject(error) : resolve(text))),
  );
  const seed = await fetcher(`${podRoot}profile/card`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: profile,
  });
  if (!seed.ok) throw new Error(`CSS profile seed status ${seed.status}`);
  const privateUrl = `${podRoot}private/fixture.txt`;
  const put = await fetcher(privateUrl, {
    method: "PUT",
    headers: { "content-type": "text/plain" },
    body: "local CSS private fixture",
  });
  if (!put.ok) throw new Error(`CSS private seed status ${put.status}`);
  if (!podToken) throw new Error("CSS fixture did not observe authenticated pod access");
  return { webId, podRoot, jar, credentials, fetcher, privateUrl, podToken };
}

/** Drive CSS's real account-selection/consent controls; keep cookies on CSS only. */
export async function completeCssLogin(
  authorizeUrl: string,
  account: Awaited<ReturnType<typeof cssAccount>>,
): Promise<string> {
  const fetchCss = async (url: string, body?: unknown) => {
    if (new URL(url).origin !== new URL(CSS).origin)
      throw new Error("OIDC driver escaped local CSS");
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      redirect: "manual",
      headers: {
        cookie: account.jar.header,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    account.jar.absorb(response);
    return response;
  };
  let location: string | null = authorizeUrl;
  for (let step = 0; step < 24; step += 1) {
    if (location) {
      const url = new URL(location, CSS);
      if (url.origin === MCP && url.pathname === "/auth/callback") return url.href;
      const response = await fetchCss(url.href);
      location = response.headers.get("location");
      if (location) continue;
    }
    const prompt = (await (await fetchCss(`${CSS}.account/oidc/prompt/`)).json()) as {
      prompt: string;
      location?: string;
      controls: { oidc: { webId: string; consent: string } };
    };
    const selecting = ["login", "select_account"].includes(prompt.prompt);
    if (!selecting && prompt.prompt !== "consent") throw new Error("Unexpected local CSS prompt");
    const response = await fetchCss(
      selecting ? prompt.controls.oidc.webId : prompt.controls.oidc.consent,
      selecting ? { webId: account.webId, remember: true } : { remember: true },
    );
    if (!response.ok) throw new Error(`CSS OIDC prompt status ${response.status}`);
    location = ((await response.json()) as { location?: string }).location ?? null;
  }
  throw new Error("CSS login failed to reach the exact MCP callback");
}
