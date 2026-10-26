// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { type AccessSummary, DetailsPane } from "@jeswr/suite-ui";
import { useState } from "react";

const grant = (id: number) => ({
  agent: { kind: "webid" as const, webId: `https://person.example/${id}` },
  role: "viewer" as const,
  inherited: id === 1,
  source: "https://pod.example/.acl",
});
export function DetailsFixtures() {
  const [action, setAction] = useState("");
  const access: AccessSummary = {
    grants: Array.from({ length: 7 }, (_, id) => grant(id)),
    canManage: true,
  };
  return (
    <>
      <div className="ds12-grid">
        <section className="ds12-example">
          <h2>Shared document</h2>
          <DetailsPane
            title="Quarterly plan"
            ownerId="https://me.example"
            access={access}
            people={{
              "https://person.example/0": "Mira Osei",
              "https://person.example/1": "Ben Kim",
            }}
            onManageAccess={() => setAction("Manage access selected")}
            actions={
              <button type="button" onClick={() => setAction("Download selected")}>
                Download
              </button>
            }
            metadata={[
              { label: "Type", value: "Document" },
              { label: "Size", value: "184 KB" },
              { label: "Location", value: <a href="/dev/components/details-pane">My Drive</a> },
              { label: "Modified", value: "26 Oct 2026, 09:14" },
              { label: "Created", value: "14 Sep 2026" },
              { label: "Owner", value: "Me" },
            ]}
          />
        </section>
        <section className="ds12-example">
          <h2>Private document</h2>
          <DetailsPane
            title="Studio notes"
            access={{ grants: [], canManage: false }}
            metadata={[
              { label: "Type", value: "Document" },
              { label: "Owner", value: "Me" },
            ]}
          />
        </section>
        <section className="ds12-example">
          <h2>Public link</h2>
          <DetailsPane
            title="Welcome"
            access={{
              grants: [
                {
                  agent: { kind: "public" },
                  role: "viewer",
                  inherited: false,
                  source: "https://pod.example/.acl",
                },
              ],
              canManage: false,
            }}
            metadata={[{ label: "Type", value: "Document" }]}
          />
        </section>
        <section className="ds12-example">
          <h2>Multiple items</h2>
          <DetailsPane selection={{ count: 3, totalSize: 9000000 }} />
        </section>
        <section className="ds12-example">
          <h2>Access loading</h2>
          <DetailsPane title="Project notes" metadata={[{ label: "Type", value: "Document" }]} />
        </section>
        <section className="ds12-example">
          <h2>Access error</h2>
          <DetailsPane
            title="Project notes"
            accessState={{ status: "error", category: "forbidden" }}
            metadata={[{ label: "Type", value: "Document" }]}
          />
        </section>
      </div>
      <p role="status">{action}</p>
    </>
  );
}
