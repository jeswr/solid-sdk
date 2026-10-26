// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  type ContentSurfaceState,
  DetailsPane,
  PodMeter,
  surfaceErrors,
  TypedView,
  type TypedViewData,
} from "@jeswr/suite-ui";
import { useState } from "react";

const states: { name: string; state: ContentSurfaceState }[] = [
  { name: "Loading", state: { status: "loading" } },
  { name: "First use", state: { status: "empty" } },
  { name: "Filtered empty", state: { status: "empty", query: "summer" } },
  ...Object.keys(surfaceErrors).map((category) => ({
    name: `Error · ${category}`,
    state: { status: "error" as const, category: category as keyof typeof surfaceErrors },
  })),
];
export type FixtureKind = "typed-view" | "details-pane" | "pod-meter";
function StateExample({
  kind,
  example,
  data,
}: {
  kind: FixtureKind;
  example: (typeof states)[number];
  data: TypedViewData;
}) {
  const [ready, setReady] = useState(false);
  const state: ContentSurfaceState = ready
    ? { status: "ready" }
    : {
        ...example.state,
        ...(example.state.status === "empty" ? { onAction: () => setReady(true) } : {}),
        ...(example.state.status === "error" ? { onRetry: () => setReady(true) } : {}),
      };
  return (
    <section data-fixture-state={example.name} className="ds12-example">
      <h2>{example.name}</h2>
      {kind === "typed-view" ? (
        <TypedView data={data} state={state} />
      ) : kind === "details-pane" ? (
        <DetailsPane
          title="Quarterly plan"
          state={state}
          access={{ grants: [], canManage: false }}
          metadata={[{ label: "Type", value: "Document" }]}
        />
      ) : (
        <PodMeter used={3100000000} quota={10000000000} state={state} />
      )}
    </section>
  );
}
export function StateFixtures({ kind, data }: { kind: FixtureKind; data: TypedViewData }) {
  return (
    <div className="ds12-grid">
      {states.map((example) => (
        <StateExample kind={kind} example={example} data={data} key={example.name} />
      ))}
    </div>
  );
}
