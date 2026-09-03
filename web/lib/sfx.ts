// Simple WebAudio-based sound effect manager. All sounds are CC0
// (Kenney Interface Sounds, via Calinou/kenney-interface-sounds).
// Volume is persisted in localStorage; 0 disables playback entirely.

const SFX_BASE = "/sfx";

export type SfxName =
  | "click" // check / generic button
  | "call" // call / confirm
  | "raise" // raise / bet
  | "fold" // fold
  | "allin" // all-in
  | "deal" // cards dealt / hand start
  | "win" // pot won / settlement
  | "error"; // errors

const FILES: Record<SfxName, string> = {
  click: "click_002.wav",
  call: "glass_002.wav",
  raise: "drop_002.wav",
  fold: "bong_001.wav",
  allin: "switch_002.wav",
  deal: "click_003.wav",
  win: "confirmation_002.wav",
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
