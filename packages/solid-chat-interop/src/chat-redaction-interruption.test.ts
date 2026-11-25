// AUTHORED-BY Claude Sonnet 5.5
// Round 2 of the owner-run archive repair: an interrupted run, and messages whose stored
// order differs from the order they were submitted in, must never leave half a secret
// behind or report clean while one remains.
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { type ChatConversation, type ChatPodPort, ChatWriter } from "./chat-writer.js";
import { storeToTurtle } from "./reconcile.js";
import { redactSecretFields } from "./redact.js";

const ROOT = "https://alice.example/pod/";
const OWNER = `${ROOT}profile/card#me`;
const CHAT = `${ROOT}private/chats/claude/thread-1/`;
const DAY1 = "2026-10-24T12:00:00.000Z";
const DAY2 = "2026-10-25T12:00:00.000Z";
const DAY3 = "2026-10-26T12:00:00.000Z";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Message = { role: "user" | "assistant"; text: string; createdAt: string };

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}
function etagOf(body: Uint8Array): string {
  let hash = 5381;
  for (const byte of body) hash = (hash * 33 + byte) >>> 0;
  return `"${body.length}-${hash.toString(16)}"`;
}
async function derivedId(role: string, text: string, createdAt: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(JSON.stringify([role, text, createdAt])),
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Strong ETags and conditional writes; every write and delete is numbered, and may fail. */
class FaultPod implements ChatPodPort {
  root = ROOT;
  webId = OWNER;
  resources = new Map<string, { body: Uint8Array; contentType: string }>();
  /** Mutating requests seen so far. */
  operations = 0;
  /** Operation number that fails; with `crash`, it and every later one fail. */
  failAt: number | undefined;
  crash = false;
  async discoverAcl(url: string) {
    return `${url}.acl`;
  }
  async read(url: string) {
    const resource = this.resources.get(url);
    if (!resource) throw httpError(404);
    return { ...resource, etag: etagOf(resource.body) };
  }
  async list(container: string) {
    return [...this.resources.keys()]
      .filter(
        (url) =>
          url.startsWith(container) &&
          url !== container &&
          !url.slice(container.length).replace(/\/$/, "").includes("/"),
      )
      .map((url) => ({ url, isContainer: url.endsWith("/") }));
  }
  private fault(url: string, ifMatch?: string) {
    const operation = this.operations++;
    if (
      this.failAt !== undefined &&
      (operation === this.failAt || (this.crash && operation > this.failAt))
    )
      throw httpError(500);
    if (ifMatch === undefined) return;
    const current = this.resources.get(url);
    if (!current || etagOf(current.body) !== ifMatch) throw httpError(412);
  }
  async write(
    url: string,
    body: Uint8Array,
    contentType: string,
    cond: { ifMatch?: string; ifNoneMatch?: "*" },
  ) {
    this.fault(url, cond.ifMatch);
    if (cond.ifNoneMatch === "*" && this.resources.has(url)) throw httpError(412);
    this.resources.set(url, { body, contentType });
    return {};
  }
  async delete(url: string, cond: { ifMatch: string }) {
    if (!this.resources.has(url)) throw httpError(404);
    this.fault(url, cond.ifMatch);
    this.resources.delete(url);
    this.resources.delete(`${url}.acl`);
  }
  text(url: string): string {
    return decoder.decode((this.resources.get(url) as { body: Uint8Array }).body);
  }
  set(url: string, text: string) {
    this.resources.set(url, { body: encoder.encode(text), contentType: "text/turtle" });
  }
  everything(): string {
    return [...this.resources.values()].map((r) => decoder.decode(r.body)).join("\n");
  }
  /** Resource name to text, ignoring request counters and ETags. */
  snapshot(): [string, string][] {
    return [...this.resources.keys()]
      .map((url): [string, string] => [
        url,
        this.text(url).replace(/(generatedAtTime )"[^"]*"/g, '$1"<time>"'),
      ])
      .sort(([a], [b]) => a.localeCompare(b));
  }
}

async function swapLiteral(pod: FaultPod, url: string, from: string, to: string) {
  const dataset = await parseRdf(pod.text(url), "text/turtle", { baseIRI: url });
  const hits = [...dataset].filter(
    (q) => q.object.termType === "Literal" && q.object.value === from,
  );
  expect(hits.length).toBeGreaterThan(0);
  for (const q of hits) {
    dataset.delete(q);
    dataset.add(DataFactory.quad(q.subject, q.predicate, DataFactory.literal(to), q.graph));
  }
  pod.set(url, await storeToTurtle(dataset));
}

/** A chat as an older writer stored it: raw title and text, under `ids` (default: digests of
 * the raw text, as an ID-less message was named). */
async function seed(title: string, messages: Message[], ids?: string[]): Promise<FaultPod> {
  const pod = new FaultPod();
  const names =
    ids ?? (await Promise.all(messages.map((m) => derivedId(m.role, m.text, m.createdAt))));
  const conversation: ChatConversation = {
    provider: "claude",
    conversationId: "thread-1",
    title: "PLACEHOLDER-TITLE",
    channel: "mcp",
    messages: messages.map((m, i) => ({
      ...m,
      id: names[i] as string,
      text: `PLACEHOLDER-MESSAGE-${i}`,
    })),
  };
  await new ChatWriter(pod).save(conversation);
  await swapLiteral(pod, `${CHAT}_conversation.ttl`, "PLACEHOLDER-TITLE", title);
  for (const [i, id] of names.entries())
    await swapLiteral(
      pod,
      `${CHAT}m-${id}.ttl`,
      `PLACEHOLDER-MESSAGE-${i}`,
      (messages[i] as Message).text,
    );
  return pod;
}

const dirty = (report: { failed: number; conflicts: number }) =>
  report.failed + report.conflicts > 0;
const CLEAN = { titles: 0, messagesRewritten: 0, messagesReplaced: 0, conflicts: 0, failed: 0 };

const PEM_HEAD = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj";
const PEM_BODY = "MBQwXZ3sPEMBODYSECRETpart2";
const SCENARIOS: { name: string; title: string; messages: Message[]; fragments: string[] }[] = [
  {
    name: "a private key split over three messages",
    title: "Plain title",
    messages: [
      {
        role: "user",
        text: `Here is the key\n-----BEGIN PRIVATE KEY-----\n${PEM_HEAD}`,
        createdAt: DAY1,
      },
      { role: "user", text: PEM_BODY, createdAt: DAY2 },
      { role: "user", text: "-----END PRIVATE KEY-----\nthanks", createdAt: DAY3 },
    ],
    fragments: [PEM_HEAD.slice(0, 20), PEM_BODY],
  },
  {
    name: "a secret split across the title and the first message",
    title: 'password="sk-fixtureTitleHalf',
    messages: [
      { role: "user", text: 'fixtureMessageHalf"; x = 1', createdAt: DAY1 },
      { role: "assistant", text: "Noted", createdAt: DAY2 },
    ],
    fragments: ["fixtureTitleHalf", "fixtureMessageHalf"],
  },
  {
    name: "a secret split across two adjacent messages",
    title: "Plain title",
    messages: [
      { role: "user", text: "before", createdAt: DAY1 },
      { role: "user", text: 'config password="sk-fixtureLeftHalf', createdAt: DAY2 },
      { role: "assistant", text: 'fixtureRightHalf"; y = 2', createdAt: DAY3 },
    ],
    fragments: ["fixtureLeftHalf", "fixtureRightHalf"],
  },
];

/** Run the repair uninterrupted, then again from every interruption point (one failing
 * request, and a crash that fails every later request); each resumed run must finish with the
 * uninterrupted result, leave no fragment, and no interrupted run may look clean. */
async function expectEveryInterruptionRecovers(
  build: () => Promise<FaultPod>,
  fragments: string[],
) {
  const uninterrupted = await build();
  uninterrupted.operations = 0;
  const first = await new ChatWriter(uninterrupted).migrateRedaction();
  expect(dirty(first)).toBe(false);
  for (const fragment of fragments) expect(uninterrupted.everything()).not.toContain(fragment);
  const operations = uninterrupted.operations;
  const expected = uninterrupted.snapshot();
  expect(operations).toBeGreaterThan(0);
  for (const crash of [false, true])
    for (let k = 0; k < operations; k++) {
      const label = `crash=${crash} k=${k}`;
      const pod = await build();
      pod.operations = 0;
      pod.failAt = k;
      pod.crash = crash;
      const interrupted = await new ChatWriter(pod).migrateRedaction();
      // Never clean while the run did not finish.
      expect(dirty(interrupted), label).toBe(true);
      pod.failAt = undefined;
      const resumed = await new ChatWriter(pod).migrateRedaction();
      expect(resumed, label).toMatchObject({ failed: 0, conflicts: 0 });
      for (const fragment of fragments) expect(pod.everything(), label).not.toContain(fragment);
      expect(pod.snapshot(), label).toEqual(expected);
      expect(await new ChatWriter(pod).migrateRedaction(), label).toMatchObject(CLEAN);
    }
}

describe("an interrupted archive repair (round 2, A1)", () => {
  for (const named of ["hash", "caller"] as const) {
    describe.each(SCENARIOS)(`$name, messages named by ${named}`, (scenario) => {
      it("finishes from every interruption point, to the uninterrupted result", async () => {
        await expectEveryInterruptionRecovers(
          () =>
            seed(
              scenario.title,
              scenario.messages,
              named === "hash" ? undefined : scenario.messages.map((_, i) => `msg-${i}`),
            ),
          scenario.fragments,
        );
      });
    });
  }

  it("writes the title last and the last message first when nothing depends on order", async () => {
    const pod = await seed(
      'password="sk-fixtureTitleHalf',
      [{ role: "user", text: 'fixtureMessageHalf"; x = 1', createdAt: DAY1 }],
      ["msg-0"],
    );
    pod.operations = 0;
    const writes: string[] = [];
    const write = pod.write.bind(pod);
    pod.write = async (url, ...rest) => {
      writes.push(url.slice(CHAT.length));
      return write(url, ...rest);
    };
    await new ChatWriter(pod).migrateRedaction();
    expect(writes).toEqual(["m-msg-0.ttl", "_conversation.ttl"]);
  });

  it("stops a conversation at its first failed write and counts what it left", async () => {
    const pod = await seed(
      "Plain title",
      [
        { role: "user", text: "token ghp_fixtureStopToken123456", createdAt: DAY1 },
        { role: "user", text: "token ghp_fixtureStopToken654321", createdAt: DAY2 },
        { role: "user", text: "token ghp_fixtureStopTokenabcdef", createdAt: DAY3 },
      ],
      ["a", "b", "c"],
    );
    pod.operations = 0;
    pod.failAt = 0;
    const report = await new ChatWriter(pod).migrateRedaction();
    // The last message's write failed; the two before it were not touched.
    expect(report).toMatchObject({ failed: 1, conflicts: 2, messagesRewritten: 0 });
    expect(pod.text(`${CHAT}m-a.ttl`)).toContain("ghp_fixtureStopToken123456");
    expect(pod.text(`${CHAT}m-b.ttl`)).toContain("ghp_fixtureStopToken654321");
  });

  it("repairs, but never reports clean, when no write order is provably recoverable", async () => {
    // A repeated unterminated quote: whichever line is written first changes how the other
    // one redacts, so the run cannot show that an interruption would be recoverable.
    const pod = await seed(
      "Plain title",
      [
        { role: "user", text: 'password="sk-fixtureRepeatedLine', createdAt: DAY1 },
        { role: "user", text: 'password="sk-fixtureRepeatedLine', createdAt: DAY2 },
      ],
      ["a", "b"],
    );
    const first = await new ChatWriter(pod).migrateRedaction();
    expect(first.failed).toBe(1);
    expect(pod.everything()).not.toContain("fixtureRepeatedLine");
    expect(await new ChatWriter(pod).migrateRedaction()).toMatchObject(CLEAN);
  });
});

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, at) =>
    permutations([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [item, ...rest]),
  );
}

describe("messages whose stored order differs from the order they were submitted in (round 2, A2)", () => {
  const Submitted: Message[] = [
    {
      role: "user",
      text: `Here is the key\n-----BEGIN PRIVATE KEY-----\n${PEM_HEAD}`,
      createdAt: DAY1,
    },
    { role: "user", text: PEM_BODY, createdAt: DAY1 },
    { role: "user", text: "-----END PRIVATE KEY-----\nthanks", createdAt: DAY1 },
  ];
  const Fragments = [PEM_HEAD.slice(0, 20), PEM_BODY];

  it("is a real gap: ordinary redaction leaks the body when it is stored before its BEGIN line", () => {
    const leaks = permutations(Submitted).filter((stored) =>
      redactSecretFields(["Plain title", ...stored.map((m) => m.text)])
        .join("\n")
        .includes(PEM_BODY),
    );
    expect(leaks.length).toBeGreaterThan(0);
  });

  it.each(
    permutations([0, 1, 2]),
  )("redacts a private key split over equal-timestamp messages stored in order %j", async (...order) => {
    const stored = order.map((at) => Submitted[at] as Message);
    const pod = await seed("Plain title", stored, ["a", "b", "c"]);
    const report = await new ChatWriter(pod).migrateRedaction();
    expect(report).toMatchObject({ failed: 0, conflicts: 0 });
    for (const fragment of Fragments) expect(pod.everything()).not.toContain(fragment);
    expect(await new ChatWriter(pod).migrateRedaction()).toMatchObject(CLEAN);
  });

  it.each(
    permutations([0, 1, 2]),
  )("recovers from every interruption with equal-timestamp messages stored in order %j", async (...order) => {
    const stored = order.map((at) => Submitted[at] as Message);
    await expectEveryInterruptionRecovers(
      () => seed("Plain title", stored, ["a", "b", "c"]),
      Fragments,
    );
  });

  it("recovers from every interruption when equal-timestamp messages are named by digest", async () => {
    await expectEveryInterruptionRecovers(() => seed("Plain title", Submitted), Fragments);
  });

  it.each([
    ["left", "right"],
    ["right", "left"],
  ])("redacts a secret split over two equal-timestamp messages stored %s first", async (...order) => {
    const halves: Record<string, Message> = {
      left: { role: "user", text: 'config password="sk-fixtureTieLeft', createdAt: DAY2 },
      right: { role: "user", text: 'fixtureTieRight"; y = 2', createdAt: DAY2 },
    };
    const pod = await seed(
      "Plain title",
      order.map((name) => halves[name] as Message),
      ["a", "b"],
    );
    expect(await new ChatWriter(pod).migrateRedaction()).toMatchObject({ failed: 0, conflicts: 0 });
    expect(pod.everything()).not.toContain("fixtureTieLeft");
    expect(pod.everything()).not.toContain("fixtureTieRight");
  });

  it("leaves unrelated equal-timestamp messages alone", async () => {
    const pod = await seed(
      "Plain title",
      [
        { role: "user", text: "hello there", createdAt: DAY1 },
        { role: "assistant", text: "general kenobi", createdAt: DAY1 },
      ],
      ["a", "b"],
    );
    pod.operations = 0;
    expect(await new ChatWriter(pod).migrateRedaction()).toMatchObject(CLEAN);
    expect(pod.operations).toBe(0);
  });

  it("keeps an already-redacted sibling that is not a copy, and collapses identical redacted duplicates", async () => {
    const pod = await seed(
      "Plain title",
      [
        { role: "user", text: "token ghp_fixtureSiblingToken123456 end.", createdAt: DAY1 },
        { role: "assistant", text: "noted [REDACTED] thanks", createdAt: DAY1 },
        { role: "assistant", text: "noted [REDACTED] thanks", createdAt: DAY1 },
      ],
      ["a", "b", "c"],
    );
    expect(await new ChatWriter(pod).migrateRedaction()).toMatchObject({ failed: 0, conflicts: 0 });
    expect(pod.everything()).not.toContain("ghp_fixtureSiblingToken123456");
    expect(pod.text(`${CHAT}m-b.ttl`)).toContain("noted [REDACTED] thanks");
    expect(pod.text(`${CHAT}m-c.ttl`)).toContain("noted [REDACTED] thanks");
  });

  it.each([
    70, 500,
  ])("leaves %i tied messages with no secret byte-identical, but reports them unverified", async (count) => {
    const pod = new FaultPod();
    const names = Array.from({ length: count }, (_, i) => `m${String(i).padStart(4, "0")}`);
    await new ChatWriter(pod).save({
      provider: "claude",
      conversationId: "thread-1",
      title: "Plain title",
      channel: "mcp",
      messages: names.map((id, i) => ({
        id,
        role: i % 2 ? "assistant" : "user",
        text: `plain note ${i}`,
        createdAt: DAY1,
      })),
    });
    const before = pod.snapshot();
    pod.operations = 0;
    const report = await new ChatWriter(pod).migrateRedaction();
    expect(pod.operations).toBe(0);
    expect(pod.snapshot()).toEqual(before);
    // Not proven for every stored order: never clean, on every run, until checked by hand.
    expect(report).toMatchObject({ failed: 1, unverified: 1, conflicts: 0, titles: 0 });
    expect(await new ChatWriter(pod).migrateRedaction()).toEqual(report);
    expect(await new ChatWriter(pod).migrateRedaction({ dryRun: true })).toMatchObject({
      failed: 1,
      unverified: 1,
    });
  });

  it("redacts a key block split over three of 70 tied messages and touches only what lies between", async () => {
    const messages: Message[] = Array.from({ length: 70 }, (_, i) => ({
      role: "user",
      text: `plain note ${i}`,
      createdAt: DAY1,
    }));
    (messages[10] as Message).text = `Key:\n-----BEGIN PRIVATE KEY-----\n${PEM_HEAD}`;
    (messages[40] as Message).text = PEM_BODY;
    (messages[60] as Message).text = "-----END PRIVATE KEY-----\nthanks";
    const ids = messages.map((_, i) => `m${String(i).padStart(3, "0")}`);
    const pod = await seed("Plain title", messages, ids);
    const before = new Map(pod.snapshot());
    const report = await new ChatWriter(pod).migrateRedaction();
    expect(report).toMatchObject({ failed: 1, unverified: 1, conflicts: 0 });
    expect(pod.everything()).not.toContain(PEM_BODY);
    expect(pod.everything()).not.toContain(PEM_HEAD.slice(0, 20));
    const after = new Map(pod.snapshot());
    const changed = ids.flatMap((id, i) =>
      before.get(`${CHAT}m-${id}.ttl`) === after.get(`${CHAT}m-${id}.ttl`) ? [] : [i],
    );
    expect(changed).toEqual(Array.from({ length: 51 }, (_, i) => i + 10));
    for (const i of [0, 9, 61, 69])
      expect(pod.text(`${CHAT}m-${ids[i]}.ttl`)).toContain(`plain note ${i}`);
    expect(await new ChatWriter(pod).migrateRedaction()).toMatchObject({
      failed: 1,
      unverified: 1,
    });
  });
});
