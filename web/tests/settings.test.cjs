const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Tests for the account-side preference mirroring (web/lib/settings.ts): which
// keys travel, how a blob from the server is validated before it is written
// into local storage, and the debounced push.
//
// The module has no runtime imports, so the real file runs here unmodified.

const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../lib/settings.ts"), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
  }
).outputText;

function harness(initial = {}) {
  const storage = new Map(Object.entries(initial));
  const sent = [];
  const timers = [];
  const socket = {
    readyState: 1,
    send: (raw) => sent.push(JSON.parse(raw)),
  };
  const window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: () => {},
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    window,
    WebSocket: { OPEN: 1 },
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: () => {},
    console,
  });
  return { settings: exports, storage, sent, timers, socket };
}

const FULL = {
  "gopoker-lang": "zh",
  "gopoker-sfx-volume": "0.4",
  "gopoker-bgm-volume": "0.07",
  "gopoker-sound": '{"sfxVolume":0.4,"bgmVolume":0.07,"voice":"male"}',
  "gopoker-voice": '{"micVolume":2,"outputVolume":0.5,"mutedPeers":["acc-b"]}',
};

// Objects built inside the vm realm carry that realm's prototypes, which
// deepStrictEqual rejects; round-trip them through JSON before comparing.
const plain = (value) => JSON.parse(JSON.stringify(value));

test("collectSettings gathers every preference with its wire type", () => {
  const h = harness(FULL);
  assert.deepEqual(plain(h.settings.collectSettings()), {
    lang: "zh",
    sfxVolume: 0.4,
    bgmVolume: 0.07,
    sound: { sfxVolume: 0.4, bgmVolume: 0.07, voice: "male" },
    voice: { micVolume: 2, outputVolume: 0.5, mutedPeers: ["acc-b"] },
  });
});

test("collectSettings omits what was never stored", () => {
  const h = harness({ "gopoker-lang": "en" });
  assert.deepEqual(plain(h.settings.collectSettings()), { lang: "en" });
});

test("collectSettings ignores corrupt values instead of exporting them", () => {
  const h = harness({
    "gopoker-lang": "fr", // not a supported language
    "gopoker-sfx-volume": "loud",
    "gopoker-bgm-volume": "9", // out of range
    "gopoker-sound": "not json",
  });
  assert.deepEqual(plain(h.settings.collectSettings()), {});
});

test("applyAccountSettings writes the blob and reports the language", () => {
  const h = harness();
  const applied = [];
  h.settings.onSettingsApplied(() => applied.push(true));

  const lang = h.settings.applyAccountSettings({
    lang: "zh",
    sfxVolume: 0.25,
    sound: { voice: "male" },
    voice: { micVolume: 3 },
  });

  assert.equal(lang, "zh");
  assert.equal(h.storage.get("gopoker-lang"), "zh");
  assert.equal(h.storage.get("gopoker-sfx-volume"), "0.25");
  assert.equal(h.storage.get("gopoker-sound"), '{"voice":"male"}');
  assert.equal(h.storage.get("gopoker-voice"), '{"micVolume":3}');
  // Modules are told to re-read; React state is the caller's job.
  assert.equal(applied.length, 1);
});

test("applyAccountSettings rejects values of the wrong shape", () => {
  const h = harness({ "gopoker-lang": "en" });
  const lang = h.settings.applyAccountSettings({
    lang: "de", // unsupported
    sfxVolume: "loud", // not a number
    bgmVolume: 2, // out of range
    sound: ["nope"], // not an object
    voice: null, // not an object
  });

  assert.equal(lang, null);
  // Nothing was overwritten, and the stored language is untouched.
  assert.equal(h.storage.get("gopoker-lang"), "en");
  assert.equal(h.storage.has("gopoker-sfx-volume"), false);
  assert.equal(h.storage.has("gopoker-bgm-volume"), false);
  assert.equal(h.storage.has("gopoker-sound"), false);
  assert.equal(h.storage.has("gopoker-voice"), false);
});

test("applyAccountSettings tolerates junk from the wire", () => {
  const h = harness();
  for (const junk of [undefined, null, "zh", 42, []]) {
    assert.equal(h.settings.applyAccountSettings(junk), null);
  }
});

test("hasStoredSettings tells an empty account from a synced one", () => {
  const h = harness();
  assert.equal(h.settings.hasStoredSettings(undefined), false);
  assert.equal(h.settings.hasStoredSettings(null), false);
  assert.equal(h.settings.hasStoredSettings({}), false);
  assert.equal(h.settings.hasStoredSettings([]), false);
  assert.equal(h.settings.hasStoredSettings("zh"), false);
  assert.equal(h.settings.hasStoredSettings({ lang: "zh" }), true);
});

test("settingsChanged coalesces a burst into one push", () => {
  const h = harness(FULL);
  h.settings.setSettingsSocket(h.socket);
  h.settings.setSettingsAccount("acc-a");

  h.settings.settingsChanged();
  h.settings.settingsChanged();
  h.settings.settingsChanged();
  assert.equal(h.sent.length, 0);

  // Only the last timer survives the burst.
  h.timers.at(-1).fn();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].action, "set-settings");
  assert.equal(h.sent[0].settings.lang, "zh");
});

test("pushSettingsNow sends without waiting", () => {
  const h = harness(FULL);
  h.settings.setSettingsSocket(h.socket);
  h.settings.setSettingsAccount("acc-a");

  h.settings.pushSettingsNow();

  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].settings.sfxVolume, 0.4);
});

test("a change made offline is flushed when the socket returns", () => {
  const h = harness(FULL);
  h.settings.setSettingsAccount("acc-a");
  h.settings.settingsChanged(); // no socket yet: the push is held
  assert.equal(h.sent.length, 0);

  h.settings.setSettingsSocket(h.socket);

  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].settings.lang, "zh");
});

test("nothing is sent before sign-in", () => {
  // Changing the language on the welcome screen must not reach the server:
  // it would answer "not logged in", which the shared error toast turns into
  // a spurious error for the player.
  const h = harness(FULL);
  h.settings.setSettingsSocket(h.socket);
  h.settings.settingsChanged();
  h.timers.at(-1).fn();
  assert.equal(h.sent.length, 0);

  h.settings.pushSettingsNow();
  assert.equal(h.sent.length, 0);

  // Once the account is known, the same change goes out.
  h.settings.setSettingsAccount("acc-a");
  h.settings.pushSettingsNow();
  assert.equal(h.sent.length, 1);
});

test("a closed socket drops the push instead of throwing", () => {
  const h = harness(FULL);
  const closed = {
    readyState: 3,
    send: () => {
      throw new Error("socket is closed");
    },
  };
  h.settings.setSettingsAccount("acc-a");
  h.settings.setSettingsSocket(closed);
  h.settings.settingsChanged();
  h.timers.at(-1).fn();
  assert.equal(h.sent.length, 0);
});
