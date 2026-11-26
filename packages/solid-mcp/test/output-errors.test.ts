// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { podOutputError } from "../src/output.js";

describe("podOutputError", () => {
  it.each([
    "Audit protection unavailable",
    "Memory protection unavailable",
    "Chat protection unavailable",
  ])("passes the fixed %s refusal through", (message) => {
    expect(podOutputError(new Error(message)).message).toBe(message);
  });

  it.each([
    new Error("Chat protection unavailable: https://pod.example/private/chats/.acl"),
    new Error("chat protection unavailable"),
    "Chat protection unavailable ",
  ])("keeps near-miss and value-bearing messages generic", (error) => {
    expect(podOutputError(error).message).toBe("Pod operation failed");
  });
});
