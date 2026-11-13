// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  expandTemplate,
  parseTemplate,
  templateVariables,
  UriTemplateError,
} from "../src/uri-template.js";

// Variables from RFC 6570 §3.2.1.
const vars = {
  count: ["one", "two", "three"],
  dom: ["example", "com"],
  dub: "me/too",
  hello: "Hello World!",
  half: "50%",
  var: "value",
  who: "fred",
  base: "http://example.com/home/",
  path: "/foo/bar",
  list: ["red", "green", "blue"],
  keys: { semi: ";", dot: ".", comma: "," },
  v: "6",
  x: "1024",
  y: "768",
  empty: "",
  empty_keys: {},
  undef: undefined,
};

const cases: [string, string][] = [
  // Level 1
  ["{var}", "value"],
  ["{hello}", "Hello%20World%21"],
  ["{half}", "50%25"],
  // Level 2
  ["{+var}", "value"],
  ["{+hello}", "Hello%20World!"],
  ["{+half}", "50%25"],
  ["{base}index", "http%3A%2F%2Fexample.com%2Fhome%2Findex"],
  ["{+base}index", "http://example.com/home/index"],
  ["O{empty}X", "OX"],
  ["O{undef}X", "OX"],
  ["{+path}/here", "/foo/bar/here"],
  ["here?ref={+path}", "here?ref=/foo/bar"],
  ["X{#var}", "X#value"],
  ["X{#hello}", "X#Hello%20World!"],
  // Level 3
  ["map?{x,y}", "map?1024,768"],
  ["{x,hello,y}", "1024,Hello%20World%21,768"],
  ["{+x,hello,y}", "1024,Hello%20World!,768"],
  ["{+path,x}/here", "/foo/bar,1024/here"],
  ["{#x,hello,y}", "#1024,Hello%20World!,768"],
  ["{#path,x}/here", "#/foo/bar,1024/here"],
  ["X{.var}", "X.value"],
  ["X{.x,y}", "X.1024.768"],
  ["{/var}", "/value"],
  ["{/var,x}/here", "/value/1024/here"],
  ["{;x,y}", ";x=1024;y=768"],
  ["{;x,y,empty}", ";x=1024;y=768;empty"],
  ["{?x,y}", "?x=1024&y=768"],
  ["{?x,y,empty}", "?x=1024&y=768&empty="],
  ["?fixed=yes{&x}", "?fixed=yes&x=1024"],
  ["{&x,y,empty}", "&x=1024&y=768&empty="],
  ["{?undef}", ""],
  ["{?x,undef,y}", "?x=1024&y=768"],
  // Level 4
  ["{var:3}", "val"],
  ["{var:30}", "value"],
  ["{list}", "red,green,blue"],
  ["{list*}", "red,green,blue"],
  ["{keys}", "semi,%3B,dot,.,comma,%2C"],
  ["{keys*}", "semi=%3B,dot=.,comma=%2C"],
  ["{+path:6}/here", "/foo/b/here"],
  ["{+list}", "red,green,blue"],
  ["{+keys*}", "semi=;,dot=.,comma=,"],
  ["{#keys}", "#semi,;,dot,.,comma,,"],
  ["X{.list*}", "X.red.green.blue"],
  ["{/list*,path:4}", "/red/green/blue/%2Ffoo"],
  ["{/keys*}", "/semi=%3B/dot=./comma=%2C"],
  ["{;hello:5}", ";hello=Hello"],
  ["{;list*}", ";list=red;list=green;list=blue"],
  ["{;keys*}", ";semi=%3B;dot=.;comma=%2C"],
  ["{?var:3}", "?var=val"],
  ["{?list}", "?list=red,green,blue"],
  ["{?list*}", "?list=red&list=green&list=blue"],
  ["{?keys}", "?keys=semi,%3B,dot,.,comma,%2C"],
  ["{?keys*}", "?semi=%3B&dot=.&comma=%2C"],
  ["{&list*}", "&list=red&list=green&list=blue"],
  ["{?empty_keys}", ""],
  ["{?count}", "?count=one,two,three"],
  ["{dub}", "me%2Ftoo"],
  ["{who}", "fred"],
  ["{v}", "6"],
];

describe("expandTemplate (RFC 6570 examples)", () => {
  it.each(cases)("%s -> %s", (template, expected) => {
    expect(expandTemplate(template, vars)).toBe(expected);
  });

  it("encodes non-ASCII as UTF-8 percent-encoding", () => {
    expect(expandTemplate("{q}", { q: "café ☕" })).toBe("caf%C3%A9%20%E2%98%95");
    expect(expandTemplate("{+q}", { q: "é" })).toBe("%C3%A9");
  });

  it("keeps a value inside its component: simple expansion encodes reserved characters", () => {
    const q = "a&b=c#d/../e?f";
    expect(expandTemplate("https://shop.test/search{?q}", { q })).toBe(
      "https://shop.test/search?q=a%26b%3Dc%23d%2F..%2Fe%3Ff",
    );
    expect(expandTemplate("https://shop.test/p/{id}", { id: "../admin" })).toBe(
      "https://shop.test/p/..%2Fadmin",
    );
    expect(expandTemplate("https://shop.test/p{/id}", { id: "//evil.test" })).toBe(
      "https://shop.test/p/%2F%2Fevil.test",
    );
  });

  it("reserved expansion passes valid pct-triplets but encodes a stray percent", () => {
    expect(expandTemplate("{+v}", { v: "%41%zz" })).toBe("%41%25zz");
  });

  it("pct-encodes literal characters not allowed in a URI", () => {
    expect(expandTemplate("https://shop.test/a b", {})).toBe("https://shop.test/a%20b");
  });

  it("ignores inherited properties as variables", () => {
    expect(expandTemplate("{toString}", {})).toBe("");
  });

  it.each([
    ["{unclosed", "unclosed"],
    ["closed}", "unmatched"],
    ["{}", "empty"],
    ["{a{b}}", "nested"],
    ["{=a}", "reserved operator"],
    ["{!a}", "reserved operator"],
    ["{a b}", "invalid variable"],
    ["{a:0}", "prefix"],
    ["{a:10000}", "prefix"],
    ["{.}", "empty"],
    ["{a..b}", "invalid variable"],
  ])("rejects malformed template %s", (template, message) => {
    expect(() => expandTemplate(template, { a: "x" })).toThrow(UriTemplateError);
    expect(() => expandTemplate(template, { a: "x" })).toThrow(message);
  });

  it("rejects a prefix modifier on a list", () => {
    expect(() => expandTemplate("{list:2}", vars)).toThrow("composite");
  });

  it("lists variable names in order of first appearance", () => {
    expect(templateVariables("https://shop.test/{a}/x{?b,a}{&c*}")).toEqual(["a", "b", "c"]);
    expect(parseTemplate("a{b}c")).toHaveLength(3);
  });
});
