// Asset preloader: warms the browser HTTP cache with the files the app needs
// before a screen is shown, so the UI never appears in its unstyled/late
// state (fallback fonts, missing wallpaper). Byte-level progress is reported
// when the server sends Content-Length; files without it fall back to a
// per-file weight. Everything is best-effort: a failed or stalled fetch is
// counted as done so the caller can never be blocked forever.

export type ProgressFn = (fraction: number) => void;

// Hard cap for one file and for the whole batch. Generous on purpose — the
// gate is a UX nicety, not a correctness requirement.
const PER_FILE_TIMEOUT_MS = 30_000;
const BATCH_TIMEOUT_MS = 45_000;

type Entry = {
  url: string;
  loaded: number;
  weight: number; // bytes when known, else the running average fallback
  known: boolean; // Content-Length was available
  done: boolean;
};

function overallFraction(entries: Entry[]): number {
  let loaded = 0;
  let total = 0;
  for (const e of entries) {
    loaded += e.done ? e.weight : e.loaded;
    total += e.weight;
  }
  return total > 0 ? Math.min(1, loaded / total) : 1;
}

function reweightUnknown(entries: Entry[]) {
  // Give files without Content-Length the average size of the known ones so
  // the bar does not jump when they finish.
  const known = entries.filter((e) => e.known);
  if (known.length === 0) {
    return;
  }
  const avg = known.reduce((s, e) => s + e.weight, 0) / known.length;
  for (const e of entries) {
    if (!e.known) {
      e.weight = avg;
    }
  }
}

async function fetchOne(entry: Entry, report: () => void): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_FILE_TIMEOUT_MS);
  try {
    const res = await fetch(entry.url, { signal: ctrl.signal });
    const len = Number(res.headers.get("Content-Length") ?? 0);
    if (res.ok && len > 0) {
      entry.weight = len;
      entry.known = true;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          entry.loaded += value?.byteLength ?? 0;
          report();
        }
      } else {
        const buf = await res.arrayBuffer();
        entry.loaded = buf.byteLength;
      }
    } else {
      // No length: consume fully so the file lands in the HTTP cache even
      // if we cannot track its progress.
      await res.arrayBuffer();
    }
  } catch {
    // Offline, aborted or server error: give up on this file silently.
  } finally {
    clearTimeout(timer);
    entry.done = true;
    report();
  }
}

// Preload a list of URLs concurrently and report overall progress as a
// 0..1 fraction. Never rejects; resolves after every request settles or the
// batch timeout expires, whichever comes first.
export async function preloadAssets(
  urls: string[],
  onProgress?: ProgressFn
): Promise<void> {
  if (urls.length === 0) {
    onProgress?.(1);
    return;
  }
  const entries: Entry[] = urls.map((url) => ({
    url,
    loaded: 0,
    weight: 1,
    known: false,
    done: false,
  }));
  let settled = false;

  const report = () => {
    if (!settled) {
      onProgress?.(overallFraction(entries));
    }
  };

  const batchTimer = setTimeout(() => {
    settled = true;
    onProgress?.(1);
  }, BATCH_TIMEOUT_MS);

  await Promise.all(
    entries.map(async (e) => {
      await fetchOne(e, report);
      // As soon as at least one length is known, size the unknowns sensibly.
      reweightUnknown(entries);
      report();
    })
  );
  clearTimeout(batchTimer);
  settled = true;
  onProgress?.(1);
}

// ---- asset lists -----------------------------------------------------------

// The wallpaper variant the current viewport will actually use, mirroring
// the media queries in styles/Register.module.css (.page) and
// styles/shared.css (.room-wallpaper).
export type WallpaperVariant = "portrait" | "wide" | "small";
export function wallpaperVariant(): WallpaperVariant {
  if (window.matchMedia("(orientation: portrait)").matches) {
    return "portrait";
  }
  if (window.matchMedia("(min-width: 700px)").matches) {
    return "wide";
  }
  return "small";
}

const LOGIN_BG: Record<WallpaperVariant, string> = {
  portrait: "/bg-portrait.webp",
  wide: "/bg-1672.webp",
  small: "/bg-1100.webp",
};

// Files the first paint depends on: the two latin fonts, the (large) CJK
// font and the login wallpaper for this viewport. These gate the loading
// screen. Client-only by design (matchMedia); returns [] during SSR.
export function criticalAssetUrls(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  return [
    "/fonts/nunito-latin.woff2",
    "/fonts/nunito-latin-ext.woff2",
    "/fonts/FZLTTHJW-subset.woff2",
    LOGIN_BG[wallpaperVariant()],
  ];
}

// Everything the lobby → game-room transition needs. Preloaded in the
// background once the loading screen is gone, so entering a room is instant.
// The BGM mp3s (~5 MB each) and the sfx set are deliberately NOT here: they
// stream lazily on first use and would dwarf everything else.
const BUTTON_LAYERS = [
  "button_bg",
  "button_highlight",
  "button_inner_shadow",
  "button_shadow",
  "button_border_normal",
  "button_border_hover",
  "button_border_pressed",
  "button_border_disabled",
  "button_disabled_wash",
];
const BUTTON_KINDS = ["check", "bet", "allin", "fold"];

export function idleAssetUrls(): string[] {
  return [
    // Room wallpapers (all variants; the room may be rotated into any one).
    "/bg-room-portrait.webp",
    "/bg-room-1100.webp",
    "/bg-room-1672.webp",
    // Table materials (felt + rail).
    "/table-felt.webp",
    "/table-edge.webp",
    // Action-bar button layers in every state.
    ...BUTTON_KINDS.flatMap((kind) =>
      BUTTON_LAYERS.map((layer) => `/assets/ui/buttons/${kind}/${layer}.png`)
    ),
    // Small UI icons and the card back used while waiting for a hand.
    "/assets/ui/seat/card_back.svg",
    "/chip.svg",
    "/dollar.svg",
    "/wallet.svg",
    "/robot.svg",
    "/microphone.svg",
    "/speaker.svg",
  ];
}

// Fire-and-forget warm-up used after the loading screen completes.
export function preloadIdleAssets(): void {
  void preloadAssets(idleAssetUrls());
}
