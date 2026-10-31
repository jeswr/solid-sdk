// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import {
  DEFAULT_MIME_LIMITS,
  headerValues,
  leaves,
  parseMime,
  shapeOf,
} from "../src/email/mime.js";

const multipart = (parts: string[], closed = true) =>
  `Content-Type: multipart/mixed; boundary="boundary"\r\n\r\npreamble\r\n--boundary \t\r\n${parts.join("\r\n--boundary\r\n")}\r\n${closed ? "--boundary--\r\nepilogue" : ""}`;
const limits = DEFAULT_MIME_LIMITS;
it("parses bounded folded headers, charset and content-type parameters, all supported transfer encodings and LF", () => {
  const raw = multipart([
    'X-Empty:\r\nContent-Type: text/plain; charset=utf-8; ignored; foo="bar"\r\nX-Test: first\r\n continuation\r\n\r\nhello\r\n',
    "Content-Type: text/plain\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nhello=20world=\r\n!",
    "Content-Type: application/ld+json; charset=utf8\r\nContent-Transfer-Encoding: base64\r\n\r\ne30=\t ",
    "Content-Transfer-Encoding: 8bit\r\n\r\nhello",
    "Content-Transfer-Encoding: binary\r\n\r\nworld",
  ]);
  for (const input of [raw, raw.replace(/\r\n/g, "\n"), Buffer.from(raw)]) {
    const result = parseMime(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.detail);
    expect(shapeOf(result.root)).toBe(
      "multipart/mixed(text/plain,text/plain,application/ld+json,text/plain,text/plain)",
    );
    const parts = leaves(result.root);
    expect(parts.map((p) => p.text)).toEqual(["hello", "hello world!", "{}", "hello", "world"]);
    expect(headerValues(parts[0]!, "x-test")).toEqual(["first continuation"]);
    expect(parts[0]!.params.foo).toBe("bar");
  }
  expect(parseMime("X-Header: value\n\nbody\r\n\r\n")).toMatchObject({ ok: true });
  expect(parseMime("X-Header: value")).toMatchObject({ ok: true, root: { text: "" } });
  expect(parseMime("\n\nbody")).toMatchObject({ ok: true, root: { text: "body" } });
  expect(parseMime("Content-Type: multipart/mixed; boundary=b\n\n--b--")).toMatchObject({
    ok: true,
    root: { children: [] },
  });
});

it.each([
  [" folded: before header\r\n\r\nbody", "continuation"],
  ["badheader\r\n\r\nbody", "malformed header"],
  ["bad header: value\r\n\r\nbody", "invalid header name"],
  ["Content-Type: invalid\r\n\r\nbody", "content type"],
  ["Content-Type: text/plain\r\nContent-Type: text/html\r\n\r\nbody", "duplicate Content-Type"],
  [
    "Content-Transfer-Encoding: 7bit\r\nContent-Transfer-Encoding: 8bit\r\n\r\nbody",
    "duplicate Content-Transfer",
  ],
  ["Content-Type: multipart/mixed\r\n\r\nbody", "boundary"],
  ['Content-Type: multipart/mixed; boundary="bad<>"\r\n\r\nbody', "boundary"],
  [multipart(["\r\nbody"], false), "closing delimiter"],
  ["Content-Transfer-Encoding: base64\r\n\r\n%bad", "base64"],
  ["Content-Transfer-Encoding: base64\r\n\r\ne30", "base64"],
  ["Content-Transfer-Encoding: quoted-printable\r\n\r\n=ZZ", "quoted-printable"],
  ["Content-Transfer-Encoding: zstd\r\n\r\nbody", "encoding"],
  ["Content-Type: text/plain; charset=iso-8859-1\r\n\r\nbody", "charset"],
  ["Content-Transfer-Encoding: base64\r\n\r\n/w==", "UTF-8"],
])("refuses malformed MIME (%s)", (raw, detail) => {
  expect(parseMime(raw)).toMatchObject({ ok: false, detail: expect.stringContaining(detail) });
});

it("enforces aggregate byte, part, header and nesting caps", () => {
  expect(parseMime("bytes", { ...limits, maxBytes: 1 })).toMatchObject({
    ok: false,
    detail: expect.stringContaining("exceeds"),
  });
  expect(parseMime("A: 1\r\nB: 2\r\n\r\n", { ...limits, maxHeaders: 1 })).toMatchObject({
    ok: false,
    detail: "too many headers",
  });
  expect(parseMime(multipart(["\r\nbody"]), { ...limits, maxParts: 1 })).toMatchObject({
    ok: false,
    detail: "too many MIME parts",
  });
  expect(parseMime(multipart(["\r\nbody"]), { ...limits, maxDepth: 0 })).toMatchObject({
    ok: false,
    detail: "MIME nesting too deep",
  });
  expect(
    parseMime("A:1\n\nx", {
      ...limits,
      get maxDepth(): number {
        throw new Error("invalid limits");
      },
    }),
  ).toEqual({ ok: false, detail: "unparseable MIME" });
});
