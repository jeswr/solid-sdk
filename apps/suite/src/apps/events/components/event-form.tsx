// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import type { EventData, Invitation, InviteeData } from "@jeswr/solid-events";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from "@jeswr/suite-ui";
import { useState } from "react";
import { invitationForm, inviteesFromText, localDateTime } from "../lib/forms";

export function EventForm({
  open,
  onClose,
  owner,
  existing,
  onSave,
}: {
  open: boolean;
  onClose(): void;
  owner: string;
  existing?: Invitation;
  onSave(data: EventData, invitees: InviteeData[]): void;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ data: EventData; invitees: InviteeData[] }>();
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent className="ev-form-dialog">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit invitation" : "Make a little occasion"}</DialogTitle>
          <DialogDescription>
            {existing
              ? "Update the details. Your guests keep the same invitation link."
              : "A good time starts with an invitation. Save it in your pod."}
          </DialogDescription>
        </DialogHeader>
        {pending && (
          <section aria-labelledby="ev-publish-title">
            <h3 id="ev-publish-title">Publish this invitation?</h3>
            <p>
              The invitation will become readable by{" "}
              {pending.data.visibility === "link" ? "anyone with the link" : "your invited WebIDs"}{" "}
              and guests can reply.
            </p>
            <div className="ev-actions">
              <Button type="button" variant="outline" onClick={() => setPending(undefined)}>
                Keep editing
              </Button>
              <Button
                type="button"
                onClick={() => {
                  onSave(pending.data, pending.invitees);
                  onClose();
                }}
              >
                Confirm publication
              </Button>
            </div>
          </section>
        )}
        <form
          hidden={!!pending}
          className="ev-form"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const form = new FormData(event.currentTarget);
              const data = invitationForm(form, owner, existing);
              const invitees = inviteesFromText(String(form.get("invitees") ?? ""));
              if (
                data.publication === "published" &&
                data.visibility === "invitees" &&
                !existing &&
                !invitees.length
              )
                throw new Error("Add at least one invitee WebID, or choose anyone with the link");
              if (existing?.publication === "draft" && data.publication === "published") {
                setPending({ data, invitees });
                return;
              }
              onSave(data, invitees);
              onClose();
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : "Please check your invitation");
            }
          }}
        >
          <div>
            <Label htmlFor="ev-name">Event name</Label>
            <Input
              id="ev-name"
              name="name"
              required
              maxLength={200}
              defaultValue={existing?.name}
              placeholder="Supper, stories & good company"
            />
          </div>
          <div>
            <Label htmlFor="ev-description">A little more about it</Label>
            <Textarea
              id="ev-description"
              name="description"
              maxLength={10000}
              defaultValue={existing?.description}
              placeholder="What should your guests know?"
            />
          </div>
          <div className="ev-form-grid">
            <div>
              <Label htmlFor="ev-start">Starts</Label>
              <Input
                id="ev-start"
                name="startDate"
                type="datetime-local"
                required
                defaultValue={localDateTime(existing?.startDate)}
              />
            </div>
            <div>
              <Label htmlFor="ev-end">Ends (optional)</Label>
              <Input
                id="ev-end"
                name="endDate"
                type="datetime-local"
                defaultValue={localDateTime(existing?.endDate)}
              />
            </div>
          </div>
          <div className="ev-form-grid">
            <div>
              <Label htmlFor="ev-location">Place</Label>
              <Input
                id="ev-location"
                name="location"
                defaultValue={existing?.location}
                placeholder="The kitchen table"
              />
            </div>
            <div>
              <Label htmlFor="ev-address">Address (optional)</Label>
              <Input id="ev-address" name="address" defaultValue={existing?.address} />
            </div>
          </div>
          <div>
            <Label htmlFor="ev-online">Online meeting URL (optional)</Label>
            <Input
              id="ev-online"
              name="onlineUrl"
              type="url"
              defaultValue={existing?.onlineUrl}
              placeholder="https://…"
            />
          </div>
          <div>
            <Label htmlFor="ev-image">Cover image URL (optional)</Label>
            <Input id="ev-image" name="image" type="url" defaultValue={existing?.image} />
            <p className="ev-muted">Shown on your invitation and its guest page.</p>
          </div>
          <div className="ev-form-grid">
            <div>
              <Label htmlFor="ev-capacity">Guest capacity (optional)</Label>
              <Input
                id="ev-capacity"
                name="capacity"
                type="number"
                min={0}
                max={1000000}
                step={1}
                defaultValue={existing?.capacity}
              />
            </div>
            <div>
              <Label htmlFor="ev-deadline">Reply by (optional)</Label>
              <Input
                id="ev-deadline"
                name="rsvpDeadline"
                type="datetime-local"
                defaultValue={localDateTime(existing?.rsvpDeadline)}
              />
            </div>
          </div>
          {existing ? (
            <p className="ev-muted">Sharing settings are fixed after creation.</p>
          ) : (
            <>
              <fieldset className="ev-fieldset">
                <legend>Who can open the invitation?</legend>
                <Label className="ev-choice">
                  <Input type="radio" name="visibility" value="invitees" defaultChecked /> Invited
                  WebIDs only
                </Label>
                <Label className="ev-choice">
                  <Input type="radio" name="visibility" value="link" /> Anyone with the link,
                  including named guests
                </Label>
              </fieldset>
              <div>
                <Label htmlFor="ev-invitees">Invitee WebIDs (one per line)</Label>
                <Textarea
                  id="ev-invitees"
                  name="invitees"
                  placeholder="https://pod.example/profile/card#me"
                />
                <p className="ev-muted">
                  You can notify these guests after the invitation is saved.
                </p>
              </div>
              <Label className="ev-choice">
                <Input type="checkbox" name="guestListVisible" /> Let guests see the guest list and
                replies
              </Label>
              <fieldset className="ev-fieldset">
                <legend>Ready to share?</legend>
                <Label className="ev-choice">
                  <Input type="radio" name="publication" value="published" defaultChecked /> Publish
                  invitation
                </Label>
                <Label className="ev-choice">
                  <Input type="radio" name="publication" value="draft" /> Save a private draft
                </Label>
              </fieldset>
            </>
          )}
          {existing?.publication === "draft" && (
            <fieldset className="ev-fieldset">
              <legend>Ready to share?</legend>
              <Label className="ev-choice">
                <Input type="radio" name="publication" value="draft" defaultChecked /> Keep as a
                private draft
              </Label>
              <Label className="ev-choice">
                <Input type="radio" name="publication" value="published" /> Publish invitation
              </Label>
            </fieldset>
          )}
          {error && (
            <p role="alert" className="ev-error">
              {error}
            </p>
          )}
          <div className="ev-actions">
            <Button type="button" variant="outline" onClick={onClose}>
              Keep browsing
            </Button>
            <Button type="submit">{existing ? "Save changes" : "Save invitation"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
