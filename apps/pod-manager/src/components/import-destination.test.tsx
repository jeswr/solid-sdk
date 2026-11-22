// AUTHORED-BY Codex GPT-6
import { createRequire } from "node:module";
import { createRegistry, fileAdapterById } from "@jeswr/pod-connectors";
import {
  createMemoryPod,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "@jeswr/pod-connectors/testing";
import { Authorization } from "@solid/object";
import { DataFactory, Store } from "n3";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeTurtle } from "@/lib/pod-data";
import { readProfile } from "@/lib/profile";
import { useSession } from "./session-provider";
import { useConnect } from "./use-connect";
import { useFileImport } from "./use-file-import";

vi.mock("./session-provider", () => ({ useSession: vi.fn() }));
vi.mock("@/lib/integrations/registry", () => ({ isLive: () => false }));

afterEach(() => vi.unstubAllGlobals());

const parent = `${TEST_POD_ROOT}integrations/`;
const bankAdapter = fileAdapterById("bank-statements");
const whoopAdapter = createRegistry().adapterById("whoop");
const bankFile = () =>
  new File(["Date,Description,Amount,Currency\n2026-06-01,Shop,-5.25,GBP"], "bank.csv");
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string) => { window: Window & typeof globalThis };
};

async function grantPublicRead(pod: ReturnType<typeof createMemoryPod>) {
  const aclUrl = `${parent}.acl`;
  const dataset = new Store();
  const auth = new Authorization(DataFactory.namedNode(`${aclUrl}#public`), dataset, DataFactory);
  auth.type.add("http://www.w3.org/ns/auth/acl#Authorization");
  auth.accessTo = parent;
  auth.default = parent;
  auth.agentClass.add("http://xmlns.com/foaf/0.1/Agent");
  auth.canRead = true;
  await pod.fetch(aclUrl, { method: "PUT", body: await serializeTurtle(dataset) });
}

describe.each(["bank file", "WHOOP API"] as const)("%s import destination", (flow) => {
  it.each(["owner-only", "public parent"] as const)("handles %s storage", async (policy) => {
    // Mount React in a DOM while keeping fetch and its byte streams in the Node realm.
    const { window } = new JSDOM("<!doctype html><html><body></body></html>");
    vi.stubGlobal("window", window);
    vi.stubGlobal("document", window.document);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const pod = createMemoryPod();
    if (policy === "public parent") await grantPublicRead(pod);
    const podFetch = vi.fn(pod.fetch);
    const unrelatedFetch = vi.fn<typeof fetch>(() => {
      throw new Error("The import should use the authenticated Pod transport");
    });
    vi.stubGlobal("fetch", unrelatedFetch);
    const profile = readProfile(TEST_WEBID, pod.dataset(TEST_PROFILE_DOC));
    vi.mocked(useSession, { partial: true }).mockReturnValue({
      webId: TEST_WEBID,
      profile: { ...profile, storages: ["https://other.test/unused/"] },
      activeStorage: TEST_POD_ROOT,
      podFetch,
      sourceFetch: unrelatedFetch,
    });
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.createElement("div"));
    let fileImport: ReturnType<typeof useFileImport> | undefined;
    let apiImport: ReturnType<typeof useConnect> | undefined;
    function Harness() {
      fileImport = useFileImport(bankAdapter);
      apiImport = useConnect(whoopAdapter);
      return null;
    }
    try {
      await act(async () => root.render(<Harness />));
      await act(async () => {
        if (flow === "bank file") await fileImport?.importFile(bankFile());
        else await apiImport?.start();
      });
      const state = flow === "bank file" ? fileImport?.state : apiImport?.state;
      const writes = podFetch.mock.calls.filter(([, init]) =>
        ["PUT", "POST", "PATCH", "DELETE"].includes(init?.method ?? "GET"),
      );
      if (policy === "owner-only") {
        expect(state?.phase, state?.error?.message).toBe("done");
        expect(state?.report?.written.length).toBeGreaterThan(0);
        expect(writes.length).toBeGreaterThan(0);
        expect(writes.every(([url]) => String(url).startsWith(TEST_POD_ROOT))).toBe(true);
      } else {
        expect(state).toMatchObject({ phase: "error", error: { name: "PrivateDestinationError" } });
        expect(writes).toEqual([]);
        expect(
          podFetch.mock.calls.some(
            ([url, init]) => url === `${parent}.acl` && (init?.method ?? "GET") === "GET",
          ),
        ).toBe(true);
      }
      expect(unrelatedFetch).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      window.close();
    }
  });
});
