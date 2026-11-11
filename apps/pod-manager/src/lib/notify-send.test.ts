// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test, vi } from "vitest";
import { NoInboxError, NotificationSendError } from "./errors.js";
import { sendNotification } from "./notify-send.js";

const recipient = "https://8.8.8.8/profile#me";
const inbox = "https://8.8.4.4/inbox/";
const args = { recipientWebId: recipient, actorWebId: "https://alice.example/#me" };
function transport(status = 201, target = inbox) {
  return vi.fn<typeof fetch>().mockImplementation(async (_input, init) =>
    init?.method === "POST"
      ? new Response(null, { status })
      : new Response(`<${recipient}> <http://www.w3.org/ns/ldp#inbox> <${target}>.`, {
          headers: { "content-type": "text/turtle" },
        }),
  );
}

test("delivers invitations and RSVP content through the real SDK sender with cached discovery", async () => {
  const fetch = transport();
  await expect(
    sendNotification(
      {
        ...args,
        type: "Invite",
        object: "https://alice.example/room/",
        summary: " Join ",
        content: " Response URL ",
      },
      fetch,
    ),
  ).resolves.toEqual({ inbox });
  await sendNotification(args, fetch);
  expect(fetch).toHaveBeenCalledTimes(3);
  const init = fetch.mock.calls[1][1];
  expect.assert(init);
  expect(new Headers(init.headers).get("content-type")).toBe("application/ld+json");
  expect(init.redirect).toBe("manual");
  expect(JSON.parse(init.body as string)).toMatchObject({
    type: "Invite",
    actor: args.actorWebId,
    object: "https://alice.example/room/",
    summary: "Join",
    content: "Response URL",
  });
  expect(JSON.parse(fetch.mock.calls[2][1]?.body as string)).not.toHaveProperty("object");
});

test("adapts missing inboxes and structured delivery failures to UI errors", async () => {
  const missing = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("", { headers: { "content-type": "text/turtle" } }));
  await expect(sendNotification(args, missing)).rejects.toBeInstanceOf(NoInboxError);
  for (const status of [403, 500, 307]) {
    await expect(sendNotification(args, transport(status))).rejects.toBeInstanceOf(
      NotificationSendError,
    );
  }
});

test.each([
  "https://127.0.0.1/inbox/",
  "http://169.254.169.254/",
  "https://user:pass@8.8.4.4/inbox/",
])("refuses unsafe inbox %s without POSTing", async (target) => {
  const fetch = transport(201, target);
  await expect(sendNotification(args, fetch)).rejects.toBeInstanceOf(NotificationSendError);
  expect(fetch.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
});

test("refuses a transport that followed a redirect despite manual mode", async () => {
  const fetch = transport();
  fetch.mockImplementationOnce(
    async () =>
      new Response(`<${recipient}> <http://www.w3.org/ns/ldp#inbox> <${inbox}>.`, {
        headers: { "content-type": "text/turtle" },
      }),
  );
  fetch.mockImplementationOnce(async () => {
    const response = new Response(null, { status: 201 });
    Object.defineProperty(response, "url", { value: "https://1.1.1.1/collect" });
    return response;
  });
  await expect(sendNotification(args, fetch)).rejects.toBeInstanceOf(NotificationSendError);
});
