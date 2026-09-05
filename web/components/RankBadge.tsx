// Rank marker shared by the settlement screen and the room stats panel: a
// gold crown for first, a silver crown for second, the number otherwise.

export function Crown({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className ?? "h-5 w-5"}
    >
      <path d="M3 8.5 7.2 12l4.8-7 4.8 7L21 8.5 19.4 18H4.6L3 8.5zm1.6 11h14.8v1.8H4.6V19.5z" />
    </svg>
  );
}

type rankBadgeProps = {
  rank: number;
  title?: string;
};

export default function RankBadge({ rank, title }: rankBadgeProps) {
  return (
    <span
      className="flex w-7 shrink-0 items-center justify-center"
      title={title}
    >
      {rank === 1 ? (
        <Crown className="h-5 w-5 text-yellow-400 drop-shadow-[0_0_4px_rgba(250,204,21,0.6)]" />
      ) : rank === 2 ? (
        <Crown className="h-5 w-5 text-slate-300" />
      ) : (
        <span className="type-num text-sm text-muted">{rank}</span>
      )}
    </span>
  );
}

/**
 * Competition ranking over a list already sorted by net descending: equal
 * nets share a rank and the next distinct net skips ahead (1, 1, 3 …).
 */
export function rankAt<T>(
  sorted: T[],
  i: number,
  net: (t: T) => number
): number {
  let r = i;
  while (r > 0 && net(sorted[r - 1]) === net(sorted[i])) {
    r--;
  }
  return r + 1;
}
