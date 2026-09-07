// Shared, best-effort scene preloading. Images use one native request and are
// ready only after decode; progress counts settled resources, not bytes.
export type ProgressFn = (fraction: number) => void;
export type PreloadResult = { failedUrls: string[] };
const PER_FILE_TIMEOUT_MS = 12_000;
export const SCENE_TIMEOUT_MS = 8_000;

type AssetTask = {
  promise: Promise<boolean>;
  ready: boolean;
  image?: HTMLImageElement;
};
const tasks = new Map<string, AssetTask>();
const FONT_REQUESTS: Record<string, [string, string]> = {
  "/fonts/nunito-latin.woff2": ['16px "Nunito"', "Poker"],
  "/fonts/nunito-latin-ext.woff2": ['16px "Nunito"', "Ā"],
  "/fonts/FZLTTHJW-subset.woff2": ['16px "FZLanTingHei"', "准备"],
};

function loadAsset(url: string): Promise<boolean> {
  const existing = tasks.get(url);
  if (existing) return existing.promise;
  const task: AssetTask = { promise: Promise.resolve(false), ready: false };
  tasks.set(url, task);
  task.promise = new Promise<boolean>((resolve) => {
    const controller = new AbortController();
    let finished = false;
    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (task.image) {
        task.image.onload = null;
        task.image.onerror = null;
        if (!ok) task.image.src = "";
      }
      task.ready = ok;
      // Keep successful decoded images alive. Failures may be retried by the
      // next scene open; a stale decode must never overwrite that retry.
      if (!ok) {
        controller.abort();
        tasks.delete(url);
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), PER_FILE_TIMEOUT_MS);
    const run = async () => {
      try {
        if (/\.(png|jpe?g|webp|gif|svg)(?:[?#]|$)/i.test(url)) {
          const img = new Image();
          task.image = img;
          img.onerror = () => finish(false);
          if (typeof img.decode === "function") {
            img.src = url;
            await img.decode();
            finish(true);
          } else {
            img.onload = () => finish(true);
            img.src = url;
          }
        } else if (
          FONT_REQUESTS[url] &&
          typeof document !== "undefined" &&
          document.fonts
        ) {
          const faces = await document.fonts.load(...FONT_REQUESTS[url]);
          finish(faces.length > 0);
        } else {
          const res = await fetch(url, { signal: controller.signal });
          if (!res.ok) throw new Error(`Asset HTTP ${res.status}`);
          await res.arrayBuffer();
          finish(true);
        }
      } catch {
        finish(false);
      }
    };
    void run();
  });
  return task.promise;
}

export function assetsLoaded(urls: string[]): boolean {
  return urls.every((url) => tasks.get(url)?.ready === true);
}

// A batch deadline releases only its caller; shared in-flight work continues
// for other consumers. Per-file deadlines also bound fetch and decode hangs.
export function preloadAssets(
  urls: string[],
  onProgress?: ProgressFn,
  timeoutMs = SCENE_TIMEOUT_MS
): Promise<PreloadResult> {
  const unique = Array.from(new Set(urls));
  return new Promise((resolve) => {
    let finished = false;
    let completed = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      onProgress?.(1);
      resolve({ failedUrls: unique.filter((url) => !assetsLoaded([url])) });
    };
    const timer = setTimeout(finish, timeoutMs);
    if (!unique.length) {
      finish();
      return;
    }
    onProgress?.(0);
    for (const url of unique) {
      void loadAsset(url).then(() => {
        if (finished) return;
        completed++;
        if (completed === unique.length) finish();
        else onProgress?.(completed / unique.length);
      });
    }
  });
}

// ---- asset lists -----------------------------------------------------------

// The wallpaper variant the current viewport will actually use, mirroring
// the media queries in styles/Register.module.css (.page) and
// styles/shared.css (.room-wallpaper).
export type WallpaperVariant = "portrait" | "wide" | "small";
export function wallpaperVariant(): WallpaperVariant {
  if (typeof window === "undefined") return "small";
  if (window.matchMedia("(orientation: portrait)").matches) {
    return "portrait";
  }
  if (window.matchMedia("(min-width: 700px)").matches) {
    return "wide";
  }
  return "small";
}

const LOGIN_BG: Record<WallpaperVariant, string> = {
  portrait: "/bg/bg-portrait.webp",
  wide: "/bg/bg-1672.webp",
  small: "/bg/bg-1100.webp",
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

// Room assets shared by the background warm-up and the room loading gate.
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

const ROOM_BG: Record<WallpaperVariant, string> = {
  portrait: "/bg/bg-room-portrait.webp",
  wide: "/bg/bg-room-1672.webp",
  small: "/bg/bg-room-1100.webp",
};

export const RECHARGE_IMAGES = {
  small: "/assets/recharge/diamond/diamond_small.webp",
  medium: "/assets/recharge/diamond/diamond_medium.webp",
  large: "/assets/recharge/diamond/diamond_large.webp",
};

export const WAITING_CARDS_IMAGE = "/assets/ui/table/waiting-cards.webp";

export function rechargeAssetUrls(): string[] {
  return Object.values(RECHARGE_IMAGES);
}

export function roomAssetUrls(): string[] {
  return [
    ROOM_BG[wallpaperVariant()],
    // Table materials (felt + rail).
    "/textures/table-felt.webp",
    "/textures/table-edge.webp",
    WAITING_CARDS_IMAGE,
    // Action-bar button layers + the per-key icon, in every state.
    ...BUTTON_KINDS.flatMap((kind) =>
      BUTTON_LAYERS.map((layer) => `/assets/ui/buttons/${kind}/${layer}.png`)
    ),
    ...BUTTON_KINDS.map(
      (kind) => `/assets/ui/buttons/${kind}/${kind}_icon.svg`
    ),
    // Small UI icons and the card back used while waiting for a hand.
    "/assets/ui/seat/card_back.svg",
    "/icons/chip.svg",
    "/icons/dollar.svg",
    "/icons/wallet.svg",
    "/icons/robot.svg",
    "/icons/microphone.svg",
    "/icons/speaker.svg",
  ];
}

export function idleAssetUrls(): string[] {
  return Array.from(
    new Set([
      ...roomAssetUrls(),
      ...rechargeAssetUrls(),
      ...Object.values(ROOM_BG),
    ])
  );
}

// Warm the current scenes first; alternate orientation wallpapers follow.
export async function preloadIdleAssets(): Promise<void> {
  await preloadAssets([...roomAssetUrls(), ...rechargeAssetUrls()]);
  await preloadAssets(Object.values(ROOM_BG));
}
