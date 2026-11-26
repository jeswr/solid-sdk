// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  toast,
} from "@jeswr/suite-ui";
import { fillLink } from "../lib/designer";
import type { FormModel } from "../lib/runtime";

export function ShareDialog({ form, close }: { form: FormModel; close: () => void }) {
  const url = fillLink(window.location.origin, form.shape);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="fm-share">
        <DialogHeader>
          <DialogTitle>Share {form.label}</DialogTitle>
          <DialogDescription>Give people a link to fill in your form.</DialogDescription>
        </DialogHeader>
        <Label htmlFor="fill-link">Fill link</Label>
        <Input id="fill-link" readOnly value={url} onFocus={(event) => event.target.select()} />
        <Button
          onClick={() => {
            if (!navigator.clipboard) {
              toast.error("Select the link and copy it manually.");
              return;
            }
            void navigator.clipboard.writeText(url).then(
              () => toast.success("Fill link copied"),
              () => toast.error("Couldn't copy the link. Select it and copy it manually."),
            );
          }}
        >
          Copy fill link
        </Button>
        <p>
          This would share the form's title, description, questions and answer choices. Responses
          remain in each respondent's pod.
        </p>
        <p>
          Copying a link doesn't change access. Public read access and response sharing will be
          handled by the Permissions tools when that integration is ready.
        </p>
      </DialogContent>
    </Dialog>
  );
}
