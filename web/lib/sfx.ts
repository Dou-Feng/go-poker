// Simple WebAudio-based sound effect manager. The game sounds are custom
// assets shipped in web/public/sfx; only click/error keep the CC0 Kenney
// Interface Sounds. Volume is persisted in localStorage; 0 disables playback
// entirely.

const SFX_BASE = "/sfx";

export type SfxName =
  | "click" // generic button
  | "pong" // primary / confirm UI buttons (register, create, room controls)
  | "drop" // taking a seat (sit down / claim / place a bot)
  | "tick" // ready / cancel-ready
  | "back" // close / return "x" buttons
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
  click: "click_003.ogg",
  pong: "bong_001.ogg",
  drop: "drop_003.ogg",
  tick: "tick_001.ogg",
  back: "click_001.ogg",
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

// Player-action press feedback: a short tick for the tap, then a ~200 ms
// breathing gap, then the action's own sound (fold/check/heroBet/allin), so
// the two follow each other cleanly instead of overlapping.
export function playTickedAction(sound: SfxName): void {
  playSfx("tick");
  void getSfxDurationMs("tick").then((ms) => {
    window.setTimeout(() => playSfx(sound), ms + 200);
  });
}

// Everything except the looping BGM tracks. All small (a few KB each), so
// decoding the whole set up front is cheap.
const ALL_SFX: SfxName[] = [
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
];

// Warm the WebAudio buffer cache so the very first press plays instantly
// instead of fetching and decoding the asset on demand. Best-effort; the
// context may still be suspended until the first user gesture, but the
// decoded buffers are ready for when it resumes.
export function preloadSfx(names: SfxName[] = ALL_SFX): void {
  try {
    const ctx = getCtx();
    if (!ctx) {
      return;
    }
    for (const name of names) {
      void getBuffer(ctx, name);
    }
  } catch {
    // ignore: preloading is best-effort
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

// ---- background music ----------------------------------------------------
// Looping music for the lobby and the game room (bg_lobby.mp3 / bg_room.mp3),
// sharing the SFX AudioContext. Browsers block audio until a user gesture, so
// the context is resumed on the first click/tap. Volume is stored separately
// from the SFX volume (gopoker-bgm-volume).

export type BgmTrack = "lobby" | "room";

const BGM_FILES: Record<BgmTrack, string> = {
  lobby: "/audio/bg_lobby.mp3",
  room: "/audio/bg_room.mp3",
};

const BGM_KEY = "gopoker-bgm-volume";
const bgmBuffers = new Map<string, AudioBuffer>();

let cachedBgmVolume: number | null = null;
let bgmTrack: BgmTrack | null = null;
let bgmSource: AudioBufferSourceNode | null = null;
let bgmGain: GainNode | null = null;
let audioUnlocked = false;

export function getBgmVolume(): number {
  if (cachedBgmVolume !== null) {
    return cachedBgmVolume;
  }
  let v = 0.15;
  if (typeof window !== "undefined") {
    const raw = window.localStorage.getItem(BGM_KEY);
    if (raw !== null) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
        v = parsed;
      }
    }
  }
  cachedBgmVolume = v;
  return v;
}

export function setBgmVolume(volume: number) {
  const v = Math.min(1, Math.max(0, volume));
  cachedBgmVolume = v;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(BGM_KEY, String(v));
  }
  // Live-update a track that is already looping.
  if (bgmGain && audioCtx) {
    bgmGain.gain.value = v;
  }
}

function unlockAudioOnGesture() {
  if (audioUnlocked) {
    return;
  }
  audioUnlocked = true;
  const resume = () => {
    const ctx = getCtx();
    if (ctx && ctx.state === "suspended") {
      void ctx.resume();
    }
  };
  document.addEventListener("pointerdown", resume, { once: true });
  document.addEventListener("keydown", resume, { once: true });
}

// Start looping music for a screen. Starting the same track again is a no-op;
// switching tracks swaps the loop. Fire-and-forget, never throws.
export function startBgm(track: BgmTrack) {
  try {
    if (bgmTrack === track && bgmSource) {
      return;
    }
    stopBgm();
    bgmTrack = track;
    const ctx = getCtx();
    if (!ctx) {
      return;
    }
    unlockAudioOnGesture();
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    const key = "bgm:" + track;
    void (async () => {
      try {
        let buf = bgmBuffers.get(key);
        if (!buf) {
          const res = await fetch(BGM_FILES[track]);
          if (!res.ok) {
            return;
          }
          const data = await res.arrayBuffer();
          buf = await ctx.decodeAudioData(data);
          bgmBuffers.set(key, buf);
        }
        if (bgmTrack !== track || !audioCtx) {
          return; // switched or stopped while decoding
        }
        const source = audioCtx.createBufferSource();
        source.buffer = buf;
        source.loop = true;
        const gain = audioCtx.createGain();
        gain.gain.value = getBgmVolume();
        source.connect(gain);
        gain.connect(audioCtx.destination);
        source.start();
        bgmSource = source;
        bgmGain = gain;
      } catch {
        // ignore: music is best-effort
      }
    })();
  } catch {
    // ignore: music is best-effort
  }
}

export function stopBgm() {
  try {
    bgmTrack = null;
    if (bgmSource) {
      try {
        bgmSource.stop();
      } catch {
        // already stopped
      }
      bgmSource.disconnect();
    }
    bgmSource = null;
    if (bgmGain) {
      bgmGain.disconnect();
    }
    bgmGain = null;
  } catch {
    // ignore: music is best-effort
  }
}
