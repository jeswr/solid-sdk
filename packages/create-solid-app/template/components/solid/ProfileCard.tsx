"use client";
// ProfileCard — renders the authenticated user's profile (name, avatar, bio,
// storages). The data comes from the auth context's `profile`, which was read
// through the @solid/object typed accessors (lib/solid/profile.ts) — this
// component never touches RDF directly.
import { useSolidAuth } from "./SolidAuthProvider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

export function ProfileCard() {
  const { profile, logout } = useSolidAuth();
  if (!profile) return null;

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="flex flex-row items-center gap-4">
        <Avatar className="size-14">
          {profile.avatarUrl && <AvatarImage src={profile.avatarUrl} alt="" />}
          <AvatarFallback>{initials(profile.name)}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col">
          <CardTitle>{profile.name}</CardTitle>
          <CardDescription className="max-w-xs truncate">
            {profile.webId}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {profile.bio && <p className="text-sm">{profile.bio}</p>}
        {profile.storages.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Pod storage</p>
            <ul className="flex flex-col gap-1">
              {profile.storages.map((s) => (
                <li key={s} className="truncate text-sm text-muted-foreground">
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}
        <Button variant="outline" onClick={logout} className="self-start">
          Log out
        </Button>
      </CardContent>
    </Card>
  );
}
