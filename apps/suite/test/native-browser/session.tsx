// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { createDemoPod } from "@/lib/demo-pod/pod";
import type { SessionState } from "@/lib/session/types";

export type { DemoPodSession, ExtensionPodSession, PodSession } from "@/lib/session/types";

const loading: SessionState = {
  status: "loading",
  extension: { present: false, granted: false, webId: null },
  connectExtension: async () => {},
};
const Context = createContext<SessionState>(loading);

/** Fixed in-memory pod; an extension-shaped session avoids any authentication/network path. */
export function PodSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(loading);
  useEffect(() => {
    const root = "https://native-browser.pod/";
    const pod = createDemoPod({
      root,
      now: () => 1793491200000,
      seed: ["alpha/", "beta/", "gamma/"].map((path) => ({
        path,
        body: "",
        contentType: "text/turtle",
      })),
    });
    setState({
      ...loading,
      status: "ready",
      session: {
        mode: "extension",
        webId: `${root}profile/card#me`,
        displayName: "Native browser fixture",
        storageUrl: root,
        fetch: pod.fetch,
        publicFetch: pod.fetch,
        subscribe: pod.subscribe,
        disconnect: async () => {},
      },
    });
  }, []);
  return <Context.Provider value={state}>{children}</Context.Provider>;
}

export function usePodSessionState(): SessionState {
  return useContext(Context);
}
