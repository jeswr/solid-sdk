// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash } from "node:crypto";

// Model immutable Git objects and fast-forward CAS, including independent server instances.
export function feedbackGithub() {
  const hash = (value: string) => createHash("sha1").update(value).digest("hex");
  const blobs = new Map<string, string>();
  const trees = new Map<string, Map<string, string>>([[hash("tree"), new Map()]]);
  const commits = new Map([[hash("head"), { tree: hash("tree"), parents: [] as string[] }]]);
  let head = hash("head");
  const issues: { number: number; body: string; state?: string; pull_request?: object }[] = [];
  let beforeIssue = async () => {};
  let issueHeaders = {};
  let loseIssueResponse = false;
  let conflicts = 0;
  const calls: { url: string; method: string | undefined }[] = [];
  const transport: typeof fetch = async (input, options) => {
    calls.push({ url: String(input), method: options?.method });
    const url = new URL(String(input));
    const path = url.pathname.replace("/repos/private/feedback", "");
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    const method = options?.method;
    if (path === "") return Response.json({ private: true, default_branch: "team/main" });
    if (path === "/git/blobs") {
      const sha = hash(body.content);
      blobs.set(sha, body.content);
      return Response.json({ sha });
    }
    if (path === "/git/ref/heads/team/main") return Response.json({ object: { sha: head } });
    if (path.startsWith("/git/commits/") && method === "GET")
      return Response.json({ tree: { sha: commits.get(path.split("/").at(-1) ?? "")?.tree } });
    if (path.startsWith("/contents/")) {
      const tree = commits.get(url.searchParams.get("ref") ?? "")?.tree;
      const sha = trees.get(tree ?? "")?.get(path.slice("/contents/".length));
      return sha
        ? Response.json({ encoding: "base64", content: blobs.get(sha) })
        : Response.json({}, { status: 404 });
    }
    if (path === "/git/trees") {
      const tree = new Map(trees.get(body.base_tree));
      for (const entry of body.tree) tree.set(entry.path, entry.sha);
      const sha = hash(JSON.stringify([...tree]));
      trees.set(sha, tree);
      return Response.json({ sha });
    }
    if (path === "/git/commits") {
      const sha = hash(JSON.stringify(body));
      commits.set(sha, body);
      return Response.json({ sha });
    }
    if (path === "/git/refs/heads/team/main") {
      if (body.sha === head) return Response.json({});
      if (commits.get(body.sha)?.parents[0] !== head) {
        conflicts++;
        return Response.json({ message: "Update is not a fast forward" }, { status: 422 });
      }
      head = body.sha;
      return Response.json({});
    }
    if (path === "/issues" && method === "POST") {
      await beforeIssue();
      const issue = { number: 123 + issues.length, body: body.body };
      issues.push(issue);
      if (loseIssueResponse) throw new Error("Connection lost after GitHub accepted the issue");
      return Response.json(issue, { status: 201, headers: issueHeaders });
    }
    if (path === "/issues" && method === "GET") {
      const offset = (Number(url.searchParams.get("page")) - 1) * 100;
      return Response.json([...issues].reverse().slice(offset, offset + 100));
    }
    throw new Error(`Unexpected GitHub request: ${method} ${url}`);
  };
  return {
    transport,
    calls,
    issues,
    get conflicts() {
      return conflicts;
    },
    get records() {
      return [...(trees.get(commits.get(head)?.tree ?? "") ?? [])]
        .filter(([path]) => path.endsWith("/submission.json"))
        .map(([path, sha]) => ({
          path,
          record: JSON.parse(Buffer.from(blobs.get(sha) ?? "", "base64").toString()),
        }));
    },
    holdIssue(callback: () => Promise<void>) {
      beforeIssue = callback;
    },
    lowBudget() {
      issueHeaders = {
        "x-ratelimit-remaining": "49",
        "x-ratelimit-reset": String(Date.now() / 1000 + 120),
      };
    },
    loseIssueResponse() {
      loseIssueResponse = true;
    },
  };
}
