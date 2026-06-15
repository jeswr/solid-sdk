"use client";
// Home: shows the LoginPanel when logged out, the ProfileCard when logged in.
// Both read state from <SolidAuthProvider> via useSolidAuth().
import { useSolidAuth } from "@/components/solid/SolidAuthProvider";
import { LoginPanel } from "@/components/solid/LoginPanel";
import { ProfileCard } from "@/components/solid/ProfileCard";

export default function Home() {
  const { webId } = useSolidAuth();
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Solid app</h1>
        <p className="max-w-md text-muted-foreground">
          Log in with your Solid Pod, read your profile, and build on your own
          data.
        </p>
      </div>
      {webId ? <ProfileCard /> : <LoginPanel />}
    </main>
  );
}
