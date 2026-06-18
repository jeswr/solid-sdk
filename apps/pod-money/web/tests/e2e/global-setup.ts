// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Playwright globalSetup for the task #123 401-budget e2e. Runs once after the
// webServers (CSS@3000 + vite@5173) are up. It:
//   1. creates a fresh CSS account + pod (the verified solid-test-infrastructure recipe);
//   2. seeds the WebID profile (foaf:name + pim:storage — a fresh CSS pod has neither,
//      so without this the app sees no display name / no storage and looks broken);
//   3. seeds the PUBLIC TYPE INDEX (`settings/publicTypeIndex.ttl`) with a
//      fin:Transaction registration pointing at the ledger — pod-money's `MoneyStore.
//      discover(primaryClass)` reads THIS exact path to find the ledger;
//   4. seeds the finance LEDGER (`finance/ledger.ttl`) — ONE fin:FinancialAccount + MANY
//      fin:Transaction nodes. UNLIKE pod-music (which reads N PER-TRACK resources),
//      pod-money reads its accounts+transactions from a SINGLE ledger file, so the
//      per-resource 401-dance surface here is the DISCOVERY CHAIN: the authenticated
//      profile re-read + the type-index read + the ledger GET — each a DISTINCT pod URL
//      that paid its own wasted 401 under the old reactive manager. The transaction COUNT
//      is the regression knob: the 401 count must NOT scale with it (it never adds reads).
// It writes the seeded credentials to a JSON sidecar the spec reads (the spec drives
// the real OIDC popup login with this account; the seeded data is its pod contents).
//
// SELF-CONTAINED: a cross-file .ts/.mjs import from a Playwright globalSetup trips the
// config transpiler (CJS/ESM mismatch), so everything is inlined (the harness rule).
// LOCAL-ONLY: every fetch targets http://localhost:3000 (the local CSS) — never the
// live deploy.
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const BASE = "http://localhost:3000";
const ISSUER = `${BASE}/`;
const TOKEN_ENDPOINT = `${BASE}/.oidc/token`;
const POD = "alice";
const WEBID = `${BASE}/${POD}/profile/card#me`;
const NAME = "Alice Money";
const EMAIL = "alice@example.com";
const PASSWORD = "test-password-123";
const POD_ROOT = `${BASE}/${POD}/`;
// pod-money's fixed discovery paths (see src/store.ts):
//   • the public type index is ALWAYS `<podRoot>settings/publicTypeIndex.ttl`;
//   • the conventional ledger fallback is `<podRoot>finance/ledger.ttl`.
// We register the ledger in the type index AND put it at the conventional path, so the
// app's `MoneyStore.discover` finds it (type-index source) on a clean run.
const TYPE_INDEX = `${POD_ROOT}settings/publicTypeIndex.ttl`;
const LEDGER = `${POD_ROOT}finance/ledger.ttl`;
// The data layer's RDF namespaces (src/vocab.ts), restated here (inlined-setup rule).
const FIN = "https://TBD.example/solid/finance#";
const PM = "https://w3id.org/jeswr/pod-money#";
// The transaction COUNT is the regression knob: the 401 count must not scale with it.
const TXN_COUNT = 12;

// Where the spec reads the seeded account + container facts.
const CREDS_PATH = fileURLToPath(new URL("./.seeded-account.json", import.meta.url));

interface Jar {
  cookie?: string;
}

async function jsonPost(url: string, body: unknown, jar: Jar) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (jar.cookie) headers.cookie = jar.cookie;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
  const sc = res.headers.get("set-cookie");
  if (sc) jar.cookie = sc.split(";")[0];
  return { status: res.status, json: await res.json() };
}

async function controls(jar: Jar) {
  const res = await fetch(`${BASE}/.account/`, {
    headers: jar.cookie ? { cookie: jar.cookie } : {},
  });
  return (await res.json()).controls;
}

/** Build the ledger Turtle: ONE account + `txnCount` transactions linked to it. */
function ledgerTurtle(txnCount: number): string {
  const account = `${LEDGER}#account-current`;
  let body = `@prefix fin: <${FIN}>.
@prefix pm: <${PM}>.
@prefix skos: <http://www.w3.org/2004/02/skos/core#>.
@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.

<#account-current> a fin:FinancialAccount, fin:CurrentAccount, fin:ActiveFinancialAccount;
  skos:prefLabel "Everyday Current".
`;
  for (let k = 0; k < txnCount; k++) {
    body += `
<#txn-${k}> a fin:Transaction;
  pm:account <${account}>;
  fin:hasMonetaryAmount <#amt-${k}>;
  fin:postingTime "2026-01-${String((k % 28) + 1).padStart(2, "0")}T10:00:00Z"^^xsd:dateTime.
<#amt-${k}> a fin:MonetaryAmount; fin:amount "${(k + 1) * 1.5}"^^xsd:decimal; fin:currency "GBP".
`;
  }
  return body;
}

export default async function globalSetup() {
  // Guard: make sure :3000 is really a CSS (a stray dev server poisons everything with
  // 308/HTML). The solid-test-infrastructure gotcha.
  const probe = await fetch(`${BASE}/.account/`, { headers: { accept: "application/json" } });
  if (!probe.ok || !(probe.headers.get("content-type") ?? "").includes("json")) {
    throw new Error(
      `Whatever is listening on ${BASE} is not a Community Solid Server ` +
        `(/.account/ -> ${probe.status} ${probe.headers.get("content-type")}). ` +
        "Check 'lsof -i :3000' — a stray dev server on :3000 is the usual culprit.",
    );
  }

  // 1. account -> password -> pod -> client credentials (the verified recipe). The CSS
  // webServer is NOT reused (reuseExistingServer:false in playwright.config), so the
  // server is FRESH every run — locally AND in CI — and the fixed `alice` account / pod
  // never pre-exists. So a 4xx here IS a genuine error.
  const jar: Jar = {};
  await jsonPost(`${BASE}/.account/account/`, {}, jar); // {} body — an EMPTY body 500s with a JSON content-type
  const c = await controls(jar);
  await jsonPost(c.password.create, { email: EMAIL, password: PASSWORD }, jar);
  const pod = await jsonPost(c.account.pod, { name: POD }, jar);
  if (pod.status >= 400) throw new Error(`pod create failed: ${JSON.stringify(pod.json)}`);
  const cc = await jsonPost(c.account.clientCredentials, { name: "seed", webId: WEBID }, jar);

  // 2. exchange client-credentials for a DPoP-bound token (jose-built proofs; the
  //    resource writes carry the `ath` claim).
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), alg: "ES256" };
  const proof = (method: string, url: string, ath?: string) =>
    new SignJWT({ htu: url, htm: method, jti: randomUUID(), ...(ath ? { ath } : {}) })
      .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk })
      .setIssuedAt()
      .sign(privateKey);
  const basic = Buffer.from(
    `${encodeURIComponent(cc.json.id)}:${encodeURIComponent(cc.json.secret)}`,
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
  if (!tr.ok) throw new Error(`token ${tr.status}: ${await tr.text()}`);
  const { access_token } = await tr.json();
  const ath = createHash("sha256").update(access_token).digest("base64url");

  const authedPut = async (url: string, body: string, contentType: string) => {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        authorization: `DPoP ${access_token}`,
        dpop: await proof("PUT", url, ath),
        "content-type": contentType,
      },
      body,
    });
    if (!res.ok && res.status !== 205) {
      throw new Error(`PUT ${url} -> ${res.status}: ${await res.text()}`);
    }
  };

  // PRE-CREATE the intermediate CONTAINER for a resource before PUTting into it (roborev
  // MEDIUM, back-ported from pod-health becddf5). CSS auto-creates intermediate containers
  // on a resource PUT — so the e2e passes WITHOUT this — but an explicit container PUT first
  // makes the seed robust on a server that does NOT auto-create them, and keeps the seeded
  // pod shape deterministic. A container is created with a PUT of `text/turtle` to the
  // trailing-slash URL; an already-existing container returns 2xx/205, both accepted.
  const ensureContainer = async (containerUrl: string) => {
    await authedPut(containerUrl, "", "text/turtle");
  };
  // The type index lives under `settings/`; the ledger under `finance/`. Pre-create both.
  await ensureContainer(`${POD_ROOT}settings/`);
  await ensureContainer(`${POD_ROOT}finance/`);

  // 3. seed the bare profile (foaf:name + pim:storage so the app has a display name +
  //    a storage root).
  await authedPut(
    `${BASE}/${POD}/profile/card`,
    `@prefix foaf: <http://xmlns.com/foaf/0.1/>.
@prefix solid: <http://www.w3.org/ns/solid/terms#>.
@prefix pim: <http://www.w3.org/ns/pim/space#>.
@prefix vcard: <http://www.w3.org/2006/vcard/ns#>.
<> a foaf:PersonalProfileDocument; foaf:maker <${WEBID}>; foaf:primaryTopic <${WEBID}>.
<${WEBID}> a foaf:Person;
  solid:oidcIssuer <${ISSUER}>;
  pim:storage <${POD_ROOT}>;
  foaf:name "${NAME}";
  vcard:hasPhoto <https://avatars.githubusercontent.com/u/9132?v=4>.
`,
    "text/turtle",
  );

  // 4. seed the PUBLIC TYPE INDEX with a fin:Transaction registration pointing at the
  //    ledger. pod-money's `MoneyStore.discover` reads THIS path (settings/publicType
  //    Index.ttl) to locate the ledger — a distinct pod URL in the discovery chain.
  await authedPut(
    TYPE_INDEX,
    `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
@prefix fin: <${FIN}>.
<> a solid:TypeIndex, solid:ListedDocument.
<#registration-pod-money-transactions> a solid:TypeRegistration;
  solid:forClass fin:Transaction;
  solid:instance <${LEDGER}>.
`,
    "text/turtle",
  );

  // 5. seed the finance LEDGER (one account + MANY transactions). This is the single
  //    file `readLedger` GETs — the transaction COUNT is the regression knob (more
  //    transactions = more TRIPLES in ONE file, never more reads).
  await authedPut(LEDGER, ledgerTurtle(TXN_COUNT), "text/turtle");

  // 6. hand the spec the seeded facts (login credentials + the regression knob).
  writeFileSync(
    CREDS_PATH,
    JSON.stringify(
      {
        base: BASE,
        webId: WEBID,
        email: EMAIL,
        password: PASSWORD,
        podRoot: POD_ROOT,
        typeIndex: TYPE_INDEX,
        ledger: LEDGER,
        txnCount: TXN_COUNT,
      },
      null,
      2,
    ),
  );
  // eslint-disable-next-line no-console
  console.log(
    `[global-setup] seeded ${WEBID} with ${TXN_COUNT} transactions in finance/ledger.ttl`,
  );
}
