// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { Button } from "@jeswr/suite-ui";
import { OnlineGate } from "@jeswr/suite-ui/sync";
import type { ReactNode } from "react";
import type { OpenWithControl } from "../state/open-with";

/** Preview action shared by Drive's editor adapters. */
export function OpenWithButton({
  control,
  name,
  icon,
}: {
  control: OpenWithControl | undefined;
  name: string;
  icon: ReactNode;
}) {
  if (!control) return null;
  const reason = control.kind === "convert" ? control.disabledReason : undefined;
  const button = (
    <Button
      variant="outline"
      size="sm"
      className="drv-open-with"
      disabled={reason !== undefined || control.pending}
      aria-busy={control.pending || undefined}
      onClick={() => void control.run()}
    >
      {icon}
      <span>Open with {name}</span>
    </Button>
  );
  return reason ? (
    <OnlineGate online={false} reason={reason}>
      {button}
    </OnlineGate>
  ) : (
    button
  );
}
