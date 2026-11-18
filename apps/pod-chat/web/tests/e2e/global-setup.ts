// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Local CSS fixture for shared sign-in: create an account, seed its public
// profile and private chat rooms, then write the facts for the popup smoke test.
// Everything is inlined for Playwright's config transpiler. All requests target
// localhost; this fixture never contacts the deployed app or an external pod.
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const BASE = "http://localhost:3000";
const ISSUER = `${BASE}/`;
const TOKEN_ENDPOINT = `${BASE}/.oidc/token`;
const POD = "alice";
const WEBID = `${BASE}/${POD}/profile/card#me`;
const NAME = "Alice Chat";
const EMAIL = "alice@example.com";
const PASSWORD = "test-password-123";
const POD_ROOT = `${BASE}/${POD}/`;
// pod-chat's ChatStore derives its containers DIRECTLY from the pod root — no type-index
// lookup (src/store.ts: CHAT_SLUG=`pod-chat/`, ROOMS_SLUG=`rooms/`). So the rooms
// container is ALWAYS `<podRoot>pod-chat/rooms/` and we seed the room resources there.
const ROOMS_CONTAINER = `${POD_ROOT}pod-chat/rooms/`;
// The data layer's RDF namespaces (src/vocab.ts), restated here (the inlined-setup rule).
// Seed with the exact namespace schemes the accessors expect, so resources
// parse into visible rooms. parseRoom requires `<#it> a pc:ChatRoom` where pc: is the HTTPS
// w3id namespace, and reads `as:name`/`dct:creator`/`dct:created` where as: is the HTTPS
// w3.org form — both restated verbatim from src/vocab.ts here.
const PC = "https://jeswr.org/ns/pod-chat#";
const AS = "https://www.w3.org/ns/activitystreams#";
const DCT = "http://purl.org/dc/terms/";
// Seed enough rooms to verify the authenticated listing and its descriptor reads.
const ROOM_COUNT = 12;

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
  // never pre-exists (the roborev LOW re-run finding). So a 4xx here IS a genuine error.
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

  // 3. seed the bare profile (foaf:name + pim:storage so the app has a display name +
  //    a storage root). pod-chat's ChatStore derives `pod-chat/rooms/` from the pod root
  //    directly, so NO type-index registration is needed (the rooms below land at the
  //    conventional container the app reads).
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

  // 4. Seed chat-room resources under pod-chat/rooms/. A
  //    PUT to `rooms/room-K.ttl` auto-creates the `pod-chat/rooms/` container; each room is
  //    a distinct URL useChat point-reads individually when the room list loads (the
  //    listing + one descriptor read per room — the N+1 walk in src/ui/useChat.ts), so N
  //    rooms => N+1 reads. parseRoom requires `<#it> a pc:ChatRoom` (the room subject is
  //    `<resource>#it`) to count as a room row — so each seeded resource renders one
  //    `.pod-chat-room-row`. We ALSO type it `as:Collection` + carry `as:name`/
  //    `dct:creator`/`dct:created` exactly as the data layer writes a real room.
  for (let k = 0; k < ROOM_COUNT; k++) {
    await authedPut(
      `${ROOMS_CONTAINER}room-${k}.ttl`,
      // The @jeswr/pod-chat data layer pins pc: to the HTTPS w3id namespace and as: to the
      // HTTPS w3.org form (src/vocab.ts); parseRoom only counts a resource as a room when
      // `<#it> a https://jeswr.org/ns/pod-chat#ChatRoom`. Seeding with a different scheme
      // makes every resource parse-but-not-a-room. Use the exact schemes the accessors expect.
      `@prefix pc: <${PC}>.
@prefix as: <${AS}>.
@prefix dct: <${DCT}>.
@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
<#it> a as:Collection, pc:ChatRoom;
  as:name "Room ${k}";
  dct:creator <${WEBID}>;
  dct:created "2026-01-${String((k % 28) + 1).padStart(2, "0")}T10:00:00Z"^^xsd:dateTime.
`,
      "text/turtle",
    );
  }

  // 4b. Prove the container and a room require credentials before the browser
  // signs in, so a successful listing demonstrates authenticated access.
  for (const url of [ROOMS_CONTAINER, `${ROOMS_CONTAINER}room-0.ttl`]) {
    const anon = await fetch(url, { headers: { accept: "text/turtle" } });
    if (anon.status !== 401 && anon.status !== 403) {
      throw new Error(
        `Seeded resource ${url} is NOT private (unauthenticated GET -> ${anon.status}, ` +
          "expected 401/403). The sign-in smoke test requires private rooms. Check the pod ACL.",
      );
    }
  }

  // 5. hand the spec the seeded facts (login credentials + the private container).
  writeFileSync(
    CREDS_PATH,
    JSON.stringify(
      {
        base: BASE,
        webId: WEBID,
        email: EMAIL,
        password: PASSWORD,
        podRoot: POD_ROOT,
        roomsContainer: ROOMS_CONTAINER,
        roomCount: ROOM_COUNT,
      },
      null,
      2,
    ),
  );
  // eslint-disable-next-line no-console
  console.log(`[global-setup] seeded ${WEBID} with ${ROOM_COUNT} rooms under pod-chat/rooms/`);
}
