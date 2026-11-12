// AUTHORED-BY Codex GPT-6
import { Store } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRdfSync, type Quad, RdfFetchError } from "../src/index.js";

const baseIRI = "https://pod.example/doc";
const turtle = '<#s> <#p> "café" .';
afterEach(() => vi.restoreAllMocks());

describe("parseRdfSync", () => {
  it("observes document order and duplicates before dataset ordering/deduplication", () => {
    const quads: Quad[] = [];
    const body = '<#later> <#p> "mentioned first" . <#s> <#p> <#first>, <#later>, <#first> .';
    const store = parseRdfSync(body, { baseIRI, onQuad: (quad) => quads.push(quad) });
    expect(quads.map((quad) => quad.object.value)).toEqual([
      "mentioned first",
      `${baseIRI}#first`,
      `${baseIRI}#later`,
      `${baseIRI}#first`,
    ]);
    expect(store.size).toBe(3);
  });

  it("does not emit observations from malformed syntax and wraps observer failures", () => {
    const onQuad = vi.fn();
    expect(() => parseRdfSync(`${turtle} not turtle .`, { baseIRI, onQuad })).toThrow(
      RdfFetchError,
    );
    expect(onQuad).not.toHaveBeenCalled();
    const reason = new Error("observer failed");
    expect(() =>
      parseRdfSync(turtle, {
        baseIRI,
        onQuad: () => {
          throw reason;
        },
      }),
    ).toThrow(expect.objectContaining({ cause: reason }));
  });

  it("returns a store synchronously and resolves relative IRIs", () => {
    const store = parseRdfSync(turtle, { baseIRI, format: "text/turtle" });
    expect(store).toBeInstanceOf(Store);
    expect([...store][0]?.subject.value).toBe(`${baseIRI}#s`);
    expect([...store][0]?.object.value).toBe("café");
    expect(parseRdfSync("").size).toBe(0);
  });

  it.each([
    ["application/n-triples", '<https://ex/s> <https://ex/p> "o" .'],
    ["application/n-quads", '<https://ex/s> <https://ex/p> "o" <https://ex/g> .'],
    ["application/trig", '<#g> { <#s> <#p> "o" . }'],
  ] as const)("supports explicit %s", (format, body) => {
    expect(parseRdfSync(body, { baseIRI, format }).size).toBe(1);
  });

  it("retains n3 automatic syntax detection only when format is omitted", () => {
    const quad = '<#s> <#p> "o" <#g> .';
    const trig = '<#g> { <#s> <#p> "o" . }';
    expect(parseRdfSync(quad, { baseIRI }).size).toBe(1);
    expect(parseRdfSync(trig, { baseIRI }).size).toBe(1);
    for (const body of [quad, trig]) {
      expect(() => parseRdfSync(body, { baseIRI, format: "text/turtle" })).toThrow(RdfFetchError);
    }
  });

  it("rejects malformed input as a structured parse error", () => {
    expect(() => parseRdfSync("not turtle .", { baseIRI })).toThrow(RdfFetchError);
    try {
      parseRdfSync("not turtle .", { baseIRI });
    } catch (error) {
      expect(error).toMatchObject({
        url: baseIRI,
        contentType: "text/turtle",
        cause: expect.any(Error),
      });
    }
  });

  it("rejects JSON-LD and unsupported formats without loading contexts", () => {
    for (const format of ["application/ld+json", "text/html"]) {
      // @ts-expect-error Runtime callers cannot bypass the synchronous syntax boundary.
      expect(() => parseRdfSync("{}", { format })).toThrow(RdfFetchError);
    }
  });

  it("counts UTF-8 bytes and accepts the exact boundary", () => {
    const maxBytes = new TextEncoder().encode(turtle).length;
    expect(parseRdfSync(turtle, { baseIRI, maxBytes }).size).toBe(1);
    expect(() => parseRdfSync(turtle, { baseIRI, maxBytes: maxBytes - 1 })).toThrow(
      expect.objectContaining({ code: "PARSE_LIMIT" }),
    );
  });

  it("counts duplicate quads before store deduplication", () => {
    expect(parseRdfSync(turtle.repeat(2), { baseIRI, maxQuads: 2 }).size).toBe(1);
    expect(() => parseRdfSync(turtle.repeat(2), { baseIRI, maxQuads: 1 })).toThrow(
      expect.objectContaining({ code: "PARSE_LIMIT" }),
    );
  });

  it.each([
    { maxBytes: -1 },
    { maxQuads: 0.5 },
    { maxTermLength: Infinity },
    { maxTotalTermLength: -1 },
    { maxTermLength: 1 },
    { maxTotalTermLength: 1 },
  ])("enforces valid term and quad budgets: %j", (limits) => {
    expect(() => parseRdfSync(turtle, { baseIRI, ...limits })).toThrow(
      expect.objectContaining({ code: "PARSE_LIMIT" }),
    );
  });

  it("throws the original abort reason before work and during parsing", () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);
    expect(() => parseRdfSync(turtle, { signal: controller.signal })).toThrow(reason);
    const live = new AbortController();
    let checks = 0;
    expect(() =>
      parseRdfSync(turtle, {
        baseIRI,
        signal: live.signal,
        check: () => {
          if (++checks === 3) live.abort(reason);
        },
      }),
    ).toThrow(reason);
  });

  it("checks the caller's deadline inside parsing, before store construction", () => {
    const reason = new Error("deadline");
    const insert = vi.spyOn(Store.prototype, "addQuad");
    let checks = 0;
    expect(() =>
      parseRdfSync(turtle, {
        baseIRI,
        check: () => {
          if (++checks === 3) throw reason;
        },
      }),
    ).toThrow(expect.objectContaining({ cause: reason }));
    expect(insert).not.toHaveBeenCalled();
  });

  it("checks before each store insertion and before returning the dataset", () => {
    const add = Store.prototype.addQuad;
    let inserted = 0;
    vi.spyOn(Store.prototype, "addQuad").mockImplementation(function (this: Store, ...args) {
      inserted++;
      return add.apply(this, args);
    });
    const reason = new Error("deadline");
    for (const body of [turtle, turtle.repeat(4)]) {
      inserted = 0;
      expect(() =>
        parseRdfSync(body, {
          baseIRI,
          check: () => {
            if (inserted >= 1) throw reason;
          },
        }),
      ).toThrow(expect.objectContaining({ cause: reason }));
      expect(inserted).toBe(1);
    }
  });

  it("preserves non-Error abort reasons", () => {
    const signal = AbortSignal.abort("stop");
    try {
      parseRdfSync(turtle, { signal });
      expect.fail("aborted parse returned");
    } catch (reason) {
      expect(reason).toBe("stop");
    }
  });
});
