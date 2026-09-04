import { Game as GameType } from "../interfaces";

// A tiny module-level event bus that carries *every* game snapshot exactly as
// it arrives from the socket, before React batching can coalesce two rapid
// broadcasts into a single render. TableFx subscribes here so its diff sees
// each intermediate frame (a bet followed by an instant call otherwise
// collapses into one render and the animation is lost).
type Listener = (snapshot: GameType) => void;

const listeners = new Set<Listener>();

export function subscribeFx(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitFx(snapshot: GameType): void {
  listeners.forEach((l) => l(snapshot));
}
