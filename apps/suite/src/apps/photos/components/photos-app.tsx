// AUTHORED-BY Codex GPT-6
"use client";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropZoneOverlay,
  ErrorState,
  LoadingSkeleton,
  Toaster,
  UploadDock,
} from "@jeswr/suite-ui";
import { Album, HardDrive, Heart, Images, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
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
  const folderPicker = useRef<HTMLInputElement>(null);
  const [strip, setStrip] = useState(true);
  useEffect(() => {
    try {
      setStrip(localStorage.getItem("photos-remove-location") !== "false");
    } catch {
      /* Storage may be disabled. */
    }
  }, []);
  const request = () => picker.current?.click();
  const uploadMenu = (className: string) => (
    <div className={className}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>
            <Upload size={18} aria-hidden="true" />
            Upload
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={request}>Upload files</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => folderPicker.current?.click()}>
            Upload folder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={strip}
            onCheckedChange={(value) => {
              setStrip(value);
              try {
                localStorage.setItem("photos-remove-location", String(value));
              } catch {
                /* Storage may be disabled. */
              }
            }}
          >
            Remove location from uploads
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
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
    { href: "/photos/storage", name: "Storage", icon: HardDrive, count: undefined },
  ];
  return (
    <UploadContext value={request}>
      <SuiteFrame
        app="photos"
        context={<span className="pho-context">Your library</span>}
        sidebar={
          <div className="pho-sidebar">
            <div className="pho-brand">Photos</div>
            {uploadMenu("pho-upload-desktop")}
            <nav aria-label="Photos">
              <ul>
                {navigation.map(({ href, name, icon: Icon, count }) => (
                  <li key={href}>
                    <Link href={href} aria-current={pathname === href ? "page" : undefined}>
                      <Icon size={20} aria-hidden="true" />
                      <span>{name}</span>
                      {count !== undefined && (
                        <span className="pho-count" title={`${count} items`}>
                          {count}
                        </span>
                      )}
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
        actions={uploadMenu("pho-upload-mobile")}
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
        <input
          ref={folderPicker}
          type="file"
          accept="image/*"
          multiple
          hidden
          {...{ webkitdirectory: "" }}
          aria-label="Upload image folder"
          onChange={(event) => {
            photos.upload(Array.from(event.target.files ?? []), strip);
            event.target.value = "";
          }}
        />
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
