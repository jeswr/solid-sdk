// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Input, Label, TooltipProvider } from "@jeswr/suite-ui";
import { useMemo, useState } from "react";
import { MemorySharingAdapter } from "../../../../shell/share/memory-adapter";
import { RequestAccess } from "../../../../shell/share/request-access";
import { ShareDialog } from "../../../../shell/share/share-dialog";
import type { ShareCapabilities, ShareKind, SharingState } from "../../../../shell/share/types";

const url = "https://example.org/storage/projects/";
const capabilityLabels: Record<keyof ShareCapabilities, string> = {
  publicLinks: "Link sharing",
  authenticatedAgentGrants: "Signed-in access",
  grantExpiry: "Expiring access",
  grantPurpose: "Grant purpose",
  notifyAgents: "Notify people",
  accessRequests: "Access requests",
  managerRole: "Manager role",
};
const initialCaps: ShareCapabilities = {
  publicLinks: true,
  authenticatedAgentGrants: true,
  grantExpiry: true,
  grantPurpose: true,
  notifyAgents: true,
  accessRequests: true,
  managerRole: true,
};
export function ShareDialogFixture() {
  const [fixture, setFixture] = useState("restricted");
  const [kind, setKind] = useState<ShareKind>("document");
  const [caps, setCaps] = useState(initialCaps);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const adapter = useMemo(() => {
    const initial: SharingState = {
      people: [
        { webId: "https://example.org/rowan#me", name: "Rowan Vale", role: "owner" },
        { webId: "https://example.org/ash#me", name: "Ash Reed", role: "editor" },
        {
          webId: "https://example.org/ivo#me",
          name: "Ivo Marsh",
          role: "viewer",
          inherited: { from: "https://example.org/storage/", fromName: "My storage" },
        },
        {
          webId: "https://example.org/wren#me",
          name: "Wren Hale",
          role: "viewer",
          expires: new Date("2027-06-01T12:00:00Z"),
        },
      ],
      general: fixture === "link" ? { mode: "link", role: "viewer" } : { mode: "restricted" },
      canManage: true,
      ...(fixture === "forbidden" || fixture === "offline" ? { readOnly: fixture } : {}),
    };
    return new MemorySharingAdapter(initial, fixture === "slow" ? 1200 : 120);
  }, [fixture]);
  return (
    <TooltipProvider>
      <main className="fixture-page grid min-w-0 gap-4" id="main-content" tabIndex={-1}>
        <h1>Share dialog</h1>
        <a href="/dev/components">All component fixtures</a>
        <Label htmlFor="share-fixture">Fixture state</Label>
        <select
          className="su-input"
          id="share-fixture"
          value={fixture}
          onChange={(event) => {
            setFixture(event.target.value);
            setStatus("");
          }}
        >
          {["restricted", "link", "forbidden", "offline", "slow", "request"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <Label htmlFor="share-kind">Item kind</Label>
        <select
          className="su-input"
          id="share-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as ShareKind)}
        >
          {["document", "file", "folder", "chatroom"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <fieldset className="grid gap-3">
          <legend>Storage capabilities</legend>
          {Object.entries(capabilityLabels).map(([key, label]) => (
            <label className="flex min-h-6 items-center gap-2" key={key} htmlFor={`cap-${key}`}>
              <Input
                id={`cap-${key}`}
                className="size-6"
                type="checkbox"
                checked={caps[key as keyof ShareCapabilities]}
                onChange={(event) =>
                  setCaps((before) => ({ ...before, [key]: event.target.checked }))
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setOpen(true)}>Open share dialog</Button>
          <Button
            variant="outline"
            onClick={() => {
              adapter.failNext("forbidden");
              setStatus("Next operation will be forbidden");
            }}
          >
            Fail next: forbidden
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              adapter.failNext("network");
              setStatus("Next operation will fail to connect");
            }}
          >
            Fail next: network
          </Button>
        </div>
        <p role="status">{status}</p>
        {fixture === "request" && (
          <section aria-label="No access">
            <h2>You don't have access to this</h2>
            <RequestAccess
              key={String(caps.accessRequests)}
              url={url}
              adapter={adapter}
              caps={caps}
              onCopyAccountId={() => navigator.clipboard.writeText("https://example.org/sage#me")}
            />
          </section>
        )}
        <ShareDialog
          key={fixture}
          open={open}
          onOpenChange={setOpen}
          url={url}
          name="Project notes"
          kind={kind}
          adapter={adapter}
          caps={caps}
          suiteHref="https://suite.example.org/docs/d/project-notes"
          contacts={[
            {
              webId: "https://example.org/sage#me",
              displayName: "Sage Brook",
              emails: ["sage@example.org"],
            },
          ]}
        />
      </main>
    </TooltipProvider>
  );
}
