// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
} from "@jeswr/suite-ui";
import { type ReactNode, useState } from "react";
import { useAgentWorkspace } from "../lib/hooks";
import { createAgentSigner } from "../lib/sign";
import { useApprovalDevice } from "./approval-key-setup-sheet";

export function AgentControl({
  stopped,
  link = false,
  trigger,
  triggerLabel,
}: {
  stopped: boolean;
  link?: boolean;
  trigger?: ReactNode;
  triggerLabel?: string;
}) {
  const { session, client } = useAgentWorkspace();
  const device = useApprovalDevice();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const label = stopped ? "Resume" : "Stop the agent";
  const begin = () =>
    void device.requireKey(() => {
      setConfirmation("");
      setError(false);
      setOpen(true);
    });
  const confirm = async () => {
    if (busy || (stopped && confirmation !== "RESUME")) return;
    setBusy(true);
    setError(false);
    try {
      await createAgentSigner(session, client).signControl(stopped ? "Resume" : "Halt");
      setOpen(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {trigger ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" aria-label={triggerLabel}>
              {trigger}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={begin}>{label}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button variant={link ? "link" : "outline"} onClick={begin}>
          {label}
        </Button>
      )}
      <AlertDialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <AlertDialogContent className="agent-app">
          <AlertDialogTitle>{stopped ? "Resume your agent" : "Stop the agent"}</AlertDialogTitle>
          <AlertDialogDescription>
            {stopped
              ? "Your agent can send and act again after you resume it."
              : "Your agent will stop sending and acting until you resume it."}
          </AlertDialogDescription>
          {stopped && (
            <>
              <p>
                If you also stopped it on the agent's computer, run <code>awp resume</code> there.
              </p>
              <label htmlFor="agent-resume-confirmation">Type RESUME to confirm</label>
              <Input
                id="agent-resume-confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
              />
            </>
          )}
          {error && <p role="alert">Couldn't save this change. Try again.</p>}
          <div className="agent-row">
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              disabled={busy || (stopped && confirmation !== "RESUME")}
              onClick={() => void confirm()}
            >
              {busy ? "Saving…" : label}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
