// AUTHORED-BY Claude Opus 4.8
import { describe, expect, it } from "vitest";
import {
  asContainer,
  folderDocument,
  mailRoot,
  messageDocument,
  messagesContainer,
  threadDocument,
  threadsContainer,
} from "../src/model/paths.js";

const POD = "https://pod.example/";
const POD_NO_SLASH = "https://pod.example";

describe("paths", () => {
  it("asContainer adds a trailing slash exactly once", () => {
    expect(asContainer("https://x.example")).toBe("https://x.example/");
    expect(asContainer("https://x.example/")).toBe("https://x.example/");
  });

  it("derives the mail root under the pod root (with or without slash)", () => {
    expect(mailRoot(POD)).toBe("https://pod.example/mail/");
    expect(mailRoot(POD_NO_SLASH)).toBe("https://pod.example/mail/");
  });

  it("derives the messages and threads containers (ending in /)", () => {
    expect(messagesContainer(POD)).toBe("https://pod.example/mail/messages/");
    expect(threadsContainer(POD)).toBe("https://pod.example/mail/threads/");
  });

  it("derives folder documents", () => {
    expect(folderDocument(POD, "inbox")).toBe("https://pod.example/mail/folders/inbox.ttl");
  });

  it("derives message and thread documents and url-encodes the id", () => {
    expect(messageDocument(POD, "m1")).toBe("https://pod.example/mail/messages/m1.ttl");
    expect(threadDocument(POD, "t1")).toBe("https://pod.example/mail/threads/t1.ttl");
    expect(messageDocument(POD, "a b")).toBe("https://pod.example/mail/messages/a%20b.ttl");
  });
});
