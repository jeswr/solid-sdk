// AUTHORED-BY Codex GPT-6.1-Sol
// Separate Node process so the demo exercises native TS loading, HTTP and process cleanup.
import { seedOwner, startCss } from "../demos/css.ts";
import { seedWalkthrough } from "../demos/scenario.ts";
import { runDemo } from "../demos/walkthrough.ts";

const css = await startCss();
try {
  const account = await seedOwner(css.origin, css.anonymous);
  for (const url of [new URL("../", account.root).href, `${account.root}../other/`]) {
    let denied = false;
    try {
      await account.authenticated(url);
    } catch {
      denied = true;
    }
    if (!denied) throw new Error("Owner transport escaped the pod");
  }
  let foreignDenied = false;
  try {
    await css.anonymous("https://pod.example/");
  } catch {
    foreignDenied = true;
  }
  if (!foreignDenied) throw new Error("Local transport escaped CSS");
  await seedWalkthrough({
    pod: account.root,
    owner: account.owner,
    io: account.authenticated,
    anonymous: css.anonymous,
    print: () => {},
  });
  const snapshots = new Map();
  const counting = async (input, init) => {
    if (init?.method && init.method !== "GET") throw new Error("Replay attempted a mutation");
    if (init?.credentials !== "omit") throw new Error("Replay attempted credentials");
    const headers = new Headers(init.headers);
    if (["authorization", "cookie", "dpop"].some((name) => headers.has(name)))
      throw new Error("Replay attempted authentication");
    const result = await css.anonymous(input, init);
    if (result.status === 200) {
      const etag = result.headers.get("etag");
      if (!etag) throw new Error("CSS evidence lacks a validator");
      snapshots.set(String(input), { etag, headers: init.headers });
    }
    return result;
  };
  // Exercise the same anonymous replay and the actual --base dispatch separately.
  const { replay } = await import("../demos/walkthrough.ts");
  if ((await replay(account.root, counting, () => {})) !== 0) throw new Error("Replay failed");
  if (snapshots.size < 10) throw new Error("Replay did not walk public evidence");
  const lines = [];
  if ((await runDemo(["--base", account.root], (line) => lines.push(line))) !== 0)
    throw new Error("Base replay failed");
  for (const [url, before] of snapshots) {
    const after = await css.anonymous(url, {
      headers: before.headers,
      credentials: "omit",
      redirect: "manual",
    });
    if (after.status !== 200 || after.headers.get("etag") !== before.etag)
      throw new Error("Replay changed a resource");
  }
  console.log("READ-ONLY PASS: six audits, no authentication or writes, unchanged public evidence");
  if ((await runDemo(["--base", new URL("unprepared/", account.root).href], () => {})) !== 1)
    throw new Error("Unprepared base unexpectedly passed");
  console.log("UNPREPARED PASS: missing walkthrough fails without provisioning or login");
  // Replace missing PROV with unrelated, corrupt evidence: its different breach must fail the demo.
  const missing = new URL("demos/d3/missing-prov/agent/audit/3.ttl", account.root).href;
  const intact = new URL("demos/d3/approved/agent/audit/3.ttl", account.root).href;
  const response = await account.authenticated(intact);
  const restored = await account.authenticated(missing, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: (await response.text()).replaceAll("/approved/", "/missing-prov/"),
  });
  if (!restored.ok) throw new Error("Could not change counterexample");
  // Wrong hashed PROV remains a failure, but must not count as the expected missing entry.
  if ((await runDemo(["--base", account.root], () => {})) !== 1)
    throw new Error("Unexpected negative result accepted");
  console.log("MISMATCH PASS: an unrelated audit failure cannot satisfy a named negative case");
} finally {
  await css.stop();
}
