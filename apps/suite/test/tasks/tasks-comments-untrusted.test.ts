// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { TaskCommentStore } from "../../src/apps/tasks/lib/model/comments";
import { type Node, NS, node, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { webId } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

const OA = "http://www.w3.org/ns/oa#";
const FORMAT = "http://purl.org/dc/elements/1.1/format";
const changes: [string, (annotation: Node, body: Node) => void][] = [
  ["missing type", (a) => a.types.clear()],
  ["literal type", (a) => a.setText(`${NS.RDF}type`, "wrong")],
  ["missing body", (a) => a.clear(`${OA}hasBody`)],
  ["literal body", (a) => a.setText(`${OA}hasBody`, "wrong")],
  ["external body", (a) => a.setIri(`${OA}hasBody`, "https://evil.test/body")],
  ["body missing type", (_, b) => b.types.clear()],
  ["HTML body", (_, b) => b.setText(FORMAT, "text/html")],
  ["non-literal text", (_, b) => b.setIri(`${NS.RDF}value`, "https://evil.test/")],
  ["non-string text", (_, b) => b.setNumber(`${NS.RDF}value`, 1)],
  ["blank text", (_, b) => b.setText(`${NS.RDF}value`, " ")],
  ["missing text", (_, b) => b.clear(`${NS.RDF}value`)],
  ["non-literal format", (_, b) => b.setIri(FORMAT, "https://evil.test/")],
  ["invalid date", (a) => a.setTyped(`${NS.DCT}created`, "bad", `${NS.XSD}dateTime`)],
  ["untyped date", (a) => a.setText(`${NS.DCT}created`, "2026-11-11")],
  ["non-literal date", (a) => a.setIri(`${NS.DCT}created`, "https://evil.test/")],
  ["missing creator", (a) => a.clear(`${NS.DCT}creator`)],
  ["literal creator", (a) => a.setText(`${NS.DCT}creator`, webId)],
  ["unsafe creator", (a) => a.setIri(`${NS.DCT}creator`, "javascript:alert(1)")],
  ["multiple creators", (a) => a.iris(`${NS.DCT}creator`).add("https://bob.test/#me")],
  ["unsupported motivation", (a) => a.setIri(`${OA}motivatedBy`, `${OA}tagging`)],
  ["missing motivation", (a) => a.clear(`${OA}motivatedBy`)],
  ["foreign task target", (a) => a.setIri(`${OA}hasTarget`, "https://evil.test/task#it")],
  [
    "reply target missing fragment",
    (a) => {
      a.setIri(`${OA}motivatedBy`, `${OA}replying`);
      a.setIri(`${OA}hasTarget`, "https://evil.test/task");
    },
  ],
  [
    "reply target wrong extension",
    (a) => {
      a.setIri(`${OA}motivatedBy`, `${OA}replying`);
      a.setIri(`${OA}hasTarget`, `${new URL("./", a.value).href}bad.txt#it`);
    },
  ],
];
describe("untrusted task annotations", () => {
  it.each([
    undefined,
    "https://pod.test/alice/tasks?x=/",
    "https://pod.test/alice/tasks/#fragment/",
    "https://pod.test/alice/tasks",
    "https://pod.test/alice/other/../tasks/",
  ])("rejects invalid stateStore %s before fetch", async (folder) => {
    const { store, inbox, pod } = await frameCache();
    const task = await store.createTask(inbox, { state: "open", title: "Task" });
    inbox.tracker.stateStore = folder;
    const before = pod.requests.length;
    expect(() => store.comments(inbox, task)).toThrow();
    expect(pod.requests).toHaveLength(before);
  });
  it.each(changes)("skips %s while retaining valid resources", async (_, change) => {
    const { store, inbox, pod } = await frameCache();
    const task = await store.createTask(inbox, { state: "open", title: "Task" });
    const comments = store.comments(inbox, task);
    const valid = await comments.create("Valid");
    const invalid = await comments.create("Invalid");
    const dataset = await pod.dataset(invalid.url);
    const annotation = node(invalid.id, dataset);
    const body = [...annotation.nodes(`${OA}hasBody`)][0] as Node;
    change(annotation, body);
    pod.seed(invalid.url, await serialize(dataset));
    expect(await comments.list()).toEqual([{ root: valid, replies: [] }]);
  });

  it("ignores outside, nested, malformed, inaccessible, redirected and non-Turtle children", async () => {
    const { store, inbox, pod } = await frameCache();
    const task = await store.createTask(inbox, { state: "open", title: "Task" });
    const comments = store.comments(inbox, task);
    const valid = await comments.create("Valid");
    const listing = await pod.dataset(comments.container);
    const urls = [
      "https://evil.test/steal.ttl",
      `${comments.container}nested/child.ttl`,
      `${comments.container}encoded%2fchild.ttl`,
      `${comments.container}query.ttl?x=1`,
      `${comments.container}fragment.ttl#it`,
      `${comments.container}notes.txt`,
    ];
    for (const url of urls) node(comments.container, listing).iris(`${NS.LDP}contains`).add(url);
    pod.seed(comments.container, await serialize(listing));
    pod.seed(`${comments.container}invalid.ttl`, "<bad");
    pod.seed(`${comments.container}denied.ttl`, "");
    pod.seed(`${comments.container}redirect.ttl`, "");
    pod.intercept = (request) => {
      if (request.url.endsWith("denied.ttl")) return new Response(null, { status: 403 });
      if (request.url.endsWith("redirect.ttl")) {
        const response = new Response("", { headers: { "Content-Type": "text/turtle" } });
        Object.defineProperty(response, "url", { value: "https://evil.test/changed.ttl" });
        return response;
      }
    };
    expect(await comments.list()).toEqual([{ root: valid, replies: [] }]);
    expect(pod.requests.some((request) => urls.includes(request.url))).toBe(false);
    await expect(comments.edit({ ...valid, url: urls[0] as string }, "Attack")).rejects.toThrow(
      "Invalid comment location",
    );
  });

  it("validates project stateStores and task ownership before authenticated fetch", async () => {
    const { store, inbox, pod } = await frameCache();
    const task = await store.createTask(inbox, { state: "open", title: "Task" });
    const before = pod.requests.length;
    expect(
      () =>
        new TaskCommentStore(
          inbox,
          { ...task, url: "https://evil.test/task.ttl" },
          webId,
          pod.fetch,
        ),
    ).toThrow("Invalid comment task");
    inbox.tracker.stateStore = "https://evil.test/";
    expect(() => store.comments(inbox, task)).toThrow();
    expect(pod.requests).toHaveLength(before);
  });

  it("fails conditional edits if a comment changes between the validating read and PUT", async () => {
    const { store, inbox, pod } = await frameCache();
    const task = await store.createTask(inbox, { state: "open", title: "Task" });
    const comments = store.comments(inbox, task);
    const root = await comments.create("Original");
    pod.intercept = (request) => {
      if (request.method === "PUT" && request.url === root.url)
        pod.seed(root.url, pod.files.get(root.url)?.body ?? "");
    };
    await expect(comments.edit(root, "Lost")).rejects.toMatchObject({ status: 412 });
    expect((await comments.list())[0]?.root.text).toBe("Original");
  });
});
