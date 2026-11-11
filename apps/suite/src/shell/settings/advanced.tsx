// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button } from "@jeswr/suite-ui";
import { useCapabilities } from "@jeswr/suite-ui/sync";
import { usePathname } from "next/navigation";
import { CopyButton } from "../account/account-card";
import { diagnostics } from "../lib/settings-diagnostics";
import { InstallApp } from "./install-app";
import { useAllPreferences, usePreferences } from "./preferences";

export function AdvancedSettings() {
  const technical = usePreferences("technicalDetails");
  const ids = usePreferences("accountIds");
  const { preferences } = useAllPreferences();
  const caps = useCapabilities();
  const pathname = usePathname();
  return (
    <>
      <InstallApp />
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={technical.value}
          onChange={(event) => technical.update(event.target.checked)}
        />
        Show technical details
      </label>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={ids.value}
          onChange={(event) => ids.update(event.target.checked)}
        />
        Show Account IDs in lists
      </label>
      <section aria-labelledby="developer-settings">
        <h2 id="developer-settings">Developer</h2>
        <h3 id="current-capabilities">Current capabilities</h3>
        <pre>{JSON.stringify(caps, null, 2)}</pre>
        <CopyButton value={JSON.stringify(caps, null, 2)} label="Copy capabilities" />
        <Button
          className="justify-self-start"
          variant="outline"
          onClick={() => {
            const data = diagnostics({
              version: process.env.NEXT_PUBLIC_SUITE_VERSION ?? "preview",
              route: pathname,
              caps,
              preferences,
            });
            const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = "solid-suite-diagnostics.json";
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Download diagnostics
        </Button>
      </section>
    </>
  );
}
