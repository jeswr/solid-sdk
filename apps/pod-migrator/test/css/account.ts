// AUTHORED-BY Codex GPT-6
import { randomUUID } from "node:crypto";
import { createPodHttp, type PodSide } from "../../src/engine/index.js";
import { boundedFetch, createSession, localUrl } from "./auth.js";

export interface CssAccount {
  webId: string;
  podRoot: string;
  fetch: typeof fetch;
  clientId: string;
  side: PodSide;
}

export function accountRequest(
  base: string,
  endpoint: string,
  cookies: ReadonlyMap<string, string>,
  body?: unknown,
): { url: string; init: RequestInit } {
  const url = localUrl(new URL(endpoint, base).href, new URL(base).origin);
  if (!new URL(url).pathname.startsWith("/.account/"))
    throw new Error("Account controls must stay inside /.account/");
  const headers = new Headers({ accept: "application/json" });
  if (cookies.size) headers.set("cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
  if (body !== undefined) headers.set("content-type", "application/json");
  return {
    url,
    init: {
      method: body === undefined ? "GET" : "POST",
      headers,
      redirect: "manual",
      ...(body === undefined ? {} : { body: JSON.stringify(body ?? {}) }),
    },
  };
}

export function rememberCookies(headers: Headers, cookies: Map<string, string>): void {
  for (const cookie of headers.getSetCookie()) {
    const pair = cookie.split(";", 1)[0] ?? "";
    const separator = pair.indexOf("=");
    if (separator < 1) throw new Error("CSS returned a malformed account cookie");
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

export async function createAccount(
  base: string,
  origins = [base],
  fetcher: typeof fetch = boundedFetch,
): Promise<CssAccount> {
  const cookies = new Map<string, string>();
  const name = `migration-${randomUUID()}`;
  async function request(endpoint: string, body?: unknown): Promise<Record<string, unknown>> {
    const { url, init } = accountRequest(base, endpoint, cookies, body);
    const response = await fetcher(url, init);
    if (!response.ok) throw new Error(`CSS account API ${init.method} failed (${response.status})`);
    rememberCookies(response.headers, cookies);
    return (await response.json()) as Record<string, unknown>;
  }
  await request("/.account/account/", {});
  const index = await request("/.account/");
  const controls = index.controls as {
    password?: { create?: string };
    account?: { pod?: string; clientCredentials?: string };
  };
  if (!controls?.password?.create || !controls.account?.pod || !controls.account.clientCredentials)
    throw new Error("CSS account API is missing registration, pod or client credential controls");
  await request(controls.password.create, {
    email: `${name}@example.test`,
    password: randomUUID(),
  });
  const pod = await request(controls.account.pod, { name });
  if (typeof pod.pod !== "string" || typeof pod.webId !== "string")
    throw new Error("CSS pod creation did not return its pod and WebID");
  const podRoot = localUrl(pod.pod, new URL(base).origin);
  const webId = localUrl(pod.webId, new URL(base).origin);
  const credentials = await request(controls.account.clientCredentials, {
    name: "pod-migrator-integration",
    webId,
  });
  if (typeof credentials.id !== "string" || typeof credentials.secret !== "string")
    throw new Error("CSS did not return client credentials");
  const discovery = await fetcher(new URL("/.well-known/openid-configuration", base).href, {
    headers: { accept: "application/json" },
    redirect: "manual",
  });
  if (!discovery.ok) throw new Error(`CSS discovery failed (${discovery.status})`);
  const metadata = (await discovery.json()) as { token_endpoint: string };
  const endpoint = localUrl(metadata.token_endpoint, new URL(base).origin);
  const authenticated = await createSession(
    endpoint,
    { id: credentials.id, secret: credentials.secret },
    origins,
    fetcher,
  );
  return {
    webId,
    podRoot,
    clientId: credentials.id,
    fetch: authenticated,
    side: {
      root: podRoot,
      ownerWebId: webId,
      implementation: "css",
      http: createPodHttp({ root: podRoot, fetch: authenticated, allowInsecureLoopback: true }),
      publicHttp: createPodHttp({ root: podRoot, fetch: fetcher, allowInsecureLoopback: true }),
    },
  };
}
