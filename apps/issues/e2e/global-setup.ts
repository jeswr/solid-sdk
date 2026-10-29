// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// Runs once after webServer (CSS + Next) are up. Seeds Alice and Bob, including
// private LDN inboxes with peer Append access, via client-credentials DPoP.
// Self-contained: a cross-file .ts/.mjs
// import from here trips Playwright's config transpiler (CJS/ESM mismatch), so it's all inline.
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { randomUUID, createHash } from "node:crypto";
import { LiteralFrom, NamedNodeFrom, OptionalAs, TermWrapper } from "@rdfjs/wrapper";
import { Authorization } from "@solid/object";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store, Writer } from "n3";

const BASE = process.env.IT_CSS_BASE ?? "http://localhost:3000";
const TOKEN_ENDPOINT = `${BASE}/.oidc/token`;
const FOAF = "http://xmlns.com/foaf/0.1/";
const PIM = "http://www.w3.org/ns/pim/space#";
const LDP = "http://www.w3.org/ns/ldp#";

class SeedProfile extends TermWrapper {
  set displayName(value: string) {
    OptionalAs.object(this, `${FOAF}name`, value, LiteralFrom.string);
  }
  set storage(value: string) {
    OptionalAs.object(this, `${PIM}storage`, value, NamedNodeFrom.string);
  }
  set inbox(value: string) {
    OptionalAs.object(this, `${LDP}inbox`, value, NamedNodeFrom.string);
  }
}

function serialize(dataset: DatasetCore): Promise<string> {
  const writer = new Writer({ format: "text/turtle" });
  for (const quad of dataset) writer.addQuad(quad);
  return new Promise((resolve, reject) =>
    writer.end((error, turtle) => (error ? reject(error) : resolve(turtle))),
  );
}

function account(pod: string, name: string) {
  const podRoot = `${BASE}/${pod}/`;
  return {
    pod, name, podRoot,
    webId: `${podRoot}profile/card#me`,
    inboxUrl: `${podRoot}inbox/`,
    email: `${pod}@example.com`,
    password: "test-password-123",
  };
}

interface Jar {
  cookie?: string;
}

async function jsonPost(url: string, body: unknown, jar: Jar) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (jar.cookie) headers.cookie = jar.cookie;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
  const sc = res.headers.get("set-cookie");
  if (sc) jar.cookie = sc.split(";")[0];
  if (!res.ok) throw new Error(`CSS account POST failed (HTTP ${res.status}).`);
  return { status: res.status, json: await res.json() };
}

async function controls(jar: Jar) {
  const res = await fetch(`${BASE}/.account/`, {
    headers: jar.cookie ? { cookie: jar.cookie } : {},
  });
  return (await res.json()).controls;
}

async function seedPod(
  owner: ReturnType<typeof account>, peerWebId: string, ccId: string, ccSecret: string,
) {
  // This workspace export is import-only; Playwright loads this config as CJS.
  const { fetchRdf, RdfFetchError } = await import("@jeswr/fetch-rdf");
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  jwk.alg = "ES256";
  const proof = (method: string, url: string, ath?: string) =>
    new SignJWT({ htu: url, htm: method, jti: randomUUID(), ...(ath ? { ath } : {}) })
      .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk })
      .setIssuedAt()
      .sign(privateKey);

  const basic = Buffer.from(
    `${encodeURIComponent(ccId)}:${encodeURIComponent(ccSecret)}`,
  ).toString("base64");
  const tr = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
      dpop: await proof("POST", TOKEN_ENDPOINT),
    },
    body: "grant_type=client_credentials&scope=webid",
  });
  if (!tr.ok) throw new Error(`CSS token exchange failed (HTTP ${tr.status}).`);
  const { access_token } = await tr.json();
  const ath = createHash("sha256").update(access_token).digest("base64url");

  const authenticatedFetch: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).origin !== BASE) throw new Error("Fixture request must stay on local CSS.");
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    headers.set("authorization", `DPoP ${access_token}`);
    headers.set("dpop", await proof(method, url, ath));
    return fetch(input, { ...init, headers, redirect: "error" });
  };
  const putDataset = async (url: string, dataset: DatasetCore, headers = {}) => {
    const res = await authenticatedFetch(url, {
      method: "PUT",
      headers: { "content-type": "text/turtle", ...headers },
      body: await serialize(dataset),
    });
    if (!res.ok) throw new Error(`CSS fixture PUT failed (HTTP ${res.status}).`);
  };

  // Preserve the server-created profile and its issuer; mutate via typed setters.
  const profileDoc = new URL("profile/card", owner.podRoot).href;
  const { dataset, etag } = await fetchRdf(profileDoc, { fetch: authenticatedFetch });
  const profile = new SeedProfile(owner.webId, dataset, DataFactory);
  profile.displayName = owner.name;
  profile.storage = owner.podRoot;
  profile.inbox = owner.inboxUrl;
  await putDataset(profileDoc, dataset, etag ? { "if-match": etag } : {});

  await putDataset(owner.inboxUrl, new Store(), {
    link: `<${LDP}BasicContainer>; rel="type"`,
  });
  const head = await authenticatedFetch(owner.inboxUrl, { method: "HEAD" });
  const aclLink = /<([^>]+)>;\s*rel="?acl"?/i.exec(head.headers.get("link") ?? "");
  if (!head.ok || !aclLink) throw new Error("Local CSS inbox did not advertise its ACL.");
  const aclUrl = new URL(aclLink[1], owner.inboxUrl).href;
  let aclEtag: string | null = null;
  try {
    aclEtag = (await fetchRdf(aclUrl, { fetch: authenticatedFetch })).etag;
  } catch (error) {
    if (!(error instanceof RdfFetchError) || error.status !== 404) throw error;
  }
  const acl = new Store();
  const ownerGrant = new Authorization(`${aclUrl}#owner`, acl, DataFactory);
  ownerGrant.type.add("http://www.w3.org/ns/auth/acl#Authorization");
  ownerGrant.accessTo = owner.inboxUrl;
  ownerGrant.default = owner.inboxUrl;
  ownerGrant.agent.add(owner.webId);
  ownerGrant.canRead = true;
  ownerGrant.canWrite = true;
  ownerGrant.canReadWriteAcl = true;

  // The other seeded account may POST, but cannot list/read the inbox or members.
  const peerGrant = new Authorization(`${aclUrl}#peer`, acl, DataFactory);
  peerGrant.type.add("http://www.w3.org/ns/auth/acl#Authorization");
  peerGrant.accessTo = owner.inboxUrl;
  peerGrant.agent.add(peerWebId);
  peerGrant.canAppend = true;
  await putDataset(aclUrl, acl, aclEtag ? { "if-match": aclEtag } : { "if-none-match": "*" });
  const anonymous = await fetch(owner.inboxUrl);
  if (anonymous.status !== 401 && anonymous.status !== 403) {
    throw new Error(`Seeded inbox must be private (anonymous HTTP ${anonymous.status}).`);
  }
}

async function seedAccount(owner: ReturnType<typeof account>, peerWebId: string) {
  const jar: Jar = {};
  await jsonPost(`${BASE}/.account/account/`, {}, jar);
  const c = await controls(jar);
  await jsonPost(c.password.create, { email: owner.email, password: owner.password }, jar);
  await jsonPost(c.account.pod, { name: owner.pod }, jar);
  const cc = await jsonPost(c.account.clientCredentials, { name: "seed", webId: owner.webId }, jar);
  await seedPod(owner, peerWebId, cc.json.id, cc.json.secret);
}

export default async function globalSetup() {
  const local = new URL(BASE);
  if (local.protocol !== "http:" || local.hostname !== "localhost" || local.origin !== BASE) {
    throw new Error("IT_CSS_BASE must be an http://localhost:<port> origin; never use a live server.");
  }
  // Guard: make sure :3000 is actually a CSS — a stray dev server (e.g. a `next dev`
  // with its default port) answers 200 on "/" and poisons everything downstream
  // with cryptic 308/HTML responses.
  const probe = await fetch(`${BASE}/.account/`, { headers: { accept: "application/json" } });
  if (!probe.ok || !(probe.headers.get("content-type") ?? "").includes("json")) {
    throw new Error(
      `Whatever is listening on ${BASE} is not a Community Solid Server ` +
        `(/.account/ -> ${probe.status} ${probe.headers.get("content-type")}). ` +
        `Check 'lsof -i :3000' — a stray 'next dev' (default port 3000) is the usual culprit.`,
    );
  }
  const stamp = randomUUID();
  const alice = account(`alice-${stamp}`, "Alice Verify");
  const bob = account(`bob-${stamp}`, "Bob Verify");
  await seedAccount(alice, bob.webId);
  await seedAccount(bob, alice.webId);
  // Runtime-only disposable login fixtures; never write credentials to disk/logs.
  process.env.SOLID_E2E_ACCOUNTS = JSON.stringify({ alice, bob });
  console.log("[global-setup] seeded local Alice and Bob with private LDN inboxes");

  // Warm the Next app server (a prod build — see playwright.config.ts) by hitting
  // "/" once before any test, so the first test never races the server's
  // first-request warmup/connection setup (best-effort — a slow/absent app must
  // not fail setup).
  const appPort = process.env.IT_APP_PORT ?? "3200";
  const appUrl = `http://localhost:${appPort}/`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 60_000);
  try {
    const res = await fetch(appUrl, { signal: ac.signal });
    await res.text(); // drain the streamed body so compilation completes
    console.log(`[global-setup] warmed Next app at ${appUrl} (${res.status})`);
  } catch {
    console.log(`[global-setup] app warmup skipped (${appUrl} not ready yet)`);
  } finally {
    clearTimeout(t); // best-effort warmup: never leave the abort timer live
  }
}
