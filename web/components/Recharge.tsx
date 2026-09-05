import { useContext } from "react";
import { useSocket } from "../hooks/useSocket";
import { addChips } from "../actions/actions";
import { useTranslation } from "../hooks/useTranslation";

// Each option shows a gem filled to `fraction` (bottom-up) with the recharge
// amount printed underneath.
const RECHARGE_OPTIONS = [
  { fraction: 0.25, amount: 200 },
  { fraction: 0.5, amount: 500 },
  { fraction: 0.75, amount: 1000 },
  { fraction: 1, amount: 2000 },
];

function GemIcon({ fraction }: { fraction: number }) {
  const pct = Math.round(fraction * 100);
  const fillHeight = 84 * fraction;
  const clipY = 92 - fillHeight;

  return (
    <svg viewBox="0 0 100 100" width="44" height="44" aria-hidden>
      <defs>
        <clipPath id={`gem-clip-${pct}`}>
          <rect x="0" y={clipY} width="100" height={fillHeight} />
        </clipPath>
      </defs>
      {/* empty gem body */}
      <polygon points="50,8 92,32 50,92 8,32" fill="#27272a" />
      {/* filled portion, clipped from the bottom up */}
      <g clipPath={`url(#gem-clip-${pct})`}>
        <polygon points="50,8 92,32 50,92 8,32" fill="#22d3ee" />
      </g>
      {/* outline and facets */}
      <polygon
        points="50,8 92,32 50,92 8,32"
        fill="none"
        stroke="#e4e4e7"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <line x1="8" y1="32" x2="92" y2="32" stroke="#e4e4e7" strokeWidth="1.5" />
      <line
        x1="50"
        y1="8"
        x2="50"
        y2="92"
        stroke="#e4e4e7"
        strokeWidth="1"
        opacity="0.45"
      />
      <line
        x1="50"
        y1="8"
        x2="8"
        y2="32"
        stroke="#e4e4e7"
        strokeWidth="1"
        opacity="0.45"
      />
      <line
        x1="50"
        y1="8"
        x2="92"
        y2="32"
        stroke="#e4e4e7"
        strokeWidth="1"
        opacity="0.45"
      />
      <line
        x1="8"
        y1="32"
        x2="50"
        y2="92"
        stroke="#e4e4e7"
        strokeWidth="1"
        opacity="0.45"
      />
      <line
        x1="92"
        y1="32"
        x2="50"
        y2="92"
        stroke="#e4e4e7"
        strokeWidth="1"
        opacity="0.45"
      />
    </svg>
  );
}

type RechargeProps = {
  onClose: () => void;
};

export default function Recharge({ onClose }: RechargeProps) {
  const socket = useSocket();
  const { t } = useTranslation();

  const topUp = (amount: number) => {
    if (socket) {
      addChips(socket, amount);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-lg bg-card p-6 shadow-2xl">
        <div className="mb-5 flex flex-row items-center justify-between">
          <p className="type-heading">{t("recharge")}</p>
          <button
            onClick={onClose}
            className="btn btn-text"
          >
            ✕
          </button>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {RECHARGE_OPTIONS.map(({ fraction, amount }) => (
            <button
              key={amount}
              onClick={() => topUp(amount)}
              className="flex flex-col items-center gap-2 rounded-lg bg-floor p-3 hover:bg-cardhi"
            >
              <GemIcon fraction={fraction} />
              <p className="text-xs font-medium text-ink">{amount}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
