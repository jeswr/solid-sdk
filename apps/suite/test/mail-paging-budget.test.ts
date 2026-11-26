// AUTHORED-BY Claude Sonnet 5.5
import { expect, it, vi } from "vitest";
import { Folder, Message, pageThreads, threadMessages } from "../src/apps/mail/lib/model";
import { emptyMailbox } from "./mail/helpers";

const url = "https://mail.example/mail/personal/all.ttl";

function accessor(proto: object, name: string): object {
  let owner: object | null = proto;
  while (owner && !Object.getOwnPropertyDescriptor(owner, name))
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
  const owner = accessor(Message.prototype, "partOfThread");
  const getter = Object.getOwnPropertyDescriptor(owner, "partOfThread")?.get as () => unknown;
  let reads = 0;
  const spy = vi.spyOn(owner as Message, "partOfThread", "get").mockImplementation(function (
    this: Message,
  ) {
    if (++reads > 20_000) throw new Error("Repeated whole-mailbox thread scans");
    return getter.call(this) as string | undefined;
  });
  // Generated live sets revalidate every member on `has`, so a per-message `has` is quadratic.
  // Count the real cost: membership probes on the folder's live set and reads of the getter.
  const folderOwner = accessor(Folder.prototype, "messageIris");
  const folderGetter = Object.getOwnPropertyDescriptor(folderOwner, "messageIris")
    ?.get as () => Set<string>;
  let folderReads = 0;
  let liveHas = 0;
  const folderSpy = vi
    .spyOn(folderOwner as Folder, "messageIris", "get")
    .mockImplementation(function (this: Folder) {
      folderReads++;
      const live = folderGetter.call(this);
      return new Proxy(live, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (prop === "has") liveHas++;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
    });
  try {
    const page = pageThreads(mailbox, folder.value, 0, 50);
    expect(page.total).toBe(1500);
    expect(page.items[0]?.messages).toHaveLength(2);
    expect(threadMessages(mailbox, `${url}#thread-7`).map((m) => m.value)).toEqual([
      `${url}#message-7-0`,
      `${url}#message-7-1`,
    ]);
    // Constant, not proportional to the 3,000 messages: one snapshot read, no live `has`.
    expect(folderReads).toBeLessThanOrEqual(2);
    expect(liveHas).toBe(0);
  } finally {
    folderSpy.mockRestore();
    spy.mockRestore();
  }
});
