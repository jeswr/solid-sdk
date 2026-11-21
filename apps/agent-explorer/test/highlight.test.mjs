// AUTHORED-BY Codex GPT-6.2 Sol
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import traceData from "../js/trace-data.js";

const context = vm.createContext({ window: {} });
for (const script of ["highlight", "markdown"]) {
  vm.runInContext(readFileSync(new URL(`../js/${script}.js`, import.meta.url), "utf8"), context);
}
const { highlight, markdown } = context.window.AX;
const entities = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#13": "\r" };
const decodeEntities = (html) =>
  html.replace(/&(amp|lt|gt|quot|#39|#13);/g, (_, name) => entities[name]);
const span = /<span class="tok-([a-z-]+)">([^<>]*)<\/span>/g;
const tokens = (html, kind) =>
  Array.from(html.matchAll(span), ([, type, value]) => [type, decodeEntities(value)])
    .filter(([type]) => type === kind)
    .map(([, value]) => value);
function roundTrip(html, input, label) {
  const plain = html.replace(span, "$2");
  assert.equal(/&(?!(?:amp|lt|gt|quot|#39|#13);)|[<>"']/.test(plain), false, label);
  assert.equal(decodeEntities(plain), input, label);
}

const traceDir = new URL("../traces/", import.meta.url);
function loadTrace(name) {
  return traceData.restore(JSON.parse(readFileSync(new URL(`${name}.json`, traceDir), "utf8")));
}
function message(name) {
  return loadTrace(name).events.find((e) => e.packet?.jsonld && e.packet?.rdf).packet;
}

test("JSON and JSON-LD distinguish keys, strings, IRIs, scalars and punctuation", () => {
  const source = message("mortgage-main--baseline").jsonld;
  const html = highlight(source, "jsonld");
  assert.ok(tokens(html, "keyword").includes('"@context"'));
  assert.ok(tokens(html, "key").includes('"id"'));
  assert.ok(tokens(html, "iri").includes('"https://w3id.org/jeswr/awp/context/v1"'));
  assert.ok(tokens(html, "string").includes('"Invoke"'));
  const json = highlight('{"@id":0,"other":[-1.2e+3,true,false,null]}', "json");
  assert.deepEqual(tokens(json, "key"), ['"@id"', '"other"']);
  assert.deepEqual(tokens(json, "number"), ["0", "-1.2e+3"]);
  assert.deepEqual(tokens(json, "literal"), ["true", "false", "null"]);
  assert.equal(tokens(json, "punctuation").join(""), "{:,:[,,,]}");
  const ld = highlight('{"@type":"awp:Message","@graph":[{"@value":"hi","@list":[]}]}', "json-ld");
  assert.deepEqual(tokens(ld, "keyword"), ['"@type"', '"@graph"', '"@value"', '"@list"']);
  assert.deepEqual(tokens(ld, "iri"), ['"awp:Message"']);
  roundTrip(html, source);
});

test("Turtle and TriG highlight recorded terms and long literals", () => {
  const rdf = message("mortgage-main--baseline").rdf;
  // The trace supplies the terms and datatype. Use the long lexical form of its date literal.
  const stamp = '"2026-11-13T09:00:00.000Z"';
  const long = '"""2026-11-13T09:00:00.000Z"""';
  const multiline = '"""first line\ncontinued with ""quotes"" & <br>"""';
  const source = `@base <urn:test:> .\n@prefix : <urn:terms:> .\n${rdf.replace(stamp, long)}
# a comment
_:node a [ :flag true; :label "test"@en-GB; :size -0.5, +.25e-1; :note ${multiline} ] .`;
  const html = highlight(source, "turtle");
  assert.ok(tokens(html, "keyword").includes("@prefix"));
  assert.ok(tokens(html, "keyword").includes("@base"));
  assert.ok(tokens(html, "keyword").includes("a"));
  assert.ok(tokens(html, "name").includes("awp:createdAt"));
  assert.ok(tokens(html, "name").includes("xsd:dateTime"));
  assert.ok(tokens(html, "keyword").includes("^^"));
  assert.ok(tokens(html, "string").includes(long));
  assert.ok(tokens(html, "string").includes(multiline));
  assert.ok(tokens(html, "keyword").includes("@en-GB"));
  assert.ok(tokens(html, "blank").includes("_:node"));
  assert.ok(tokens(html, "number").includes("-0.5"));
  assert.ok(tokens(html, "number").includes("+.25e-1"));
  assert.ok(tokens(html, "literal").includes("true"));
  assert.deepEqual(tokens(html, "comment"), ["# a comment"]);
  assert.match(tokens(html, "punctuation").join(""), /\[/);
  roundTrip(html, source);

  const trig = message("age-check--baseline").rdf;
  assert.ok(tokens(highlight(trig, "trig"), "blank").includes("_:awp0"));
});

test("N-Triples and N-Quads highlight terms from a recorded named graph", () => {
  const rdf = message("age-check--baseline").rdf;
  const match = rdf.match(/^(<urn:[^>]+>) \{\n(<urn:[^>]+>) a awp:(\w+);/m);
  assert.ok(match, "recorded TriG contains the named graph and statement");
  const [, graph, subject, type] = match;
  const object = `<https://w3id.org/jeswr/awp#${type}>`;
  const predicate = "<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>";
  const triple = `${subject} ${predicate} ${object}`;
  const nt = `${triple} .`;
  const nq = `${triple} ${graph} .`;
  assert.deepEqual(tokens(highlight(nt, "nt"), "iri"), [subject, predicate, object]);
  assert.deepEqual(tokens(highlight(nq, "n-quads"), "iri"), [subject, predicate, object, graph]);
});

test("SPARQL highlights a recorded query, including case-insensitive keywords", () => {
  const trace = loadTrace("introduction--baseline");
  const source = JSON.stringify(trace).match(/"query":("(?:\\.|[^"\\])*")/);
  assert.ok(source, "recorded trace has a query");
  const query = JSON.parse(source[1]).replace("SELECT", "sElEcT");
  const html = highlight(query, "sparql");
  assert.deepEqual(tokens(html, "keyword"), ["sElEcT", "DISTINCT", "WHERE", "GRAPH", "^^"]);
  assert.ok(tokens(html, "variable").includes("?subject"));
  assert.ok(tokens(html, "iri").includes("<http://www.w3.org/2001/XMLSchema#boolean>"));
  roundTrip(html, query);
  const operators = highlight("FILTER(?x<5 && ?x <= 6)", "sparql");
  assert.deepEqual(tokens(operators, "number"), ["5", "6"]);
});

test("HTTP, JavaScript, TypeScript and shell highlight lightly and preserve text", () => {
  const http =
    'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nETag: "tag"\r\n\r\n{"ok":true}';
  const response = highlight(http, "http");
  assert.ok(tokens(response, "keyword").includes("HTTP/1.1"));
  assert.ok(tokens(response, "number").includes("200"));
  assert.ok(tokens(response, "key").includes("Content-Type"));
  assert.ok(tokens(response, "string").includes('"tag"'));
  assert.ok(tokens(response, "literal").includes("true"));
  roundTrip(response, http);
  for (const [lang, source, keyword, comment] of [
    ["js", 'const req = fetch("http://example.test"); // run', "const", "// run"],
    ["ts", 'export type Mode = "test"; /* choose */', "type", "/* choose */"],
    ["sh", 'export MODE="test" # choose', "export", "# choose"],
  ]) {
    const html = highlight(source, lang);
    assert.ok(tokens(html, "keyword").includes(keyword), lang);
    assert.equal(tokens(html, "string").length, 1, lang);
    assert.deepEqual(tokens(html, "comment"), [comment], lang);
    roundTrip(html, source, lang);
  }
});

test("auto-detection handles JSON primitives, nested JSON-LD and Turtle snippets", () => {
  assert.deepEqual(tokens(highlight("  null"), "literal"), ["null"]);
  assert.deepEqual(tokens(highlight('[{"key":1}'), "key"), ['"key"']);
  assert.deepEqual(tokens(highlight('[{"nested":{"\\u0040id":"urn:item"}}]'), "keyword"), [
    '"\\u0040id"',
  ]);
  assert.deepEqual(tokens(highlight('{ "hint": "{\\"@id\\":1}" }'), "keyword"), []);
  for (const source of [
    "@prefix ex: <urn:ex:> .",
    "# prefixes\nPREFIX ex: <urn:ex:>",
    "# triples\n<urn:subject> <urn:predicate> <urn:object> .",
  ]) {
    assert.ok(tokens(highlight(source), "iri").length, source);
  }
  assert.equal(highlight("plain <word> & text"), "plain &lt;word&gt; &amp; text");
  assert.equal(highlight('{"@id":"urn:item"}', "text"), "{&quot;@id&quot;:&quot;urn:item&quot;}");
  assert.equal(highlight("<unknown>", "constructor"), "&lt;unknown&gt;");
});

test("malformed tokens and injection-shaped text are escaped exactly once", () => {
  const attack = "</pre><script>'\"><img onerror=alert(1)>&amp;\r\n\uD800\uDC01\uD800 \uDC00";
  const inputs = [
    attack,
    JSON.stringify({ [attack]: attack }),
    `<urn:s> <urn:p> "unterminated ${attack}`,
    "<urn:s-no-close",
    `"unterminated ${attack}`,
    `"A${"\\\\".repeat(100_000)}${attack}`,
    JSON.stringify("x".repeat(700_000) + attack),
    "word.".repeat(100_000),
  ];
  for (const input of inputs) {
    for (const lang of [undefined, "json", "jsonld", "ttl", "sparql", "js", "sh", "http", attack]) {
      roundTrip(highlight(input, lang), input, lang);
    }
  }
  assert.equal(highlight("&amp;", "text"), "&amp;amp;");
  assert.equal(highlight('{"x":"unterminated', "json"), "{&quot;x&quot;:&quot;unterminated");
  assert.equal(highlight("<urn:s> <urn:unclosed", "ttl"), "&lt;urn:s&gt; &lt;urn:unclosed");
  assert.equal(highlight(undefined, "json"), "");
  assert.equal(
    highlight("<x>", {
      toString: () => {
        throw new Error("unsupported");
      },
    }),
    "&lt;x&gt;",
  );
});

function jsonFiles(dir) {
  return readdirSync(dir).filter((name) => name.endsWith(".json"));
}

function publishedTrace(name) {
  // bundle-data emits the committed packed trace as one compact JSON line.
  return `${JSON.stringify(JSON.parse(readFileSync(new URL(name, traceDir), "utf8")))}\n`;
}

test("the largest published trace highlights in under 200 ms", (t) => {
  let largest = { name: "", text: "", bytes: 0 };
  for (const name of jsonFiles(traceDir)) {
    const text = publishedTrace(name);
    const bytes = Buffer.byteLength(text);
    if (bytes > largest.bytes) largest = { name, text, bytes };
  }
  const start = performance.now();
  const html = highlight(largest.text);
  const elapsed = performance.now() - start;
  assert.ok(html.includes('<span class="tok-key">'));
  assert.ok(elapsed < 200, `${largest.name} took ${elapsed.toFixed(1)} ms`);
  t.diagnostic(`${largest.name} (${largest.bytes} bytes): ${elapsed.toFixed(1)} ms`);
});

test("every bundled trace document and checked-in data file round-trips", () => {
  const data = new URL("../data/", import.meta.url);
  for (const name of jsonFiles(data)) {
    const input = readFileSync(new URL(name, data), "utf8");
    roundTrip(highlight(input), input, name);
  }
  for (const name of jsonFiles(traceDir)) {
    const input = publishedTrace(name);
    roundTrip(highlight(input), input, name);
  }
});

test("every spec fence round-trips through the Markdown renderer with its language", () => {
  const specs = new URL("../../../docs/specs/agent/", import.meta.url);
  const languages = new Set();
  for (const name of readdirSync(specs).filter((name) => name.endsWith(".md"))) {
    const source = readFileSync(new URL(name, specs), "utf8");
    const expected = Array.from(
      source.matchAll(
        /^[ \t]*(\x60{3,}|~{3,})[ \t]*([\w+-]*)[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\1[ \t]*$/gm,
      ),
      ([, , lang, body]) => [lang, body.replace(/\r\n/g, "\n")],
    );
    const actual = Array.from(
      markdown(source).html.matchAll(
        /<pre><code(?: data-lang="([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g,
      ),
      ([, lang, html]) => [lang || "", html],
    );
    assert.equal(actual.length, expected.length, name);
    for (const [i, [lang, body]] of expected.entries()) {
      languages.add(lang);
      assert.equal(actual[i][0], lang, name);
      roundTrip(actual[i][1], body, name);
      assert.equal(actual[i][1].includes('<span class="tok-'), lang !== "", name);
    }
  }
  assert.ok(["", "json", "turtle"].every((lang) => languages.has(lang)));
});
