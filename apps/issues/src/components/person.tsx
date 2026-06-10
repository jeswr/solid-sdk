"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { usePerson, initialsOf } from "@/lib/people";
import { Users } from "lucide-react";

/** Avatar for a WebID (profile photo, else initials). */
export function PersonAvatar({ webId, className = "size-5" }: { webId: string; className?: string }) {
  const person = usePerson(webId);
  return (
    <Avatar className={className}>
      {person?.avatarUrl && <AvatarImage src={person.avatarUrl} alt="" />}
      <AvatarFallback className="bg-primary/10 text-[0.6rem] font-medium text-primary">
        {initialsOf(person?.name ?? "?")}
      </AvatarFallback>
    </Avatar>
  );
}

/** Just the display name for a WebID (host until the profile loads). */
export function PersonName({ webId }: { webId: string }) {
  const person = usePerson(webId);
  return <>{person?.name ?? webId}</>;
}

/**
 * A person rendered as a compact contact chip — avatar + display name resolved
 * from their WebID profile (never the raw IRI). `isTeam` renders the group icon.
 */
export function PersonChip({
  webId,
  isTeam = false,
  className = "",
}: {
  webId: string;
  isTeam?: boolean;
  className?: string;
}) {
  const person = usePerson(webId);
  if (isTeam) {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`}>
        <Users className="size-3.5" aria-hidden /> Team
      </span>
    );
  }
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`} title={webId}>
      <PersonAvatar webId={webId} />
      <span className="truncate">{person?.name ?? webId}</span>
    </span>
  );
}
