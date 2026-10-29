// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { canonicalJson, DEFAULT_LIMITS, digestBytes } from "@jeswr/agent-model";
import { describe, expect, it, vi } from "vitest";
import { createDirectSend } from "../src/direct/send.js";
import { type DirectMailbox, envelope } from "../src/direct/shared.js";
import { createDirectReader } from "../src/direct.js";
import {
  ChannelParseError,
  DIRECT,
  ProviderRejectedError,
  type SendGrant,
  type TokenProvider,
} from "../src/index.js";
import { createInMemoryDirectBinding } from "../src/testing.js";
import { account, limits, message, options, signed, verifyMessage } from "./fixtures/signed.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe("direct loopback", () => {
  it("round-trips real signed bytes, with dry-run, scope separation and positive evidence", async () => {
    const config = options();
    const binding = createInMemoryDirectBinding(config);
    const proposal = signed();
    const wire = await binding.send.render(proposal, DIRECT);
    expect(await binding.send.validate(wire, proposal)).toEqual({ ok: true });
    expect(await binding.send.lookup?.(wire)).toEqual({ outcome: "absent" });
    const io = { account, tokens: config.tokens };
    expect(await binding.send.transmit(wire, io)).toEqual({
      outcome: "rejected",
      detail: "dry-run",
    });
    expect(await binding.send.transmit(wire, { ...io, dryRun: true })).toEqual({
      outcome: "rejected",
      detail: "dry-run",
    });
    expect(config.tokens.calls).toEqual([]);
    const result = await binding.send.transmit(wire, { ...io, dryRun: false });
    expect(result).toEqual({ outcome: "accepted", providerRef: `direct:${wire.digest}` });
    expect(await binding.send.transmit(wire, { ...io, dryRun: false })).toEqual(result);
    expect(await binding.send.lookup?.(wire)).toEqual({
      outcome: "found",
      providerRef: `direct:${wire.digest}`,
    });
    expect(binding.send.finalAbsence).toBe(true);
    const page = await binding.ingest.list(account, undefined, limits);
    expect(page.items).toEqual([{ id: message.id, raw: wire.bytes }]);
    const parsed = binding.ingest.parse({ id: message.id, raw: wire.bytes });
    expect(parsed).toMatchObject({
      channel: "direct",
      rawSha256: wire.digest.slice(8),
      rawByteLength: Buffer.byteLength(wire.bytes),
      warnings: ["signature-unverified"],
    });
    expect(JSON.parse(parsed.jsonLdBlocks?.[0] ?? "null")["agent:compactJws"]).toBe(
      proposal.compactJws,
    );
    expect(await verifyMessage(proposal.compactJws)).toEqual(message);
    expect(
      binding.ingest.parse({ id: "bytes", raw: Buffer.from(wire.bytes) }).jsonLdBlocks,
    ).toEqual([wire.bytes]);
    expect(await binding.ingest.list(account, page.next, limits)).toEqual({
      items: [],
      next: page.next,
    });
    expect(binding.ingest.threadKey?.(parsed)).toBeUndefined();
    expect(binding.ingest.threadKey?.({ ...parsed, threadId: "thread" })).toBe("thread");
    expect(config.tokens.calls.map((call) => call.access)).toEqual([
      "send",
      "send",
      "read",
      "read",
    ]);
    const read = await config.tokens.read(account);
    const send = await config.tokens.send(account);
    expect(read.accessToken).not.toBe(send.accessToken);
    expect(binding.origins.size).toBe(0);
    expect(
      createDirectReader({ inboxes: new Map(), accepted: new Map() }, config.tokens).send,
    ).toBeUndefined();
  });

  it("round-trips a bounded payload near the carriage byte limit", async () => {
    const config = options();
    const binding = createInMemoryDirectBinding(config);
    const description = {
      first: "x".repeat(DEFAULT_LIMITS.maxStringLength),
      second: "x".repeat(DEFAULT_LIMITS.maxStringLength),
      third: "",
    };
    const payload = { ...message, kind: "description", body: { description } };
    const unpaddedBytes = Buffer.byteLength(envelope(signed(payload).compactJws));
    description.third = "x".repeat(Math.floor(((DIRECT.maxBytes - unpaddedBytes) * 3) / 4));
    expect(description.third.length).toBeLessThanOrEqual(DEFAULT_LIMITS.maxStringLength);
    const proposal = signed(payload);
    expect(proposal.compactJws.length).toBeGreaterThan(DEFAULT_LIMITS.maxStringLength);
    const wire = await binding.send.render(proposal, DIRECT);
    expect(Buffer.byteLength(wire.bytes)).toBeLessThanOrEqual(DIRECT.maxBytes);
    expect(Buffer.byteLength(wire.bytes)).toBeGreaterThan(DIRECT.maxBytes - 4);
    expect(await binding.send.validate(wire, proposal)).toEqual({ ok: true });
    const result = { outcome: "accepted", providerRef: `direct:${wire.digest}` };
    expect(
      await binding.send.transmit(wire, { account, tokens: config.tokens, dryRun: false }),
    ).toEqual(result);
    expect(await binding.send.lookup?.(wire)).toEqual({
      outcome: "found",
      providerRef: result.providerRef,
    });
    const page = await binding.ingest.list(account, undefined, limits);
    expect(page.items).toEqual([{ id: message.id, raw: wire.bytes }]);
    for (const item of page.items)
      expect(binding.ingest.parse(item).jsonLdBlocks).toEqual([wire.bytes]);
    const oversized = `${wire.bytes}${" ".repeat(DIRECT.maxBytes - Buffer.byteLength(wire.bytes) + 1)}`;
    for (const raw of [oversized, Buffer.from(oversized)])
      expect(() => binding.ingest.parse({ id: message.id, raw })).toThrow(ChannelParseError);
  });

  it.each([
    { bound: "string length", value: "x".repeat(DEFAULT_LIMITS.maxStringLength + 1) },
    {
      bound: "depth",
      value: Array.from({ length: DEFAULT_LIMITS.maxJsonDepth }).reduce<unknown>(
        (nested) => ({ nested }),
        null,
      ),
    },
    { bound: "array length", value: Array(DEFAULT_LIMITS.maxArrayLength + 1).fill(0) },
    {
      bound: "node count",
      value: Array.from({ length: 10 }, () => Array(DEFAULT_LIMITS.maxArrayLength).fill(0)),
    },
  ])("enforces decoded payload $bound independently of carrier parsing", async ({ value }) => {
    const config = options();
    const verify = vi.fn(verifyMessage);
    const binding = createInMemoryDirectBinding({ ...config, verify });
    const proposal = signed({
      ...message,
      kind: "description",
      body: { description: { value } },
    });
    const bytes = envelope(proposal.compactJws);
    const wire = { bytes, digest: digestBytes(bytes), mediaType: "application/ld+json" };
    expect(Buffer.byteLength(bytes)).toBeLessThan(DIRECT.maxBytes);
    expect(binding.ingest.parse({ id: message.id, raw: bytes }).warnings).toEqual([
      "signature-unverified",
    ]);
    await expect(binding.send.render(proposal, DIRECT)).rejects.toThrow();
    expect(await binding.send.validate(wire, proposal)).toEqual({ ok: false, reason: "malformed" });
    await expect(
      binding.send.transmit(wire, { account, tokens: config.tokens, dryRun: false }),
    ).rejects.toThrow();
    await expect(binding.send.lookup?.(wire)).rejects.toThrow();
    expect(verify).toHaveBeenCalledTimes(4);
    expect(config.tokens.calls).toEqual([]);
  });

  it("bounds raw carrier bytes before decoding, including a stripped UTF-8 BOM", () => {
    const binding = createInMemoryDirectBinding(options());
    const text = envelope("a.b.c");
    const padded = `${text}${" ".repeat(DIRECT.maxBytes - Buffer.byteLength(text))}`;
    const bounded = Buffer.from(padded);
    expect(bounded.byteLength).toBe(DIRECT.maxBytes);
    expect(binding.ingest.parse({ id: "bounded", raw: bounded }).jsonLdBlocks).toEqual([padded]);
    const oversized = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bounded]);
    expect(oversized.byteLength).toBeGreaterThan(DIRECT.maxBytes);
    expect(new TextDecoder("utf-8", { fatal: true }).decode(oversized)).toBe(padded);
    const decode = vi.spyOn(TextDecoder.prototype, "decode");
    try {
      for (const raw of [oversized, new Uint8Array(DIRECT.maxBytes + 1)])
        expect(() => binding.ingest.parse({ id: "oversized", raw })).toThrow(ChannelParseError);
      expect(decode).not.toHaveBeenCalled();
    } finally {
      decode.mockRestore();
    }
  });

  it.each([
    { stage: "verification", mutation: "replace" },
    { stage: "verification", mutation: "mutate" },
    { stage: "credentials", mutation: "replace" },
    { stage: "credentials", mutation: "mutate" },
  ])("binds credentials and delivery to one account during $stage ($mutation)", async ({
    stage,
    mutation,
  }) => {
    const config = options();
    const verify = vi.fn(verifyMessage);
    const send = vi.fn(config.tokens.send.bind(config.tokens));
    const tokens = { read: config.tokens.read.bind(config.tokens), send };
    const binding = createInMemoryDirectBinding({ ...config, verify, tokens });
    const wire = await binding.send.render(signed(), DIRECT);
    const started = deferred<void>();
    const resume = deferred<void>();
    if (stage === "verification")
      verify.mockImplementationOnce(async (jws) => {
        started.resolve();
        await resume.promise;
        return verifyMessage(jws);
      });
    else
      send.mockImplementationOnce(async (ref) => {
        started.resolve();
        await resume.promise;
        return config.tokens.send(ref);
      });

    const ref = { ...account };
    const io = { account: ref, tokens, dryRun: false };
    const pending = binding.send.transmit(wire, io);
    await started.promise;
    const other = { id: "other-account" };
    if (mutation === "replace") io.account = other;
    else ref.id = other.id;
    resume.resolve();
    expect(await pending).toEqual({ outcome: "accepted", providerRef: `direct:${wire.digest}` });
    expect(config.tokens.calls).toEqual([{ access: "send", account }]);
    expect((await binding.ingest.list(account, undefined, limits)).items).toEqual([
      { id: message.id, raw: wire.bytes },
    ]);
    expect((await binding.ingest.list(other, undefined, limits)).items).toEqual([]);
  });

  it.each([
    "verification",
    "credentials",
  ] as const)("keeps absence unknown during pending %s until delivery or rejection", async (stage) => {
    for (const accepted of [true, false]) {
      const config = options();
      const verify = vi.fn(verifyMessage);
      const send = vi.fn(config.tokens.send.bind(config.tokens));
      const tokens = { read: config.tokens.read.bind(config.tokens), send };
      const binding = createInMemoryDirectBinding({ ...config, verify, tokens });
      const wire = await binding.send.render(signed(), DIRECT);
      const unrelated = await binding.send.render(
        signed({ ...message, id: "urn:example:message:unrelated" }),
        DIRECT,
      );
      const started = deferred<void>();
      const resume = deferred<void>();
      const pause = async () => {
        started.resolve();
        await resume.promise;
      };
      if (stage === "verification")
        verify.mockImplementationOnce(async (jws) => {
          await pause();
          return verifyMessage(jws);
        });
      else
        send.mockImplementationOnce(async (ref) => {
          await pause();
          return config.tokens.send(ref);
        });

      const pending = binding.send.transmit(wire, { account, tokens, dryRun: false });
      await started.promise;
      expect(binding.send.finalAbsence).toBe(true);
      expect(await binding.send.lookup?.(wire)).toMatchObject({ outcome: "unknown" });
      expect(await binding.send.lookup?.(unrelated)).toEqual({ outcome: "absent" });
      expect((await binding.ingest.list(account, undefined, limits)).items).toEqual([]);
      if (accepted) {
        resume.resolve();
        expect(await pending).toEqual({
          outcome: "accepted",
          providerRef: `direct:${wire.digest}`,
        });
        expect(await binding.send.lookup?.(wire)).toEqual({
          outcome: "found",
          providerRef: `direct:${wire.digest}`,
        });
        expect((await binding.ingest.list(account, undefined, limits)).items).toHaveLength(1);
      } else {
        const rejected = expect(pending).rejects.toThrow("test refusal");
        resume.reject(new Error("test refusal"));
        await rejected;
        expect(await binding.send.lookup?.(wire)).toEqual({ outcome: "absent" });
        expect((await binding.ingest.list(account, undefined, limits)).items).toEqual([]);
      }
    }
  });

  it.each([
    "verification",
    "credentials",
  ] as const)("snapshots wire fields before pending %s, including retries", async (stage) => {
    for (const retry of [false, true]) {
      const config = options();
      const verify = vi.fn(verifyMessage);
      const send = vi.fn(config.tokens.send.bind(config.tokens));
      const tokens = { read: config.tokens.read.bind(config.tokens), send };
      const binding = createInMemoryDirectBinding({ ...config, verify, tokens });
      const original = await binding.send.render(signed(), DIRECT);
      const replacement = await binding.send.render(
        signed({ ...message, id: "urn:example:message:replacement" }),
        DIRECT,
      );
      const io = { account, tokens, dryRun: false };
      const result = { outcome: "accepted", providerRef: `direct:${original.digest}` };
      if (retry) expect(await binding.send.transmit(original, io)).toEqual(result);

      const started = deferred<void>();
      const resume = deferred<void>();
      if (stage === "verification")
        verify.mockImplementationOnce(async (jws) => {
          started.resolve();
          await resume.promise;
          return verifyMessage(jws);
        });
      else
        send.mockImplementationOnce(async (ref) => {
          started.resolve();
          await resume.promise;
          return config.tokens.send(ref);
        });

      const wire = { ...original };
      const pending = binding.send.transmit(wire, io);
      await started.promise;
      Object.assign(wire, replacement);
      expect(await binding.send.lookup?.(original)).toMatchObject({
        outcome: retry ? "found" : "unknown",
      });
      expect(await binding.send.lookup?.(replacement)).toEqual({ outcome: "absent" });
      resume.resolve();
      expect(await pending).toEqual(result);
      expect(await binding.send.lookup?.(original)).toEqual({
        outcome: "found",
        providerRef: result.providerRef,
      });
      expect(await binding.send.lookup?.(replacement)).toEqual({ outcome: "absent" });
      expect(await binding.send.transmit(original, io)).toEqual(result);
      expect((await binding.ingest.list(account, undefined, limits)).items).toEqual([
        { id: message.id, raw: original.bytes },
      ]);
    }
  });

  it.each([
    "accepted",
    "verification",
    "credentials",
  ] as const)("snapshots lookup wire before verification for %s evidence", async (state) => {
    const config = options();
    const verify = vi.fn(verifyMessage);
    const send = vi.fn(config.tokens.send.bind(config.tokens));
    const tokens = { read: config.tokens.read.bind(config.tokens), send };
    const binding = createInMemoryDirectBinding({ ...config, verify, tokens });
    const original = await binding.send.render(signed(), DIRECT);
    const replacement = await binding.send.render(
      signed({ ...message, body: { want: ["different"] } }),
      DIRECT,
    );
    const io = { account, tokens, dryRun: false };
    const sendStarted = deferred<void>();
    const sendResume = deferred<void>();
    if (state === "verification")
      verify.mockImplementationOnce(async (jws) => {
        sendStarted.resolve();
        await sendResume.promise;
        return verifyMessage(jws);
      });
    else if (state === "credentials")
      send.mockImplementationOnce(async (ref) => {
        sendStarted.resolve();
        await sendResume.promise;
        return config.tokens.send(ref);
      });

    const result = { outcome: "accepted", providerRef: `direct:${original.digest}` };
    const pending = binding.send.transmit(original, io);
    if (state === "accepted") expect(await pending).toEqual(result);
    else await sendStarted.promise;

    const lookupStarted = deferred<void>();
    const lookupResume = deferred<void>();
    verify.mockImplementationOnce(async (jws) => {
      lookupStarted.resolve();
      await lookupResume.promise;
      return verifyMessage(jws);
    });
    const wire = { ...original };
    const lookup = binding.send.lookup?.(wire);
    await lookupStarted.promise;
    Object.assign(wire, replacement);
    lookupResume.resolve();
    if (state === "accepted")
      expect(await lookup).toEqual({ outcome: "found", providerRef: result.providerRef });
    else expect(await lookup).toMatchObject({ outcome: "unknown" });
    expect(await binding.send.lookup?.(replacement)).toEqual({ outcome: "absent" });

    sendResume.resolve();
    expect(await pending).toEqual(result);
    expect(await binding.send.lookup?.(original)).toEqual({
      outcome: "found",
      providerRef: result.providerRef,
    });
    expect((await binding.ingest.list(account, undefined, limits)).items).toEqual([
      { id: message.id, raw: original.bytes },
    ]);
  });

  it.each([
    { label: "just before expiry", at: Date.parse(message.expiresAt) - 1, accepted: true },
    { label: "at expiry", at: Date.parse(message.expiresAt), accepted: false },
    { label: "after expiry", at: Date.parse(message.expiresAt) + 1, accepted: false },
    { label: "after clock rollback", at: Date.parse(message.createdAt) - 1, accepted: false },
    { label: "with an invalid clock", at: NaN, accepted: false },
  ])("rechecks freshness $label after pending credentials", async ({ at, accepted }) => {
    const config = options();
    let clock = config.now();
    const binding = createInMemoryDirectBinding({ ...config, now: () => clock });
    const wire = await binding.send.render(signed(), DIRECT);
    const started = deferred<void>();
    const grant = deferred<SendGrant>();
    const tokens: TokenProvider = {
      read: config.tokens.read.bind(config.tokens),
      send: () => {
        started.resolve();
        return grant.promise;
      },
    };
    const pending = binding.send.transmit(wire, { account, tokens, dryRun: false });
    await started.promise;
    expect(await binding.send.lookup?.(wire)).toMatchObject({ outcome: "unknown" });
    expect((await binding.ingest.list(account, undefined, limits)).items).toEqual([]);
    clock = at;
    if (accepted) {
      grant.resolve(await config.tokens.send(account));
      const result = { outcome: "accepted", providerRef: `direct:${wire.digest}` };
      expect(await pending).toEqual(result);
      expect(await binding.send.lookup?.(wire)).toEqual({
        outcome: "found",
        providerRef: result.providerRef,
      });
      expect((await binding.ingest.list(account, undefined, limits)).items).toEqual([
        { id: message.id, raw: wire.bytes },
      ]);
    } else {
      const rejected = expect(pending).rejects.toThrow("expired or not yet valid");
      grant.resolve(await config.tokens.send(account));
      await rejected;
      expect(await binding.send.lookup?.(wire)).toEqual({ outcome: "absent" });
      expect((await binding.ingest.list(account, undefined, limits)).items).toEqual([]);
    }
  });

  it.each([
    "verification",
    "credentials",
  ] as const)("shares pending %s with another sender on the same mailbox", async (stage) => {
    for (const accepted of [true, false]) {
      const config = options();
      const mailbox: DirectMailbox = { inboxes: new Map(), accepted: new Map() };
      const verify = vi.fn(verifyMessage);
      const send = vi.fn(config.tokens.send.bind(config.tokens));
      const tokens = { read: config.tokens.read.bind(config.tokens), send };
      const sender = createDirectSend(mailbox, { ...config, verify });
      const wire = await sender.render(signed(), DIRECT);
      const started = deferred<void>();
      const resume = deferred<void>();
      if (stage === "verification")
        verify.mockImplementationOnce(async (jws) => {
          started.resolve();
          await resume.promise;
          return verifyMessage(jws);
        });
      else
        send.mockImplementationOnce(async (ref) => {
          started.resolve();
          await resume.promise;
          return config.tokens.send(ref);
        });

      const pending = sender.transmit(wire, { account, tokens, dryRun: false });
      await started.promise;
      const observer = createDirectSend(mailbox, config);
      expect(observer.finalAbsence).toBe(true);
      expect(await observer.lookup?.(wire)).toMatchObject({ outcome: "unknown" });
      const isolated = createInMemoryDirectBinding(config);
      expect(await isolated.send.lookup?.(wire)).toEqual({ outcome: "absent" });
      if (accepted) {
        resume.resolve();
        expect(await pending).toEqual({
          outcome: "accepted",
          providerRef: `direct:${wire.digest}`,
        });
        expect(await observer.lookup?.(wire)).toEqual({
          outcome: "found",
          providerRef: `direct:${wire.digest}`,
        });
      } else {
        const rejected = expect(pending).rejects.toThrow("test refusal");
        resume.reject(new Error("test refusal"));
        await rejected;
        expect(await observer.lookup?.(wire)).toEqual({ outcome: "absent" });
      }
      expect(
        (await createDirectReader(mailbox, config.tokens).ingest.list(account, undefined, limits))
          .items,
      ).toHaveLength(accepted ? 1 : 0);
    }
  });

  it.each([
    false,
    true,
  ])("tracks overlapping attempts across shared senders (%s) and keeps positive evidence", async (shared) => {
    const config = options();
    const mailbox: DirectMailbox = { inboxes: new Map(), accepted: new Map() };
    const binding = {
      ...createDirectReader(mailbox, config.tokens),
      send: createDirectSend(mailbox, config),
    };
    const secondSender = shared ? createDirectSend(mailbox, config) : binding.send;
    const wire = await binding.send.render(signed(), DIRECT);
    const firstGrant = deferred<SendGrant>();
    const secondGrant = deferred<SendGrant>();
    const firstStarted = deferred<void>();
    const secondStarted = deferred<void>();
    const tokens: TokenProvider = {
      read: config.tokens.read.bind(config.tokens),
      send: vi
        .fn()
        .mockImplementationOnce(() => {
          firstStarted.resolve();
          return firstGrant.promise;
        })
        .mockImplementationOnce(() => {
          secondStarted.resolve();
          return secondGrant.promise;
        }),
    };
    const io = { account, tokens, dryRun: false };
    const first = binding.send.transmit(wire, io);
    await firstStarted.promise;
    const second = secondSender.transmit(wire, io);
    await secondStarted.promise;
    expect(await binding.send.lookup?.(wire)).toMatchObject({ outcome: "unknown" });
    const rejected = expect(first).rejects.toThrow("test refusal");
    firstGrant.reject(new Error("test refusal"));
    await rejected;
    expect(await binding.send.lookup?.(wire)).toMatchObject({ outcome: "unknown" });
    expect(await secondSender.lookup?.(wire)).toMatchObject({ outcome: "unknown" });
    secondGrant.resolve(await config.tokens.send(account));
    const result = await second;
    expect(result).toEqual({ outcome: "accepted", providerRef: `direct:${wire.digest}` });
    expect(await binding.send.lookup?.(wire)).toEqual({
      outcome: "found",
      providerRef: `direct:${wire.digest}`,
    });
    expect(await secondSender.lookup?.(wire)).toEqual({
      outcome: "found",
      providerRef: `direct:${wire.digest}`,
    });

    const retryStarted = deferred<void>();
    const retryGrant = deferred<SendGrant>();
    const retry = binding.send.transmit(wire, {
      ...io,
      tokens: {
        ...tokens,
        send: () => {
          retryStarted.resolve();
          return retryGrant.promise;
        },
      },
    });
    await retryStarted.promise;
    expect(await binding.send.lookup?.(wire)).toEqual({
      outcome: "found",
      providerRef: `direct:${wire.digest}`,
    });
    retryGrant.resolve(await config.tokens.send(account));
    expect(await retry).toEqual(result);
    expect((await binding.ingest.list(account, undefined, limits)).items).toHaveLength(1);
  });

  it("bounds aggregate bytes, item count and cursors across isolated accounts", async () => {
    const config = options();
    const b = createInMemoryDirectBinding(config);
    const wire = await b.send.render(signed(), DIRECT);
    await b.send.transmit(wire, { account, tokens: config.tokens, dryRun: false });
    const second = await b.send.render(signed({ ...message, id: "urn:example:message:2" }), DIRECT);
    await b.send.transmit(second, { account, tokens: config.tokens, dryRun: false });
    const first = await b.ingest.list(account, undefined, {
      maxItems: 10,
      maxBytes: Buffer.byteLength(wire.bytes),
    });
    expect(first.items).toHaveLength(1);
    expect(
      (await b.ingest.list(account, first.next, { ...limits, maxItems: 1 })).items[0]?.id,
    ).toBe("urn:example:message:2");
    expect((await b.ingest.list({ id: "other" }, undefined, limits)).items).toEqual([]);
    await expect(b.ingest.list(account, undefined, { ...limits, maxBytes: 1 })).rejects.toThrow(
      "byte bound",
    );
    for (const bounds of [
      { maxItems: 0, maxBytes: 10 },
      { maxItems: 1.5, maxBytes: 10 },
      { maxItems: 1, maxBytes: 0 },
      { maxItems: 1, maxBytes: NaN },
    ])
      await expect(b.ingest.list(account, undefined, bounds)).rejects.toThrow("bounds");
    for (const cursor of [
      "!",
      "null",
      "{}",
      '{"account":"other","offset":0}',
      '{"account":"test-account","offset":-1}',
      '{"account":"test-account","offset":0.5}',
      '{"account":"test-account","offset":10}',
    ])
      await expect(b.ingest.list(account, cursor, limits)).rejects.toThrow();
    for (const ref of [undefined, { id: 1 }, { id: "" }, { id: "x".repeat(2049) }])
      await expect(b.ingest.list(ref as never, undefined, limits)).rejects.toThrow(
        "account reference",
      );
  });

  it("binds delayed read credentials to a frozen reference for the selected inbox", async () => {
    const config = options();
    const raw = envelope(signed().compactJws);
    const mailbox: DirectMailbox = {
      inboxes: new Map([[account.id, [{ id: message.id, raw }]]]),
      accepted: new Map(),
    };
    const started = deferred<void>();
    const resume = deferred<void>();
    const read = vi.fn(async (ref: Parameters<TokenProvider["read"]>[0]) => {
      started.resolve();
      await resume.promise;
      return config.tokens.read(ref);
    });
    const reader = createDirectReader(mailbox, {
      read,
      send: config.tokens.send.bind(config.tokens),
    });
    const ref = { ...account };
    const pending = reader.ingest.list(ref, undefined, limits);
    await started.promise;
    ref.id = "other-account";
    resume.resolve();
    expect(await pending).toEqual({
      items: [{ id: message.id, raw }],
      next: JSON.stringify({ account: account.id, offset: 1 }),
    });
    expect(config.tokens.calls).toEqual([{ access: "read", account }]);
    const authorized = read.mock.calls[0]?.[0];
    expect(authorized).not.toBe(ref);
    expect(Object.isFrozen(authorized)).toBe(true);
    expect(Reflect.set(authorized as object, "id", "other-account")).toBe(false);
    expect(authorized).toEqual(account);
  });

  it.each([
    { bound: "maxItems", replacement: Number.MAX_SAFE_INTEGER },
    { bound: "maxBytes", replacement: Number.MAX_SAFE_INTEGER },
    { bound: "maxItems", replacement: 0 },
    { bound: "maxBytes", replacement: 0 },
  ] as const)("snapshots list $bound before delayed credentials ($replacement)", async ({
    bound,
    replacement,
  }) => {
    const config = options();
    const first = { id: "first", raw: "first fixture" };
    const items = [first, { id: "second", raw: "second fixture" }];
    const mailbox: DirectMailbox = {
      inboxes: new Map([[account.id, items]]),
      accepted: new Map(),
    };
    const started = deferred<void>();
    const resume = deferred<void>();
    const reader = createDirectReader(mailbox, {
      read: async (ref) => {
        started.resolve();
        await resume.promise;
        return config.tokens.read(ref);
      },
      send: config.tokens.send.bind(config.tokens),
    });
    const bounds =
      bound === "maxItems"
        ? { maxItems: 1, maxBytes: limits.maxBytes }
        : { maxItems: limits.maxItems, maxBytes: Buffer.byteLength(first.raw) };
    const pending = reader.ingest.list(account, undefined, bounds);
    await started.promise;
    bounds[bound] = replacement;
    resume.resolve();
    expect(await pending).toEqual({
      items: [first],
      next: JSON.stringify({ account: account.id, offset: 1 }),
    });
    expect(config.tokens.calls).toEqual([{ access: "read", account }]);
  });

  it("reads each caller-owned list bound once before validation", async () => {
    const config = options();
    const first = { id: "first", raw: "first fixture" };
    const items = [first, { id: "second", raw: "second fixture" }];
    const mailbox: DirectMailbox = {
      inboxes: new Map([[account.id, items]]),
      accepted: new Map(),
    };
    const maxItems = vi
      .fn<() => number>()
      .mockReturnValueOnce(1)
      .mockReturnValue(Number.MAX_SAFE_INTEGER);
    const maxBytes = vi
      .fn<() => number>()
      .mockReturnValueOnce(Buffer.byteLength(first.raw))
      .mockReturnValue(Number.MAX_SAFE_INTEGER);
    const bounds = {
      get maxItems() {
        return maxItems();
      },
      get maxBytes() {
        return maxBytes();
      },
    };
    const page = await createDirectReader(mailbox, config.tokens).ingest.list(
      account,
      undefined,
      bounds,
    );
    expect(page).toEqual({
      items: [first],
      next: JSON.stringify({ account: account.id, offset: 1 }),
    });
    expect(maxItems).toHaveBeenCalledTimes(1);
    expect(maxBytes).toHaveBeenCalledTimes(1);
  });

  it("refuses wrong-scope, absent and empty grants before reading or delivering", async () => {
    for (const grant of [
      undefined,
      { access: "read", accessToken: "test-token" },
      { access: "send", accessToken: 1 },
      { access: "send", accessToken: " " },
    ]) {
      const config = options();
      const b = createInMemoryDirectBinding(config);
      const wire = await b.send.render(signed(), DIRECT);
      const tokens = { send: async () => grant } as unknown as TokenProvider;
      await expect(b.send.transmit(wire, { account, tokens, dryRun: false })).rejects.toThrow(
        "grant",
      );
      expect(await b.send.lookup?.(wire)).toEqual({ outcome: "absent" });
    }
    const b = createInMemoryDirectBinding({
      ...options(),
      tokens: {
        read: async () => ({ access: "send", accessToken: "test-token" }),
      } as unknown as TokenProvider,
    });
    await expect(b.ingest.list(account, undefined, limits)).rejects.toThrow("grant");
  });

  it("re-derives every wire field and rejects tampering, unsupported profiles and outbox changes", async () => {
    const config = options();
    const b = createInMemoryDirectBinding(config);
    const proposal = signed();
    const wire = await b.send.render(proposal, DIRECT);
    for (const changed of [
      { ...wire, bytes: `${wire.bytes} ` },
      { ...wire, digest: "wrong" },
      { ...wire, mediaType: "text/plain" },
      { ...wire, extra: true },
    ])
      expect(await b.send.validate(changed, proposal)).toEqual({
        ok: false,
        reason: "terms-digest-mismatch",
      });
    expect(
      await b.send.validate(wire, {
        ...proposal,
        message: { ...message, id: "urn:example:changed" },
      }),
    ).toEqual({ ok: false, reason: "malformed" });
    await expect(b.send.render(proposal, { ...DIRECT, footer: "required" })).rejects.toThrow(
      "carriage",
    );
    for (const changed of [
      undefined,
      { ...wire, bytes: 3 },
      { ...wire, bytes: "x".repeat(65537) },
      { ...wire, digest: "wrong" },
    ])
      await expect(
        b.send.transmit(changed as never, { account, tokens: config.tokens, dryRun: false }),
      ).rejects.toBeInstanceOf(ChannelParseError);
    expect(config.tokens.calls).toEqual([]);
  });

  it("rejects unverifiable, malformed, expired and future signed input", async () => {
    const proposal = signed();
    for (const verify of [
      async () => undefined,
      async () => {
        throw new Error("untrusted key");
      },
    ]) {
      const b = createInMemoryDirectBinding({ ...options(), verify });
      expect((await b.send.validate({ bytes: "", digest: "", mediaType: "" }, proposal)).ok).toBe(
        false,
      );
      await expect(b.send.render(proposal, DIRECT)).rejects.toThrow();
    }
    for (const changed of [
      { ...message, expiresAt: "2026-10-26T12:00:00Z" },
      { ...message, createdAt: "2026-10-26T12:01:00Z" },
    ]) {
      const config = options();
      const binding = createInMemoryDirectBinding(config);
      const expiredProposal = signed(changed);
      const wire = await binding.send.render(expiredProposal, DIRECT);
      expect((await binding.send.validate(wire, expiredProposal)).ok).toBe(false);
      await expect(
        binding.send.transmit(wire, { account, tokens: config.tokens, dryRun: false }),
      ).rejects.toThrow("expired or not yet valid");
      expect(config.tokens.calls).toEqual([]);
    }
    await expect(
      createInMemoryDirectBinding(options()).send.render(
        signed({ ...message, kind: "unknown" }),
        DIRECT,
      ),
    ).rejects.toThrow();
    const badClock = createInMemoryDirectBinding({ ...options(), now: () => NaN });
    const wire = await badClock.send.render(proposal, DIRECT);
    expect((await badClock.send.validate(wire, proposal)).ok).toBe(false);
    const current = signed({
      ...message,
      createdAt: new Date(Date.now() - 60000).toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    const defaultClock = createInMemoryDirectBinding({
      tokens: options().tokens,
      verify: verifyMessage,
    });
    expect(
      await defaultClock.send.validate(await defaultClock.send.render(current, DIRECT), current),
    ).toEqual({ ok: true });
    const signature = proposal.compactJws.split(".");
    signature[2] = "a".repeat(86);
    await expect(
      createInMemoryDirectBinding(options()).send.render(
        { ...proposal, compactJws: signature.join(".") },
        DIRECT,
      ),
    ).rejects.toThrow("signature");
  });

  it("never replaces accepted bytes on an id conflict", async () => {
    const config = options();
    const b = createInMemoryDirectBinding(config);
    const first = await b.send.render(signed(), DIRECT);
    const other = await b.send.render(
      signed({ ...message, body: { want: ["different"] } }),
      DIRECT,
    );
    const io = { account, tokens: config.tokens, dryRun: false };
    await b.send.transmit(first, io);
    await expect(b.send.transmit(other, io)).rejects.toBeInstanceOf(ProviderRejectedError);
    await expect(
      b.send.transmit(first, { ...io, account: { id: "other" } }),
    ).rejects.toBeInstanceOf(ProviderRejectedError);
    expect(await b.send.lookup?.(other)).toEqual({ outcome: "absent" });
    expect((await b.ingest.list(account, undefined, limits)).items).toHaveLength(1);
    const empty: DirectMailbox = { inboxes: new Map(), accepted: new Map() };
    expect(
      (await createDirectReader(empty, config.tokens).ingest.list(account, undefined, limits))
        .items,
    ).toEqual([]);
  });

  it("keeps rendering deterministic and permits positive-evidence lookup after expiry", async () => {
    let clock = Date.parse("2026-10-26T12:00:00Z");
    const config = { ...options(), now: () => clock };
    const binding = createInMemoryDirectBinding(config);
    const proposal = signed();
    const wire = await binding.send.render(proposal, DIRECT);
    const result = await binding.send.transmit(wire, {
      account,
      tokens: config.tokens,
      dryRun: false,
    });
    clock = Date.parse("2026-10-26T14:00:00Z");
    expect(await binding.send.render(proposal, DIRECT)).toEqual(wire);
    expect((await binding.send.validate(wire, proposal)).ok).toBe(false);
    expect(await binding.send.lookup?.(wire)).toEqual({
      outcome: "found",
      providerRef: result.outcome === "accepted" ? result.providerRef : "missing",
    });
  });

  it("hardens the pure parser against hostile carriers and oversized bytes", async () => {
    const b = createInMemoryDirectBinding(options());
    for (const raw of [
      "null",
      "{}",
      "!",
      "[]",
      "x".repeat(65537),
      new Uint8Array([255]),
      canonicalJson({ "agent:compactJws": 3 }),
      envelope("unsigned"),
      envelope("a.b.c").replace("jws-compact", "unsigned"),
      canonicalJson({ ...JSON.parse(envelope("a.b.c")), extra: true }),
    ])
      expect(() => b.ingest.parse({ id: "test", raw })).toThrow(ChannelParseError);
    expect(() => b.ingest.parse({ id: "", raw: envelope("a.b.c") })).toThrow("message id");
    expect(() => b.ingest.parse({ id: undefined, raw: envelope("a.b.c") } as never)).toThrow(
      "message id",
    );
    const wire = {
      bytes: envelope("a.b.c"),
      digest: digestBytes(envelope("a.b.c")),
      mediaType: "application/ld+json",
    };
    await expect(
      b.send.transmit(wire, { account, tokens: options().tokens, dryRun: false }),
    ).rejects.toThrow();
  });
});
