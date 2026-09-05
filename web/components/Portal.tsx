import { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

type portalProps = {
  children: ReactNode;
};

// Renders children at the end of <body>. Fixed-position modals opened from a
// toolbar that itself has a z-index (e.g. the game room's top-right column)
// are otherwise trapped inside that toolbar's stacking context and end up
// beneath table overlays with a higher z-index. Client-only: nothing is
// rendered during SSR or before mount.
export default function Portal({ children }: portalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);
  if (!mounted || typeof document === "undefined") {
    return null;
  }
  return createPortal(children, document.body);
}
