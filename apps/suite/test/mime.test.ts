// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { MimeParseError, parseMimeMessage, sanitizeMessageHtml } from "../src/apps/mail/lib/mime";

const fixture = (name: string) => readFile(new URL(`./fixtures/mime/${name}.eml`, import.meta.url));

describe("RFC 5322 and MIME parsing", () => {
  it("unfolds and decodes headers, preserving duplicate fields and structured raw values", async () => {
    const message = await parseMimeMessage(await fixture("headers"));
    expect(message.subject).toBe("A synthetic ✓ message");
    expect(message.from).toEqual({ name: "Zoë Example", address: "zoe@example.org" });
    expect(message.sender).toEqual({ name: "Fictional Relay", address: "relay@example.org" });
    expect(message.to).toEqual([
      {
        name: "Friends",
        group: [
          { name: "River, Alex", address: "alex@example.org" },
          { name: "", address: "robin@example.org" },
        ],
      },
      { name: "Morgan Example", address: "morgan@example.org" },
    ]);
    expect(message.cc).toEqual([{ name: "Sam Example", address: "sam@example.org" }]);
    expect(message.bcc).toEqual([{ name: "", address: "hidden@example.org" }]);
    expect(message.replyTo).toEqual([{ name: "", address: "reply@example.org" }]);
    expect(message.date).toBe("2026-10-25T10:34:56.000Z");
    expect(message.messageId).toBe("<sample-1@example.org>");
    expect(message.inReplyTo).toBe("<sample-0@example.org>");
    expect(message.references).toBe("<sample-root@example.org> <sample-0@example.org>");
    expect(message.headers.filter((header) => header.name === "x-label")).toEqual([
      { name: "x-label", rawValue: "=?ISO-8859-1?Q?caf=E9?=", value: "café" },
      { name: "x-label", rawValue: "second", value: "second" },
    ]);
    expect(message.headers.find((header) => header.name === "subject")?.rawValue).not.toMatch(
      /[\r\n]/,
    );
    expect(message.text).toBe("Hello, fictional friends.\nThis is synthetic mail.\n");
    expect(message.html).toBeNull();
    expect(message.attachments).toEqual([]);
  });

  it("extracts mixed/alternative/related bodies, attachment bytes and CID metadata", async () => {
    const message = await parseMimeMessage(await fixture("multipart"));
    expect(message.text).toBe("Hello café ✓.\nA softbreak.");
    expect(message.html).toContain("<p>Hello <strong>café ✓</strong>.</p>");
    expect(message.html).toContain('data-inline-cid="logo@example.org"');
    expect(message.html).not.toContain("src=");
    expect(message.attachments).toHaveLength(5);
    expect(message.attachments[0]).toEqual({
      filename: "logo.png",
      contentType: "image/png",
      disposition: null,
      description: null,
      contentId: "logo@example.org",
      inline: true,
      size: 8,
      content: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    expect(message.attachments[1]).toEqual({
      filename: "fictional café.pdf",
      contentType: "application/pdf",
      disposition: "attachment",
      description: "Fictional résumé",
      contentId: null,
      inline: false,
      size: 15,
      content: new TextEncoder().encode("%PDF-synthetic\n"),
    });
    expect(message.attachments[2]?.filename).toBe("notes ✓.txt");
    expect(new TextDecoder().decode(message.attachments[2]?.content)).toBe("Attachment ✓");
    expect(message.attachments[3]).toMatchObject({
      filename: null,
      contentType: "application/octet-stream",
      size: 4,
      inline: false,
      content: new Uint8Array([0, 1, 2, 255]),
    });
    expect(message.attachments[4]).toMatchObject({
      filename: "inline.gif",
      contentId: "extra@example.org",
      disposition: "inline",
      inline: true,
    });
    expect(message.text).not.toMatch(/preamble|epilogue|Attachment/);
  });

  it("extracts HTML-only mail without active HTML or an invented plain-text body", async () => {
    const message = await parseMimeMessage(await fixture("html-only"));
    expect(message.text).toBe("");
    expect(message.html).toContain("<p>Hello <strong>Dana</strong> &amp; Kit.</p>");
    expect(message.html).toContain('<a href="https://example.org/read">Read more</a>');
    expect(message.html).not.toMatch(
      /<script|<style|<iframe|<object|<svg|<form|<input|<base|<link|<meta|src=|srcset=|onload=|onerror=|style=|ping=|javascript:|Sentinel/,
    );
  });

  it("honors related start IDs case-sensitively and preserves supporting text as resource bytes", async () => {
    const message = await parseMimeMessage(await fixture("related-html"));
    expect(message.text).toBe("");
    expect(message.html).toBe('<p>Root body</p><img alt="" data-inline-cid="root@example.org" />');
    expect(message.attachments).toEqual([
      {
        filename: "support.html",
        contentType: "text/html",
        disposition: "inline",
        description: "Auxiliary café",
        contentId: "root@example.org",
        inline: true,
        size: 21,
        content: new Uint8Array([
          ...new TextEncoder().encode("<p>Auxiliary caf"),
          233,
          ...new TextEncoder().encode("</p>"),
        ]),
      },
      {
        filename: null,
        contentType: "text/plain",
        disposition: null,
        description: null,
        contentId: "notes@example.org",
        inline: true,
        size: 14,
        content: new TextEncoder().encode("Resource notes"),
      },
    ]);
  });

  it.each([
    "",
    '; start="<missing@example.org>"',
  ])("uses the first related child when start is absent or unresolved: %s", async (start) => {
    const message = await parseMimeMessage(
      `Content-Type: multipart/related; boundary=x${start}\n\n--x\nContent-Type: text/html\n\n<p>Root</p>\n--x\nContent-Type: text/html\nContent-ID: <support@example.org>\n\n<p>Support</p>\n--x--`,
    );
    expect(message.html).toBe("<p>Root</p>");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({
      contentType: "text/html",
      contentId: "support@example.org",
      inline: true,
      content: new TextEncoder().encode("<p>Support</p>"),
    });
  });

  it("selects the last repeated media types and replaces outer fallbacks with nested alternatives", async () => {
    const message = await parseMimeMessage(await fixture("nested-alternatives"));
    expect(message.text).toBe("Preferred plain café");
    expect(message.html).toBe("<p>Preferred HTML</p>");
    expect(message.attachments).toEqual([]);
  });

  it.each(["plain", "html"])("selects the last of two text/%s alternatives", async (type) => {
    const message = await parseMimeMessage(
      `Content-Type: multipart/alternative; boundary=x\n\n--x\nContent-Type: text/${type}\n\nEarlier\n--x\nContent-Type: text/${type}\n\nPreferred\n--x--`,
    );
    expect(message.text).toBe(type === "plain" ? "Preferred" : "");
    expect(message.html).toBe(type === "html" ? "Preferred" : null);
    expect(message.attachments).toEqual([]);
  });

  it.each(["plain", "html"])("allows an empty preferred text/%s alternative", async (type) => {
    const message = await parseMimeMessage(
      `Content-Type: multipart/alternative; boundary=x\n\n--x\nContent-Type: text/${type}\n\nEarlier\n--x\nContent-Type: text/${type}\n\n--x--`,
    );
    expect(message.text).toBe("");
    expect(message.html).toBe(type === "html" ? "" : null);
  });

  it("keeps resources of selected related alternatives without duplicating them across body types", async () => {
    const message = await parseMimeMessage(
      'Content-Type: multipart/alternative; boundary=a\n\n--a\nContent-Type: multipart/related; boundary=r\n\n--r\nContent-Type: text/html\n\n<p>Old</p>\n--r\nContent-Type: image/png\nContent-ID: <old@example.org>\n\nold\n--r--\n--a\nContent-Type: multipart/related; boundary=s; start="<body@example.org>"\n\n--s\nContent-Type: multipart/alternative; boundary=b\nContent-ID: <body@example.org>\n\n--b\nContent-Type: text/plain\n\nCurrent\n--b\nContent-Type: text/html\n\n<p>Current</p>\n--b--\n--s\nContent-Type: text/html\nContent-ID: <current@example.org>\n\n<p>Resource</p>\n--s--\n--a\nContent-Type: application/octet-stream\n\nUnsupported alternative\n--a--',
    );
    expect(message.text).toBe("Current");
    expect(message.html).toBe("<p>Current</p>");
    expect(message.attachments.map((part) => part.contentId)).toEqual([
      "current@example.org",
      null,
    ]);
  });

  it("keeps a non-root multipart subtree entirely out of the related reading body", async () => {
    const message = await parseMimeMessage(
      "Content-Type: multipart/related; boundary=r\n\n--r\nContent-Type: text/html\n\n<p>Root</p>\n--r\nContent-Type: multipart/alternative; boundary=a\n\n--a\nContent-Type: text/plain\n\nSupport plain\n--a\nContent-Type: text/html\n\n<p>Support HTML</p>\n--a--\n--r--",
    );
    expect(message.text).toBe("");
    expect(message.html).toBe("<p>Root</p>");
    expect(message.attachments.map((part) => part.contentType)).toEqual([
      "text/plain",
      "text/html",
    ]);
  });

  it.each([
    false,
    true,
  ])("rejects colliding resource IDs across selected related alternatives (nested: %s)", async (nested) => {
    const related = (type: string, boundary: string) =>
      `Content-Type: multipart/related; boundary=${boundary}\n\n--${boundary}\nContent-Type: text/${type}\n\n${type === "html" ? '<p>HTML</p><img src="cid:shared@example.org">' : "Plain"}\n--${boundary}\nContent-Type: image/png\nContent-ID: <shared@example.org>\n\n${type} resource\n--${boundary}--`;
    let input = `Content-Type: multipart/alternative; boundary=a\n\n--a\n${related("plain", "p")}\n--a\n${related("html", "h")}\n--a--`;
    if (nested) {
      input = `Content-Type: multipart/mixed; boundary=m\n\n--m\n${input}\n--m--`;
    }
    const result = parseMimeMessage(input);
    await expect(result).rejects.toBeInstanceOf(MimeParseError);
    await expect(result).rejects.toMatchObject({
      name: "MimeParseError",
      code: "EAMBIGUOUSCID",
    });
  });

  it.each([
    "distinct@example.org",
    "Shared@example.org",
  ])("keeps non-colliding related alternative resources: %s", async (htmlId) => {
    const related = (type: string, boundary: string, id: string) =>
      `Content-Type: multipart/related; boundary=${boundary}\n\n--${boundary}\nContent-Type: text/${type}\n\n${type === "html" ? `<img src="cid:${id}">` : "Plain"}\n--${boundary}\nContent-Type: image/png\nContent-ID: <${id}>\n\n${type} resource\n--${boundary}--`;
    const message = await parseMimeMessage(
      `Content-Type: multipart/alternative; boundary=a\n\n--a\n${related("plain", "p", "shared@example.org")}\n--a\n${related("html", "h", htmlId)}\n--a--`,
    );
    expect(message.text).toBe("Plain");
    expect(message.html).toContain(`data-inline-cid="${htmlId}"`);
    expect(message.attachments.map((part) => part.contentId)).toEqual([
      "shared@example.org",
      htmlId,
    ]);
  });

  it("discards colliding IDs belonging only to a superseded related alternative", async () => {
    const related = (boundary: string, body: string) =>
      `Content-Type: multipart/related; boundary=${boundary}\n\n--${boundary}\nContent-Type: text/html\n\n<p>${body}</p><img src="cid:shared@example.org">\n--${boundary}\nContent-Type: image/png\nContent-ID: <shared@example.org>\n\n${body}\n--${boundary}--`;
    const message = await parseMimeMessage(
      `Content-Type: multipart/alternative; boundary=a\n\n--a\n${related("p", "Old")}\n--a\n${related("h", "Current")}\n--a--`,
    );
    expect(message.html).toContain("<p>Current</p>");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]?.content).toEqual(new TextEncoder().encode("Current"));
  });

  describe("nested alternative CID validation", () => {
    const alternative = (boundary: string, ...parts: string[]) =>
      `Content-Type: multipart/alternative; boundary=${boundary}\n\n--${boundary}\n${parts.join(`\n--${boundary}\n`)}\n--${boundary}--`;
    const pair = (boundary: string, label: string, htmlId = "shared@example.org") => {
      const related = (type: string, id: string) => {
        const partBoundary = `${boundary}-${type}`;
        const body = type === "plain" ? label : `<p>${label}</p><img src="cid:${id}">`;
        return `Content-Type: multipart/related; boundary=${partBoundary}\n\n--${partBoundary}\nContent-Type: text/${type}\n\n${body}\n--${partBoundary}\nContent-Type: image/png\nContent-ID: <${id}>\n\n${label} ${type} resource\n--${partBoundary}--`;
      };
      return alternative(boundary, related("plain", "shared@example.org"), related("html", htmlId));
    };

    it.each([
      "direct",
      "alternative",
      "mixed",
      "related",
    ])("discards collisions in a superseded nested pair through %s", async (wrapper) => {
      let obsolete = pair("old", "Old");
      if (wrapper !== "direct") {
        obsolete = `Content-Type: multipart/${wrapper}; boundary=w\n\n--w\n${obsolete}\n--w--`;
      }
      const message = await parseMimeMessage(
        alternative("outer", obsolete, pair("current", "Current", "current@example.org")),
      );
      expect(message.text).toBe("Current");
      expect(message.html).toBe(
        '<p>Current</p><img alt="" data-inline-cid="current@example.org" />',
      );
      expect(message.attachments).toHaveLength(2);
      expect(message.attachments.map((part) => part.contentId)).toEqual([
        "shared@example.org",
        "current@example.org",
      ]);
      expect(message.attachments.map((part) => part.content)).toEqual([
        new TextEncoder().encode("Current plain resource"),
        new TextEncoder().encode("Current html resource"),
      ]);
    });

    it.each([
      "plain",
      "html",
      "both",
    ])("rejects retained nested collisions after replacing %s", async (replacement) => {
      const preferred =
        replacement === "both"
          ? pair("current", "Current")
          : `Content-Type: text/${replacement}\n\nCurrent`;
      const result = parseMimeMessage(alternative("outer", pair("old", "Old"), preferred));
      await expect(result).rejects.toBeInstanceOf(MimeParseError);
      await expect(result).rejects.toMatchObject({
        name: "MimeParseError",
        code: "EAMBIGUOUSCID",
      });
    });
  });

  it.each([
    "x-download; filename=synthetic.txt",
    "x-download",
  ])("downloads an unknown text disposition: %s", async (disposition) => {
    const message = await parseMimeMessage(
      `Content-Type: multipart/mixed; boundary=m\n\n--m\nContent-Type: text/plain\n\nReading body\n--m\nContent-Type: text/plain\nContent-Disposition: ${disposition}\n\nDownload only\n--m--`,
    );
    expect(message.text).toBe("Reading body");
    expect(message.html).toBeNull();
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({
      disposition: "x-download",
      inline: false,
      content: new TextEncoder().encode("Download only"),
    });
  });

  it("keeps an unknown multipart disposition as a grouped download", async () => {
    const body = "--a\nContent-Type: text/plain\n\nDownload only\n--a--";
    const message = await parseMimeMessage(
      `Content-Type: multipart/mixed; boundary=a\nContent-Disposition: x-download; filename=synthetic.mime\n\n${body}`,
    );
    expect(message.text).toBe("");
    expect(message.html).toBeNull();
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({
      filename: "synthetic.mime",
      disposition: "x-download",
      content: new TextEncoder().encode(body),
    });
  });

  it("overrides an unknown disposition only for the selected related root", async () => {
    const message = await parseMimeMessage(
      "Content-Type: multipart/related; boundary=r\n\n--r\nContent-Type: text/html\nContent-Disposition: x-download; filename=root.html\n\n<p>Root</p>\n--r\nContent-Type: text/plain\nContent-Disposition: x-download; filename=resource.txt\nContent-ID: <resource@example.org>\n\nResource\n--r--",
    );
    expect(message.text).toBe("");
    expect(message.html).toBe("<p>Root</p>");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({
      filename: "resource.txt",
      disposition: "x-download",
      contentId: "resource@example.org",
      inline: true,
    });
  });

  it.each([
    "\n",
    "\r\n",
  ])("preserves an attached multipart group and its wire bytes with %j delimiters", async (newline) => {
    const body = [
      "Synthetic preamble",
      "--attached",
      "Content-Type: multipart/alternative; boundary=inner",
      "",
      "--inner",
      "Content-Type: text/plain; charset=windows-1252",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Attached caf=E9",
      "--inner",
      "Content-Type: text/html",
      "",
      "<p>Attached HTML</p>",
      "--inner--",
      "--attached",
      "Content-Type: application/octet-stream",
      "Content-Transfer-Encoding: base64",
      "",
      "AAH/",
      "--attached--",
      "Synthetic epilogue",
    ].join(newline);
    const input = [
      "Content-Type: multipart/mixed; boundary=outer",
      "",
      "--outer",
      "Content-Type: text/plain",
      "",
      "Reading body",
      "--outer",
      "Content-Type: multipart/mixed; boundary=attached",
      'Content-Disposition: attachment; filename="attached.mime"',
      "Content-Description: Synthetic group",
      "Content-ID: <group@example.org>",
      "",
      body,
      "--outer",
      "Content-Type: text/plain",
      "",
      "Reading tail",
      "--outer--",
    ].join(newline);
    const framed = new TextEncoder().encode(`!${input}!`);
    const message = await parseMimeMessage(framed.subarray(1, -1));
    expect(message.text).toBe("Reading body\nReading tail");
    expect(message.html).toBeNull();
    const content = new TextEncoder().encode(body);
    expect(message.attachments).toEqual([
      {
        filename: "attached.mime",
        contentType: "multipart/mixed",
        disposition: "attachment",
        description: "Synthetic group",
        contentId: "group@example.org",
        inline: false,
        size: content.byteLength,
        content,
      },
    ]);
  });

  it.each([
    "--a--",
    "Unterminated body",
  ])("keeps a top-level attached multipart through EOF: %s", async (ending) => {
    const body = `--a\r\nContent-Type: text/plain\r\n\r\nAttached body\r\n${ending}`;
    const message = await parseMimeMessage(
      `Content-Type: multipart/alternative; boundary=a\r\nContent-Disposition: attachment; filename=top.mime\r\n\r\n${body}`,
    );
    expect(message.text).toBe("");
    expect(message.html).toBeNull();
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({
      filename: "top.mime",
      contentType: "multipart/alternative",
      content: new TextEncoder().encode(body),
    });
  });

  it.each([
    ["html", ""],
    ["plain", ""],
    ["html", '; start="<root@example.org>"'],
    ["plain", '; start="<root@example.org>"'],
  ])("reads the attached related text/%s root with %s", async (type, start) => {
    const root = `Content-Type: text/${type}\nContent-ID: <root@example.org>\nContent-Disposition: attachment; filename=root.txt\n\nRoot body`;
    const support =
      "Content-Type: text/html\nContent-ID: <support@example.org>\nContent-Disposition: attachment; filename=support.html\n\n<p>Support</p>";
    const children = start ? [support, root] : [root, support];
    const message = await parseMimeMessage(
      `Content-Type: multipart/related; boundary=r${start}\n\n--r\n${children.join("\n--r\n")}\n--r--`,
    );
    expect(message.text).toBe(type === "plain" ? "Root body" : "");
    expect(message.html).toBe(type === "html" ? "Root body" : null);
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({
      filename: "support.html",
      disposition: "attachment",
      inline: true,
      content: new TextEncoder().encode("<p>Support</p>"),
    });
  });

  it("preserves an attached multipart whose header separator is missing", async () => {
    const body = "--a\nContent-Type: text/plain\n\nAttached body\n--a--";
    const message = await parseMimeMessage(
      `Content-Type: multipart/mixed; boundary=a\nContent-Disposition: attachment; filename=recovered.mime\n${body}`,
    );
    expect(message.text).toBe("");
    expect(message.attachments[0]?.content).toEqual(new TextEncoder().encode(body));
  });

  it("processes an attached multipart related root while retaining an unsupported root as bytes", async () => {
    const message = await parseMimeMessage(
      "Content-Type: multipart/related; boundary=r\n\n--r\nContent-Type: multipart/alternative; boundary=a\nContent-Disposition: attachment; filename=root.mime\n\n--a\nContent-Type: text/html\n\n<p>Root</p>\n--a--\n--r--",
    );
    expect(message.html).toBe("<p>Root</p>");
    expect(message.attachments).toEqual([]);
    const unsupported = await parseMimeMessage(
      "Content-Type: multipart/related; boundary=r\n\n--r\nContent-Type: application/octet-stream\nContent-Disposition: attachment\n\nRoot bytes\n--r--",
    );
    expect(unsupported.text).toBe("");
    expect(unsupported.html).toBeNull();
    expect(unsupported.attachments[0]?.content).toEqual(new TextEncoder().encode("Root bytes"));
  });

  it.each([
    ["text/calendar", "utf-8", "base64"],
    ["application/ics", "utf-8", "base64"],
    ["text/calendar", "windows-1252", "base64"],
    ["application/ics", "windows-1252", "base64"],
    ["text/calendar", "windows-1252", "quoted-printable"],
    ["application/ics", "windows-1252", "quoted-printable"],
  ])("preserves %s %s %s attachment bytes and metadata", async (type, charset, transfer) => {
    const calendar = "BEGIN:VCALENDAR\r\nSUMMARY:Fictional café\r\nEND:VCALENDAR\r\n\r\n";
    const content = Buffer.from(calendar, charset === "utf-8" ? "utf8" : "latin1");
    const encoded =
      transfer === "base64"
        ? content.toString("base64")
        : [...content].map((byte) => `=${byte.toString(16).padStart(2, "0")}`).join("");
    const message = await parseMimeMessage(
      `Content-Type: multipart/mixed; boundary=m\r\n\r\n--m\r\nContent-Type: text/plain\r\n\r\nReading body\r\n--m\r\nContent-Type: ${type}; charset=${charset}; method=PUBLISH\r\nContent-Disposition: attachment; filename=fictional.ics\r\nContent-Description: Synthetic calendar\r\nContent-ID: <calendar@example.org>\r\nContent-Transfer-Encoding: ${transfer}\r\n\r\n${encoded}\r\n--m--`,
    );
    expect(message.text).toBe("Reading body");
    expect(message.html).toBeNull();
    expect(message.attachments).toEqual([
      {
        filename: "fictional.ics",
        contentType: type,
        disposition: "attachment",
        description: "Synthetic calendar",
        contentId: "calendar@example.org",
        inline: false,
        size: content.byteLength,
        content: new Uint8Array(content),
      },
    ]);
  });

  it("returns predictable empty values for an empty message", async () => {
    expect(await parseMimeMessage("")).toEqual({
      headers: [],
      from: null,
      sender: null,
      to: [],
      cc: [],
      bcc: [],
      replyTo: [],
      subject: "",
      date: null,
      messageId: null,
      inReplyTo: null,
      references: null,
      text: "",
      html: null,
      attachments: [],
    });
  });

  it.each([
    "7bit",
    "8bit",
    "binary",
    "quoted-printable",
    "base64",
  ])("preserves exact %s attachment bytes at EOF", async (transfer) => {
    for (const nested of [false, true]) {
      for (const ending of ["", "\n", "\r\n", "\r\n\r\n", "\r"]) {
        const content = new Uint8Array([0, 128, 255, ...new TextEncoder().encode(ending)]);
        const body =
          transfer === "base64"
            ? Buffer.from(content).toString("base64")
            : transfer === "quoted-printable"
              ? `=00=80=FF${ending}`
              : String.fromCharCode(...content);
        const headers = `Content-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=eof.bin\r\nContent-Transfer-Encoding: ${transfer}\r\n\r\n`;
        // Missing closing delimiters also leave a child attachment at EOF.
        const prefix = nested ? "Content-Type: multipart/mixed; boundary=m\r\n\r\n--m\r\n" : "";
        const input = Buffer.from(`!${prefix}${headers}${body}!`, "latin1");
        const message = await parseMimeMessage(input.subarray(1, -1));
        expect(message.attachments).toHaveLength(1);
        expect(message.attachments[0]).toMatchObject({
          filename: "eof.bin",
          size: content.length,
        });
        expect(message.attachments[0]?.content).toEqual(content);
        expect(message.text).toBe("");
      }
    }
  });

  it.each([
    "7bit",
    "8bit",
    "binary",
    "x-unknown",
  ])("decodes %s body octets from a sliced byte input", async (encoding) => {
    const header = new TextEncoder().encode(
      `Content-Type: text/plain; charset=windows-1252\r\nContent-Transfer-Encoding: ${encoding}\r\n\r\n`,
    );
    const framed = new Uint8Array([42, ...header, 99, 97, 102, 233, 32, 128, 42]);
    const message = await parseMimeMessage(framed.subarray(1, -1));
    expect(message.text).toBe("café €");
  });

  it.each([
    ["utf-8", "base64", "44GT44KT44Gr44Gh44Gv", "こんにちは"],
    ["iso-8859-1", "quoted-printable", "caf=E9=20=3D=20yes=\r\n!", "café = yes!"],
    ["shift_jis", "base64", "grGC8YLJgr+CzQ==", "こんにちは"],
    ["x-fictional-charset", "8bit", "Hello", "Hello"],
  ])("decodes %s with %s", async (charset, transfer, body, expected) => {
    const input = new TextEncoder().encode(
      `Content-Type: text/plain; charset=${charset}\r\nContent-Transfer-Encoding: ${transfer}\r\n\r\n${body}`,
    );
    expect((await parseMimeMessage(input.buffer)).text.trim()).toBe(expected);
  });

  it("keeps encapsulated mail as an attachment, excluding its body from the outer message", async () => {
    const message = await parseMimeMessage(
      "Content-Type: multipart/mixed; boundary=x\n\n--x\nContent-Type: text/plain\n\nOuter message\n--x\nContent-Type: message/rfc822\n\nFrom: Fictional <inner@example.org>\nSubject: Inner\n\nInner body\n--x--",
    );
    expect(message.text.trim()).toBe("Outer message");
    expect(message.attachments[0]?.contentType).toBe("message/rfc822");
    expect(new TextDecoder().decode(message.attachments[0]?.content)).toContain("Inner body");
  });

  it("tolerates LF headers, invalid dates, missing closing boundaries and malformed encoded words", async () => {
    const message = await parseMimeMessage(
      'Date: fictional date\nSubject: =?broken?=\nContent-Type: multipart/mixed; boundary="x"\n\n--x\nContent-Type: text/plain\n\nRecovered body',
    );
    expect(message.date).toBe("fictional date");
    expect(message.subject).toBe("=?broken?=");
    expect(message.text.trim()).toBe("Recovered body");
  });

  it("propagates the parser's nesting limit rejection", async () => {
    let input = "Content-Type: text/plain\r\n\r\nEnd";
    for (let depth = 0; depth < 257; depth++) {
      input = `Content-Type: multipart/mixed; boundary=b${depth}\r\n\r\n--b${depth}\r\n${input}\r\n--b${depth}--`;
    }
    await expect(parseMimeMessage(input)).rejects.toMatchObject({ code: "EMAXNESTINGDEPTH" });
  });
});

describe("safe reading HTML", () => {
  it("decodes CID URL escapes once, preserves ID case and ignores malformed escapes", () => {
    expect(
      sanitizeMessageHtml(
        '<img src="cid:Logo%2Fone%40example.org"><img src="cid:literal%2540example.org"><img src="cid:%invalid">',
      ),
    ).toBe(
      '<img alt="" data-inline-cid="Logo/one@example.org" /><img alt="" data-inline-cid="literal%40example.org" /><img alt="" />',
    );
    expect(sanitizeMessageHtml('<img src="cid:%22%3E%3Cscript%3E">')).toBe(
      '<img alt="" data-inline-cid="&quot;&gt;&lt;script&gt;" />',
    );
  });

  it("keeps basic reading structure, table semantics and safe user-activated links", () => {
    const html =
      '<h2>Title</h2><blockquote><em>Quoted</em></blockquote><ul><li>One</li></ul><pre><code>x &lt; y</code></pre><table><caption>Data</caption><tbody><tr><th scope="row">Row</th><td colspan="2">Value</td></tr></tbody></table><a href="mailto:fictional@example.org" title="Email">Write</a><a href="#part">Jump</a>';
    expect(sanitizeMessageHtml(html)).toBe(html);
  });

  it("converts only CID sources to inert metadata and discards forged CID attributes", () => {
    expect(
      sanitizeMessageHtml(
        '<img src="CID:logo@example.org" alt="Logo" title="Local"><img data-inline-cid="forged" src="https://example.org/pixel"><img src="cid:"><img>',
      ),
    ).toBe(
      '<img alt="Logo" title="Local" data-inline-cid="logo@example.org" /><img alt="" /><img alt="" /><img alt="" />',
    );
  });

  it.each([
    '<a href="jav&#x61;script:alert(1)">Link</a>',
    '<a href="java&#10;script:alert(1)">Link</a>',
    '<a href="data:text/html,evil">Link</a>',
    '<a href="vbscript:evil">Link</a>',
    '<a href="//example.org/path">Link</a>',
  ])("removes unsafe or protocol-relative link targets: %s", (html) => {
    expect(sanitizeMessageHtml(html)).toBe("<a>Link</a>");
  });

  it.each([
    '<img src="https://example.org/pixel" srcset="https://example.org/2x 2x" onerror="evil()">',
    '<img src="data:image/svg+xml,evil" style="background:url(https://example.org/pixel)">',
    '<img src="/local" background="https://example.org/pixel">',
    '<img src="blob:https://example.org/id">',
    '<img src="//example.org/pixel">',
  ])("removes every automatic image source: %s", (html) => {
    expect(sanitizeMessageHtml(html)).toBe('<img alt="" />');
  });

  it("removes scripts, styles, embedded documents, foreign content and active attributes", () => {
    const html =
      '<script>bad()</script><style>bad()</style><iframe srcdoc="bad">bad</iframe><object>bad</object><svg><script>bad()</script></svg><math><mi>bad</mi></math><template>bad</template><video poster="https://example.org/pixel"><source src="https://example.org/video"></video><p onclick="bad()" id="location" class="bad" style="color:red">Safe</p>';
    expect(sanitizeMessageHtml(html)).toBe("<p>Safe</p>");
    expect(sanitizeMessageHtml(sanitizeMessageHtml(html))).toBe("<p>Safe</p>");
  });
});
