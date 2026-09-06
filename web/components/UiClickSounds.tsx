import { useEffect } from "react";
import { mountUiClick } from "../lib/uiClick";
import { preloadSfx } from "../lib/sfx";

/** Mounts the delegated `data-sfx` button-sound dispatcher once and warms the
 *  small SFX set in the background so the very first press sounds instantly.
 *  Renders nothing; lives at the app root so it is active on every screen. */
export default function UiClickSounds() {
  useEffect(() => {
    const unregister = mountUiClick();
    preloadSfx();
    return unregister;
  }, []);
  return null;
}
