// Simple WebAudio-based sound effect manager. The game sounds are custom
// assets shipped in web/public/sfx; only click/error keep the CC0 Kenney
// Interface Sounds. Volume is persisted in localStorage; 0 disables playback
// entirely.

const SFX_BASE = "/sfx";

export type SfxName =
  | "click" // generic button
  | "check" // check (tap on the felt) - hero and opponents
  | "heroBet" // my own call/raise (chips in)
  | "otherBet" // another player's call/raise
  | "fold" // fold (card drop) - hero and opponents
  | "allin" // all-in, anyone
  | "gameStart" // a fresh session's first hand begins
  | "showcard" // voluntarily showing my own hand ("show")
  | "showcardAll" // showdown flips the revealed hands open
  | "win" // pot collected at showdown (played twice)
  | "error"; // errors / forfeited pot

const FILES: Record<SfxName, string> = {
  click: "click_002.wav",
  check: "check_felt.wav",
  heroBet: "hero_bet.ogg",
  otherBet: "other_bet.ogg",
  fold: "card_drop.ogg",
  allin: "allin.wav",
  gameStart: "game_start.ogg",
  showcard: "showcard.ogg",
  showcardAll: "showcard_all.ogg",
  win: "win_pot.wav",
  error: "error_004.wav",
};

const VOLUME_KEY = "gopoker-sfx-volume";

let cachedVolume: number | null = null;
let audioCtx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer>();

export function getSfxVolume(): number {
  if (cachedVolume !== null) {
    return cachedVolume;
  }
  let v = 0.5;
  if (typeof window !== "undefined") {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw !== null) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
        v = parsed;
      }
    }
  }
  cachedVolume = v;
  return v;
}

export function setSfxVolume(volume: number) {
  const v = Math.min(1, Math.max(0, volume));
  cachedVolume = v;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(VOLUME_KEY, String(v));
  }
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) {
      return null;
    }
    audioCtx = new Ctor();
  }
  // Browsers start the context suspended until a user gesture.
  if (audioCtx.state === "suspended") {
    void audioCtx.resume();
  }
  return audioCtx;
}

async function getBuffer(
  ctx: AudioContext,
  name: SfxName
): Promise<AudioBuffer | null> {
  const cached = buffers.get(name);
  if (cached) {
    return cached;
  }
  try {
    const res = await fetch(`${SFX_BASE}/${FILES[name]}`);
    if (!res.ok) {
      return null;
    }
    const data = await res.arrayBuffer();
    const buf = await ctx.decodeAudioData(data);
    buffers.set(name, buf);
    return buf;
  } catch {
    return null;
  }
}

// Fire-and-forget playback; safe to call from anywhere, never throws.
export function playSfx(name: SfxName) {
  try {
    const volume = getSfxVolume();
    if (volume <= 0) {
      return;
    }
    const ctx = getCtx();
    if (!ctx) {
      return;
    }
    void getBuffer(ctx, name).then((buf) => {
      if (!buf || !audioCtx) {
        return;
      }
      const source = audioCtx.createBufferSource();
      source.buffer = buf;
      const gain = audioCtx.createGain();
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(audioCtx.destination);
      source.start();
    });
  } catch {
    // ignore: sounds are best-effort
  }
}

// Length of a sound in ms once its asset is decoded (0 if it cannot be
// loaded). Visual cues that must clear when a sound finishes (the "READY
// GO!" caption, the showdown pot collect) are timed from this so they stay in
// sync even if an asset is swapped for one of a different length.
export async function getSfxDurationMs(name: SfxName): Promise<number> {
  try {
    const ctx = getCtx();
    if (!ctx) {
      return 0;
    }
    const buf = await getBuffer(ctx, name);
    return buf ? Math.round(buf.duration * 1000) : 0;
  } catch {
    return 0;
  }
}
