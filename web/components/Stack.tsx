import { useContext, useEffect, useRef, useState } from "react";
import { AppContext } from "../providers/AppStore";
import { useTranslation } from "../hooks/useTranslation";
import Chip from "./Chip";
import Rebuy from "./Rebuy";
import RoomBalanceButton from "./RoomBalanceButton";

// Keep the rebuy affordance visible on touch screens, where hover titles
// cannot explain that the table-stack counter is also a button.
export default function Stack() {
  const { appState } = useContext(AppContext);
  const { t } = useTranslation();
  const [showRebuy, setShowRebuy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showRebuy) return;
    const outside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setShowRebuy(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowRebuy(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [showRebuy]);

  const game = appState.game;
  const me = game?.players.find((p) => p.uuid === appState.clientID);
  if (!game || !me) {
    return null;
  }

  return (
    <div ref={containerRef} className="relative flex flex-col items-end">
      <RoomBalanceButton
        buttonRef={triggerRef}
        amount={me.stack}
        label={t("tapToRebuy")}
        icon={<Chip className="h-4 w-4 shrink-0" amount={me.stack} />}
        expanded={showRebuy}
        onClick={() => setShowRebuy((s) => !s)}
      />
      {showRebuy && (
        <div className="absolute right-0 top-full z-50 mt-1 w-full">
          <Rebuy onDone={() => setShowRebuy(false)} />
        </div>
      )}
    </div>
  );
}
