// AUTHORED-BY Codex GPT-6
"use client";
import {
  Button,
  DropZoneOverlay,
  ErrorState,
  LoadingSkeleton,
  Toaster,
  UploadDock,
} from "@jeswr/suite-ui";
import { Album, Heart, Images, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useContext, useRef, useState } from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { PhotosProvider, usePhotos } from "../state/photos-context";

const UploadContext = createContext<() => void>(() => {});
export function useRequestUpload() {
  return useContext(UploadContext);
}
function Chrome({ children }: { children: ReactNode }) {
  const photos = usePhotos();
  const pathname = usePathname();
  const picker = useRef<HTMLInputElement>(null);
  const [strip, setStrip] = useState(true);
  const request = () => picker.current?.click();
  const navigation = [
    { href: "/photos", name: "Photos", icon: Images, count: photos.photos.length },
    { href: "/photos/albums", name: "Albums", icon: Album, count: photos.albums.length },
    {
      href: "/photos/favourites",
      name: "Favourites",
      icon: Heart,
      count: photos.photos.filter((photo) => photos.favourites.includes(photo.ref)).length,
    },
    { href: "/photos/trash", name: "Trash", icon: Trash2, count: photos.trash.length },
  ];
  const uploadButton = (
    <Button onClick={request}>
      <Upload size={18} aria-hidden="true" />
      Upload
    </Button>
  );
  return (
    <UploadContext value={request}>
      <SuiteFrame
        app="photos"
        context={<span className="pho-context">Your library</span>}
        sidebar={
          <div className="pho-sidebar">
            <div className="pho-brand">Photos</div>
            {uploadButton}
            <nav aria-label="Photos">
              <ul>
                {navigation.map(({ href, name, icon: Icon, count }) => (
                  <li key={href}>
                    <Link href={href} aria-current={pathname === href ? "page" : undefined}>
                      <Icon size={20} aria-hidden="true" />
                      <span>{name}</span>
                      <span className="pho-count" title={`${count} items`}>
                        {count}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <p className="pho-sidebar-note">
              A little space for your memories.
              <br />
              Saved in your pod.
            </p>
          </div>
        }
        search={{
          placeholder: "Search in Photos",
          action: "/photos/search",
          scopeLabel: "in Photos",
        }}
        actions={uploadButton}
      >
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-label="Upload images"
          onChange={(event) => {
            photos.upload(Array.from(event.target.files ?? []), strip);
            event.target.value = "";
          }}
        />
        <div className="pho-upload-options">
          <label>
            <input
              type="checkbox"
              checked={strip}
              onChange={(event) => setStrip(event.target.checked)}
            />
            Strip location from uploads
          </label>
          <span>Keep your places private. Applies to dropped files too.</span>
        </div>
        <DropZoneOverlay
          folderName="Photos"
          onFiles={(files) => {
            photos.upload(
              files.files.map((entry) => entry.file),
              strip,
            );
          }}
        >
          {children}
        </DropZoneOverlay>
        <div className="pho-save-status" role="status">
          {photos.saving ? "Saving…" : photos.announcement}
        </div>
        {photos.uploads.length > 0 && (
          <div className="pho-dock">
            <UploadDock
              items={photos.uploads}
              canPause={false}
              onPause={() => {}}
              onResume={() => {}}
              onCancel={photos.cancelUpload}
              onRetry={photos.retryUpload}
            />
            {photos.uploads.every((item) =>
              ["done", "skipped", "failed"].includes(item.status),
            ) && (
              <Button
                variant="outline"
                className="pho-dismiss-uploads"
                onClick={photos.dismissUploads}
              >
                Dismiss uploads
              </Button>
            )}
          </div>
        )}
      </SuiteFrame>
    </UploadContext>
  );
}
function SessionGate({ children }: { children: ReactNode }) {
  const session = usePodSessionState();
  if (session.status === "loading")
    return <LoadingSkeleton preset="grid" label="Opening Photos…" />;
  if (session.status === "error")
    return (
      <div className="pho-page">
        <h1>Photos</h1>
        <ErrorState error="unreachable" actions={{ retry: () => location.reload() }} />
      </div>
    );
  return (
    <PhotosProvider session={session.session}>
      <Chrome>{children}</Chrome>
    </PhotosProvider>
  );
}
export function PhotosApp({ children }: { children: ReactNode }) {
  return (
    <PodSessionProvider>
      <SessionGate>{children}</SessionGate>
      <Toaster position="bottom-center" />
    </PodSessionProvider>
  );
}
