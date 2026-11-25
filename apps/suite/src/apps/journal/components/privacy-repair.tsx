// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@jeswr/suite-ui";
import { useState } from "react";

export function PrivacyRepair({ makePrivate }: { makePrivate: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const explanation =
    "This removes other people's access to the journal folder and its inherited entries.";
  return (
    <>
      <p>{explanation}</p>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogTrigger asChild>
          <Button>Make my journal private</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make your journal private?</DialogTitle>
            <DialogDescription>{explanation}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirming(false);
                makePrivate();
              }}
            >
              Make private
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
