// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { parseVCards, serializeVCards, type VCard } from "../src/apps/contacts/lib/vcard";
import { apple, google, quotedPrintable, version4 } from "./fixtures/vcard/exports";

const wrap = (lines: string, version = "4.0") =>
  `BEGIN:VCARD\nVERSION:${version}\nFN:Test\n${lines}\nEND:VCARD`;
const first = (text: string): VCard => {
  const card = parseVCards(text)[0];
  if (!card) throw new Error("Expected fixture card");
  return card;
};

const emptyName = { family: [""], given: [""], additional: [""], prefixes: [""], suffixes: [""] };

describe("synthetic vCard exports", () => {
  it("imports every requested Google-style field without RDF or network", () => {
    expect(first(google)).toEqual({
      version: "3.0",
      fn: "Rowan Example",
      n: {
        family: ["Example"],
        given: ["Rowan"],
        additional: ["River"],
        prefixes: ["Dr."],
        suffixes: ["Jr."],
      },
      emails: [
        { value: "rowan@example.org", parameters: { TYPE: ["internet", "home", "pref"] } },
        { value: "rowan.work@example.org", parameters: { TYPE: ["work"] } },
      ],
      tels: [{ value: "+1-202-555-0142", parameters: { TYPE: ["cell"] } }],
      addresses: [
        {
          value: {
            poBox: [""],
            extended: [""],
            street: ["42 Fiction Lane, Apt 3"],
            locality: ["Example City"],
            region: ["Example Region"],
            postalCode: ["00000"],
            country: ["Exampleland"],
          },
          parameters: { TYPE: ["home"] },
        },
      ],
      org: ["Example; Works", "Research, Design"],
      title: "Imaginary Director",
      bday: "1992-03-04",
      note: "First line\nSecond line; comma, slash\\end",
      photo: "https://example.org/photos/rowan.jpg?size=2,3",
      categories: ["Friends", "Test, People"],
    });
  });

  it("imports Apple grouped properties, quoted labels, birthday sentinel and ignores binary photos", () => {
    const card = first(apple);
    expect(card.emails[0]).toEqual({
      group: "item1",
      value: "marin@example.org",
      parameters: { TYPE: ["internet", "home", "pref"] },
    });
    expect(card.tels[0]?.group).toBe("item2");
    expect(card.addresses[0]?.parameters.LABEL).toEqual([
      "42 Fiction Lane; Example City: Exampleland",
    ]);
    expect(card.bday).toBe("1604-07-09");
    expect(card.photo).toBeUndefined();
    expect(card.note).toBe(
      "A folded synthetic note from a fictional contact with enough text to continue on the next physical line.",
    );
  });

  it("decodes v3 quoted-printable UTF-8, soft breaks, multibyte characters and Latin-1", () => {
    const cards = parseVCards(quotedPrintable);
    expect(cards.map((card) => card.fn)).toEqual(["Zoë Example", "André Fiction"]);
    expect(cards[0]?.n?.given).toEqual(["Zoë"]);
    expect(cards[0]?.note).toBe("A soft line with ë and 🌿\nEnd");
  });

  it("imports v4 structured lists, text/URI phones, preferences, reduced dates and caret parameters", () => {
    const card = first(version4);
    expect(card.n?.family).toEqual(["Example", "Fiction"]);
    expect(card.n?.additional).toEqual(["A.", "B."]);
    expect(card.emails[0]?.parameters).toEqual({ TYPE: ["work", "internet"], PREF: ["1"] });
    expect(card.tels.map((tel) => tel.value)).toEqual([
      "tel:+1-202-555-0199;ext=42",
      "Call the fictional front desk",
    ]);
    expect(card.addresses[0]?.value.street).toEqual(["42 Fiction Lane", "Suite 4"]);
    expect(card.addresses[0]?.parameters.LABEL).toEqual(['42 Fiction Lane\nExample City"Office"^']);
    expect(card.bday).toBe("--0709");
    expect(card.note).toBe('Literal "quotes": they are text.');
    expect(card.categories).toEqual(["Work", "Research", "Example"]);
  });

  it.each([
    google,
    apple,
    quotedPrintable,
    version4,
  ])("round-trips the supported fields", (text) => {
    const cards = parseVCards(text);
    expect(parseVCards(serializeVCards(cards))).toEqual(cards);
    expect(JSON.parse(JSON.stringify(cards))).toEqual(cards);
  });

  it("supports mixed versions and multiple cards in one file", () => {
    const cards = parseVCards(google + version4);
    expect(cards.map((card) => card.version)).toEqual(["3.0", "4.0"]);
    expect(parseVCards(serializeVCards(cards))).toEqual(cards);
  });
});

describe("content lines and values", () => {
  it("handles empty files, BOM, case-insensitive keywords and CR/LF/CRLF", () => {
    expect(parseVCards("\uFEFF\r\n\n")).toEqual([]);
    expect(serializeVCards([])).toBe("");
    const text = "\uFEFFbegin:vcard\rversion:4.0\rfn:Test\n\r\nend:vcard\r\n";
    expect(first(text)).toEqual({
      version: "4.0",
      fn: "Test",
      emails: [],
      tels: [],
      addresses: [],
      categories: [],
    });
  });

  it("unfolds one leading space or tab without trimming significant whitespace", () => {
    expect(first(wrap("NOTE:  first\n second\n\t third  ")).note).toBe("  firstsecond third  ");
    expect(first(wrap("FN;ENCODING=QUOTED-PRINTABLE:Soft=\n fold", "3.0")).fn).toBe("Softfold");
  });

  it.each([
    "Andr=C3=\r\n A9",
    "Andr=C3=\r\n\tA9",
    "Andr=C3=\r\n a9",
    "Andr=C3=A\r\n 9",
    "Andr=C3=\r\n=A9",
    "Andr=C3=\r\n =A9",
  ])("distinguishes folded quoted-printable escapes from soft breaks: %j", (value) => {
    const card = first(wrap(`FN;ENCODING=QUOTED-PRINTABLE:${value}\nN:;;;;`, "3.0"));
    expect(card.fn).toBe("André");
    expect(first(serializeVCards([card]))).toEqual(card);
  });

  it.each([
    ["=\r\n 4\r\n 1", "A"],
    ["=\r\n\t4\r\n\t1", "A"],
    ["=\n \n 4\n 1", "A"],
    ["=\r\n 4\r\n 1=\r\n 4\r\n 2", "AB"],
    ["=\r\n 4\r\n 1=\r\nnext", "Anext"],
  ])("unfolds every continuation before decoding quoted-printable: %j", (value, expected) => {
    const card = first(
      wrap(`FN;ENCODING=QUOTED-PRINTABLE:${value}\nEMAIL:fiction@example.org\nN:;;;;`, "3.0"),
    );
    expect(card.fn).toBe(expected);
    expect(card.emails[0]?.value).toBe("fiction@example.org");
    expect(first(serializeVCards([card]))).toEqual(card);
  });

  it("recognizes QP only in headers and allows folded and quoted parameter headers", () => {
    const card = first(
      wrap(
        "NOTE:Literal ;ENCODING=QUOTED-PRINTABLE:value=\nEMAIL;TYPE=\n HOME:fiction@example.org",
      ),
    );
    expect(card.note).toBe("Literal ;ENCODING=QUOTED-PRINTABLE:value=");
    expect(card.emails[0]?.parameters.TYPE).toEqual(["home"]);
    expect(first(serializeVCards([card]))).toEqual(card);
    const qp = first(
      wrap('NOTE;LABEL="Example: header";ENCODING="QUOTED-PRINTABLE":soft=\nbreak', "3.0"),
    );
    expect(qp.note).toBe("softbreak");
  });

  it.each(["3.0", "4.0"])("keeps quoted encoding lookalikes separate in v%s", (version) => {
    const card = first(
      wrap(
        'TEL;LABEL="Room;ENCODING=QUOTED-PRINTABLE;desk":555-0100=\nEMAIL:fiction@example.org',
        version,
      ),
    );
    expect(card.tels[0]?.value).toBe("555-0100=");
    expect(card.tels[0]?.parameters.LABEL).toEqual(["Room;ENCODING=QUOTED-PRINTABLE;desk"]);
    expect(card.emails[0]?.value).toBe("fiction@example.org");
    expect(first(serializeVCards([card])).tels).toEqual(card.tels);
  });

  it("decodes only lowercase caret newlines and preserves unknown sequences", () => {
    const card = first(wrap(`EMAIL;LABEL="Room^North^nSouth^x^^^'":fiction@example.org`));
    expect(card.emails[0]?.parameters.LABEL).toEqual(['Room^North\nSouth^x^"']);
    expect(first(serializeVCards([card]))).toEqual(card);
  });

  it.each([
    "TEL:555-0100",
    String.raw`TEL:555\,0100\;desk\nnext`,
    "TEL;VALUE=text:555-0100",
  ])("round-trips v4 telephone text: %s", (line) => {
    const card = first(wrap(line));
    expect(card.tels[0]?.value).toBe(line.endsWith("next") ? "555,0100;desk\nnext" : "555-0100");
    expect(serializeVCards([card])).toContain(`${line}\r\n`);
    expect(first(serializeVCards([card]))).toEqual(card);
  });

  it.each(["text", "TEXT", "date", "date-and-or-time"])("preserves BDAY VALUE=%s", (type) => {
    const value = type.toLowerCase() === "text" ? String.raw`circa 1800\, spring` : "18000101";
    const card = first(wrap(`BDAY;VALUE=${type}:${value}`));
    expect(card.bdayValueType).toBe(type.toLowerCase());
    expect(card.bday).toBe(type.toLowerCase() === "text" ? "circa 1800, spring" : "18000101");
    expect(serializeVCards([card])).toContain(`BDAY;VALUE=${type.toLowerCase()}:${value}\r\n`);
    expect(first(serializeVCards([card]))).toEqual(card);
  });

  it("uses the final birthday's value type, including the default", () => {
    const card = first(wrap("BDAY;VALUE=text:circa 1800\nBDAY:--0709"));
    expect(card.bday).toBe("--0709");
    expect(card.bdayValueType).toBeUndefined();
    expect(serializeVCards([card])).toContain("BDAY:--0709\r\n");
    expect(first(serializeVCards([card]))).toEqual(card);
  });

  it("unescapes delimiters, escaped backslashes and uppercase newlines exactly once", () => {
    const card = first(
      wrap(String.raw`N:One\,Two;A\\,B\;C;;;\n
NOTE:path\\name\Nnext\qend\
CATEGORIES:one\\,two,three\,four`),
    );
    expect(card.n?.family).toEqual(["One,Two"]);
    expect(card.n?.given).toEqual(["A\\", "B;C"]);
    expect(card.n?.suffixes).toEqual(["\n"]);
    expect(card.note).toBe("path\\name\nnext\\qend\\");
    expect(card.categories).toEqual(["one\\", "two", "three,four"]);
    expect(first(serializeVCards([card]))).toEqual(card);
  });

  it("pads omitted structured components and keeps empty values", () => {
    const card = first(wrap("N:Family\nADR:Box\nORG:\nTITLE:\nBDAY:\nNOTE:\nCATEGORIES:"));
    expect(card.n).toEqual({ ...emptyName, family: ["Family"] });
    expect(card.addresses[0]?.value).toEqual({
      poBox: ["Box"],
      extended: [""],
      street: [""],
      locality: [""],
      region: [""],
      postalCode: [""],
      country: [""],
    });
    expect(card.org).toEqual([""]);
    expect(card.title).toBe("");
    expect(card.bday).toBe("");
    expect(card.note).toBe("");
    expect(card.categories).toEqual([""]);
    expect(first(serializeVCards([card]))).toEqual(card);
  });

  it("merges bare/repeated parameters, respects quoted separators and preserves parameter escapes", () => {
    const card = first(
      wrap(
        String.raw`EMAIL;HOME;TYPE=WORK;X-REF="one,two:three;four";X-PATH="a\,b";X-END=path\;X-NEXT=yes:fiction@example.org`,
      ),
    );
    expect(card.emails[0]?.parameters).toEqual({
      TYPE: ["home", "work"],
      "X-REF": ["one,two:three;four"],
      "X-PATH": [String.raw`a\,b`],
      "X-END": ["path\\"],
      "X-NEXT": ["yes"],
    });
    expect(first(serializeVCards([card]))).toEqual(card);
  });

  it("uses last singular occurrence and accumulates categories and repeated contact points", () => {
    const card = first(
      wrap(
        "FN:Final\nORG:One\nORG:Two\nEMAIL:first@example.org\nEMAIL:last@example.org\nTEL;VALUE=text:one\nTEL;VALUE=text:two\nADR:One\nADR:Two\nCATEGORIES:A\nCATEGORIES:B",
      ),
    );
    expect(card.fn).toBe("Final");
    expect(card.org).toEqual(["Two"]);
    expect(card.emails).toHaveLength(2);
    expect(card.tels).toHaveLength(2);
    expect(card.addresses).toHaveLength(2);
    expect(card.categories).toEqual(["A", "B"]);
  });

  it.each(["3.0", "4.0"])("encodes URI commas for v%s without TEXT escaping", (version) => {
    const comma = version === "4.0" ? String.raw`\,` : ",";
    const card = first(
      wrap(
        String.raw`TEL;VALUE=URI:tel:+1-202-555-0100;ext=2${comma}3\N
PHOTO;VALUE=URI:https://example.org/a${comma}b;c.jpg`,
        version,
      ),
    );
    expect(card.tels[0]?.value).toBe(String.raw`tel:+1-202-555-0100;ext=2,3\N`);
    expect(card.photo).toBe("https://example.org/a,b;c.jpg");
    const output = serializeVCards([card]);
    expect(output).toContain(String.raw`TEL;VALUE=URI:tel:+1-202-555-0100;ext=2${comma}3\N`);
    expect(output).toContain(`PHOTO;VALUE=URI:https://example.org/a${comma}b;c.jpg`);
    expect(first(output).tels).toEqual(card.tels);
    expect(first(output).photo).toBe(card.photo);
  });

  it("decodes v4 default PHOTO URI commas and leaves other URI escapes intact", () => {
    const card = first(wrap(String.raw`PHOTO:https://example.org/a\,b\;c\N.jpg`));
    expect(card.photo).toBe(String.raw`https://example.org/a,b\;c\N.jpg`);
    expect(first(serializeVCards([card]))).toEqual(card);
  });

  it("keeps v3 URI backslashes intact", () => {
    const card = first(wrap(String.raw`PHOTO;VALUE=URI:https://example.org/a\,b.jpg`, "3.0"));
    expect(card.photo).toBe(String.raw`https://example.org/a\,b.jpg`);
    expect(first(serializeVCards([card])).photo).toBe(card.photo);
  });

  it.each([
    "PHOTO;ENCODING=BASE64:abc",
    "PHOTO;VALUE=binary:abc",
    "PHOTO:relative.jpg",
    "PHOTO:https://example.org/a b.jpg",
  ])("ignores unsupported photo %s", (line) => {
    expect(first(wrap(line)).photo).toBeUndefined();
  });

  it("ignores unknown properties even when their transport encoding is unsupported", () => {
    expect(first(wrap("X-EXTRA;ENCODING=BASE64:abc")).fn).toBe("Test");
  });

  it("keeps literal Unicode, escaped delimiters and unencoded text in quoted-printable", () => {
    const card = first(
      wrap(
        "FN;ENCODING=QUOTED-PRINTABLE:🌿 Fiction=3B Test\nEMAIL;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:fiction=40example.org",
        "3.0",
      ),
    );
    expect(card.fn).toBe("🌿 Fiction; Test");
    expect(card.emails[0]).toEqual({ value: "fiction@example.org", parameters: {} });
  });
});

describe("serialization from plain objects", () => {
  it("supports minimal v4 cards and supplies v3's required empty N", () => {
    const card = first(wrap(""));
    expect(serializeVCards([card])).toBe("BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Test\r\nEND:VCARD\r\n");
    expect(first(serializeVCards([{ ...card, version: "3.0" }])).n).toEqual(emptyName);
  });

  it.each([
    "3.0",
    "4.0",
  ] as const)("normalizes TEL parameter keys before v%s encoding", (version) => {
    for (const key of ["value", "Value", "VALUE"]) {
      const card = first(wrap("", version));
      const value = "tel:+1-202-555-0100;ext=42,43";
      const parameters = { [key]: ["uri"], type: ["work"] };
      card.tels.push({ value, parameters });
      const output = serializeVCards([card]);
      const comma = version === "4.0" ? String.raw`\,` : ",";
      expect(output).toContain(`TEL;VALUE=uri;TYPE=work:tel:+1-202-555-0100;ext=42${comma}43\r\n`);
      expect(first(output).tels).toEqual([
        { value, parameters: { VALUE: ["uri"], TYPE: ["work"] } },
      ]);
      expect(card.tels[0]?.parameters).toEqual({ [key]: ["uri"], type: ["work"] });
    }
  });

  it("rejects TEL parameter keys that collide after normalization", () => {
    const card = first(wrap(""));
    card.tels.push({
      value: "tel:+1-202-555-0100;ext=42",
      parameters: { VALUE: ["uri"], value: ["text"] },
    });
    expect(() => serializeVCards([card])).toThrow(SyntaxError);
    expect(() => serializeVCards([card])).toThrow("Duplicate vCard parameter name");
  });

  it("normalizes CRLF/CR/newline text and prevents line injection", () => {
    const card = { ...first(wrap("")), fn: "A\r\nB\rC\nD", note: "text\nEND:VCARD\nBEGIN:VCARD" };
    const serialized = serializeVCards([card]);
    expect(parseVCards(serialized)).toHaveLength(1);
    expect(first(serialized).fn).toBe("A\nB\nC\nD");
    expect(first(serialized).note).toBe(card.note);
  });

  it("folds at 75 UTF-8 octets with no split codepoints or blank continuation lines", () => {
    const card = {
      ...first(wrap("")),
      fn: "a".repeat(72),
      note: `${"x".repeat(69)}🌿${"é漢🌿".repeat(45)}`,
    };
    const output = serializeVCards([card]);
    const lines = output.split("\r\n");
    expect(lines).toContain(`FN:${"a".repeat(72)}`);
    expect(lines.some((line) => line.startsWith(" 🌿"))).toBe(true);
    expect(lines.every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    expect(output).not.toContain("\uFFFD");
    expect(first(output)).toEqual(card);
  });

  it("omits stale transport parameters, uppercases keys and escapes v4 caret parameters", () => {
    const card = first(wrap(""));
    card.emails.push({
      group: "item9",
      value: "fiction@example.org",
      parameters: {
        type: ["home"],
        LABEL: ['Office: "main"; zone, A\nB^C'],
        encoding: ["QUOTED-PRINTABLE"],
        charset: ["UTF-8"],
      },
    });
    const serialized = serializeVCards([card]);
    expect(serialized).not.toContain("ENCODING");
    expect(serialized).not.toContain("CHARSET");
    expect(first(serialized).emails[0]).toEqual({
      group: "item9",
      value: "fiction@example.org",
      parameters: { TYPE: ["home"], LABEL: ['Office: "main"; zone, A\nB^C'] },
    });
  });
});

describe("malformed input", () => {
  it.each([
    ["garbage", "Content outside"],
    ["END:VCARD", "Unexpected"],
    ["BEGIN:VCARD\nBEGIN:VCARD", "Nested"],
    ["BEGIN:VCARD", "Unclosed"],
    ["BEGIN:VCARD\nFN:Test\nEND:VCARD", "VERSION"],
    [wrap("", "2.1"), "VERSION"],
    [wrap("VERSION:4.0"), "VERSION"],
    ["BEGIN:VCARD\nVERSION:4.0\nEND:VCARD", "Missing"],
    [wrap("broken"), "content line"],
    [wrap('EMAIL;LABEL="unclosed:address'), "content line"],
    [wrap("bad.name.extra:value"), "property name"],
    [wrap("EMAIL;bad key=value:fiction@example.org"), "parameter name"],
    [wrap('EMAIL;X-A=a"b:fiction@example.org'), "content line"],
    [wrap("N:a;b;c;d;e;f"), "components"],
    [wrap("ADR:a;b;c;d;e;f;g;h"), "components"],
    [wrap("FN;ENCODING=BASE64:abc", "3.0"), "encoding"],
    [wrap("FN;ENCODING=QUOTED-PRINTABLE:Test", "4.0"), "encoding"],
    [wrap("FN;ENCODING=QUOTED-PRINTABLE:=ZZ", "3.0"), "quoted-printable"],
    [wrap("FN;ENCODING=QUOTED-PRINTABLE;CHARSET=not-a-charset:=41", "3.0"), "charset"],
    [wrap("FN;ENCODING=QUOTED-PRINTABLE:=FF", "3.0"), "charset"],
  ])("rejects malformed input without exposing values (%s)", (text, message) => {
    expect(() => parseVCards(text)).toThrow(SyntaxError);
    expect(() => parseVCards(text)).toThrow(message);
  });

  it("rejects invalid object versions, URI values and header injection", () => {
    const card = first(wrap(""));
    expect(() => serializeVCards([{ ...card, version: "2.1" as "4.0" }])).toThrow("version");
    expect(() => serializeVCards([{ ...card, photo: "relative.jpg" }])).toThrow("URI");
    expect(() =>
      serializeVCards([{ ...card, bday: "circa 1800", bdayValueType: "text\nNOTE" }]),
    ).toThrow("parameter");
    expect(() =>
      serializeVCards([{ ...card, tels: [{ value: "bad\nURI", parameters: { VALUE: ["uri"] } }] }]),
    ).toThrow("URI");
    for (const group of ["bad\ngroup", ""]) {
      expect(() =>
        serializeVCards([
          { ...card, emails: [{ value: "fiction@example.org", parameters: {}, group }] },
        ]),
      ).toThrow("group");
    }
    expect(() =>
      serializeVCards([
        {
          ...card,
          emails: [{ value: "fiction@example.org", parameters: { "bad\nkey": ["value"] } }],
        },
      ]),
    ).toThrow("parameter");
    for (const label of ['bad"quote', "bad\nline"]) {
      expect(() =>
        serializeVCards([
          {
            ...card,
            version: "3.0",
            emails: [{ value: "fiction@example.org", parameters: { LABEL: [label] } }],
          },
        ]),
      ).toThrow("v3 parameter");
    }
  });
});
