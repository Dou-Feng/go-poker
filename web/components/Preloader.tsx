import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { criticalAssetUrls, preloadAssets } from "../lib/preload";

type Props = {
  // Fired once the critical assets are cached AND the fade-out finished;
  // the parent should unmount the preloader in response.
  onComplete: () => void;
};

// Full-screen loading gate shown until the first-paint assets (fonts +
// login wallpaper) are in the HTTP cache. Renders the same markup on the
// server (progress 0, fully opaque) so static-export hydration matches, and
// only then starts fetching. It deliberately uses no custom fonts or
// images of its own — the point is to look fine before anything loads.
// Covers everything (z above Toast/Profile portals) so login stays
// unreachable until the reveal.

const FADE_MS = 400;

export default function Preloader({ onComplete }: Props) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(0);
  const [fading, setFading] = useState(false);
  const doneRef = useRef(onComplete);
  doneRef.current = onComplete;

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let finishTimer: ReturnType<typeof setTimeout> | undefined;

    const paint = (fraction: number) => {
      if (!cancelled && raf === 0) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (!cancelled) {
            setProgress(fraction);
          }
        });
      }
    };

    const run = async () => {
      try {
        await preloadAssets(criticalAssetUrls(), paint);
        // The @font-face rules trigger their own loads as soon as the CSS
        // applies; make sure those have settled too before the reveal, so
        // the first screen never renders with a fallback font.
        if (typeof document !== "undefined" && document.fonts?.ready) {
          await document.fonts.ready;
        }
      } catch {
        // Best effort only — never trap the user on this screen.
      }
      if (cancelled) {
        return;
      }
      paint(1);
      setFading(true);
      finishTimer = setTimeout(() => {
        if (!cancelled) {
          doneRef.current();
        }
      }, FADE_MS);
    };

    void run();
    return () => {
      cancelled = true;
      if (raf !== 0) {
        cancelAnimationFrame(raf);
      }
      if (finishTimer !== undefined) {
        clearTimeout(finishTimer);
      }
    };
  }, []);

  const pct = Math.round(progress * 100);

  return (
    <div
      className={
        "fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-brand px-8 transition-opacity duration-[400ms] motion-reduce:transition-none " +
        (fading ? "pointer-events-none opacity-0" : "opacity-100")
      }
      role="status"
      aria-live="polite"
      aria-label={`${t("loadingAssets")} ${pct}%`}
    >
      {/* Pure-text brand mark: no fonts or images required to look right. */}
      <div className="flex flex-col items-center gap-2">
        <p className="type-display text-2xl text-ink sm:text-3xl">
          <span aria-hidden="true">♠&nbsp;</span>GoPoker
          <span aria-hidden="true">&nbsp;♥</span>
        </p>
        <p
          className="gp-preloader-pulse type-caption text-muted"
          aria-hidden="true"
        >
          ♦ ♣
        </p>
      </div>

      <div className="flex w-full max-w-xs flex-col items-center gap-2">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-card">
          <div
            className="h-full rounded-full bg-ink transition-[width] duration-150 ease-out motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="type-label text-xs text-muted">
          {t("loadingAssets")} · <span className="type-num">{pct}%</span>
        </p>
      </div>
    </div>
  );
}
