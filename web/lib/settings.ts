// Player preferences live in localStorage so they apply before login and on
// every page load; they are mirrored onto the account as well
// (backend/server/settings.go) so they follow the player to another device.
//
// Two rules shape this module:
//
//   - While playing, the client is authoritative: a change is applied locally
//     at once and pushed in the background, so a slow or failed save never
//     blocks the UI and offline play keeps working.
//   - On sign-in the account's copy wins — except for an account that has none
//     yet (a new player, or anyone from before this feature existed): it
//     adopts the browser's settings, so nobody loses the setup they had.
//
// The module imports no setting module on purpose. voice/sfx/sound subscribe
// here instead, so a change can travel module -> settings (push) and
// settings -> module (apply) without an import cycle.

import type { Language } from "./translations";
import type { SoundSettings } from "./sound";

/** One preference: where it lives locally, and how it looks on the wire. */
type FieldCodec = {
  name: string;
  storage: string;
  /** Local storage -> blob value; undefined when nothing is stored yet. */
  read(): unknown;
  /** Blob value -> local storage. Ignores values of the wrong type. */
  write(value: unknown): void;
};

function readRaw(storage: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(storage);
  } catch {
    return null;
  }
}

function writeRaw(storage: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(storage, value);
  } catch {
    // Storage unavailable (private mode, disabled cookies): settings simply
    // do not persist locally; the account copy still carries them.
  }
}

function readJSON(storage: string): unknown {
  const raw = readRaw(storage);
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FIELDS: FieldCodec[] = [
  {
    name: "lang",
    storage: "gopoker-lang",
    read: () => {
      const raw = readRaw("gopoker-lang");
      return raw === "en" || raw === "zh" ? raw : undefined;
    },
    write: (value) => {
      if (value === "en" || value === "zh") {
        writeRaw("gopoker-lang", value);
      }
    },
  },
  {
    name: "sfxVolume",
    storage: "gopoker-sfx-volume",
    read: () => readVolume("gopoker-sfx-volume"),
    write: (value) => {
      if (isVolume(value)) {
        writeRaw("gopoker-sfx-volume", String(value));
      }
    },
  },
  {
    name: "bgmVolume",
    storage: "gopoker-bgm-volume",
    read: () => readVolume("gopoker-bgm-volume"),
    write: (value) => {
      if (isVolume(value)) {
        writeRaw("gopoker-bgm-volume", String(value));
      }
    },
  },
  {
    name: "sound",
    storage: "gopoker-sound",
    read: () => readJSON("gopoker-sound"),
    write: (value) => {
      if (isPlainObject(value)) {
        writeRaw("gopoker-sound", JSON.stringify(value));
      }
    },
  },
  {
    name: "voice",
    storage: "gopoker-voice",
    read: () => readJSON("gopoker-voice"),
    write: (value) => {
      if (isPlainObject(value)) {
        writeRaw("gopoker-voice", JSON.stringify(value));
      }
    },
  },
];

/**
 * Volumes are 0..1. The same range check guards reading and writing, so a
 * value this module exports can always be applied again on another device.
 */
function isVolume(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function readVolume(storage: string): number | undefined {
  const raw = readRaw(storage);
  if (raw === null) {
    return undefined;
  }
  const value = Number(raw);
  return isVolume(value) ? value : undefined;
}

export type SettingsBlob = Record<string, unknown>;

/** The browser's current preferences, ready to be stored on the account. */
export function collectSettings(): SettingsBlob {
  const blob: SettingsBlob = {};
  for (const field of FIELDS) {
    const value = field.read();
    if (value !== undefined) {
      blob[field.name] = value;
    }
  }
  return blob;
}

type AppliedListener = () => void;
const appliedListeners = new Set<AppliedListener>();

/**
 * Register a module that must re-read its preferences after an incoming
 * blob was written (see voice.reloadSettings, sfx volume setters, ...).
 */
export function onSettingsApplied(listener: AppliedListener): void {
  appliedListeners.add(listener);
}

function notifyApplied() {
  appliedListeners.forEach((listener) => listener());
}

export function hasStoredSettings(raw: unknown): boolean {
  return isPlainObject(raw) && Object.keys(raw).length > 0;
}

/**
 * Adopt the preferences stored on the account. Returns the language to switch
 * to, or null when the blob carried none (the caller owns React state, so
 * this module never dispatches).
 */
export function applyAccountSettings(raw: unknown): Language | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  let touched = false;
  for (const field of FIELDS) {
    if (!(field.name in raw)) {
      continue;
    }
    field.write(raw[field.name]);
    touched = true;
  }
  if (touched) {
    notifyApplied();
  }
  const lang = raw.lang;
  return lang === "en" || lang === "zh" ? lang : null;
}

// ---- pushing to the server --------------------------------------------

/** Minimum spacing between saves; a slider drag produces many changes. */
const PUSH_DELAY_MS = 1500;

let socket: WebSocket | null = null;
let account: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The signed-in account, or null on the register/login screen. Preferences
 * are only pushed for an account: the server answers "not logged in" to
 * anything else, and the shared error toast would surface that to a player who
 * merely switched the language on the welcome screen.
 */
export function setSettingsAccount(uuid: string | null): void {
  account = uuid && uuid.length > 0 ? uuid : null;
  if (account) {
    flushPendingPush();
  }
}

/** The live game socket, or null while disconnected. */
export function setSettingsSocket(next: WebSocket | null): void {
  socket = next;
  if (next) {
    flushPendingPush();
  }
}

function send(blob: SettingsBlob) {
  if (!account || !socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  try {
    socket.send(JSON.stringify({ action: "set-settings", settings: blob }));
  } catch {
    // A closed socket loses this push; the next change retries.
  }
}

function flushPendingPush() {
  if (pushTimer === null) {
    return;
  }
  clearTimeout(pushTimer);
  pushTimer = null;
  send(collectSettings());
}

/**
 * Note that a preference changed: the push is debounced and coalesced, so a
 * slider drag or a burst of toggles costs one save. Changes made while
 * offline are sent as soon as the socket is back (setSettingsSocket).
 */
export function settingsChanged(): void {
  if (typeof window === "undefined") {
    return;
  }
  if (pushTimer !== null) {
    clearTimeout(pushTimer);
  }
  pushTimer = setTimeout(() => {
    pushTimer = null;
    send(collectSettings());
  }, PUSH_DELAY_MS);
}

/** Upload immediately — used to seed an account that has nothing stored. */
export function pushSettingsNow(): void {
  if (pushTimer !== null) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  send(collectSettings());
}
