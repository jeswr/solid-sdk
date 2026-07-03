// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Playwright global setup (self-contained per the skill's gotcha — no sibling
 * imports). Runs once after CSS + the app are up: creates a CSS account + pod for
 * `alice`, seeds her profile with `foaf:name` + `pim:storage` (a fresh CSS pod has
 * neither, so login "works" but has no display name / write path), and writes the
 * credentials to `e2e/.auth.json` for the specs. The verified CSS account-API +
 * client-credentials DPoP recipe (solid-test-infrastructure skill).
 */
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const BASE = "http://localhost:3000";
const POD = "alice";
const EMAIL = "alice@example.com";
const PASSWORD = "alice-pass-123";

interface Jar {
  cookie?: string;
}

async function jsonPost(url: string, body: unknown, jar: Jar): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (jar.cookie) headers.cookie = jar.cookie;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
  const sc = res.headers.get("set-cookie");
  if (sc) jar.cookie = sc.split(";")[0];
  if (!res.ok && res.status !== 409) throw new Error(`${url} -> ${res.status}: ${await res.text()}`);
  return res.status === 409 ? {} : ((await res.json()) as Record<string, unknown>);
}

export default async function globalSetup(): Promise<void> {
  const webId = `${BASE}/${POD}/profile/card#me`;
  const podRoot = `${BASE}/${POD}/`;
  const jar: Jar = {};

  try {
    // account -> password -> pod -> client credentials
    await jsonPost(`${BASE}/.account/account/`, {}, jar);
    const { controls } = (await (
      await fetch(`${BASE}/.account/`, { headers: jar.cookie ? { cookie: jar.cookie } : {} })
    ).json()) as {
      controls: {
        password: { create: string };
        account: { pod: string; clientCredentials: string };
      };
    };
    await jsonPost(controls.password.create, { email: EMAIL, password: PASSWORD }, jar);
    await jsonPost(controls.account.pod, { name: POD }, jar);
    const cc = (await jsonPost(controls.account.clientCredentials, { name: "fixture", webId }, jar)) as {
      id: string;
      secret: string;
    };

    // exchange for a DPoP-bound token
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const jwk = { ...(await exportJWK(publicKey)), alg: "ES256" };
    const proof = (htm: string, htu: string, ath?: string) =>
      new SignJWT({ htu, htm, jti: randomUUID(), ...(ath ? { ath } : {}) })
        .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk })
        .setIssuedAt()
        .sign(privateKey);
    const tokenEndpoint = `${BASE}/.oidc/token`;
    const basic = Buffer.from(`${encodeURIComponent(cc.id)}:${encodeURIComponent(cc.secret)}`).toString("base64");
    const tokenRes = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
        dpop: await proof("POST", tokenEndpoint),
      },
      body: "grant_type=client_credentials&scope=webid",
    });
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    const ath = createHash("sha256").update(access_token).digest("base64url");

    // seed the profile: foaf:name + pim:storage
    const cardUrl = `${BASE}/${POD}/profile/card`;
    const card = `@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix pim: <http://www.w3.org/ns/pim/space#> .
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
<${cardUrl}#me> a foaf:Person ;
  foaf:name "Alice Tester" ;
  pim:storage <${podRoot}> ;
  solid:oidcIssuer <${BASE}/> .`;
    await fetch(cardUrl, {
      method: "PUT",
      headers: {
        authorization: `DPoP ${access_token}`,
        dpop: await proof("PUT", cardUrl, ath),
        "content-type": "text/turtle",
      },
      body: card,
    });

    writeFileSync(
      join(process.cwd(), "e2e", ".auth.json"),
      JSON.stringify({ webId, podRoot, email: EMAIL, password: PASSWORD, base: BASE }, null, 2),
    );
  } catch (err) {
    // Surface but do not hard-fail globalSetup if CSS already had the account.
    console.warn("[global-setup] seeding note:", (err as Error).message);
  }
}
