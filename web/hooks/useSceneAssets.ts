import { useEffect, useState } from "react";
import { assetsLoaded, preloadAssets } from "../lib/preload";

// Each mount waits for its scene only. Successful assets and pending requests
// are shared with startup warm-up; unmounting stops React updates, not downloads.
export function useSceneAssets(assetUrls: () => string[]) {
  const [urls] = useState(assetUrls);
  const [state, setState] = useState(() => ({
    ready: assetsLoaded(urls),
    progress: assetsLoaded(urls) ? 1 : 0,
    failedUrls: [] as string[],
  }));
  useEffect(() => {
    let cancelled = false;
    void preloadAssets(urls, (progress) => {
      if (!cancelled) setState((s) => ({ ...s, progress }));
    }).then(({ failedUrls }) => {
      if (!cancelled) setState({ ready: true, progress: 1, failedUrls });
    });
    return () => {
      cancelled = true;
    };
  }, [urls]);
  return state;
}
