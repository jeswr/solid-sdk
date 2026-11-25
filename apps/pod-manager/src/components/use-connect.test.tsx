// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { createRegistry } from "@jeswr/pod-connectors";
import { Provenance } from "@jeswr/pod-connectors/core/provenance";
import {
  createMemoryPod,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "@jeswr/pod-connectors/testing";
import { DataFactory } from "n3";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { readProfile } from "@/lib/profile";
import type { Session } from "./session-provider";
import { useConnect } from "./use-connect";

const current = vi.hoisted(() => ({
  session: undefined as
    | Pick<Session, "webId" | "profile" | "activeStorage" | "podFetch" | "sourceFetch">
    | undefined,
}));
vi.mock("./session-provider", () => ({ useSession: () => current.session }));
afterEach(() => vi.unstubAllGlobals());

it("marks Pod Manager demo imports through the runner's default agent", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const pod = createMemoryPod();
  const sourceFetch = vi.fn<typeof fetch>(async () => {
    throw new Error("Demo import must use fixtures");
  });
  current.session = {
    webId: TEST_WEBID,
    profile: readProfile(TEST_WEBID, pod.dataset(TEST_PROFILE_DOC)),
    activeStorage: TEST_POD_ROOT,
    podFetch: pod.fetch,
    sourceFetch,
  };
  const adapter = createRegistry().adapterById("spotify");
  let connect: ReturnType<typeof useConnect> | undefined;
  function Harness() {
    connect = useConnect(adapter);
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Harness)));
    if (!connect) throw new Error("Hook did not mount");
    expect(connect.live).toBe(false);
    await act(async () => connect?.start());
    expect(connect.state.phase).toBe("done");
    const report = connect.state.report;
    if (!report) throw new Error("Demo import did not complete");
    expect(report.mode).toBe("demo");
    expect(report.state?.counts.items).toBeGreaterThan(0);
    let marked = 0;
    for (const { url } of report.written) {
      const dataset = pod.dataset(url);
      const subjects = new Set([...dataset].map((quad) => quad.subject.value));
      for (const subject of subjects) {
        if (subject === url || !subject.startsWith(`${TEST_POD_ROOT}integrations/spotify/`))
          continue;
        const [agent] = new Provenance(subject, dataset, DataFactory).attributedTo;
        expect(agent).toBe("https://jeswr.org/ns/suite#demo-connector");
        expect(new Provenance(agent, dataset, DataFactory).name).toBe("Demo data");
        marked++;
      }
    }
    expect(marked).toBeGreaterThan(0);
    expect(sourceFetch).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});
