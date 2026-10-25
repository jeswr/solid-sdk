/**
 * The optional local A2A binding in-process: agents run the loopback listener of the official
 * `@a2a-js/sdk` against their AgentHost and dispatch through the runtime transmission boundary.
 * Personal agents use the explicitly selected solid-odrl module (or a stand-in SPARQ executable
 * where the policy binary itself is under test) so the gate needs no Rust binary; the
 * separate-process workflow with the real SPARQ module is scripts/pilot-a2a-integration.mjs.
 *
 * Denial tests count requests at the PEER's listener (every request, before any check): a
 * sender-side refusal must leave that count at zero — not merely be rejected by the peer.
 */
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  A2A_ACK_MEDIA_TYPE,
  A2A_BINDING,
  A2A_ENVELOPE_MEDIA_TYPE,
  A2aDispatcher,
  type A2aListener,
  type A2aPeer,
  a2aMessageIdFor,
  ackMessageIdFor,
  loopbackEndpoint,
  readA2aConfig,
  readA2aPeers,
  sendEnvelope,
  startA2aServer,
  validateAck,
} from "./bindings/a2a.js";
import { main, openAgent } from "./cli.js";
import { NORTH } from "./fixtures/mortgage.js";
import { AgentHost, type Json } from "./host.js";
import { FileLedger } from "./store/ledger.js";

const NOW = "2026-10-19T08:00:00Z";
const HOUR = 3_600_000;
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function cli(args: string[]) {
  let out = "";
  await main([...args], { stdout: (s) => (out += s) });
  return out.trim().startsWith("{") ? (JSON.parse(out) as Record<string, unknown>) : {};
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

/** Stand-in SPARQ executable (permits except the init probe's gated prohibition). */
function standIn(dir: string): string {
  const path = join(dir, "sparq-policy-decide");
  const body = `let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
const gated=JSON.parse(s).policy.text.includes("urn:awp:probe:prohibit");
process.stdout.write(JSON.stringify({api:"sparq-policy-decide/1",effect:gated?"indeterminate":"permit",
matchedRules:[],reasons:[],unresolved:gated?[{rule:"r",leftOperand:"purpose",kind:"missing-context"}]:[],
evaluator:{crate:"sparq-policy",version:"0.0.0-stand-in",function:"decide"}}));});`;
  writeFileSync(path, `#!${process.execPath}\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

const IDS = {
  alice: ["https://alice.example/#me", "https://agents.alice.example/personal#agent"],
  bob: ["https://bob.example/#me", "https://agents.bob.example/personal#agent"],
  carol: ["https://carol.example/#me", "https://agents.carol.example/personal#agent"],
} as const;
type Name = keyof typeof IDS;

interface Setup {
  root: string;
  owners: string;
  clock: { t: number };
  now: () => Date;
  sparqBin?: string;
}

/** Three personal agents with SEPARATE owner custody (owner keys under `owners/`). */
async function setup(
  opts: { aliceSparq?: boolean; aliceValidityDays?: number } = {},
): Promise<Setup> {
  const root = mkdtempSync(join(tmpdir(), "awp-a2a-unit-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const owners = join(root, "owners");
  const sparqBin = opts.aliceSparq ? standIn(root) : undefined;
  const common = ["--dir", root, "--now", NOW];
  const init: Record<string, Record<string, unknown>> = {};
  for (const [name, [party, actor]] of Object.entries(IDS)) {
    const module =
      name === "alice" && sparqBin ? [`--sparq-bin=${sparqBin}`] : ["--policy-engine=solid-odrl"];
    init[name] = await cli([
      "init",
      ...module,
      "--name",
      name,
      "--party",
      party,
      "--actor",
      actor,
      "--owner-dir",
      owners,
      ...(name === "alice" && opts.aliceValidityDays
        ? ["--validity-days", String(opts.aliceValidityDays)]
        : []),
      ...Object.entries(IDS)
        .filter(([n]) => n !== name)
        .flatMap(([, [p]]) => ["--known-party", p]),
      ...common,
    ]);
    writeFileSync(
      join(root, `${name}.card.json`),
      JSON.stringify(await cli(["card", "--name", name, ...common])),
    );
    await cli([
      "a2a-config",
      "--name",
      name,
      "--port",
      String(await freePort()),
      "--out",
      join(root, `${name}.a2a.json`),
      ...common,
    ]);
  }
  const pin = async (who: Name, peer: Name, a2a = true) => {
    await cli([
      "pin",
      "--name",
      who,
      "--card",
      join(root, `${peer}.card.json`),
      `--party-kid=${String(init[peer]?.partyKid)}`,
      `--actor-kid=${String(init[peer]?.actorKid)}`,
      ...common,
    ]);
    if (a2a)
      await cli([
        "a2a-pin",
        "--name",
        who,
        "--connection",
        join(root, `${peer}.a2a.json`),
        ...common,
      ]);
  };
  await pin("alice", "bob");
  await pin("bob", "alice");
  // carol knows alice (so alice's signature verifies at carol) but is nobody's audience.
  await pin("carol", "alice", false);
  const clock = { t: Date.parse(NOW) };
  return { root, owners, clock, now: () => new Date(clock.t), ...(sparqBin ? { sparqBin } : {}) };
}

interface Running {
  a: Awaited<ReturnType<typeof openAgent>>;
  h: AgentHost;
  listener: A2aListener;
  dispatcher: A2aDispatcher | undefined;
  /** POST requests that reached this agent's listener (counted before any check). */
  posts: { n: number };
  logs: string[];
}

async function host(
  env: Setup,
  name: string,
  opts: { auto?: boolean; peers?: A2aPeer[]; fetch?: typeof fetch; deadlineMs?: number } = {},
): Promise<Running> {
  const a = await openAgent(env.root, name, env.now, { extraBindings: [{ id: A2A_BINDING }] });
  const h = new AgentHost(a, env.now);
  await a.rt.recover();
  const logs: string[] = [];
  const log = (l: string) => logs.push(l);
  const posts = { n: 0 };
  const listener = await startA2aServer(
    h,
    readA2aConfig(a.dir) as NonNullable<ReturnType<typeof readA2aConfig>>,
    log,
    {
      onRequest: (r) => {
        if (r.method === "POST") posts.n++;
      },
    },
  );
  const peers = opts.peers ?? readA2aPeers(a.dir);
  const dispatcher =
    peers.length > 0
      ? new A2aDispatcher(h, peers, log, opts.deadlineMs ?? 5_000, opts.fetch ?? fetch)
      : undefined;
  if (dispatcher && (opts.auto ?? true)) h.onOutbound(() => dispatcher.kick());
  let closed = false;
  cleanups.push(async () => {
    if (closed) return;
    closed = true;
    h.stopAccepting();
    await listener.close();
    await dispatcher?.idle();
    await h.drain();
    a.close();
  });
  return { a, h, listener, dispatcher, posts, logs };
}

async function until(check: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const received = (dir: string) =>
  new FileLedger(join(dir, "ledger.jsonl"))
    .entries()
    .map((e) => e.record as Record<string, unknown>)
    .filter((r) => r.type === "message-in")
    .map((r) => `${r.kind}:${r.binding}`);

const propose = (r: Running, peer: Name, day = "2026-10-20") =>
  r.h.call(() =>
    r.h.runOperation("propose_meeting", {
      peerActor: IDS[peer][1],
      windowStart: `${day}T13:00:00Z`,
      windowEnd: `${day}T17:00:00Z`,
    }),
  );

/** Alice (manual dispatch) ends with a signed `propose` (an authorised action) queued for bob. */
async function queuedPropose(alice: Running, day?: string) {
  await propose(alice, "bob", day);
  await alice.dispatcher?.dispatch(); // describe → bob; bob auto-replies with its description
  await until(() => alice.h.undelivered().some((m) => m.kind === "propose"));
  const out = alice.h.undelivered().find((m) => m.kind === "propose");
  if (!out) throw new Error("no propose queued");
  return out;
}

const record = (r: Running, id: string) => r.a.rt.transmissions().find((t) => t.messageId === id);

/** Every file under `dir` (recursively). */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe("optional local A2A binding (official @a2a-js/sdk, loopback)", () => {
  it("runs a complete scheduling conversation over A2A, every send through the transmission boundary", async () => {
    const env = await setup();
    const alice = await host(env, "alice");
    const bob = await host(env, "bob");
    const started = await propose(alice, "bob");
    expect(started).toMatchObject({ step: { disposition: "local" } });
    const done = (h: AgentHost) =>
      h.agent.rt.conversations().length === 1 &&
      h.agent.rt.conversations()[0]?.phase === "completed" &&
      h.undelivered().length === 0;
    await until(() => done(alice.h) && done(bob.h));
    expect(received(alice.a.dir)).toEqual([
      `description:${A2A_BINDING}`,
      `accept:${A2A_BINDING}`,
      `receipt:${A2A_BINDING}`,
    ]);
    expect(received(bob.a.dir)).toEqual([
      `describe:${A2A_BINDING}`,
      `propose:${A2A_BINDING}`,
      `receipt:${A2A_BINDING}`,
    ]);
    // Each send has a durable record correlating envelope id, A2A id and the peer's ack id.
    const tx = alice.a.rt.transmissions();
    expect(tx.map((t) => t.status)).toEqual(["sent", "sent", "sent"]);
    for (const t of tx) {
      expect(t.binding).toBe(A2A_BINDING);
      expect(t.externalId).toBe(a2aMessageIdFor(t.messageId));
      expect(t.providerRef).toBe(`${ackMessageIdFor(t.externalId)}:accepted`);
    }
    expect(Object.keys(alice.a.calendar.data.holds)).toHaveLength(1);
    expect(Object.keys(bob.a.calendar.data.holds)).toHaveLength(1);
    // The Agent Card is accurate and public: no private keys, no local paths.
    const res = await fetch(bob.listener.cardUrl);
    const text = await res.text();
    const card = JSON.parse(text);
    expect(card.supportedInterfaces).toEqual([
      expect.objectContaining({ url: bob.listener.url, protocolBinding: "JSONRPC" }),
    ]);
    expect(card.capabilities).toMatchObject({ streaming: false, pushNotifications: false });
    expect(card.defaultInputModes).toEqual([A2A_ENVELOPE_MEDIA_TYPE]);
    expect(text).not.toContain(env.root);
    expect(text).not.toMatch(/"d"\s*:|private|token"/i);
  }, 20_000);

  it("services run without owner private material: separate custody leaves no owner key in any service directory", async () => {
    const env = await setup();
    for (const name of ["alice", "bob", "carol"]) {
      const serviceFiles = files(join(env.root, name));
      expect(existsSync(join(env.root, name, "keys", "owner.private.jwk.json"))).toBe(false);
      const ownerFile = join(env.owners, name, "owner.private.jwk.json");
      const ownerD = JSON.parse(readFileSync(ownerFile, "utf8")).jwk.d as string;
      for (const f of serviceFiles) expect(readFileSync(f, "utf8")).not.toContain(ownerD);
      expect(statSync(ownerFile).mode & 0o077).toBe(0);
    }
    // open, card, status and receive all work with the owner keys absent from the service.
    const alice = await host(env, "alice");
    const bob = await host(env, "bob");
    await propose(alice, "bob");
    await until(() => bob.a.rt.conversations()[0]?.phase === "completed");
    expect(await cli(["card", "--name", "bob", "--dir", env.root])).toMatchObject({
      actor: IDS.bob[1],
    });
  }, 20_000);

  it("refuses unauthenticated, oversized, non-loopback-host and browser requests; only SendMessage", async () => {
    const env = await setup();
    const bob = await host(env, "bob");
    const url = bob.listener.url;
    const token = (readA2aConfig(bob.a.dir) as { token: string }).token;
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "SendMessage", params: {} });
    const post = (headers: Record<string, string>, data = body) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: data,
      });
    expect((await post({})).status).toBe(401);
    expect((await post({ authorization: "Bearer wrong" })).status).toBe(401);
    expect(
      (await post({ authorization: `Bearer ${token}`, origin: "http://evil.example" })).status,
    ).toBe(403);
    expect(
      (
        await fetch(url.replace("127.0.0.1", "localhost"), {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body,
        })
      ).status,
    ).toBe(421);
    const big = JSON.stringify({ pad: "x".repeat(400 * 1024) });
    expect((await post({ authorization: `Bearer ${token}` }, big)).status).toBe(413);
    const other = await post(
      { authorization: `Bearer ${token}` },
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ListTasks", params: {} }),
    );
    expect(await other.json()).toMatchObject({ error: { code: -32601 } });
    for (const bad of [
      "http://localhost:4000/a2a/jsonrpc",
      "http://10.0.0.1:4000/a2a/jsonrpc",
      "https://127.0.0.1:4000/a2a/jsonrpc",
      "http://127.0.0.1/a2a/jsonrpc",
      "http://127.0.0.1:4000/other",
      "http://u:p@127.0.0.1:4000/a2a/jsonrpc",
    ])
      expect(() => loopbackEndpoint(bad)).toThrow();
    expect(loopbackEndpoint("http://[::1]:4000/a2a/jsonrpc").hostname).toBe("[::1]");
  }, 20_000);

  it("verifies carried envelopes like any binding: tamper, wrong audience and replay", async () => {
    const env = await setup();
    const alice = await host(env, "alice", { auto: false });
    const bob = await host(env, "bob", { auto: false });
    const carol = await host(env, "carol", { auto: false });
    await propose(alice, "bob");
    const [out] = alice.h.undelivered(IDS.bob[1]);
    if (out?.wire.format !== "awp-jws-compact/0.1") throw new Error("no signed outbound");
    const bobPeer = readA2aPeers(alice.a.dir).find((p) => p.actor === IDS.bob[1]);
    if (!bobPeer) throw new Error("bob not pinned");
    const [h, p, s] = out.wire.jws.split(".");
    const payload = JSON.parse(Buffer.from(p as string, "base64url").toString());
    payload.kind = "propose";
    const tampered = {
      ...out.wire,
      jws: `${h}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${s}`,
    };
    expect(await sendEnvelope(bobPeer, { id: `${out.id}-t`, wire: tampered })).toMatchObject({
      kind: "processed",
      ack: { disposition: "rejected", reason: "bad-signature" },
    });
    const carolPeer = {
      actor: IDS.carol[1],
      url: carol.listener.url,
      token: (readA2aConfig(carol.a.dir) as { token: string }).token,
    };
    expect(await sendEnvelope(carolPeer, out)).toMatchObject({
      kind: "processed",
      ack: { disposition: "rejected", reason: "wrong-audience" },
    });
    expect(await sendEnvelope(bobPeer, out)).toMatchObject({
      ack: { disposition: "accepted", messageId: out.id },
    });
    expect(await sendEnvelope(bobPeer, out)).toMatchObject({ ack: { disposition: "duplicate" } });
    expect(received(bob.a.dir)).toEqual([`describe:${A2A_BINDING}`]);
  }, 20_000);

  describe("send-time authorisation: a denied message never leaves (zero requests at the peer)", () => {
    const denials: [string, (env: Setup, alice: Running) => Promise<void>, string][] = [
      [
        "mandate revoked after the message was signed",
        async (_e, alice) => {
          await alice.a.rt.revokeMandate();
        },
        "not-authorised",
      ],
      [
        "the signed message expired while queued",
        async (env) => {
          env.clock.t += 7 * HOUR;
        },
        "expired",
      ],
      [
        "the pinned policy binary was replaced (policy module unavailable)",
        async (env) => {
          writeFileSync(
            env.sparqBin as string,
            `${readFileSync(env.sparqBin as string, "utf8")}//x`,
          );
        },
        "not-authorised",
      ],
    ];
    for (const [what, deny, reason] of denials)
      it(what, async () => {
        const env = await setup({ aliceSparq: what.includes("policy") });
        const alice = await host(env, "alice", { auto: false });
        const bob = await host(env, "bob");
        const out = await queuedPropose(alice);
        await deny(env, alice);
        bob.posts.n = 0;
        const result = await alice.dispatcher?.dispatch();
        expect(result?.failed).toEqual([
          expect.objectContaining({ id: out.id, status: "refused", reason }),
        ]);
        expect(bob.posts.n).toBe(0);
        expect(record(alice, out.id)).toBeUndefined(); // no attempt was even written ahead
        expect(alice.h.undelivered().map((m) => m.id)).toContain(out.id);
        expect(received(bob.a.dir)).toEqual([`describe:${A2A_BINDING}`]);
      }, 20_000);

    it("the owner mandate expired while the message was still valid", async () => {
      const env = await setup({ aliceValidityDays: 1 });
      env.clock.t = Date.parse(NOW) + 23 * HOUR;
      const alice = await host(env, "alice", { auto: false });
      const bob = await host(env, "bob");
      const out = await queuedPropose(alice, "2026-10-21");
      env.clock.t = Date.parse(NOW) + 25 * HOUR; // mandate over; the 6 h message is not
      bob.posts.n = 0;
      const result = await alice.dispatcher?.dispatch();
      expect(result?.failed).toEqual([
        expect.objectContaining({ id: out.id, status: "refused", reason: "not-authorised" }),
      ]);
      expect(bob.posts.n).toBe(0);
    }, 20_000);
  });

  it("a lost reply is uncertain (not unsent); an identical re-authorised resend is a duplicate — one business effect", async () => {
    const env = await setup();
    let lose = 0;
    const lossy: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      if (lose > 0) {
        lose--;
        await res.arrayBuffer(); // the peer processed it; only the reply is lost
        throw new Error("socket hang up (simulated lost reply)");
      }
      return res;
    };
    const alice = await host(env, "alice", { auto: false, fetch: lossy });
    const bob = await host(env, "bob");
    const out = await queuedPropose(alice);
    lose = 1;
    const first = await alice.dispatcher?.dispatch();
    expect(first?.failed).toEqual([expect.objectContaining({ id: out.id, status: "uncertain" })]);
    expect(record(alice, out.id)?.status).toBe("uncertain");
    expect(alice.h.undelivered().map((m) => m.id)).toContain(out.id);
    const second = await alice.dispatcher?.dispatch();
    expect(second?.delivered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: out.id, transmission: "sent", peerDisposition: "duplicate" }),
      ]),
    );
    expect(record(alice, out.id)).toMatchObject({ status: "sent", attempts: 2 });
    // One propose processed at bob, one hold on each side once the conversation completes.
    await until(() => alice.a.rt.conversations()[0]?.phase === "completed");
    expect(received(bob.a.dir).filter((r) => r.startsWith("propose:"))).toHaveLength(1);
    expect(Object.keys(bob.a.calendar.data.holds)).toHaveLength(1);
  }, 20_000);

  it("an uncertain message whose authority is revoked is not resent and stays uncertain", async () => {
    const env = await setup();
    let lose = 0;
    const lossy: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      if (lose > 0) {
        lose--;
        await res.arrayBuffer();
        throw new Error("socket hang up (simulated lost reply)");
      }
      return res;
    };
    const alice = await host(env, "alice", { auto: false, fetch: lossy });
    const bob = await host(env, "bob");
    const out = await queuedPropose(alice);
    lose = 1;
    await alice.dispatcher?.dispatch();
    expect(record(alice, out.id)?.status).toBe("uncertain");
    await alice.a.rt.revokeMandate();
    bob.posts.n = 0;
    const retry = await alice.dispatcher?.dispatch();
    expect(retry?.failed).toEqual([
      expect.objectContaining({ id: out.id, status: "refused", reason: "not-authorised" }),
    ]);
    expect(bob.posts.n).toBe(0);
    expect(record(alice, out.id)?.status).toBe("uncertain"); // never described as unsent
  }, 20_000);

  it("connection refused is not-sent; no reply by the deadline is uncertain; later delivery resolves it", async () => {
    const env = await setup();
    const bobPeer = readA2aPeers(join(env.root, "alice")).find((p) => p.actor === IDS.bob[1]);
    if (!bobPeer) throw new Error("bob not pinned");
    // A peer that reads the request and never answers.
    let hung = 0;
    const hang: Server = createServer((req: IncomingMessage, _res: ServerResponse) => {
      hung++;
      req.resume();
    });
    await new Promise<void>((r) => hang.listen(0, "127.0.0.1", r));
    cleanups.push(
      () =>
        new Promise<void>((r) => {
          hang.closeAllConnections();
          hang.close(() => r());
        }),
    );
    const hangUrl = `http://127.0.0.1:${(hang.address() as AddressInfo).port}/a2a/jsonrpc`;
    const closedUrl = `http://127.0.0.1:${await freePort()}/a2a/jsonrpc`;
    const peers = { current: [{ ...bobPeer, url: closedUrl }] };
    const alice = await host(env, "alice", { auto: false, peers: peers.current, deadlineMs: 400 });
    await propose(alice, "bob");
    const [describe] = alice.h.undelivered();
    if (!describe) throw new Error("no describe");
    const refused = await alice.dispatcher?.dispatch();
    expect(refused?.failed).toEqual([expect.objectContaining({ status: "not-sent" })]);
    expect(record(alice, describe.id)).toMatchObject({ status: "not-sent" });
    const viaHang = new A2aDispatcher(alice.h, [{ ...bobPeer, url: hangUrl }], () => {}, 400);
    const silent = await viaHang.dispatch();
    expect(hung).toBe(1);
    expect(silent.failed).toEqual([expect.objectContaining({ status: "uncertain" })]);
    expect(record(alice, describe.id)?.status).toBe("uncertain");
    // The real peer: an identical resend resolves it.
    const bob = await host(env, "bob", { auto: false });
    const real = new A2aDispatcher(alice.h, [bobPeer], () => {}, 5_000);
    const ok = await real.dispatch();
    expect(ok.delivered).toEqual([
      expect.objectContaining({ id: describe.id, transmission: "sent" }),
    ]);
    expect(received(bob.a.dir)).toEqual([`describe:${A2A_BINDING}`]);
  }, 20_000);

  it("strict acknowledgements: wrong/missing ids, unknown dispositions, extra parts, tasks and garbage never retire a message", async () => {
    const env = await setup();
    const bob = await host(env, "bob", { auto: false });
    const bobPeer = readA2aPeers(join(env.root, "alice")).find((p) => p.actor === IDS.bob[1]);
    if (!bobPeer) throw new Error("bob not pinned");
    // A proxy in front of bob that forwards the request and rewrites bob's genuine reply.
    type Rewrite = (body: Json) => unknown;
    let rewrite: Rewrite | undefined;
    const proxy = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers))
        if (
          typeof v === "string" &&
          (k === "authorization" || k === "content-type" || k.startsWith("a2a-"))
        )
          headers[k] = v;
      const upstream = await fetch(bob.listener.url, {
        method: "POST",
        headers,
        body: Buffer.concat(chunks),
      });
      const json = (await upstream.json()) as Json;
      const out = rewrite ? rewrite(json) : json;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(typeof out === "string" ? out : JSON.stringify(out));
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    cleanups.push(() => new Promise<void>((r) => proxy.close(() => r())));
    const proxyPeer = {
      ...bobPeer,
      url: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}/a2a/jsonrpc`,
    };
    const alice = await host(env, "alice", { auto: false, peers: [proxyPeer] });
    await propose(alice, "bob");
    const [describe] = alice.h.undelivered();
    if (!describe) throw new Error("no describe");
    const msg = (j: Json) => (j.result as { message: Json }).message;
    const ackData = (j: Json) => ((msg(j).parts as Json[])[0] as { data: Json }).data;
    /** Apply `change` to bob's genuine reply and return it. */
    const edit =
      (change: (j: Json) => void): Rewrite =>
      (j) => {
        change(j);
        return j;
      };
    const cases: [string, Rewrite][] = [
      [
        "wrong transport id",
        edit((j) => {
          ackData(j).transportMessageId = "awp-other";
        }),
      ],
      [
        "unknown disposition",
        edit((j) => {
          ackData(j).disposition = "ok";
        }),
      ],
      [
        "missing message id on accepted",
        edit((j) => {
          delete ackData(j).messageId;
        }),
      ],
      [
        "a different signed message id",
        edit((j) => {
          ackData(j).messageId = "urn:uuid:other";
        }),
      ],
      [
        "an extra field",
        edit((j) => {
          ackData(j).extra = 1;
        }),
      ],
      [
        "duplicate ack parts",
        edit((j) => {
          msg(j).parts = [...(msg(j).parts as Json[]), ...(msg(j).parts as Json[])];
        }),
      ],
      [
        "wrong ack message id",
        edit((j) => {
          msg(j).messageId = "ack-0";
        }),
      ],
      [
        "a peer task",
        (j) => ({
          ...j,
          result: {
            task: { id: "t1", contextId: "c1", status: { state: "TASK_STATE_COMPLETED" } },
          },
        }),
      ],
      ["garbage", () => "not json"],
      ["an empty result", (j) => ({ ...j, result: {} })],
    ];
    for (const [what, fn] of cases) {
      rewrite = fn;
      const r = await alice.dispatcher?.dispatch();
      expect(r?.failed, what).toEqual([
        expect.objectContaining({ id: describe.id, status: "uncertain" }),
      ]);
      expect(
        alice.h.undelivered().map((m) => m.id),
        what,
      ).toContain(describe.id);
      expect(record(alice, describe.id)?.status, what).toBe("uncertain");
    }
    rewrite = undefined;
    const ok = await alice.dispatcher?.dispatch();
    expect(ok?.delivered).toEqual([
      expect.objectContaining({
        id: describe.id,
        transmission: "sent",
        peerDisposition: "duplicate",
      }),
    ]);
    expect(received(bob.a.dir)).toEqual([`describe:${A2A_BINDING}`]); // processed once
  }, 30_000);

  it("validateAck: the closed vocabulary separates transport refusal, indeterminate and business outcomes", () => {
    const a2aMessageId = "awp-1";
    const awpMessageId = "urn:uuid:m1";
    const ack = (data: Json, extra: Json = {}) => ({
      messageId: ackMessageIdFor(a2aMessageId),
      role: 2,
      // biome-ignore lint/style/useNamingConvention: the A2A SDK's oneof discriminator
      parts: [{ content: { $case: "data", value: data }, mediaType: A2A_ACK_MEDIA_TYPE }],
      ...extra,
    });
    const ok = (d: Json) => validateAck(ack(d), { a2aMessageId, awpMessageId });
    expect(
      ok({ transportMessageId: a2aMessageId, disposition: "accepted", messageId: awpMessageId }),
    ).toMatchObject({ ok: true });
    expect(
      ok({ transportMessageId: a2aMessageId, disposition: "rejected", reason: "bad-signature" }),
    ).toMatchObject({ ok: true });
    expect(
      ok({ transportMessageId: a2aMessageId, disposition: "transport-refused", reason: "busy" }),
    ).toMatchObject({ ok: true, ack: { disposition: "transport-refused" } });
    expect(ok({ transportMessageId: a2aMessageId, disposition: "indeterminate" })).toMatchObject({
      ok: true,
      ack: { disposition: "indeterminate" },
    });
    expect(ok({ transportMessageId: a2aMessageId, disposition: "local" })).toMatchObject({
      ok: false,
    });
    expect(
      validateAck(
        ack(
          { transportMessageId: a2aMessageId, disposition: "accepted", messageId: awpMessageId },
          { role: 1 },
        ),
        { a2aMessageId, awpMessageId },
      ),
    ).toMatchObject({ ok: false });
    expect(
      validateAck({ id: "t", status: {}, history: [] }, { a2aMessageId, awpMessageId }),
    ).toMatchObject({ ok: false });
  });

  it("two agents sending to each other at the same moment do not deadlock", async () => {
    const env = await setup();
    const alice = await host(env, "alice", { auto: false, deadlineMs: 3_000 });
    const bob = await host(env, "bob", { auto: false, deadlineMs: 3_000 });
    await propose(alice, "bob");
    await propose(bob, "alice", "2026-10-21");
    const started = Date.now();
    const [ra, rb] = await Promise.all([alice.dispatcher?.dispatch(), bob.dispatcher?.dispatch()]);
    expect(Date.now() - started).toBeLessThan(2_500);
    expect(ra?.delivered).toHaveLength(1);
    expect(rb?.delivered).toHaveLength(1);
    expect(received(alice.a.dir)).toEqual([`describe:${A2A_BINDING}`]);
    expect(received(bob.a.dir)).toEqual([`describe:${A2A_BINDING}`]);
  }, 20_000);

  it("mortgage: a disclosure whose owner approval expired while queued is not sent (zero requests)", async () => {
    const root = mkdtempSync(join(tmpdir(), "awp-a2a-mortgage-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const owners = join(root, "owners");
    const common = ["--dir", root, "--now", NOW, "--policy-engine=solid-odrl"];
    const issuance = (await cli([
      "synthetic-issuers",
      "--out",
      join(root, "issuance"),
      ...common,
    ])) as {
      wallet: string;
      issuers: string;
    };
    const init: Record<string, Record<string, unknown>> = {};
    init.sam = await cli([
      "init",
      "--name",
      "sam",
      "--role",
      "mortgage-consumer",
      "--wallet",
      issuance.wallet,
      "--owner-dir",
      owners,
      ...common,
    ]);
    init.northbank = await cli([
      "init",
      "--name",
      "northbank",
      "--role",
      "mortgage-lender",
      "--issuers",
      issuance.issuers,
      "--owner-dir",
      owners,
      ...common,
    ]);
    for (const n of ["sam", "northbank"]) {
      writeFileSync(
        join(root, `${n}.card.json`),
        JSON.stringify(await cli(["card", "--name", n, ...common])),
      );
      await cli([
        "a2a-config",
        "--name",
        n,
        "--port",
        String(await freePort()),
        "--out",
        join(root, `${n}.a2a.json`),
        ...common,
      ]);
    }
    for (const [who, peer] of [
      ["sam", "northbank"],
      ["northbank", "sam"],
    ] as const) {
      await cli([
        "pin",
        "--name",
        who,
        "--card",
        join(root, `${peer}.card.json`),
        `--party-kid=${String(init[peer]?.partyKid)}`,
        `--actor-kid=${String(init[peer]?.actorKid)}`,
        ...common,
      ]);
      await cli([
        "a2a-pin",
        "--name",
        who,
        "--connection",
        join(root, `${peer}.a2a.json`),
        ...common,
      ]);
    }
    const clock = { t: Date.parse(NOW) };
    const env: Setup = { root, owners, clock, now: () => new Date(clock.t) };
    const sam = await host(env, "sam", { auto: false });
    const nb = await host(env, "northbank");
    const started = await sam.h.call(() =>
      sam.h.runOperation("start_prequalification", {
        lenderActor: NORTH.actor,
        propertyPrice: 450000,
        loanAmount: 380000,
      }),
    );
    const application = (started.step as { conversation: string }).conversation;
    for (let i = 0; i < 50 && sam.a.rt.pendingApprovals().length === 0; i++) {
      await sam.dispatcher?.dispatch(); // sam's operator dispatches; northbank auto-replies
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(sam.a.rt.pendingApprovals()).toHaveLength(1);
    const pending = sam.a.rt.pendingApprovals()[0];
    // Signed OUTSIDE the service (owner directory), valid for one hour.
    const signed = (await cli([
      "sign-approval",
      "--name",
      "sam",
      "--owner-dir",
      owners,
      "--action",
      pending?.actionDigest as string,
      "--conversation",
      application,
      ...common,
    ])) as { approval: string };
    const approved = await sam.h.call(() => sam.h.submitApproval(signed.approval));
    expect((approved.outbound as Json[]).map((o) => o.kind)).toEqual(["accept", "deliver"]);
    clock.t += HOUR + 60_000; // the approval lapses while the disclosure is queued
    nb.posts.n = 0;
    const result = await sam.dispatcher?.dispatch();
    expect(result?.failed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "refused", reason: "approval-required" }),
      ]),
    );
    expect(result?.delivered).toEqual([]);
    expect(nb.posts.n).toBe(0);
    expect((nb.h.status().domain as { dataStore: unknown[] }).dataStore).toEqual([]);
  }, 30_000);
});
