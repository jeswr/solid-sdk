// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fetchRdf, parseRdf } from "@jeswr/fetch-rdf";
import { createPodAuth } from "@jeswr/pod-auth";
import { createRegistration } from "@jeswr/pod-auth/registration";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { createPodClient } from "@jeswr/storage-client";
import { expect, test } from "vitest";
import { cssTarget } from "../src/targets/css.js";

/** A Node driver for CSS's normal account/password → WebID → consent UI, without mocking OIDC. */
function cssAuthorizationUi(
  base: string,
  email: string,
  password: string,
  webId: string,
  callback: string,
) {
  const cookies = new Map<string, string>();
  const transport = async (target: string | URL, signal: AbortSignal, body?: object) => {
    const url = new URL(target, base);
    assert.equal(url.origin, new URL(base).origin, "Foreign CSS UI control");
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      redirect: "manual",
      signal,
      headers: {
        accept: "application/json",
        cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";", 1)[0]!;
      const split = pair.indexOf("=");
      cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
    return response;
  };
  const json = async (target: string, signal: AbortSignal, body?: object) => {
    const response = await transport(target, signal, body);
    assert(response.ok, "CSS UI operation failed");
    // Deliberately discard parse causes; they can contain passwords/account tokens.
    try {
      return await response.json();
    } catch {
      throw new Error("Invalid CSS UI response");
    }
  };
  const navigate = async (
    target: string | URL,
    signal: AbortSignal,
  ): Promise<string | undefined> => {
    let url = new URL(target, base);
    for (let hop = 0; hop < 20; hop++) {
      if (url.origin === new URL(callback).origin && url.pathname === new URL(callback).pathname)
        return url.href;
      const response = await transport(url, signal);
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (response.status >= 300 && response.status < 400 && location) {
        url = new URL(location, url);
        continue;
      }
      assert(response.ok, "CSS authorization navigation failed");
      return undefined;
    }
    throw new Error("CSS authorization redirect limit exceeded");
  };
  return {
    getCode: async (authorizationUrl: URL, signal: AbortSignal) => {
      // Account login does not itself select an OIDC WebID or grant consent.
      let completed = await navigate(authorizationUrl, signal);
      if (completed) return completed;
      let index = await json(new URL(".account/", base).href, signal);
      const loggedIn = await json(index.controls.password.login, signal, { email, password });
      assert.equal(typeof loggedIn.location, "string", "CSS login must resume the interaction");
      completed = await navigate(loggedIn.location, signal);
      assert.equal(completed, undefined, "Fresh authorization must require WebID selection");
      index = await json(new URL(".account/", base).href, signal);
      const picked = await json(index.controls.oidc.webId, signal, { webId });
      await navigate(picked.location, signal);
      index = await json(new URL(".account/", base).href, signal);
      const consented = await json(index.controls.oidc.consent, signal, { remember: false });
      completed = await navigate(consented.location, signal);
      assert(completed, "CSS consent must produce the real OIDC callback");
      return completed;
    },
    clear: () => {
      cookies.clear();
      email = "";
      password = "";
    },
  };
}

test("fresh CSS v7 registration returns the new Identity and its PodAuth session reads its private pod", async () => {
  // Reuses the exact pinned CSS 7.2.0 startup/config/module graph from ADR-009's target.
  const running = await cssTarget.start();
  const base = new URL("/", running.root).href;
  const username = `signup-${randomUUID().slice(0, 16)}`;
  const pod = new URL(`${username}/`, base).href;
  const webId = `${pod}profile/card#me`;
  const callback = new URL("registration-callback", base).href;
  const password = randomUUID();
  const ui = cssAuthorizationUi(
    base,
    `${username}@registration.invalid`,
    password,
    webId,
    callback,
  );
  const auth = createPodAuth({
    clientId: { dynamicRegistration: true },
    redirectUri: callback,
    allowInsecureLoopback: true,
    ui: { getWebId: async () => webId, getCode: ui.getCode },
  });
  try {
    const registration = createRegistration({
      accountApi: new URL(".account/", base).href,
      podAuth: auth,
      allowInsecureLoopback: true,
    });
    expect(await registration.available()).toBe(true);
    // CSS file.json answers 401 for missing children of its server root.
    expect(await registration.checkUsername(username)).not.toBe("taken");
    const identity = await registration.register({
      username,
      displayName: "Registration 雪",
      password,
    });
    expect(identity.webId).toBe(webId);
    expect(identity.storages).toContain(pod);
    expect(await auth.identity()).toEqual(identity);
    const profile = await fetchRdf(webId.split("#")[0]!, { fetch: auth.fetch });
    for (const predicate of [
      "http://xmlns.com/foaf/0.1/name",
      "http://www.w3.org/2006/vcard/ns#fn",
    ])
      expect(
        [...profile.dataset].some(
          (quad) =>
            quad.subject.value === webId &&
            quad.predicate.value === predicate &&
            quad.object.value === "Registration 雪",
        ),
      ).toBe(true);
    // Make the new root private, then prove the authenticated read is not vacuous.
    const { storage } = await createPodClient({
      fetch: auth.fetch,
      storage: pod,
      capabilities: createMemoryCache(),
    });
    const acl = (await storage.head(pod)).links.get("acl")?.[0]?.target;
    assert(acl, "New pod must have an ACL");
    const etag = (await storage.head(acl)).etag;
    assert(etag, "ACL must have a validator");
    const rules = await parseRdf(
      "@prefix acl: <http://www.w3.org/ns/auth/acl#>. <#owner> a acl:Authorization; acl:agent <profile/card#me>; acl:accessTo <./>; acl:default <./>; acl:mode acl:Read, acl:Write, acl:Append, acl:Control.",
      "text/turtle",
      { baseIRI: pod },
    );
    await storage.writeRdf(acl, rules, { ifMatch: etag });
    const anonymous = await fetch(pod, { redirect: "error", credentials: "omit" });
    await anonymous.body?.cancel();
    expect([401, 403]).toContain(anonymous.status);
    // CSS serializes the container with relative IRIs; parse it rather than matching text.
    const ownPod = await fetchRdf(pod, { fetch: auth.fetch });
    expect([...ownPod.dataset].some((quad) => quad.subject.value === pod)).toBe(true);
    // The owner-only pod denies anonymous HEAD, which CSS also does for missing names.
    expect(await registration.checkUsername(username)).toBe("unknown");
  } finally {
    ui.clear();
    try {
      await auth.logout();
    } finally {
      await running.stop();
    }
  }
}, 120_000);
