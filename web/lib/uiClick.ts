import { playSfx, SfxName } from "./sfx";

// One rule for all interface buttons: any <button> that is NOT gameplay gets
// the generic click sound by default, so a newly added interface button is
// covered automatically — no per-button wiring.
//
// Exceptions:
//  - data-sfx="<SfxName>" on a button (or an ancestor) overrides the default
//    sound for that button (e.g. data-sfx="pong" for confirm/room controls).
//  - buttons inside GAMEPLAY_SELECTOR are left alone: the betting keys and
//    the raise panel already play their own sounds, seat surfaces / empty
//    seats stay silent.
const VALID: ReadonlySet<string> = new Set<SfxName>([
  "click",
  "pong",
  "drop",
  "tick",
  "back",
  "check",
  "heroBet",
  "otherBet",
  "fold",
  "allin",
  "gameStart",
  "showcard",
  "showcardAll",
  "win",
  "error",
]);

// Action bar + raise panel + every seat (occupied surface, ready / show-card,
// empty / open / bot-placement buttons). Generic clicks must not fire there.
const GAMEPLAY_SELECTOR =
  ".room-action-input, .gp-action-bar, .gp-action-btn, .gp-raise-panel, .poker-table-seat";

let mounted = false;

/** Wire the delegated capture listener once. Returns an unregister fn. */
export function mountUiClick(): () => void {
  if (mounted) {
    return () => {};
  }
  mounted = true;
  const onClick = (e: Event) => {
    const target = e.target as Element | null;
    if (!target || typeof target.closest !== "function") {
      return;
    }
    const btn = target.closest("button");
    if (!btn || (btn as HTMLButtonElement).disabled) {
      return;
    }
    if (btn.getAttribute("aria-disabled") === "true") {
      return;
    }
    // Explicit tag wins (e.g. the pong group).
    const tagged = btn.closest("[data-sfx]") as HTMLElement | null;
    if (tagged) {
      const name = tagged.dataset.sfx;
      if (name && VALID.has(name)) {
        playSfx(name as SfxName);
      }
      return;
    }
    // Gameplay controls are left to their own sounds (or stay silent).
    if (btn.closest(GAMEPLAY_SELECTOR)) {
      return;
    }
    // Everything else is an interface button: one generic class of sound.
    playSfx("click");
  };
  document.addEventListener("click", onClick, true);
  return () => {
    document.removeEventListener("click", onClick, true);
    mounted = false;
  };
}
