// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import {
  compileOperation,
  createExecutor,
  InMemorySessions,
  requestFingerprint,
} from "@jeswr/site-executor";
import { type ActionRequest, SAB, SCHEMA, type SiteModel } from "@jeswr/site-model";
import {
  launchChromium,
  matchRequest,
  parseForms,
  type RecordedRequest,
} from "@jeswr/site-profiler";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { browserWriteFingerprint } from "../src/fallback/fingerprint.js";
import { candidatesFromTrace, learnFallback } from "../src/fallback/learn.js";
import {
  escapeControls,
  fallbackRedactor,
  redactSnapshot,
  rememberSessionHeader,
} from "../src/fallback/redact.js";
import {
  BrowserDriver,
  createFallback,
  createTaskExecutor,
  runTask,
  scriptedFallbackPlanner,
  scriptedPlanner,
} from "../src/index.js";

const model = (site: string): SiteModel => ({
  id: "urn:shop:model",
  site,
  version: "0.1.0",
  generatedAt: "2026-11-13T00:00:00.000Z",
  operations: [],
  flows: [],
});
const record = (
  origin: string,
  seq: number,
  changes: Partial<RecordedRequest> = {},
): RecordedRequest => ({
  seq,
  phase: "demonstration",
  method: "GET",
  url: origin,
  resourceType: "document",
  requestHeaders: {},
  cookieNames: [],
  status: 200,
  ...changes,
});
const update: ActionRequest = {
  node: "urn:request",
  types: [`${SCHEMA}UpdateAction`],
  values: () => [],
};
const controls = [
  ...Array.from({ length: 5 }, (_, i) => 0x200b + i),
  ...Array.from({ length: 5 }, (_, i) => 0x202a + i),
  ...Array.from({ length: 10 }, (_, i) => 0x2060 + i),
  0xfeff,
  0x01,
  0x7f,
  0x85,
  0x2028,
  0x2029,
];

describe("fallback review r2 wire properties", () => {
  const shapes = [
    ["x=01", '<input type="number" name="x">', "application/x-www-form-urlencoded"],
    [
      "x=00012&other=",
      '<input type="number" name="x"><input name="x"><input name="other">',
      "application/x-www-form-urlencoded",
    ],
    [
      "x=&qty=",
      '<input name="x"><input type="number" name="qty">',
      "application/x-www-form-urlencoded",
    ],
    [
      "x=01&qty=0002",
      '<input type="number" name="x"><input name="qty"><input name="qty">',
      "application/x-www-form-urlencoded",
    ],
    [
      '{"x":"01","other":"","enabled":true,"count":2}',
      '<input type="number" name="x"><input name="count">',
      "application/json",
    ],
    [
      '{"x":1.25,"other":"0002","enabled":false}',
      '<input name="x"><input type="number" name="other">',
      "application/json",
    ],
  ];
  it.each(
    shapes,
  )("wire typing property: %s has equal fingerprints and blocks repeats", async (body, fields, type) => {
    const origin = "https://shop.test";
    const earlier =
      '<form action="/save" method="post"><input name="x"><input type="number" name="other"><input name="qty"></form>';
    const current =
      '<form action="/save" method="post">' +
      fields +
      '<input name="unsent" value="ignored"></form>';
    const source = record(origin, 0, { contentType: "text/html", bodySample: earlier + current });
    const wire = record(origin, 1, {
      method: "POST",
      url: `${origin}/save`,
      requestHeaders: { "content-type": type as string },
      postData: body,
    });
    const fingerprint = browserWriteFingerprint(
      wire,
      origin,
      parseForms(current, origin),
      new Map(),
    );
    // A second request with different types cannot alter this request's learned types.
    const other = { ...wire, seq: 2, postData: type?.includes("json") ? '{"x":2}' : "x=2" };
    const candidates = candidatesFromTrace(
      [source, other, wire],
      origin,
      [],
      new Set([1, 2]),
      (s) => s,
    );
    const candidate = candidates.find((c) => c.samples.some((r) => r.seq === 1));
    if (!candidate) throw new Error("Missing wire candidate");
    const transport = vi.fn(async () => new Response("unexpected"));
    const sessions = new InMemorySessions();
    const learned = await learnFallback({
      model: model(origin),
      sessions,
      request: update,
      transport,
      driver: { candidates: async () => [candidate] },
    });
    expect(learned.proposed, JSON.stringify(learned.rejected)).toHaveLength(1);
    const operation = learned.proposed[0];
    if (!operation) throw new Error("Missing operation");
    const values = matchRequest(candidate, wire);
    if (!values) throw new Error("Missing wire values");
    expect(requestFingerprint(compileOperation(operation, values, origin))).toBe(fingerprint);
    expect(operation.inputs.some((p) => p.name === "unsent")).toBe(false);
    const action: ActionRequest = {
      ...update,
      values: (path) =>
        path[0] === `${SAB}operation`
          ? [operation.id]
          : operation.inputs
              .filter((p) => JSON.stringify(p.path) === JSON.stringify(path))
              .flatMap((p) => (values[p.name] === undefined ? [] : [values[p.name] as string])),
    };
    const executor = createExecutor({ model: learned.model, sessions, fetch: transport });
    expect(await executor.execute(action, { excludeFingerprints: [fingerprint] })).toMatchObject({
      status: "refused",
      errorKind: "repeat",
    });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("fallback review r2 credential and display boundaries", () => {
  it("redacts explicitly discovered short credentials, including embedded and encoded echoes", () => {
    const redact = fallbackRedactor(new Set(["tiny"]));
    for (const text of ["tiny", "Value: tiny", "Value: %74iny", "https://shop.test/tiny"])
      expect(redact(text)).not.toContain("tiny");
  });
  it("rejects credential-valued ordinary fields before redaction could alter their wire typing", async () => {
    const origin = "https://shop.test";
    const token = "credential-value-12345";
    const candidates = candidatesFromTrace(
      [
        record(origin, 0, {
          contentType: "application/javascript",
          resourceType: "script",
          bodySample: `window.csrfToken="${token}";`,
        }),
        record(origin, 1, {
          method: "POST",
          url: `${origin}/save`,
          postData: `qty=${token}`,
          requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
        }),
      ],
      origin,
      [],
      new Set([1]),
      (s) => s,
    );
    const result = await learnFallback({
      model: model(origin),
      sessions: new InMemorySessions(),
      request: update,
      driver: { candidates: async () => candidates },
    });
    expect(result.proposed).toEqual([]);
    expect(result.rejected).toContainEqual(
      expect.objectContaining({
        reason: "Unresolved session material in learning candidate.",
      }),
    );
    expect(JSON.stringify([candidates, result])).not.toContain(token);
  });
  it("rejects unresolved opaque template constants with a reason before replay", async () => {
    const origin = "https://shop.test";
    const candidates = candidatesFromTrace(
      [
        record(origin, 0, {
          url: `${origin}/data/opaqueTokenWithoutSupportedSource123/orders`,
          contentType: "application/json",
          bodySample: '{"items":[{"orderNumber":"5010","total":"18.50","currency":"GBP"}]}',
        }),
      ],
      origin,
      [],
      new Set(),
      (s) => s,
    );
    const transport = vi.fn(async () => Response.json({ items: [{ orderNumber: "5010" }] }));
    const result = await learnFallback({
      model: model(origin),
      sessions: new InMemorySessions(),
      transport,
      request: { ...update, types: [`${SCHEMA}ViewAction`] },
      driver: { candidates: async () => candidates },
    });
    expect(result.proposed).toEqual([]);
    expect(result.rejected).toContainEqual(
      expect.objectContaining({
        reason: "Unresolved token-like constant in proposed operation.",
      }),
    );
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    ["script", "application/javascript", 'window["csrfToken"]="external-once-material";'],
    ["script", "text/plain", 'self.settings={csrfToken:"external-once-material"};'],
    ["xhr", "application/json", '{"settings":{"accessToken":"external-once-material"}}'],
    ["document", "text/html", '<script>window.csrfToken="external-once-material"</script>'],
  ])("discovers %s responses (%s), including unsuccessful POST sources, before replay", async (resourceType, contentType, bodySample) => {
    const origin = "https://shop.test";
    const token = "external-once-material";
    const trace = [
      record(origin, 0, {
        url: `${origin}/source`,
        method: "POST",
        status: 400,
        resourceType,
        contentType,
        bodySample,
      }),
      record(origin, 1, {
        url: `${origin}/data/${token}/orders`,
        contentType: "application/json",
        bodySample: '{"items":[{"orderNumber":"5010"}]}',
      }),
    ];
    const candidates = candidatesFromTrace(trace, origin, [], new Set(), (s) => s);
    const transport = vi.fn(async () => Response.json({ items: [{ orderNumber: "5010" }] }));
    const learned = await learnFallback({
      model: model(origin),
      sessions: new InMemorySessions(),
      request: { ...update, types: [`${SCHEMA}ViewAction`] },
      driver: { candidates: async () => candidates },
      transport,
    });
    expect(learned.proposed).toEqual([]);
    expect(learned.rejected.some((r) => r.reason.includes("session material"))).toBe(true);
    expect(transport).not.toHaveBeenCalled();
    expect(JSON.stringify([candidates, learned])).not.toContain(token);
  });
  it.each([
    "  bEaReR  header-credential-secret  ",
    "\tBaSiC\theader-credential-secret\t",
    " dPoP   header-credential-secret ",
  ])("normalises and remembers raw, transmitted and split header credentials: %s", (raw) => {
    const secrets = new Set<string>();
    const normalised = rememberSessionHeader(secrets, raw);
    expect(normalised).toMatch(/^(Bearer|Basic|DPoP) header-credential-secret$/);
    expect([...secrets]).toEqual(
      expect.arrayContaining([raw, normalised, "header-credential-secret"]),
    );
    const redact = fallbackRedactor(secrets);
    for (const value of [raw, normalised, "header-credential-secret"])
      expect(redact(value)).not.toContain("header-credential-secret");
  });
  it("scrubs query, parameter/bare fragments, userinfo and exact secret path segments", () => {
    const secrets = new Set(["tiny", "registered-credential"]);
    const redact = (s: string) => redactSnapshot(s, fallbackRedactor(secrets), secrets);
    for (const text of [
      "https://user:pass@shop.test/tiny?ok=public&key=unknown#access_token=fragment-secret&ok=public",
      "/%74iny/orders?ok=public#state=fragment-state&ok=public",
      "#a=public&c=tiny&nonce=fragment-nonce",
      "#unknownOpaqueToken1234567",
      "https://shop.test/#unknownOpaqueToken1234567",
      "https://shop.test/registered-credential/orders#ok=public",
    ]) {
      const result = redact(text);
      expect(result).not.toMatch(
        /tiny|registered-credential|fragment-secret|fragment-state|fragment-nonce|unknownOpaqueToken1234567|user:pass|unknown&/,
      );
      expect(result).toContain("redacted");
    }
    expect(redact("https://shop.test/public#orders")).toBe("https://shop.test/public#orders");
  });
  it("escapes every bidi, invisible formatting and other control character as visible text", () => {
    const escaped = escapeControls(String.fromCharCode(...controls));
    for (const code of controls) {
      expect(escaped).not.toContain(String.fromCharCode(code));
      expect(escaped).toContain(`\\u${code.toString(16).padStart(4, "0")}`);
    }
  });
});

describe("fallback review r2 Chromium regressions", () => {
  let server: Server;
  let origin: string;
  const sent: { path: string; method: string; body: string; auth?: string }[] = [];
  const token = "external-once-credential-123";
  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const path = new URL(req.url ?? "/", "http://shop.test").pathname;
        sent.push({
          path,
          method: req.method ?? "",
          body: Buffer.concat(chunks).toString(),
          auth: req.headers.authorization,
        });
        res.setHeader("content-type", "text/html");
        if (path === "/credential.js") {
          res.setHeader("content-type", "application/javascript");
          res.end(
            'window.csrfToken="' +
              token +
              '";document.getElementById("exposed").textContent=window.csrfToken;',
          );
        } else if (path === "/redirect-source") {
          res.writeHead(302, { location: "/redirect-echo" });
          res.end(`<script>window.csrfToken="${token}"</script>`);
        } else if (path === "/redirect-echo") {
          res.end(`<p>${token}</p>`);
        } else if (path === "/credentials.json") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ settings: { accessToken: token } }));
        } else if (path === "/json-source") {
          res.end(
            '<p id="exposed"></p><script>const r=new XMLHttpRequest();r.open("GET","/credentials.json");r.onload=()=>document.getElementById("exposed").textContent=JSON.parse(r.responseText).settings.accessToken;r.send();</script>',
          );
        } else if (path === "/script-source") {
          res.end('<p id="exposed"></p><script src="/credential.js"></script>');
        } else if (path === "/pre-source") {
          res.end(`<p>${token}</p>`);
        } else if (path === "/cookie-echo") {
          res.end(
            '<p>quoted-cookie-secret demo&#45;only&#45;form&#45;key&#45;secret %63srf+one%20two+secret /items/1</p><input type="hidden" name="form_key" value="demo-only-form-key-secret"><meta name="csrf-token" content="csrf one two secret"><input aria-label="Echo" value="quoted-cookie-secret">',
          );
        } else if (path === "/header") {
          res.end(
            "<p>" +
              req.headers.authorization +
              '</p><input aria-label="Public" value="' +
              req.headers.authorization?.split(" ").at(-1) +
              '">',
          );
        } else if (path === "/urls") {
          const url =
            "https://user:private@shop.test/tiny/orders?key=query-secret&amp;ok=public#access_token=fragment-secret&amp;ok=public";
          res.end(
            '<a href="/">' +
              url +
              '</a><input aria-label="Ordinary" value="' +
              url +
              '"><p>#bareOpaqueToken123456</p>',
          );
        } else if (path === "/controls") {
          const entities = controls.map((c) => `&#${c};`).join("");
          res.end(
            '<form aria-label="Form' +
              entities +
              '" action="/save" method="post"><input aria-label="Value' +
              entities +
              '" name="x' +
              entities +
              '" value="Text' +
              entities +
              '"><button>Save' +
              entities +
              "</button></form>",
          );
        } else if (path === "/repeat") {
          res.end(
            '<form method="post" action="/save"><input name="x" value="01"><input name="x" value="02"><button>Save</button></form>',
          );
        } else if (path === "/wire") {
          res.end(
            '<form action="/save" method="post"><input name="x"></form><form action="/save" method="post"><input type="number" name="x" value="01"><button>Save</button></form>',
          );
        } else if (path === "/save") res.end("<p>Saved</p>");
        else res.end("<p>Start</p>");
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });
  const driver = (sessions = new InMemorySessions()) =>
    BrowserDriver.create({
      site: origin,
      sessions,
      minActionDelayMs: 0,
      launch: launchChromium,
      approver: () => "approve",
    });
  it.each([
    "/script-source",
    "/json-source",
    "/redirect-source",
  ])("registers loaded credentials before snapshot and trace exposure: %s", async (path) => {
    const d = await driver();
    try {
      await d.goto(path);
      expect(JSON.stringify([await d.snapshot(), d.trace, await d.candidates()])).not.toContain(
        token,
      );
      expect(JSON.stringify(d.trace)).toContain("redacted");
    } finally {
      await d.close();
    }
  });
  it.each([
    '"quoted-cookie-secret"',
    "%22quoted-cookie-secret%22",
  ])("r10/r3 registers logical cookie payloads before snapshots and learning: %s", async (value) => {
    const sessions = new InMemorySessions();
    sessions.set(origin, undefined, {
      cookies: [
        { name: "sid", value, domain: "127.0.0.1", path: "/", httpOnly: true },
        { name: "preference", value: "1", domain: "127.0.0.1", path: "/" },
      ],
    });
    const d = await driver(sessions);
    try {
      await d.goto("/cookie-echo");
      const snapshot = await d.snapshot();
      for (const surface of [
        snapshot.text,
        JSON.stringify(snapshot.nodes),
        JSON.stringify(d.trace),
        JSON.stringify(await d.candidates()),
      ]) {
        expect(surface).not.toMatch(
          /quoted-cookie-secret|demo-only-form-key-secret|%63srf|csrf one two secret/,
        );
      }
      expect(snapshot.text).toContain("/items/1");
      expect(snapshot.text).toContain("[redacted]");
    } finally {
      await d.close();
    }
  });
  it("r10 keeps free-text snapshots for a one-character HttpOnly cookie", async () => {
    const sessions = new InMemorySessions();
    sessions.set(origin, undefined, {
      cookies: [{ name: "ordinary", value: "1", httpOnly: true, domain: "127.0.0.1", path: "/" }],
    });
    const d = await driver(sessions);
    try {
      await d.goto("/cookie-echo");
      const snapshot = await d.snapshot();
      expect(snapshot.text).not.toContain("samples suppressed");
      expect(snapshot.text).toContain("/items/1");
      expect(JSON.stringify(d.trace)).toContain("/items/1");
      expect(JSON.stringify(d.trace)).not.toContain("samples suppressed");
    } finally {
      await d.close();
    }
  });
  it.each([
    "bEaReR",
    "bAsIc",
    "dPoP",
  ])("protects padded mixed-case %s session headers in transmitted echoes", async (scheme) => {
    const sessions = new InMemorySessions();
    sessions.set(origin, undefined, {
      cookies: [],
      headers: { Authorization: `  ${scheme}   header-credential-secret  ` },
    });
    const d = await driver(sessions);
    try {
      await d.goto("/header");
      expect(sent.at(-1)?.auth).toMatch(/^(Bearer|Basic|DPoP) header-credential-secret$/);
      expect(JSON.stringify([await d.snapshot(), d.trace])).not.toContain(
        "header-credential-secret",
      );
    } finally {
      await d.close();
    }
  });
  it("redacts finalized candidates again when a later response discovers a credential", async () => {
    const browser = await launchChromium();
    const d = await BrowserDriver.create({
      site: origin,
      sessions: new InMemorySessions(),
      minActionDelayMs: 0,
      launch: async () => browser,
    });
    try {
      await d.goto("/pre-source");
      expect(JSON.stringify(await d.candidates())).toContain(token);
      const page = browser.contexts()[0]?.pages()[0];
      if (!page) throw new Error("Missing page");
      await page.goto(`${origin}/script-source`);
      await d.close();
      expect(JSON.stringify(await d.candidates())).not.toContain(token);
    } finally {
      await d.close();
    }
  });
  it("scrubs URL names, values and trace text through the same boundary", async () => {
    const sessions = new InMemorySessions();
    sessions.set(origin, undefined, {
      cookies: [{ name: "sid", value: "tiny", domain: "127.0.0.1", path: "/", hostOnly: true }],
    });
    const d = await driver(sessions);
    try {
      await d.goto("/urls");
      const snapshot = await d.snapshot();
      expect(snapshot.nodes.some((n) => n.value?.includes("public"))).toBe(true);
      expect(JSON.stringify([snapshot, d.trace])).not.toMatch(
        /tiny|user:private|query-secret|fragment-secret|bareOpaqueToken123456/,
      );
    } finally {
      await d.close();
    }
  });
  it("escapes formatting controls in snapshot names/values and approval text", async () => {
    const d = await driver();
    try {
      await d.goto("/controls");
      const snapshot = await d.snapshot();
      const button = snapshot.nodes.find((n) => n.role === "button" && n.ref);
      if (!button?.ref) throw new Error("Missing Save");
      expect(button.name).toContain("\\u202e");
      expect(snapshot.nodes.some((n) => n.value?.includes("\\u200b"))).toBe(true);
      await d.click(button.ref);
      for (const text of [
        snapshot.text,
        ...snapshot.nodes.flatMap((n) => [n.name, n.value ?? ""]),
        d.approvals[0]?.summary ?? "",
      ])
        for (const code of controls) expect(text).not.toContain(String.fromCharCode(code));
      expect(d.approvals[0]?.summary).toContain("\\u202e");
    } finally {
      await d.close();
    }
  });
  it("rejects repeated wire names before transmitting any write", async () => {
    const d = await driver();
    const before = sent.length;
    try {
      await d.goto("/repeat");
      const button = (await d.snapshot()).nodes.find((n) => n.role === "button")?.ref;
      if (!button) throw new Error("Missing Save");
      await expect(d.click(button)).rejects.toMatchObject({ kind: "guard" });
      expect(sent.slice(before).some((r) => r.method === "POST")).toBe(false);
    } finally {
      await d.close();
    }
  });
  it("blocks the leading-zero write learned from conflicting forms (ONE POST)", async () => {
    const sessions = new InMemorySessions();
    const initial = model(origin);
    const before = sent.length;
    const trace = await runTask({
      model: initial,
      executor: createTaskExecutor({ model: initial, sessions }),
      goal: "Save once",
      approver: () => "approve",
      maxSteps: 2,
      fallback: createFallback({
        sessions,
        minActionDelayMs: 0,
        planner: () =>
          scriptedFallbackPlanner([
            { kind: "step", action: { kind: "goto", url: "/wire" } },
            (input) => {
              const ref = input.snapshot.nodes.find((n) => n.name === "Save" && n.ref)?.ref;
              if (!ref) throw new Error("Missing Save");
              return { kind: "step", action: { kind: "click", ref } };
            },
            { kind: "done" },
          ]),
      }),
      planner: scriptedPlanner(
        Array.from({ length: 2 }, () => ({
          kind: "act" as const,
          turtle: `[] a <${SCHEMA}UpdateAction>; <${SAB}x> "01".`,
        })),
      ),
    });
    expect(
      trace.steps.map((s) => s.status),
      JSON.stringify(trace.steps),
    ).toEqual(["done", "repeat-blocked"]);
    expect(
      sent
        .slice(before)
        .filter((r) => r.method === "POST")
        .map((r) => r.body),
    ).toEqual(["x=01"]);
  });
});
