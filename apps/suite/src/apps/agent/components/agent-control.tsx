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
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useAgentWorkspace } from "../lib/hooks";
import { createAgentSigner } from "../lib/sign";
import { useApprovalDevice } from "./approval-key-setup-sheet";

export function AgentControl({
  stopped,
  unknown = false,
  localStop = false,
  link = false,
  trigger,
  triggerLabel,
  request = 0,
}: {
  stopped: boolean;
  unknown?: boolean;
  /**
   * The agent reports a stop that has no signed owner Halt (for example `awp halt` on its
   * computer). Resume is offered alongside Stop; it still needs a signed, confirmed Resume.
   */
  localStop?: boolean;
  link?: boolean;
  trigger?: ReactNode;
  triggerLabel?: string;
  request?: number;
}) {
  const { session, client } = useAgentWorkspace();
  const device = useApprovalDevice();
  const [open, setOpen] = useState(false);
  const [resume, setResume] = useState(stopped);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const label = stopped ? "Resume" : "Stop the agent";
  // An extra Resume, never derived from unsigned state alone: confirming it signs a Resume.
  const extraResume = !stopped && (unknown || localStop);
  const begin = (resume: boolean) =>
    void device.requireKey(() => {
      setResume(resume);
      setConfirmation("");
      setError(false);
      setOpen(true);
    });
  const beginRef = useRef(begin);
  beginRef.current = begin;
  useEffect(() => {
    if (request > 0) beginRef.current(false);
  }, [request]);
  const confirm = async () => {
    if (busy || (resume && confirmation !== "RESUME")) return;
    setBusy(true);
    setError(false);
    try {
      await createAgentSigner(session, client).signControl(resume ? "Resume" : "Halt");
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
            <Button ref={triggerRef} variant="ghost" aria-label={triggerLabel}>
              {trigger}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => begin(stopped)}>{label}</DropdownMenuItem>
            {extraResume && (
              <DropdownMenuItem onSelect={() => begin(true)}>Resume</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <>
          <Button
            ref={triggerRef}
            variant={link ? "link" : "outline"}
            onClick={() => begin(stopped)}
          >
            {label}
          </Button>
          {extraResume && (
            <Button variant={link ? "link" : "outline"} onClick={() => begin(true)}>
              Resume
            </Button>
          )}
        </>
      )}
      <AlertDialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <AlertDialogContent
          className="agent-app"
          aria-busy={busy}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <AlertDialogTitle>{resume ? "Resume your agent" : "Stop the agent"}</AlertDialogTitle>
          <AlertDialogDescription>
            {resume
              ? "Your agent can send and act again after you resume it."
              : "Your agent will stop sending and acting until you resume it."}
          </AlertDialogDescription>
          {resume && (
            <>
              {localStop && !stopped && (
                <p>
                  Your agent says it was stopped on its computer. Resuming here records that you
                  want it running again.
                </p>
              )}
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
              aria-busy={busy}
              disabled={busy || (resume && confirmation !== "RESUME")}
              onClick={() => void confirm()}
            >
              {busy ? "Saving…" : resume ? "Resume" : "Stop the agent"}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
