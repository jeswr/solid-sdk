// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import {
  AccessDeniedError,
  classifyReadError,
  DataControllerError,
  DataFormatError,
  NetworkError,
  NotFoundError,
} from "../src/errors.js";

describe("read-error taxonomy", () => {
  it("each class is a DataControllerError and carries the url + status", () => {
    const nf = new NotFoundError("https://pod.example/r", { status: 404 });
    expect(nf).toBeInstanceOf(DataControllerError);
    expect(nf).toBeInstanceOf(NotFoundError);
    expect(nf.url).toBe("https://pod.example/r");
    expect(nf.status).toBe(404);
    expect(nf.name).toBe("NotFoundError");
    expect(nf.message).toContain("https://pod.example/r");
  });

  it("instanceof discriminates between the four classes", () => {
    const errors = [
      new NotFoundError("u"),
      new AccessDeniedError("u"),
      new NetworkError("u"),
      new DataFormatError("u"),
    ];
    expect(errors.filter((e) => e instanceof NotFoundError)).toHaveLength(1);
    expect(errors.filter((e) => e instanceof AccessDeniedError)).toHaveLength(1);
    expect(errors.filter((e) => e instanceof NetworkError)).toHaveLength(1);
    expect(errors.filter((e) => e instanceof DataFormatError)).toHaveLength(1);
    // All four are the shared base.
    expect(errors.every((e) => e instanceof DataControllerError)).toBe(true);
  });

  it("preserves the cause", () => {
    const cause = new Error("boom");
    const e = new NetworkError("u", { cause });
    expect(e.cause).toBe(cause);
  });

  describe("classifyReadError", () => {
    it("passes through an existing DataControllerError unchanged", () => {
      const original = new NotFoundError("u", { status: 404 });
      expect(classifyReadError("u", original)).toBe(original);
    });

    it("404/410 → NotFound", () => {
      expect(classifyReadError("u", null, { status: 404 })).toBeInstanceOf(NotFoundError);
      expect(classifyReadError("u", null, { status: 410 })).toBeInstanceOf(NotFoundError);
    });

    it("401/403 → AccessDenied", () => {
      expect(classifyReadError("u", null, { status: 401 })).toBeInstanceOf(AccessDeniedError);
      expect(classifyReadError("u", null, { status: 403 })).toBeInstanceOf(AccessDeniedError);
    });

    it("a 2xx that threw → DataFormat (a parse failure, not network)", () => {
      expect(classifyReadError("u", new Error("bad turtle"), { status: 200 })).toBeInstanceOf(
        DataFormatError,
      );
      expect(classifyReadError("u", new Error("bad turtle"), { parsed: false })).toBeInstanceOf(
        DataFormatError,
      );
    });

    it("any other non-2xx → Network", () => {
      expect(classifyReadError("u", null, { status: 500 })).toBeInstanceOf(NetworkError);
      expect(classifyReadError("u", null, { status: 418 })).toBeInstanceOf(NetworkError);
    });

    it("no status, no parse hint → Network (a transport failure)", () => {
      expect(classifyReadError("u", new Error("ECONNREFUSED"))).toBeInstanceOf(NetworkError);
    });

    it("extracts a status off the error or its cause", () => {
      expect(classifyReadError("u", { status: 404 })).toBeInstanceOf(NotFoundError);
      expect(classifyReadError("u", { cause: { status: 403 } })).toBeInstanceOf(AccessDeniedError);
    });
  });
});
