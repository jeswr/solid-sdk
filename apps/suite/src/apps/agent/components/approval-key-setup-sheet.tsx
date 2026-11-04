// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Sheet, SheetContent, SheetDescription, SheetTitle, toast } from "@jeswr/suite-ui";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAgentWorkspace } from "../lib/hooks";
import { approvalKeyStatus, type KeyStatus, setupApprovalKey } from "../lib/keys";

export function ApprovalKeySetupSheet({
  open,
  onOpenChange,
  status,
  onReady,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  status: KeyStatus;
  onReady(): void;
}) {
  const { session } = useAgentWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const setupButton = useRef<HTMLButtonElement>(null);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = matchMedia("(max-width: 767px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const setup = async () => {
    setBusy(true);
    setError(false);
    try {
      await setupApprovalKey(session);
      toast.success("This device can now approve");
      onReady();
      onOpenChange(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <SheetContent
        side={mobile ? "bottom" : "right"}
        className="agent-app agent-detail-sheet"
        showCloseButton={!busy}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          setupButton.current?.focus();
        }}
      >
        <SheetTitle>
          {status === "unavailable"
            ? "This device cannot approve"
            : status === "ready"
              ? "Approval key ready"
              : "Set up approvals on this device"}
        </SheetTitle>
        <SheetDescription>
          To approve what your agent does, this device needs its own approval key. It stays on this
          device and can't be copied.
        </SheetDescription>
        {status === "unavailable" && (
          <p>
            The key is missing from this device or your account profile. Set up a new key; previous
            keys stay in your profile for audit.
          </p>
        )}
        {error && (
          <p role="alert">Couldn't set up this device. Check your connection and try again.</p>
        )}
        <div className="agent-row">
          <Button ref={setupButton} onClick={() => void setup()} disabled={busy}>
            {busy
              ? "Setting up…"
              : error
                ? "Retry"
                : status === "unavailable"
                  ? "Set up this device again"
                  : "Set up this device"}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Not now
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
interface Device {
  status: KeyStatus | "checking";
  setup(): void;
  requireKey(action: () => void): Promise<void>;
}
const Context = createContext<Device | undefined>(undefined);
export function ApprovalDeviceProvider({ children }: { children: ReactNode }) {
  const { session } = useAgentWorkspace();
  const [status, setStatus] = useState<Device["status"]>("checking");
  const [open, setOpen] = useState(false);
  const pending = useRef<(() => void) | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: closing setup rechecks the actual pointer even after failure
  useEffect(() => {
    let active = true;
    let generation = 0;
    const refresh = () => {
      const request = ++generation;
      void approvalKeyStatus(session).then(
        (value) => {
          if (active && request === generation) setStatus(value);
        },
        () => {
          if (active && request === generation) setStatus("unavailable");
        },
      );
    };
    refresh();
    addEventListener("storage", refresh);
    addEventListener("focus", refresh);
    const unsubscribe = session.subscribe((url) => {
      if (url.split("#")[0] === session.webId.split("#")[0]) refresh();
    });
    return () => {
      active = false;
      removeEventListener("storage", refresh);
      removeEventListener("focus", refresh);
      unsubscribe();
    };
  }, [session, open]);
  const requireKey = useCallback(
    async (action: () => void) => {
      const value = await approvalKeyStatus(session).catch(() => "unavailable" as const);
      setStatus(value);
      if (value === "ready") action();
      else {
        pending.current = action;
        setOpen(true);
      }
    },
    [session],
  );
  return (
    <Context
      value={{
        status,
        setup: () => {
          pending.current = undefined;
          setOpen(true);
        },
        requireKey,
      }}
    >
      {children}
      <ApprovalKeySetupSheet
        open={open}
        status={status === "checking" ? "none" : status}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) pending.current = undefined;
        }}
        onReady={() => {
          setStatus("ready");
          const action = pending.current;
          pending.current = undefined;
          action?.();
        }}
      />
    </Context>
  );
}
export function useApprovalDevice() {
  const value = useContext(Context);
  if (!value) throw new Error("Approval device is not ready");
  return value;
}
