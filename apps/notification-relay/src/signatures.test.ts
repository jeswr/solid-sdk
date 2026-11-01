// AUTHORED-BY Codex GPT-6.1-Sol
import { generateKeyPairSync } from "node:crypto";
import { expect, test, vi } from "vitest";
import { covered, epoch, event, keyid, storage, vector } from "../test/fixtures.js";
import { createWebhookVerifier, safeUrl, signatureInput } from "./signatures.js";

test.each([
  "ed25519",
  "ecdsa-p256-sha256",
  "ecdsa-p384-sha384",
  "rsa-pss-sha512",
  "rsa-v1_5-sha256",
])("verifies jose-generated %s keys and reordered components", async (alg) => {
  const f = await vector(alg);
  const fetch = vi.fn(async () => Response.json(f.document));
  const verify = createWebhookVerifier({ fetch, now: () => epoch });
  const signed = f.signed(event, { components: [...covered].reverse() });
  expect(await verify(signed)).toMatchObject({
    fingerprint: expect.any(String),
    expires: epoch + 300_000,
  });
  expect(fetch).toHaveBeenCalledWith(
    storage,
    expect.objectContaining({ redirect: "error", credentials: "omit" }),
  );
  await verify(signed);
  expect(fetch).toHaveBeenCalledTimes(1);
  if (alg !== "rsa-v1_5-sha256") {
    await verify(f.signed(event, { params: `;created=${epoch / 1000};keyid="${keyid}"` }));
  }
});

test("enforces freshness inclusive at both 300-second boundaries and one-hour cache expiry", async () => {
  const f = await vector();
  let now = epoch;
  const fetch = vi.fn(async () => Response.json(f.document));
  const verify = createWebhookVerifier({ fetch, now: () => now });
  for (const delta of [-300, 300]) await verify(f.signed(event, { created: epoch / 1000 + delta }));
  for (const delta of [-301, 301])
    await expect(verify(f.signed(event, { created: epoch / 1000 + delta }))).rejects.toThrow(
      "Stale",
    );
  now += 3_600_000;
  await verify(f.signed(event, { created: now / 1000 }));
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const expires of [`"bad"`, String(now / 1000 - 1), String(now / 1000 - 301)]) {
    await expect(
      verify(
        f.signed(event, {
          created: now / 1000 - 300,
          params: `;created=${now / 1000 - 300};keyid="${keyid}";expires=${expires}`,
        }),
      ),
    ).rejects.toThrow("Stale");
  }
  await verify(
    f.signed(event, {
      created: now / 1000,
      params: `;created=${now / 1000};keyid="${keyid}";expires=${now / 1000 + 10};nonce="n";tag="webhook"`,
    }),
  );
});

test.each([
  "",
  "?encoded=a%2Fb&empty=",
])("verifies additional derived components and HTTP fields for query %s", async (query) => {
  const f = await vector();
  const verify = createWebhookVerifier({
    fetch: async () => Response.json(f.document),
    now: () => epoch,
  });
  const signed = f.signed(event, {
    url: `https://relay.example/inbox/test${query}`,
    components: ["date", "@query", ...covered.slice().reverse(), "@target-uri", "content-length"],
    headers: {
      date: new Date(epoch).toUTCString(),
      "content-length": String(Buffer.byteLength(JSON.stringify(event))),
    },
  });
  await expect(verify(signed)).resolves.toMatchObject({ fingerprint: expect.any(String) });
  for (const name of ["date", "content-length"]) {
    const tampered = { ...signed, headers: { ...signed.headers, [name]: "tampered" } };
    await expect(verify(tampered)).rejects.toThrow("Invalid signature");
    const missing = { ...signed, headers: { ...signed.headers } };
    delete missing.headers[name];
    await expect(verify(missing)).rejects.toThrow("missing signature component");
  }
  const tampered = { ...signed, url: new URL(signed.url) };
  tampered.url.search = "?tampered";
  await expect(verify(tampered)).rejects.toThrow("Invalid signature");
});

test("extra components never replace required components or bypass component validation", async () => {
  const f = await vector();
  const verify = createWebhookVerifier({
    fetch: async () => Response.json(f.document),
    now: () => epoch,
  });
  for (const missing of covered) {
    await expect(
      verify(
        f.signed(event, { components: [...covered.filter((c) => c !== missing), "@target-uri"] }),
      ),
    ).rejects.toThrow("Missing components");
  }
  for (const extra of ["@unsupported", "@status", "@query-param", "Content-Type", "bad:field"]) {
    await expect(
      verify(f.signed(event, { components: [...covered, extra], headers: { [extra]: "value" } })),
    ).rejects.toThrow("Unsupported or missing signature component");
  }
  for (const extra of ["missing-header", "toString", "__proto__"]) {
    await expect(verify(f.signed(event, { components: [...covered, extra] }))).rejects.toThrow(
      "Unsupported or missing signature component",
    );
  }
  await expect(
    verify(
      f.signed(event, { components: [...covered, "date", "date"], headers: { date: "value" } }),
    ),
  ).rejects.toThrow("Missing components");
});

test("rejects tampering of every required component, signature, digest and body", async () => {
  const f = await vector();
  const verify = createWebhookVerifier({
    fetch: async () => Response.json(f.document),
    now: () => epoch,
  });
  for (const mutate of [
    (s: ReturnType<typeof f.signed>) => {
      s.method = "PUT";
    },
    (s: ReturnType<typeof f.signed>) => {
      s.url.protocol = "http:";
    },
    (s: ReturnType<typeof f.signed>) => {
      s.url.host = "evil.example";
    },
    (s: ReturnType<typeof f.signed>) => {
      s.url.pathname = "/inbox/other";
    },
    (s: ReturnType<typeof f.signed>) => {
      s.headers["content-type"] = "application/json";
    },
    (s: ReturnType<typeof f.signed>) => {
      s.body = Buffer.from("tampered");
    },
    (s: ReturnType<typeof f.signed>) => {
      s.headers.signature = `sig1=:${Buffer.alloc(64).toString("base64")}:`;
    },
    (s: ReturnType<typeof f.signed>) => {
      s.headers.signature = "other=:YWJj:";
    },
    (s: ReturnType<typeof f.signed>) => {
      s.headers["content-digest"] = "sha-256=:YQ==:";
    },
    (s: ReturnType<typeof f.signed>) => {
      s.headers["content-digest"] = "sha-256=:AB==:";
    },
    (s: ReturnType<typeof f.signed>) => {
      delete (s.headers as Record<string, string>)["content-digest"];
    },
    (s: ReturnType<typeof f.signed>) => {
      delete (s.headers as Record<string, string>).signature;
    },
    (s: ReturnType<typeof f.signed>) => {
      delete (s.headers as Record<string, string>)["signature-input"];
    },
  ]) {
    const signed = f.signed();
    mutate(signed);
    await expect(verify(signed)).rejects.toThrow();
  }
  for (const contentType of ["text/plain", ""])
    await expect(verify(f.signed(event, { contentType }))).rejects.toThrow("content type");
  const signed = f.signed();
  delete (signed.headers as Record<string, string>)["content-type"];
  await expect(verify(signed)).rejects.toThrow();
  await verify(f.signed(event, { contentType: "application/json; charset=utf-8" }));
});

test.each([
  "",
  "sig1=()",
  'sig1=(@method);created=1;keyid="x"',
  'sig1=("@method");created=1;keyid="x"',
  `sig1=(${covered
    .concat("@method")
    .map((c) => `"${c}"`)
    .join(" ")});created=1;keyid="x"`,
  `sig1=(${covered.map((c) => `"${c}"`).join(" ")});created=1;created=2;keyid="x"`,
  `sig1=(${covered.map((c) => `"${c}"`).join(" ")});other=1`,
  `sig1=(${covered.map((c) => `"${c}"`).join(" ")});created=1;keyid="x",other=()`,
  `sig1=(${covered.map((c) => `"${c}"`).join(" ")});created=1`,
  `sig1=(${covered.map((c) => `"${c}"`).join(" ")});created="1";keyid="x"`,
])("rejects malformed or incomplete signature input %s", (input) => {
  expect(() => signatureInput(input)).toThrow();
});

test("canonicalizes spaces, integers, and escaped Structured Field strings", () => {
  const input = `sig*=(${covered.map((c) => `"${c}"`).join("  ")}); created=0001;keyid="https://x/#k";nonce="a\\"b\\\\c"`;
  expect(signatureInput(input).canonical).toBe(
    `(${covered.map((c) => `"${c}"`).join(" ")});created=1;keyid="https://x/#k";nonce="a\\"b\\\\c"`,
  );
});

test.each([
  undefined,
  "",
  "ftp://example.org/",
  "https://a/\nsecret",
  "https://a/\\x",
  "https://a:bad/",
  "https://user:secret@a/",
  "http://example.org/",
  "http://localhost/",
])("refuses unsafe identifiers without echoing values %s", (value) => {
  expect(() => safeUrl(value)).toThrow("Invalid URL");
});
test("loopback HTTP is opt-in", () => {
  expect(safeUrl("http://localhost:3000/", true).host).toBe("localhost:3000");
  expect(() => safeUrl("http://example.org/", true)).toThrow();
});

test("binds keyid to the registered storage before doing I/O", async () => {
  const f = await vector();
  const fetch = vi.fn();
  const verify = createWebhookVerifier({ fetch, now: () => epoch });
  for (const id of [storage, "https://foreign.example/storage#k"]) {
    await expect(
      verify(f.signed(event, { params: `;created=${epoch / 1000};keyid="${id}"` })),
    ).rejects.toThrow();
  }
  expect(fetch).not.toHaveBeenCalled();
});

test("requires the matching unambiguous verificationMethod in a bound storage document", async () => {
  const f = await vector();
  for (const document of [
    null,
    [],
    { ...f.document, id: "foreign" },
    { ...f.document, type: "Other" },
    { ...f.document, verificationMethod: null },
    { ...f.document, verificationMethod: [] },
    { ...f.document, verificationMethod: [null] },
    {
      ...f.document,
      verificationMethod: [f.document.verificationMethod[0], f.document.verificationMethod[0]],
    },
    { ...f.document, verificationMethod: [{ id: keyid }] },
  ]) {
    const verify = createWebhookVerifier({
      fetch: async () => Response.json(document),
      now: () => epoch,
    });
    await expect(verify(f.signed())).rejects.toThrow();
  }
  const document = {
    ...f.document,
    type: ["Storage"],
    verificationMethod: [{ id: "#key", publicKeyJwk: f.jwk }],
  };
  await createWebhookVerifier({ fetch: async () => Response.json(document), now: () => epoch })(
    f.signed(),
  );
  for (const response of [
    new Response(null, { status: 500 }),
    Object.assign(Response.json(f.document), {}),
  ]) {
    if (response.status === 200) Object.defineProperty(response, "redirected", { value: true });
    await expect(
      createWebhookVerifier({ fetch: async () => response, now: () => epoch })(f.signed()),
    ).rejects.toThrow("unavailable");
  }
});

test("refuses private/symmetric keys, forbidden key usages, unknown algorithms and key confusion", async () => {
  const f = await vector();
  for (const jwk of [
    { ...f.jwk, d: "private" },
    { ...f.jwk, k: "symmetric" },
    { ...f.jwk, use: "enc" },
    { ...f.jwk, key_ops: "verify" },
    { ...f.jwk, key_ops: ["sign"] },
    { ...f.jwk, kty: "EC" },
    { ...f.jwk, crv: "X25519" },
  ]) {
    const document = { ...f.document, verificationMethod: [{ id: keyid, publicKeyJwk: jwk }] };
    await expect(
      createWebhookVerifier({ fetch: async () => Response.json(document), now: () => epoch })(
        f.signed(),
      ),
    ).rejects.toThrow();
  }
  const verify = createWebhookVerifier({
    fetch: async () =>
      Response.json({
        ...f.document,
        verificationMethod: [
          { id: keyid, publicKeyJwk: { ...f.jwk, use: "sig", key_ops: ["verify"] } },
        ],
      }),
    now: () => epoch,
  });
  for (const alg of ['"none"', "42", '"hmac-sha256"', '"toString"']) {
    await expect(
      verify(f.signed(event, { params: `;created=${epoch / 1000};keyid="${keyid}";alg=${alg}` })),
    ).rejects.toThrow("Unsupported");
  }
  await verify(f.signed());
  const weak = generateKeyPairSync("rsa", { modulusLength: 1024 });
  const jwk = weak.publicKey.export({ format: "jwk" });
  await expect(
    createWebhookVerifier({
      fetch: async () =>
        Response.json({ ...f.document, verificationMethod: [{ id: keyid, publicKeyJwk: jwk }] }),
      now: () => epoch,
    })(
      f.signed(event, {
        params: `;created=${epoch / 1000};keyid="${keyid}";alg="rsa-v1_5-sha256"`,
      }),
    ),
  ).rejects.toThrow("Weak RSA");
});

test("refuses revoked/expired methods, foreign controllers, and inconsistent algorithm metadata", async () => {
  const f = await vector();
  for (const fields of [
    { revoked: "2026-01-01T00:00:00Z" },
    { controller: "https://foreign.example/" },
    { expires: epoch },
    { expires: "bad" },
    { expires: new Date(epoch).toISOString() },
    { publicKeyJwk: { ...f.jwk, p: "private" } },
    { publicKeyJwk: { ...f.jwk, alg: "ES256" } },
  ]) {
    const doc = {
      ...f.document,
      verificationMethod: [{ ...f.document.verificationMethod[0], ...fields }],
    };
    await expect(
      createWebhookVerifier({ fetch: async () => Response.json(doc), now: () => epoch })(
        f.signed(),
      ),
    ).rejects.toThrow();
  }
  const doc = {
    ...f.document,
    verificationMethod: [
      {
        ...f.document.verificationMethod[0],
        controller: storage,
        expires: new Date(epoch + 1).toISOString(),
        publicKeyJwk: { ...f.jwk, alg: "EdDSA" },
      },
    ],
  };
  await createWebhookVerifier({ fetch: async () => Response.json(doc), now: () => epoch })(
    f.signed(),
  );
});

test("bounds the one-hour storage description cache", async () => {
  const f = await vector();
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const id = String(input);
    return Response.json({
      ...f.document,
      id,
      verificationMethod: [{ id: `${id}#key`, publicKeyJwk: f.jwk }],
    });
  });
  const verify = createWebhookVerifier({ fetch, now: () => epoch });
  for (let i = 0; i < 1001; i++) {
    const id = `https://storage.example/${i}`;
    const signed = f.signed(event, {
      params: `;created=${epoch / 1000};keyid="${id}#key";alg="ed25519"`,
    });
    signed.storage = id;
    await verify(signed);
  }
  const signed = f.signed(event, {
    params: `;created=${epoch / 1000};keyid="https://storage.example/0#key";alg="ed25519"`,
  });
  signed.storage = "https://storage.example/0";
  await verify(signed);
  expect(fetch).toHaveBeenCalledTimes(1002);
});

test("infers the signature algorithm from JWK alg metadata without allowing unknown algorithms", async () => {
  const f = await vector("rsa-v1_5-sha256");
  const document = {
    ...f.document,
    verificationMethod: [{ id: keyid, publicKeyJwk: { ...f.jwk, alg: "RS256" } }],
  };
  await createWebhookVerifier({ fetch: async () => Response.json(document), now: () => epoch })(
    f.signed(event, { params: `;created=${epoch / 1000};keyid="${keyid}"` }),
  );
  const unknown = {
    ...f.document,
    verificationMethod: [{ id: keyid, publicKeyJwk: { ...f.jwk, alg: "unknown" } }],
  };
  await expect(
    createWebhookVerifier({ fetch: async () => Response.json(unknown), now: () => epoch })(
      f.signed(event, { params: `;created=${epoch / 1000};keyid="${keyid}"` }),
    ),
  ).rejects.toThrow("Unsupported");
});
