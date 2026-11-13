// AUTHORED-BY Claude Opus 5.5
/** Icons, product illustrations and the Answerable seal. All drawn inline; no assets. */
import type { ReactNode } from "react";

type IconName =
  | "send"
  | "menu"
  | "plus"
  | "chat"
  | "shield"
  | "activity"
  | "key"
  | "check"
  | "x"
  | "chev"
  | "pause"
  | "fingerprint"
  | "face"
  | "lock"
  | "store"
  | "bank"
  | "doc"
  | "user"
  | "external"
  | "spark";

const PATHS: Record<IconName, ReactNode> = {
  send: <path d="M5 12h12M12 5l7 7-7 7" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chat: <path d="M5 5h14v10H9l-4 4z" />,
  shield: <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" />,
  activity: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  key: (
    <>
      <circle cx="8" cy="14" r="4" />
      <path d="M11 11l8-8M16 6l3 3" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  chev: <path d="M6 9l6 6 6-6" />,
  pause: <path d="M8 5v14M16 5v14" />,
  fingerprint: (
    <path d="M12 11v3c0 2.5-.6 4.5-1.6 6M8.5 9.5A4 4 0 0 1 16 11v2c0 2-.3 3.8-.9 5.4M5.5 13.5c.3-1 .5-1.8.5-2.5a6 6 0 0 1 11.7-1.9M19 14.5c-.2 1.5-.6 3-1.1 4.3M8.4 19.5c.7-1.5 1.1-3.3 1.1-5.5V11a2.5 2.5 0 0 1 5 0" />
  ),
  face: (
    <>
      <circle cx="12" cy="10" r="5" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  store: <path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6" />,
  bank: <path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />,
  doc: <path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1-4.5 4-7 8-7s7 2.5 8 7" />
    </>
  ),
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />,
  spark: (
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />
  ),
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/** The Answerable trust mark. */
export function Seal({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" stroke="var(--accent)" strokeWidth="1.8" />
      <path
        d="M7.5 12.5l3 3 6-6.5"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ProductArt({ art, color }: { art: "sneaker" | "sock" | "jacket"; color: string }) {
  if (art === "sock")
    return (
      <svg viewBox="0 0 120 90" aria-hidden="true">
        <path
          d="M48 8h26v42c0 8 4 12 12 18 6 5 4 16-6 16H52c-14 0-22-8-22-20 0-9 6-14 12-20 4-4 6-8 6-14z"
          fill={color}
        />
        <rect x="48" y="8" width="26" height="9" rx="2" fill="#fff" opacity=".35" />
        <path
          d="M30 68c8 2 18 2 28 0"
          stroke="#fff"
          strokeOpacity=".3"
          strokeWidth="3"
          fill="none"
        />
      </svg>
    );
  if (art === "jacket")
    return (
      <svg viewBox="0 0 120 90" aria-hidden="true">
        <path d="M44 8l16 8 16-8 22 12-8 22-8-4v44H38V38l-8 4-8-22z" fill={color} />
        <path d="M60 16v68" stroke="#fff" strokeOpacity=".35" strokeWidth="2" />
        <path
          d="M50 10c2 8 6 10 10 10s8-2 10-10"
          fill="none"
          stroke="#fff"
          strokeOpacity=".3"
          strokeWidth="2"
        />
      </svg>
    );
  return (
    <svg viewBox="0 0 120 90" aria-hidden="true">
      <path
        d="M12 58c0-6 4-10 10-12l18-6 12-16c3-3 7-3 9 1l6 10c4 6 12 9 22 10l12 2c6 1 9 6 9 12v6H12z"
        fill={color}
      />
      <path d="M12 64h98v6c0 3-2 5-5 5H17c-3 0-5-2-5-5z" fill="#fff" opacity=".9" />
      <path d="M12 64h98" stroke="#000" strokeOpacity=".12" strokeWidth="2" />
      <path
        d="M52 30l8 10M58 26l8 10M64 24l7 10"
        stroke="#fff"
        strokeOpacity=".6"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
