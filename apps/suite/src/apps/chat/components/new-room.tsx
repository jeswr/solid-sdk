// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PeoplePicker,
  type SharingPerson,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@jeswr/suite-ui";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { encodeRef } from "@/lib/refs";
import type { Room } from "../lib/client";
import { useChat, useReadPreferences, useRooms } from "../state/chat-context";
import { ChatEmpty, useProfile } from "./chat-app";
import { RoomView } from "./room";
export function NewRoomPage() {
  const { client, currentRoom, invalidate } = useChat();
  const router = useRouter();
  const preferences = useReadPreferences();
  const rooms = useRooms();
  const backgroundRoom =
    currentRoom ??
    [...(preferences.data ?? [])]
      .filter((marker) => rooms.data?.some((room) => room.url === marker.roomId))
      .sort((a, b) => (b.lastRead ?? -Infinity) - (a.lastRead ?? -Infinity))[0]?.roomId ??
    rooms.data?.[0]?.url;
  const [tab, setTab] = useState("room");
  const [name, setName] = useState("");
  const [people, setPeople] = useState<SharingPerson[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Room>();
  const id = useId();
  const close = () => {
    const room = created?.url ?? backgroundRoom;
    if (room) router.replace(`/chat/r/${encodeRef(room)}`);
    else router.replace("/chat");
  };
  const link =
    created && typeof location !== "undefined"
      ? client.inviteLink(created.url, location.origin)
      : "";
  return (
    <>
      {backgroundRoom ? <RoomView key={backgroundRoom} url={backgroundRoom} /> : <ChatEmpty />}
      <Dialog open onOpenChange={(open) => !open && !busy && close()}>
        <DialogContent
          className="chat-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById("main-content")?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{created ? "Invite people" : "New conversation"}</DialogTitle>
            <DialogDescription>
              {created
                ? "Copy the link below. Your invitee opens it while signed in to join the conversation."
                : "Start a room for a group or a direct message with one person."}
            </DialogDescription>
          </DialogHeader>
          {created ? (
            <div className="chat-invite">
              <Label htmlFor={`${id}-link`}>Invite link</Label>
              <Input id={`${id}-link`} value={link} readOnly />
              <p>
                Invitations use a link on this storage. People need to sign in with an account that
                has access.
              </p>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(link).then(
                      () => toast.success("Invite link copied"),
                      () => toast.error("Couldn't copy invite link"),
                    );
                  }}
                >
                  Copy invite link
                </Button>
                <Button onClick={close}>Open conversation</Button>
              </DialogFooter>
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setError("");
                if (query.trim()) {
                  setError("Add the account ID using the people picker before creating.");
                  return;
                }
                if (tab === "dm" && people.length !== 1) {
                  setError("Choose exactly one person for a direct message.");
                  return;
                }
                setBusy(true);
                void (
                  tab === "dm"
                    ? client.createDirect(people[0]?.webId as string)
                    : client.createRoom({
                        name: name.trim(),
                        members: people.map((person) => person.webId),
                      })
                )
                  .then(
                    (room) => {
                      if (
                        (tab === "room" && people.length === 0) ||
                        (tab === "dm" && rooms.data?.some((joined) => joined.url === room.url))
                      )
                        router.replace(`/chat/r/${encodeRef(room.url)}`);
                      else setCreated(room);
                      invalidate();
                    },
                    () =>
                      setError(
                        "Couldn't create this conversation. Check the details and try again.",
                      ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              <Tabs
                value={tab}
                onValueChange={(value) => {
                  setTab(value);
                  setError("");
                }}
              >
                <TabsList aria-label="Conversation type">
                  <TabsTrigger value="room">Room</TabsTrigger>
                  <TabsTrigger value="dm">Direct message</TabsTrigger>
                </TabsList>
                <TabsContent value="room">
                  <Label htmlFor={`${id}-name`}>Room name</Label>
                  <Input
                    id={`${id}-name`}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={200}
                    required={tab === "room"}
                    placeholder="e.g. Book club"
                  />
                </TabsContent>
                <TabsContent value="dm">
                  <p className="chat-hint">Choose one person by their WebID.</p>
                </TabsContent>
              </Tabs>
              <div
                onPointerDownCapture={(event) => {
                  // Keep focus in the picker until Add person receives its click.
                  // Blur removes its suggestions and recenters this dialog between
                  // pointerdown and pointerup, moving the mobile button off target.
                  if (
                    event.target instanceof Element &&
                    event.target.closest(".su-picker-input button")
                  )
                    event.preventDefault();
                }}
              >
                <PeoplePicker
                  contacts={{ people: [], state: { kind: "ready" } }}
                  value={people}
                  onChange={setPeople}
                  query={query}
                  onQueryChange={setQuery}
                  useProfile={useProfile}
                />
              </div>
              {error && <p role="alert">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={close} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    busy ||
                    (tab === "room" && !name.trim()) ||
                    (tab === "dm" && people.length !== 1)
                  }
                >
                  {busy ? "Creating…" : tab === "dm" ? "Start direct message" : "Create room"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
