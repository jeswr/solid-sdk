// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  getMoveValidity,
  ListError,
  type ListErrorCode,
  type MoveEntry,
} from "../src/apps/drive/lib/list";

function folder(path: string): MoveEntry {
  return { url: `https://example.org${path}`, kind: "container" };
}
function file(path: string): MoveEntry {
  return { url: `https://example.org${path}`, kind: "resource" };
}
const work = Object.freeze(folder("/drive/Work/"));
const archive = Object.freeze(folder("/drive/Archive/"));
function fails(run: () => unknown, code: ListErrorCode): void {
  expect(run).toThrow(ListError);
  expect(run).toThrow(expect.objectContaining({ code }));
}

describe("Drive move topology", () => {
  it("allows moves to siblings, ancestors, root and other origins without mutation", () => {
    const sources = Object.freeze([work, Object.freeze(file("/drive/report.pdf"))]);
    for (const target of [
      archive,
      folder("/drive/"),
      folder("/"),
      { url: "https://other.example.org/drive/Work/nested/", kind: "container" } as const,
    ]) {
      expect(getMoveValidity(sources, target)).toEqual({ valid: true });
    }
    expect(sources).toEqual([work, file("/drive/report.pdf")]);
    expect(getMoveValidity([folder("/")], folder("/drive/"))).toEqual({
      valid: false,
      reason: "descendant",
    });
    expect(getMoveValidity([folder("/")], folder("/"))).toEqual({ valid: false, reason: "self" });
  });

  it("rejects self/descendant moves for any selected folder", () => {
    expect(getMoveValidity([work], work)).toEqual({ valid: false, reason: "self" });
    expect(getMoveValidity([work], folder("/drive/Work/nested/deeper/"))).toEqual({
      valid: false,
      reason: "descendant",
    });
    expect(getMoveValidity([archive, work], folder("/drive/Work/nested/"))).toEqual({
      valid: false,
      reason: "descendant",
    });
    expect(getMoveValidity([file("/drive/report.pdf")], work)).toEqual({ valid: true });
    expect(getMoveValidity([work], file("/drive/other.txt"))).toEqual({
      valid: false,
      reason: "not-folder",
    });
  });

  it.each([
    [file("/drive/name"), folder("/drive/name/")],
    [folder("/drive/name/"), file("/drive/name")],
  ])("distinguishes file and folder sources with the same path (%j, %j)", (...sources) => {
    expect(getMoveValidity(sources, folder("/archive/"))).toEqual({ valid: true });
    expect(getMoveValidity(sources, folder("/drive/name/"))).toEqual({
      valid: false,
      reason: "self",
    });
    expect(getMoveValidity(sources, folder("/drive/name/child/"))).toEqual({
      valid: false,
      reason: "descendant",
    });
  });

  it("compares complete, case-sensitive decoded path segments and canonical origins", () => {
    expect(getMoveValidity([work], folder("/drive/Workshop/"))).toEqual({ valid: true });
    expect(getMoveValidity([work], folder("/drive/work/"))).toEqual({ valid: true });
    expect(
      getMoveValidity([work], { url: "https://EXAMPLE.ORG:443/drive/%57ork/", kind: "container" }),
    ).toEqual({ valid: false, reason: "self" });
    expect(getMoveValidity([folder("/drive/Caf%C3%A9/")], folder("/drive/Café/nested/"))).toEqual({
      valid: false,
      reason: "descendant",
    });
    expect(
      getMoveValidity([work], { url: "http://example.org/drive/Work/", kind: "container" }),
    ).toEqual({ valid: true });
    expect(
      getMoveValidity([work], { url: "https://example.org:8443/drive/Work/", kind: "container" }),
    ).toEqual({ valid: true });
    expect(getMoveValidity([file("/drive/name")], folder("/drive/name/"))).toEqual({ valid: true });
    expect(getMoveValidity([file("/drive/name")], folder("/drive/name/child/"))).toEqual({
      valid: true,
    });
    expect(getMoveValidity([folder("/drive/a%23b/")], folder("/drive/a%23b/child/"))).toEqual({
      valid: false,
      reason: "descendant",
    });
  });

  it.each([
    "relative/",
    "ftp://example.org/drive/",
    "https://example.org",
    "https:///drive/",
    "https://[invalid]/drive/",
    "https://example.org/drive/../Work/",
    "https://example.org/drive/./",
    "https://example.org/drive/%2e%2E/",
    "https://example.org/drive/.%2e/",
    "https://example.org//drive/",
    "https://example.org/drive/%2FWork/",
    "https://example.org/drive/%5cWork/",
    "https://example.org/drive/%252e/",
    "https://example.org/drive/%invalid/",
    "https://example.org/drive/%FF/",
    "https://example.org/drive/%00/",
    "https://example.org/drive/%7f/",
    "https://example.org/drive\\Work/",
    "https://example.org/drive/Work/?view=1",
    "https://example.org/drive/Work/?",
    "https://example.org/drive/Work/#it",
    "https://example.org/drive/Work/#",
    "https://user:password@example.org/drive/",
    "https://:password@example.org/drive/",
    "https://user@example.org/drive/",
    " https://example.org/drive/",
    "https://example.org/drive/with space/",
    "https://example.org/drive/\n",
    "https://example.org/drive/Work",
    "",
    7,
    "https://example.org/\ud800/",
  ])("rejects unsupported/ambiguous URLs (%j)", (url) => {
    const bad = { url, kind: "container" } as MoveEntry;
    fails(() => getMoveValidity([bad], archive), "unsupported-url");
    fails(() => getMoveValidity([work], bad), "unsupported-url");
  });

  it("requires resources without trailing slash and validates all sources before returning invalid", () => {
    fails(() => getMoveValidity([file("/drive/file/")], archive), "unsupported-url");
    fails(() => getMoveValidity([work, folder("/drive/../bad/")], work), "unsupported-url");
    fails(
      () => getMoveValidity([folder("/drive/../bad/")], file("/drive/file")),
      "unsupported-url",
    );
  });

  it.each([
    null,
    [],
    [null],
    new Array(1),
    [{ url: "https://example.org/drive/", kind: "unknown" }],
    [work, work],
    [work, { url: "https://EXAMPLE.ORG:443/drive/%57ork/", kind: "container" }],
    [file("/drive/name"), file("/drive/name")],
    [file("/drive/name"), { url: "https://EXAMPLE.ORG:443/drive/%6Eame", kind: "resource" }],
  ])("rejects malformed/empty/duplicate sources (%j)", (sources) => {
    fails(() => getMoveValidity(sources as MoveEntry[], archive), "invalid-move");
  });

  it("rejects malformed targets without exposing input in errors", () => {
    fails(() => getMoveValidity([work], null as unknown as MoveEntry), "invalid-move");
    fails(
      () =>
        getMoveValidity([work], {
          url: "https://example.org/",
          kind: "folder",
        } as unknown as MoveEntry),
      "invalid-move",
    );
    fails(() => getMoveValidity([work], [] as unknown as MoveEntry), "invalid-move");
  });
});
