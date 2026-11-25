// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, test } from "vitest";
import { encodesPlainCharacter, isAuxiliaryResourceTarget } from "./index.js";

describe("shared auxiliary resource targets", () => {
  test.each([
    "%61",
    "%30",
    "%2e",
    "%5F",
    "%7e",
    "%2D",
    "%2f",
    "%5C",
    "%25",
  ])("recognises ambiguous percent escape %s", (encoded) => {
    expect(encodesPlainCharacter(`/data/a${encoded}b`)).toBe(true);
    expect(isAuxiliaryResourceTarget(`/data/a${encoded}b`)).toBe(true);
  });
  test.each([
    "/data/plain.txt",
    "/data/a%20b",
    "/data/caf%C3%A9",
    "/data/%40name",
    "/data/%",
    "/data/%zz",
    "/data/folder/",
    "",
  ])("permits ordinary path %s", (path) => {
    expect(encodesPlainCharacter(path)).toBe(false);
    expect(isAuxiliaryResourceTarget(path)).toBe(false);
  });
  test.each([
    "/data/.acl",
    "/data/x.ACL",
    "/data/x.acr",
    "/data/x.meta",
    "/data/x.acl/",
    "/data/x.acl//",
    "/data/x;y",
    "/data/x?",
    "/data/x#",
    "/data/x\\y",
    "/data/x.",
    "/data/x ",
    "/data/x./child",
    "/data/x /child",
    "/data/x%20",
    "/data/x%20/child",
    "/data/x%3By",
    "/data/x%3fy",
    "/data/x%23y",
    "/data/x%252Eacl",
    "/data/x.ac%6C",
  ])("refuses auxiliary or ambiguous target %s", (path) => {
    expect(isAuxiliaryResourceTarget(path)).toBe(true);
    expect(isAuxiliaryResourceTarget(`https://pod.example${path}`)).toBe(true);
  });
});
