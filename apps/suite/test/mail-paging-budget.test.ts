// AUTHORED-BY Claude Sonnet 5.5
import { expect, it, vi } from "vitest";
import { Message, pageThreads, threadMessages } from "../src/apps/mail/lib/model";
import { emptyMailbox } from "./mail/helpers";

const url = "https://mail.example/mail/personal/all.ttl";

function accessor(): object {
  let owner: object | null = Message.prototype;
  while (owner && !Object.getOwnPropertyDescriptor(owner, "partOfThread"))
    owner = Object.getPrototypeOf(owner);
  return owner as object;
}

it("pages and expands threads in a 3,000-message folder within a linear access budget", () => {
  const mailbox = emptyMailbox();
  const folder = mailbox.createFolder(`${url}#inbox`);
  for (let i = 0; i < 1500; i++) {
    const thread = mailbox.createThread(`${url}#thread-${i}`);
    for (let j = 0; j < 2; j++) {
      const message = mailbox.createMessage(`${url}#message-${i}-${j}`);
      message.dateSent = new Date(Date.UTC(2026, 0, 1) + (i * 2 + j) * 1000);
      if (j === 0) message.partOfThread = thread.value;
      else thread.addMessage(message.value); // Membership only: no back-link.
      folder.addMessage(message.value);
    }
  }
  const owner = accessor();
  const getter = Object.getOwnPropertyDescriptor(owner, "partOfThread")?.get as () => unknown;
  let reads = 0;
  const spy = vi.spyOn(owner as Message, "partOfThread", "get").mockImplementation(function (
    this: Message,
  ) {
    if (++reads > 20_000) throw new Error("Repeated whole-mailbox thread scans");
    return getter.call(this) as string | undefined;
  });
  try {
    const start = performance.now();
    const page = pageThreads(mailbox, folder.value, 0, 50);
    expect(page.total).toBe(1500);
    expect(page.items[0]?.messages).toHaveLength(2);
    expect(threadMessages(mailbox, `${url}#thread-7`).map((m) => m.value)).toEqual([
      `${url}#message-7-0`,
      `${url}#message-7-1`,
    ]);
    expect(performance.now() - start).toBeLessThan(5_000);
  } finally {
    spy.mockRestore();
  }
});
