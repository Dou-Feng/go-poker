// Poker chip drawn inline so its colour can follow the amount it stands for
// (the old public/chip.svg was a fixed green that vanished against the felt).
// Denominations: silver for small amounts, brown for medium, gold for large.

export type ChipTone = "silver" | "brown" | "gold";

export function chipToneFor(amount?: number | null): ChipTone {
  if (amount == null) {
    return "brown";
  }
  if (amount < 50) {
    return "silver";
  }
  if (amount < 500) {
    return "brown";
  }
  return "gold";
}

const PALETTE: Record<
  ChipTone,
  { base: string; edge: string; ring: string; center: string }
> = {
  silver: {
    base: "#aeb6c2",
    edge: "#eef1f5",
    ring: "#6f7986",
    center: "#d3d9e1",
  },
  brown: {
    base: "#8a5a33",
    edge: "#eadbc8",
    ring: "#57371c",
    center: "#a97449",
  },
  gold: {
    base: "#d3a11b",
    edge: "#fff3c4",
    ring: "#8f6a0f",
    center: "#f1c75a",
  },
};

type chipProps = {
  className?: string;
  /** Picks the denomination colour; omit for the neutral brown chip. */
  amount?: number | null;
  /** Explicit colour, overriding `amount`. */
  tone?: ChipTone;
};

export default function Chip({ className, amount, tone }: chipProps) {
  const c = PALETTE[tone ?? chipToneFor(amount)];
  // Eight edge notches around the rim, like a real chip.
  const notches = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden
      className={className ?? "h-4 w-4"}
      style={{ flexShrink: 0 }}
    >
      <circle
        cx="50"
        cy="50"
        r="47"
        fill={c.base}
        stroke={c.ring}
        strokeWidth="3"
      />
      {notches.map((deg) => (
        <rect
          key={deg}
          x="43"
          y="4"
          width="14"
          height="14"
          rx="2"
          fill={c.edge}
          transform={`rotate(${deg} 50 50)`}
        />
      ))}
      <circle
        cx="50"
        cy="50"
        r="30"
        fill={c.center}
        stroke={c.ring}
        strokeWidth="2.5"
      />
      <circle
        cx="50"
        cy="50"
        r="22"
        fill="none"
        stroke={c.ring}
        strokeWidth="2"
        strokeDasharray="6 5"
        opacity="0.7"
      />
    </svg>
  );
}
