// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
"use client";
import { Button, ErrorState, LoadingSkeleton, Toaster } from "@jeswr/suite-ui";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Footprints,
  HeartPulse,
  LayoutDashboard,
  LockKeyhole,
  Moon,
  Pill,
  Plus,
  Scale,
  ShieldCheck,
  Syringe,
} from "lucide-react";
import Link from "next/link";
import { createContext, type ReactNode, useContext, useState } from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { useRoutePathname } from "@/lib/route-params";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { CATALOGUE, type MetricId } from "../lib/data/metrics";
import { HealthProvider, useHealth } from "../state/health-context";
import { MeasurementSheet } from "./measurement-sheet";

const MeasurementContext = createContext<(metric?: MetricId) => void>(() => {});
export function useMeasurement() {
  return useContext(MeasurementContext);
}
const icons = [Footprints, HeartPulse, Moon, Scale, Activity];
function Sidebar() {
  const pathname = useRoutePathname();
  const { session } = useHealth();
  const links = [
    { href: "/health", label: "Summary", icon: LayoutDashboard },
    ...CATALOGUE.map((metric, index) => ({
      href: `/health/m/${metric.id}`,
      label: metric.label,
      icon: icons[index] ?? Activity,
    })),
    { href: "/health/medications", label: "Medications", icon: Pill },
    { href: "/health/conditions", label: "Conditions", icon: ShieldCheck },
    { href: "/health/immunisations", label: "Immunisations", icon: Syringe },
    { href: "/health/workouts", label: "Workouts", icon: Footprints },
    { href: "/health/import", label: "Import", icon: ArrowDownToLine },
    { href: "/health/export", label: "Export", icon: ArrowUpFromLine },
  ];
  return (
    <div className="hlt-sidebar">
      <div className="hlt-brand">
        <HeartPulse aria-hidden="true" size={24} />
        <strong>Health</strong>
      </div>
      <nav aria-label="Health">
        <ul>
          {links.map(({ href, label, icon: Icon }, index) => (
            <li key={href}>
              {index === 1 && <p className="hlt-nav-label">Metrics</p>}
              <Link href={href} aria-current={pathname === href ? "page" : undefined}>
                <Icon size={18} aria-hidden="true" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="hlt-sidebar-foot">
        <p>
          <LockKeyhole size={16} aria-hidden="true" />
          Only you can see this
        </p>
        <p className="hlt-muted">Your readings stay in your pod.</p>
        {session.mode === "demo" && (
          <p className="hlt-muted">Sample data · {session.displayName}</p>
        )}
      </div>
    </div>
  );
}
function Chrome({ children }: { children: ReactNode }) {
  const { boot, retryBoot, saving } = useHealth();
  const [measurement, setMeasurement] = useState<MetricId | null>(null);
  return (
    <MeasurementContext value={(metric = "weight") => setMeasurement(metric)}>
      <SuiteFrame
        app="health"
        sidebar={<Sidebar />}
        context={<span className="hlt-top-context">Health</span>}
        search={{
          placeholder: "Search in Health",
          action: "/health/search",
          scopeLabel: "in Health",
        }}
        actions={
          <Button
            size="sm"
            aria-label="Add measurement"
            onClick={() => setMeasurement("weight")}
            disabled={boot.status !== "ready"}
          >
            <Plus size={16} aria-hidden="true" />
            <span className="hlt-add-label">Add measurement</span>
            <span className="hlt-add-short">Add</span>
          </Button>
        }
      >
        {boot.status === "loading" ? (
          <div className="hlt-page">
            <h1>Opening your Health records</h1>
            <LoadingSkeleton preset="grid" label="Preparing private Health storage" />
          </div>
        ) : boot.status === "error" ? (
          <div className="hlt-page">
            <h1>Health storage needs attention</h1>
            <ErrorState error="unreachable" actions={{ retry: retryBoot }}>
              <p>
                We couldn't confirm that your Health storage is private. Nothing else will be saved
                until only-you access is set up. Check your storage permissions and try again.
              </p>
            </ErrorState>
          </div>
        ) : (
          children
        )}
        <div className="hlt-save-status" role="status">
          {saving ? "Saving to your pod…" : ""}
        </div>
        <MeasurementSheet metric={measurement} onClose={() => setMeasurement(null)} />
      </SuiteFrame>
    </MeasurementContext>
  );
}
function SessionGate({ children }: { children: ReactNode }) {
  const state = usePodSessionState();
  if (state.status === "loading")
    return (
      <div className="hlt-page">
        <h1>Opening Health</h1>
        <LoadingSkeleton preset="grid" />
      </div>
    );
  // Native builds start signed out until native sign-in lands.
  if (state.status === "signed-out")
    return (
      <div className="hlt-page">
        <h1>Health</h1>
        <p role="status">Sign in to open your Health</p>
      </div>
    );
  if (state.status === "error")
    return (
      <div className="hlt-page">
        <h1>Can't open Health</h1>
        <ErrorState error="unreachable" actions={{ retry: () => location.reload() }}>
          <p>This browser couldn't open the demo pod's storage.</p>
        </ErrorState>
      </div>
    );
  return (
    <HealthProvider session={state.session}>
      <Chrome>{children}</Chrome>
    </HealthProvider>
  );
}
export function HealthApp({ children }: { children: ReactNode }) {
  return (
    <PodSessionProvider>
      <SessionGate>{children}</SessionGate>
      <Toaster position="bottom-center" />
    </PodSessionProvider>
  );
}
