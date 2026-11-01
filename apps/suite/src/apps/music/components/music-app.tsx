// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  Badge,
  Button,
  ErrorState,
  IconButton,
  LoadingSkeleton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  Toaster,
} from "@jeswr/suite-ui";
import { Disc3, Heart, History, House, ListMusic, Music2, Settings2, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { playlistHref } from "../lib/navigation";
import { MusicProvider, useMusic } from "../state/music-context";
import { CreatePlaylist } from "./playlist-dialogs";

const navigation = [
  ["Home", "/music", House],
  ["Tracks", "/music/tracks", Music2],
  ["Albums", "/music/albums", Disc3],
  ["Artists", "/music/artists", Users],
  ["Playlists", "/music/playlists", ListMusic],
  ["Liked songs", "/music/liked", Heart],
  ["History", "/music/history", History],
] as const;
function Sidebar() {
  const pathname = usePathname();
  const music = useMusic();
  return (
    <nav className="mus-sidebar" aria-label="Music">
      <div className="mus-brand">
        <Music2 aria-hidden="true" size={22} />
        <span>Music</span>
      </div>
      <p className="mus-eyebrow">Your library</p>
      <ul>
        {navigation.map(([name, href, Icon]) => (
          <li key={href}>
            <Link href={href} aria-current={pathname === href ? "page" : undefined}>
              <Icon size={18} aria-hidden="true" />
              {name}
              {name === "Tracks" && music.snapshot ? (
                <span className="mus-nav-count">{music.snapshot.library.tracks.length}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
      <div className="mus-sidebar-heading">
        <p className="mus-eyebrow">Your playlists</p>
        <CreatePlaylist compact />
      </div>
      <ul>
        {music.snapshot?.playlists.map((playlist) => (
          <li key={playlist.id}>
            <Link
              href={playlistHref(playlist.id)}
              aria-current={pathname === playlistHref(playlist.id) ? "page" : undefined}
            >
              <ListMusic size={16} aria-hidden="true" />
              <span className="mus-truncate">{playlist.name}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mus-sidebar-note">
        <Badge variant="secondary">Saved to your pod</Badge>
        <p>Your music, collected in one place.</p>
      </div>
    </nav>
  );
}
function Settings() {
  const music = useMusic();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label="Music settings" variant="ghost">
          <Settings2 size={19} aria-hidden="true" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent className="mus-settings" align="end">
        <h2>Artwork</h2>
        <div className="mus-setting-row">
          <label htmlFor="mus-artwork">Load images from Spotify</label>
          <Switch
            id="mus-artwork"
            checked={music.snapshot?.preferences.value.artwork === "hot-link"}
            disabled={!music.snapshot}
            onCheckedChange={music.artwork}
            aria-describedby="mus-artwork-help"
          />
        </div>
        <p id="mus-artwork-help">
          Off by default. Loading artwork contacts the image provider and shares your IP address
          with them.
        </p>
      </PopoverContent>
    </Popover>
  );
}
function Chrome({ children }: { children: ReactNode }) {
  const music = useMusic();
  return (
    <SuiteFrame
      app="music"
      sidebar={<Sidebar />}
      context={<span className="mus-context">Music</span>}
      search={{ placeholder: "Search in Music", action: "/music/search", scopeLabel: "in Music" }}
      actions={<Settings />}
    >
      <div className="mus-content">
        {children}
        <p role="status" aria-live="polite" className={music.saving ? "mus-save" : "mus-sr-only"}>
          {music.saving ? "Saving…" : music.notice}
        </p>
      </div>
    </SuiteFrame>
  );
}
function SessionGate({ children }: { children: ReactNode }) {
  const state = usePodSessionState();
  if (state.status === "loading")
    return (
      <div className="mus-content">
        <h1>Music</h1>
        <LoadingSkeleton label="Opening Music" preset="grid" />
      </div>
    );
  // Native builds start signed out until native sign-in lands.
  if (state.status === "signed-out")
    return (
      <div className="mus-content">
        <h1>Music</h1>
        <p role="status">Sign in to open your Music</p>
      </div>
    );
  if (state.status === "error")
    return (
      <div className="mus-content">
        <h1>Can’t open Music</h1>
        <ErrorState error="unreachable" actions={{ retry: () => location.reload() }} />
      </div>
    );
  return (
    <MusicProvider
      key={`${state.session.webId}-${state.session.storageUrl}`}
      session={state.session}
    >
      <Chrome>{children}</Chrome>
    </MusicProvider>
  );
}
export function MusicApp({ children }: { children: ReactNode }) {
  return (
    <PodSessionProvider>
      <SessionGate>{children}</SessionGate>
      <Toaster position="bottom-center" />
    </PodSessionProvider>
  );
}
export function MusicSurface({ children }: { children: ReactNode }) {
  const music = useMusic();
  if (music.status === "loading")
    return <LoadingSkeleton label="Loading your music" preset="table" />;
  if (music.status === "error")
    return (
      <ErrorState error="unreachable" actions={{ retry: music.refresh }}>
        <Button
          variant="outline"
          onClick={() => {
            void music.refresh();
          }}
        >
          Refresh Music
        </Button>
      </ErrorState>
    );
  return children;
}
