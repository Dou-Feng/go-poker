// Lightweight client-side audio: synthesized SFX via the Web Audio API and
// voice announcements via the browser's SpeechSynthesis API (so male/female
// voices work without any external assets or APIs).

export type SoundSettings = {
  sfxVolume: number;
  bgmVolume: number;
  voice: "male" | "female";
};

const KEY = "gopoker-sound";

const DEFAULTS: SoundSettings = {
  sfxVolume: 0.6,
  bgmVolume: 0.3,
  voice: "female",
};

export function loadSoundSettings(): SoundSettings {
  if (typeof window === "undefined") {
    return DEFAULTS;
  }
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      return { ...DEFAULTS, ...JSON.parse(raw) };
    }
  } catch {
    // ignore malformed settings
  }
  return DEFAULTS;
}

export function saveSoundSettings(settings: SoundSettings) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  }
}

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) {
    return null;
  }
  if (!audioCtx) {
    audioCtx = new AC();
  }
  return audioCtx;
}

function tone(
  freq: number,
  duration: number,
  type: OscillatorType,
  volume: number,
  delay = 0
) {
  const ac = ctx();
  if (!ac || volume <= 0) {
    return;
  }
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t = ac.currentTime + delay;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

export function playSfx(
  name: "deal" | "chip" | "check" | "call" | "raise" | "allin" | "fold" | "win"
) {
  const v = loadSoundSettings().sfxVolume;
  if (v <= 0) {
    return;
  }
  switch (name) {
    case "deal":
      tone(660, 0.12, "triangle", v);
      break;
    case "chip":
      tone(1250, 0.05, "square", v * 0.45);
      break;
    case "check":
      tone(520, 0.1, "sine", v);
      break;
    case "call":
      tone(620, 0.1, "sine", v);
      break;
    case "raise":
      tone(880, 0.12, "sine", v);
      break;
    case "allin":
      tone(440, 0.22, "sawtooth", v * 0.55);
      break;
    case "fold":
      tone(300, 0.16, "sine", v);
      break;
    case "win":
      [523, 659, 784].forEach((f, i) => tone(f, 0.2, "triangle", v, i * 0.13));
      break;
  }
}

export function speak(text: string, lang: "en" | "zh") {
  const settings = loadSoundSettings();
  if (settings.sfxVolume <= 0) {
    return;
  }
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang === "zh" ? "zh-CN" : "en-US";
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find((v) =>
    settings.voice === "male"
      ? /male|david|daniel|li-mu|yunxi/i.test(v.name)
      : /female|samantha|victoria|zira|xiaoxiao|xiaoyi/i.test(v.name)
  );
  if (voice) {
    u.voice = voice;
  }
  u.rate = 1.05;
  u.volume = Math.min(1, settings.sfxVolume + 0.2);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

// A very soft, looping ambient pad used as background music. It is generated
// from detuned oscillators so it needs no audio assets.
let bgmTimer: ReturnType<typeof setInterval> | null = null;
let bgmNodes: { osc: OscillatorNode; gain: GainNode }[] = [];

export function startBgm() {
  const ac = ctx();
  if (!ac || bgmTimer) {
    return;
  }
  const volume = loadSoundSettings().bgmVolume;
  if (volume <= 0) {
    return;
  }
  const chords = [
    [220, 277.18, 329.63],
    [174.61, 220, 261.63],
    [196, 246.94, 293.66],
    [164.81, 207.65, 246.94],
  ];
  let idx = 0;
  const playChord = () => {
    bgmNodes.forEach((n) => {
      try {
        n.osc.stop();
      } catch {
        // ignore
      }
    });
    bgmNodes = [];
    const chord = chords[idx % chords.length];
    idx++;
    chord.forEach((freq) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.detune.value = 4;
      const t = ac.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume * 0.35, t + 0.8);
      gain.gain.setValueAtTime(volume * 0.35, t + 2.4);
      gain.gain.linearRampToValueAtTime(0, t + 3.6);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 3.8);
      bgmNodes.push({ osc, gain });
    });
  };
  playChord();
  bgmTimer = setInterval(playChord, 3600);
}

export function stopBgm() {
  if (bgmTimer) {
    clearInterval(bgmTimer);
    bgmTimer = null;
  }
  bgmNodes.forEach((n) => {
    try {
      n.osc.stop();
    } catch {
      // ignore
    }
  });
  bgmNodes = [];
}
