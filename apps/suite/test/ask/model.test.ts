// AUTHORED-BY Codex (GPT-6.1 Sol)
import { expect, it, vi } from "vitest";
import { hostedAnswerModel } from "../../src/apps/ask/lib/model";

const passages = [
  {
    url: "https://pod.example/note",
    title: "Note",
    app: "notes",
    text: "Passport expires in 2028.",
    href: "/notes/n/private",
  },
];
it("sends exactly one question and selected evidence, with cancellation and no extra account data", async () => {
  const send = vi.fn(async () => Response.json({ text: "2028 [1]." }));
  const signal = new AbortController().signal;
  expect(await hostedAnswerModel(send).answer("passport?", passages, signal)).toBe("2028 [1].");
  const [url, init] = (send.mock.calls as unknown as [string, RequestInit][])[0] as [
    string,
    RequestInit,
  ];
  expect(url).toBe("/api/ask");
  expect(init.signal).toBe(signal);
  expect(init.cache).toBe("no-store");
  expect(JSON.parse(init.body as string)).toEqual({
    question: "passport?",
    passages: [
      { url: passages[0]?.url, title: "Note", app: "notes", text: "Passport expires in 2028." },
    ],
  });
});
it.each([
  [503, "not-configured"],
  [429, "rate-limited"],
  [502, "network"],
])("classifies HTTP %s without exposing content", async (status, code) => {
  await expect(
    hostedAnswerModel(async () => new Response("private", { status: status as number })).answer(
      "q",
      passages,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code });
});
it.each([
  {},
  null,
  { text: 4 },
  { text: " " },
  { text: "x".repeat(16001) },
])("rejects malformed provider output: %s", async (data) => {
  await expect(
    hostedAnswerModel(async () => Response.json(data)).answer(
      "q",
      passages,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "invalid" });
});
it("handles malformed JSON, network failures and aborts", async () => {
  await expect(
    hostedAnswerModel(async () => new Response("not json")).answer(
      "q",
      passages,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "invalid" });
  await expect(
    hostedAnswerModel(async () => {
      throw new Error("private");
    }).answer("q", passages, new AbortController().signal),
  ).rejects.toMatchObject({ code: "network" });
  const abort = new AbortController();
  abort.abort();
  await expect(
    hostedAnswerModel(async () => {
      throw new Error();
    }).answer("q", passages, abort.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    hostedAnswerModel(async () => Response.json({ text: "ok" })).answer(
      "q",
      passages,
      abort.signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
});
it("defaults to the same-origin browser transport", async () => {
  const send = vi.fn(async () => Response.json({ text: "2028 [1]." }));
  vi.stubGlobal("fetch", send);
  try {
    await hostedAnswerModel().answer("q", passages, new AbortController().signal);
    expect(send).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});
