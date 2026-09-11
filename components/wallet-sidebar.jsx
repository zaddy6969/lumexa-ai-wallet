import Link from "next/link";
import { memo } from "react";

const ACTIONS = [
  { id: "dashboard", label: "Home", icon: "dashboard" },
  { id: "send", label: "Send", icon: "send" },
  { id: "receive", label: "Receive", icon: "receive" },
  { id: "swap", label: "Swap", icon: "swap" },
  { id: "bridge", label: "Bridge", icon: "bridge" },
  { id: "activity", label: "Activity", icon: "activity" }
];

export function FeatureIcon({ name }) {
  const commonProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true"
  };

  switch (name) {
    case "receive":
      return (
        <svg {...commonProps}>
          <path d="M12 3v13" />
          <path d="m7 11 5 5 5-5" />
          <path d="M5 20h14" />
        </svg>
      );
    case "ai":
      return (
        <svg {...commonProps}>
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
          <circle cx="12" cy="12" r="3.5" />
        </svg>
      );
    case "send":
      return (
        <svg {...commonProps}>
          <path d="M5 12h13" />
          <path d="m13 6 6 6-6 6" />
          <path d="M5 18v-3.5" />
        </svg>
      );
    case "swap":
      return (
        <svg {...commonProps}>
          <path d="M7 7h10" />
          <path d="m14 4 3 3-3 3" />
          <path d="M17 17H7" />
          <path d="m10 14-3 3 3 3" />
        </svg>
      );
    case "bridge":
      return (
        <svg {...commonProps}>
          <path d="M5 16c2.2-4 4.5-6 7-6s4.8 2 7 6" />
          <path d="M4 19h16M7 16v3M12 11v8M17 16v3" />
        </svg>
      );
    case "activity":
      return (
        <svg {...commonProps}>
          <path d="M4 14h4l2-7 4 11 2-7h4" />
          <path d="M4 20h16" />
        </svg>
      );
    case "portfolio":
      return (
        <svg {...commonProps}>
          <path d="M5 9h14v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9Z" />
          <path d="M8 9V7a4 4 0 0 1 8 0v2M9 14h6" />
        </svg>
      );
    default:
      return (
        <svg {...commonProps}>
          <rect x="4" y="4" width="7" height="7" rx="2" />
          <rect x="13" y="4" width="7" height="7" rx="2" />
          <rect x="4" y="13" width="7" height="7" rx="2" />
          <rect x="13" y="13" width="7" height="7" rx="2" />
        </svg>
      );
  }
}

function WalletSidebar({ activeView, onSelect, onReceive }) {
  return (
    <div className="sidebar">
      <div className="sidebar-label">Wallet</div>
      <nav aria-label="Wallet navigation">
        {ACTIONS.map((action) => {
          const active = action.id === activeView;
          return (
            <button
              key={action.id}
              type="button"
              className={active ? "is-active" : ""}
              onClick={() => (action.id === "receive" ? onReceive?.() : onSelect?.(action.id))}
              aria-current={active ? "page" : undefined}
            >
              <span>
                <FeatureIcon name={action.icon} />
              </span>
              <strong>{action.label}</strong>
            </button>
          );
        })}
      </nav>
      <div className="sidebar-security">
        <span aria-hidden="true">✓</span>
        <div>
          <strong>Non-custodial</strong>
          <small>Lumexa cannot access your keys or sign transactions.</small>
        </div>
      </div>
      <div className="sidebar-links">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </div>
    </div>
  );
}

export default memo(WalletSidebar);
