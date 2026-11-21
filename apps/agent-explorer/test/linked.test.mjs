// AUTHORED-BY Codex GPT-6.2 Sol
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import traceData from "../js/trace-data.js";

const window = {};
vm.runInNewContext(readFileSync(new URL("../js/highlight.js", import.meta.url), "utf8"), {
  window,
});
const linked = () => {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(new URL("../js/linked.js", import.meta.url), "utf8"), {
    window,
    module,
  });
  return module.exports;
};
const context = "https://w3id.org/jeswr/awp/context/store/v1";
const jsonld = JSON.stringify({ label: "<img src=x onerror=alert(1)>", "@context": context });
const turtle = '<urn:item> <urn:label> "<img src=x onerror=alert(1)>" .\n';
const tableEntry = { what: "memory-item", jsonld, context, turtle };
const unhighlight = (html) =>
  html
    .replace(/<\/?span[^>]*>/g, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
const panes = (html) =>
  [...html.matchAll(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)].map((match) => match[1]);

test("packet and store views highlight both panes and fold the context", () => {
  const { html, packet } = linked();
  for (const input of [packet({ jsonld, context, rdf: turtle }), tableEntry]) {
    const folded = html(input, { id: "test" });
    const [json, rdf] = panes(folded);
    assert.equal(panes(folded).length, 2);
    assert.equal(unhighlight(json), JSON.stringify({ label: JSON.parse(jsonld).label }, null, 2));
    assert.equal(unhighlight(rdf), turtle);
    assert.match(json, /tok-key/);
    assert.match(rdf, /tok-iri/);
    assert.doesNotMatch(folded, /<img/i);
    assert.match(folded, /aria-expanded="false"[^>]*>Show context/);
    const shown = html(input, { id: "test", context: true });
    assert.equal(
      unhighlight(panes(shown)[0]),
      JSON.stringify({ "@context": context, label: JSON.parse(jsonld).label }, null, 2),
    );
    assert.match(shown, /Open the context/);
  }
});

test("single formats and old packets still render", () => {
  const { html, packet, entries } = linked();
  for (const input of [{ turtle }, { jsonld }, packet({ trig: turtle })]) {
    const result = html(input, { id: "test" });
    assert.equal(panes(result).length, 1);
    assert.match(result, /not recorded/);
  }
  assert.match(html(packet({ trig: turtle }), { id: "test" }), />TriG</);
  assert.equal(html(packet({}), { id: "test" }), "");
  assert.equal(entries({}, {}).length, 0);
  assert.equal(entries({}, { linked: ["constructor", "__proto__"] }).length, 0);
});

test("restoring an explorer copy preserves linked views", () => {
  const { entries } = linked();
  const key = "sha-256:" + "a".repeat(64);
  const trace = traceData.restore({
    linked: { [key]: tableEntry },
    events: [{ linked: [key], fact: null }],
    explorerCopy: {
      encoding: "event-values/1",
      values: [{ label: "fact" }],
      refs: [[["events", 0, "fact"], 0]],
    },
  });
  assert.equal(entries(trace, trace.events[0])[0], tableEntry);
  assert.deepEqual(trace.events[0].fact, { label: "fact" });
});
