// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { DataFactory, Writer } from "n3";
import { test, vi } from "vitest";
import { SimpleDataset } from "../src/SimpleDataset.js";
import { WebIdIssuerProvider } from "../src/WebIdIssuerProvider.js";
import { fetchTurtle, issuersFromWebId, WebIdAgent, webIdTrustsIssuer } from "../src/webId.js";

const webId = new URL("https://id.example/alice#me");
const documentUrl = "https://profiles.example/alice/card?view=1";
const issuer = "https://issuer.example/";
const oidcIssuer = "http://www.w3.org/ns/solid/terms#oidcIssuer";
const storage = "http://www.w3.org/ns/pim/space#storage";
const { namedNode, quad } = DataFactory;
const profile = new Writer().quadsToString([
  quad(namedNode(webId.href), namedNode(oidcIssuer), namedNode(issuer)),
  quad(namedNode(`${documentUrl}#me`), namedNode(oidcIssuer), namedNode("https://other.example/")),
]);

for (const status of [301, 302, 303, 307, 308]) {
  test(`WebID issuers follow ${status} and resolve a subsequent relative Location`, async () => {
    const controller = new AbortController();
    const requests = [];
    const http = {
      fetch: async (url, init) => {
        requests.push({ url: url.href, init });
        if (requests.length === 1)
          return new Response("redirect body", {
            status,
            headers: { location: "https://profiles.example/redirect/next" },
          });
        if (requests.length === 2)
          return new Response(null, {
            status: 302,
            headers: { location: "../alice/card?view=1#ignored" },
          });
        assert.equal(url.href, documentUrl);
        return new Response(profile);
      },
    };
    const issuers = await issuersFromWebId(webId, controller.signal, http);
    assert.deepEqual(
      issuers.map((url) => url.href),
      [issuer],
    );
    assert.deepEqual(
      requests.map(({ url }) => url),
      ["https://id.example/alice", "https://profiles.example/redirect/next", documentUrl],
    );
    for (const { init } of requests) {
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "manual");
      assert.equal(init.credentials, "omit");
      assert.equal(init.signal, controller.signal);
      assert.deepEqual([...new Headers(init.headers)], [["accept", "text/turtle"]]);
      assert.equal(init.body, undefined);
    }
    assert.equal(webId.href, "https://id.example/alice#me", "the identity URL is unchanged");
  });
}

test("the final URL is the Turtle base while issuer and storage subjects remain the original WebID", async () => {
  const turtle = new Writer().quadsToString([
    quad(namedNode(webId.href), namedNode(oidcIssuer), namedNode("issuer")),
    quad(namedNode(webId.href), namedNode(storage), namedNode("./pod/")),
    quad(namedNode("#me"), namedNode(oidcIssuer), namedNode("https://other.example/")),
    quad(namedNode("#me"), namedNode(storage), namedNode("https://other.example/pod/")),
  ]);
  const http = {
    fetch: async (url) =>
      url.href === "https://id.example/alice"
        ? new Response(null, { status: 303, headers: { location: documentUrl } })
        : new Response(turtle), // Injected responses have no response.url.
  };
  const { quads, base } = await fetchTurtle(webId, undefined, http);
  assert.equal(base, documentUrl);
  const agent = new WebIdAgent(webId.href, new SimpleDataset(quads), DataFactory);
  assert.deepEqual(
    [...agent.oidcIssuers].map((url) => url.href),
    ["https://profiles.example/alice/issuer"],
  );
  assert.deepEqual(
    [...agent.storages].map((url) => url.href),
    ["https://profiles.example/alice/pod/"],
  );
  assert.deepEqual(
    (await issuersFromWebId(webId, undefined, http)).map((url) => url.href),
    ["https://profiles.example/alice/issuer"],
  );
});

test("WebID redirects never receive the resource request's credentials or headers", async () => {
  const requests = [];
  const provider = new WebIdIssuerProvider(async () => webId, {
    fetch: async (url, init) => {
      requests.push({ url: url.href, init });
      return requests.length === 1
        ? new Response(null, { status: 307, headers: { location: documentUrl } })
        : new Response(profile);
    },
  });
  const request = new Request("https://pod.example/private", {
    credentials: "include",
    headers: { authorization: "Bearer secret", cookie: "session=secret", dpop: "proof" },
  });
  assert.equal((await provider.getIssuer(request)).href, issuer);
  assert.equal(requests.length, 2);
  for (const { init } of requests) {
    assert.equal(init.credentials, "omit");
    assert.deepEqual([...new Headers(init.headers)], [["accept", "text/turtle"]]);
  }
});

test("redirected WebID verification trusts only issuers listed for the original identity", async () => {
  const http = {
    fetch: async (url) =>
      url.href === "https://id.example/alice"
        ? new Response(null, { status: 303, headers: { location: documentUrl } })
        : new Response(profile),
  };
  assert.equal(await webIdTrustsIssuer(webId, issuer, undefined, http), true);
  assert.equal(await webIdTrustsIssuer(webId, "https://issuer.example", undefined, http), true);
  assert.equal(await webIdTrustsIssuer(webId, "https://other.example/", undefined, http), false);
});

for (const allowInsecureRequests of [false, true]) {
  test(`an HTTP redirect on a later hop requires the insecure dev option (${allowInsecureRequests})`, async () => {
    const requests = [];
    const http = {
      allowInsecureRequests,
      fetch: async (url) => {
        requests.push(url.href);
        if (requests.length === 1)
          return new Response(null, { status: 301, headers: { location: documentUrl } });
        if (requests.length === 2)
          return new Response(null, {
            status: 307,
            headers: { location: "http://dev.example/profile" },
          });
        return new Response(profile);
      },
    };
    const pending = issuersFromWebId(webId, undefined, http);
    if (allowInsecureRequests) {
      assert.deepEqual(
        (await pending).map((url) => url.href),
        [issuer],
      );
      assert.deepEqual(requests, [
        "https://id.example/alice",
        documentUrl,
        "http://dev.example/profile",
      ]);
    } else {
      await assert.rejects(pending, /Refusing non-HTTPS request/);
      assert.deepEqual(requests, ["https://id.example/alice", documentUrl]);
    }
  });
}

for (const location of ["data:text/turtle,ignored", "https://["]) {
  test(`invalid or non-HTTP redirect target is rejected: ${location}`, async () => {
    let calls = 0;
    await assert.rejects(
      issuersFromWebId(webId, undefined, {
        allowInsecureRequests: true,
        fetch: async () => {
          calls++;
          return new Response(null, { status: 302, headers: { location } });
        },
      }),
      TypeError,
    );
    assert.equal(calls, 1);
  });
}

for (const redirects of [5, 6]) {
  test(`WebID dereferencing bounds redirect chains (${redirects} redirects)`, async () => {
    let calls = 0;
    let cancelled = 0;
    const http = {
      fetch: async () => {
        calls++;
        if (calls > redirects) return new Response(profile);
        return new Response(new ReadableStream({ cancel: () => cancelled++ }), {
          status: 308,
          headers: { location: `./hop-${calls}` },
        });
      },
    };
    const pending = issuersFromWebId(webId, undefined, http);
    if (redirects === 5) {
      assert.deepEqual(
        (await pending).map((url) => url.href),
        [issuer],
      );
    } else {
      await assert.rejects(pending, /Too many redirects/);
    }
    assert.equal(calls, 6);
    assert.equal(cancelled, redirects);
  });
}

for (const status of [300, 301, 302, 303, 304, 305, 306, 307, 308]) {
  test(`3xx ${status} without Location fails without another request`, async () => {
    let calls = 0;
    await assert.rejects(
      issuersFromWebId(webId, undefined, {
        fetch: async () => {
          calls++;
          return new Response(null, { status });
        },
      }),
      new RegExp(`could not be retrieved \\(${status}\\)`),
    );
    assert.equal(calls, 1);
  });
}

for (const status of [300, 304, 305, 306]) {
  test(`non-redirect status ${status} is not followed even with Location`, async () => {
    let calls = 0;
    await assert.rejects(
      issuersFromWebId(webId, undefined, {
        fetch: async () => {
          calls++;
          return new Response(null, { status, headers: { location: documentUrl } });
        },
      }),
      /could not be retrieved/,
    );
    assert.equal(calls, 1);
  });
}

test("a WebID redirect cycle exhausts the hop limit", async () => {
  let calls = 0;
  await assert.rejects(
    issuersFromWebId(webId, undefined, {
      fetch: async () => {
        calls++;
        return new Response(null, { status: 302, headers: { location: "/alice" } });
      },
    }),
    /Too many redirects/,
  );
  assert.equal(calls, 6);
});

test("aborting before dereferencing prevents all transport calls", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    issuersFromWebId(webId, controller.signal, {
      fetch: async () => assert.fail("aborted fetch must not be sent"),
    }),
    { name: "AbortError" },
  );
});

test("aborting between hops prevents the redirect target request", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    issuersFromWebId(webId, controller.signal, {
      fetch: async () => {
        calls++;
        return new Response(new ReadableStream({ cancel: () => controller.abort() }), {
          status: 303,
          headers: { location: documentUrl },
        });
      },
    }),
    { name: "AbortError" },
  );
  assert.equal(calls, 1);
});

test("aborting during a redirected fetch rejects with the caller's reason", async () => {
  const controller = new AbortController();
  const started = Promise.withResolvers();
  const reason = new Error("profile lookup cancelled");
  let calls = 0;
  const pending = issuersFromWebId(webId, controller.signal, {
    fetch: async (url, init) => {
      calls++;
      if (calls === 1)
        return new Response(null, { status: 307, headers: { location: documentUrl } });
      assert.equal(url.href, documentUrl);
      assert.equal(init.signal, controller.signal);
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        started.resolve();
      });
    },
  });
  await started.promise;
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(calls, 2);
});

test("a transport response arriving after cancellation is rejected", async () => {
  const controller = new AbortController();
  await assert.rejects(
    issuersFromWebId(webId, controller.signal, {
      fetch: async () => {
        controller.abort();
        return new Response(profile);
      },
    }),
    { name: "AbortError" },
  );
});

test("redirects use the default non-reactive transport when no HTTP options are supplied", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  fetch.mockResolvedValueOnce(
    new Response(null, { status: 303, headers: { location: documentUrl } }),
  );
  fetch.mockResolvedValueOnce(new Response(profile));
  try {
    assert.deepEqual(
      (await issuersFromWebId(webId)).map((url) => url.href),
      [issuer],
    );
    assert.equal(fetch.mock.calls.length, 2);
    assert.equal(fetch.mock.calls[1][0].href, documentUrl);
  } finally {
    fetch.mockRestore();
  }
});

// Browsers expose manual redirects only as opaque responses.
function opaqueRedirect() {
  return { type: "opaqueredirect", status: 0, ok: false, headers: new Headers(), body: null };
}

function withUrl(response, url) {
  Object.defineProperty(response, "url", { value: url });
  return response;
}

test("browser opaque redirects are followed by the platform and the final URL is the base", async () => {
  const requests = [];
  const relative = new Writer().quadsToString([
    quad(namedNode(webId.href), namedNode(oidcIssuer), namedNode(issuer)),
  ]);
  const http = {
    fetch: async (url, init) => {
      requests.push({ url: url.href, redirect: init.redirect, credentials: init.credentials });
      if (requests.length === 1) return opaqueRedirect();
      return withUrl(new Response(`${relative}\n<#me> <${storage}> <../storage/> .`), documentUrl);
    },
  };
  const { base, quads } = await fetchTurtle(webId, undefined, http);
  assert.equal(base, documentUrl);
  assert.ok(quads.some((q) => q.object.value === "https://profiles.example/storage/"));
  assert.deepEqual(
    (await issuersFromWebId(webId, undefined, http)).map((url) => url.href),
    [issuer],
  );
  assert.deepEqual(requests.slice(0, 2), [
    { url: "https://id.example/alice", redirect: "manual", credentials: "omit" },
    { url: "https://id.example/alice", redirect: "follow", credentials: "omit" },
  ]);
});

test("browser opaque redirects without a response URL keep the requested document as the base", async () => {
  let calls = 0;
  const { base } = await fetchTurtle(webId, undefined, {
    fetch: async () => (++calls === 1 ? opaqueRedirect() : new Response(profile)),
  });
  assert.equal(base, "https://id.example/alice");
});

for (const allowInsecureRequests of [false, true]) {
  test(`browser opaque redirects ending on http: require the insecure dev option (${allowInsecureRequests})`, async () => {
    let calls = 0;
    const pending = fetchTurtle(webId, undefined, {
      allowInsecureRequests,
      fetch: async () =>
        ++calls === 1
          ? opaqueRedirect()
          : withUrl(new Response(profile), "http://profiles.example/alice/card"),
    });
    if (allowInsecureRequests)
      assert.equal((await pending).base, "http://profiles.example/alice/card");
    else await assert.rejects(pending, { name: "TypeError", message: /Refusing non-HTTPS/ });
  });
}

test("aborting while the platform follows an opaque redirect rejects", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    fetchTurtle(webId, controller.signal, {
      fetch: async () => {
        if (++calls === 1) return opaqueRedirect();
        controller.abort();
        return new Response(profile);
      },
    }),
    { name: "AbortError" },
  );
});
