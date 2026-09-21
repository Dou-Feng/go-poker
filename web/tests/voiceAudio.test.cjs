const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const compiled = Object.fromEntries(
  ["sfx", "voice"].map((name) => [
    name,
    ts.transpileModule(
      fs.readFileSync(path.join(__dirname, `../lib/${name}.ts`), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2019,
        },
      }
    ).outputText,
  ])
);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function harness(options = {}) {
  const contexts = [],
    tracks = [],
    elements = [],
    peers = [],
    timers = [],
    captures = [],
    constraints = [],
    listeners = new Map();
  const storage = new Map([
    ["gopoker-sfx-volume", "0.3"],
    ["gopoker-bgm-volume", "0.07"],
  ]);
  if (options.settings)
    storage.set("gopoker-voice", JSON.stringify(options.settings));
  const session = { type: "auto" };
  function stream() {
    const track = {
      stopped: false,
      stop() {
        this.stopped = true;
      },
      async applyConstraints(value) {
        constraints.push(value);
        if (options.apply) await options.apply(value);
      },
    };
    tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  }
  class AudioContext {
    constructor() {
      this.state = options.resume ? "suspended" : "running";
      this.sources = [];
      this.gains = [];
      this.compressors = [];
      this.resumeCalls = 0;
      this.destination = {};
      contexts.push(this);
    }
    resume() {
      this.resumeCalls++;
      this.state = "running";
      return options.resume?.promise ?? Promise.resolve();
    }
    close() {
      this.state = "closed";
      return options.close?.promise ?? Promise.resolve();
    }
    decodeAudioData() {
      return Promise.resolve({ duration: 0.1 });
    }
    createBufferSource() {
      const source = {
        started: false,
        stopped: false,
        connect() {},
        disconnect() {},
        start() {
          this.started = true;
        },
        stop() {
          this.stopped = true;
        },
      };
      this.sources.push(source);
      return source;
    }
    createGain() {
      const gain = { gain: { value: 1 }, connect() {}, disconnect() {} };
      this.gains.push(gain);
      return gain;
    }
    createMediaStreamSource() {
      if (options.graphFailure) throw new Error("graph failed");
      return { connect() {} };
    }
    createDynamicsCompressor() {
      const compressor = {
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 0 },
        attack: { value: 0 },
        release: { value: 0 },
        connect() {},
      };
      this.compressors.push(compressor);
      return compressor;
    }
    createMediaStreamDestination() {
      return { stream: stream() };
    }
  }
  class RTCPeerConnection {
    constructor() {
      peers.push(this);
    }
    addTransceiver() {
      return {
        direction: "recvonly",
        sender: { replaceTrack: async () => {} },
      };
    }
    close() {
      this.closed = true;
    }
  }
  const document = {
    body: { appendChild() {} },
    addEventListener(name, fn) {
      listeners.set(name, fn);
    },
    createElement(tag) {
      const element = {
        tag,
        style: {},
        paused: true,
        removed: false,
        setAttribute() {},
        appendChild() {},
        pause() {
          this.paused = true;
        },
        play() {
          this.paused = false;
          return Promise.resolve();
        },
        remove() {
          this.removed = true;
        },
      };
      elements.push(element);
      return element;
    },
  };
  const navigator = {
    userAgent: options.desktop ? "Linux" : "iPhone",
    platform: options.desktop ? "Linux" : "iPhone",
    maxTouchPoints: 5,
    mediaDevices: {
      getUserMedia: (value) => {
        captures.push(value);
        return options.capture?.promise ?? Promise.resolve(stream());
      },
    },
  };
  if (!options.noSession) navigator.audioSession = session;
  const window = {
    AudioContext,
    isSecureContext: true,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    location: { hostname: "localhost" },
    setTimeout: (fn) => {
      timers.push(fn);
    },
  };
  const modules = {};
  for (const name of ["sfx", "voice"]) {
    const exports = {};
    vm.runInNewContext(compiled[name], {
      exports,
      window,
      navigator,
      document,
      RTCPeerConnection,
      process: { env: {} },
      console,
      setTimeout,
      clearTimeout,
      fetch: () =>
        options.fetch?.promise ??
        Promise.resolve({
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(0),
        }),
      require: (id) =>
        id === "./sfx"
          ? modules.sfx
          : { getIceServers() {}, sendVoiceSignal() {} },
    });
    modules[name] = exports;
  }
  const voice = modules.voice.voice;
  voice.enterRoom("room", "self");
  return {
    voice,
    sfx: modules.sfx,
    contexts,
    tracks,
    elements,
    peers,
    timers,
    storage,
    session,
    stream,
    captures,
    constraints,
    listeners,
  };
}

test("turning off the mic restores normal audio while game sounds keep playing", async () => {
  const h = harness();
  h.sfx.startBgm("room");
  h.sfx.playSfx("tick");
  await flush();
  const game = h.contexts[0];
  assert.equal(h.session.type, "ambient");
  assert.equal(game.sources.length, 2);
  await h.voice.setMic(true);
  assert.equal(h.session.type, "play-and-record");
  assert.equal(game.state, "running");
  assert.ok(game.sources.every((s) => !s.stopped));
  h.sfx.playSfx("fold");
  await flush();
  assert.equal(game.sources.length, 3);
  h.voice.setSpeaker(true);
  await h.voice.setMic(false);
  await flush();
  assert.equal(h.session.type, "playback");
  assert.ok(h.tracks.every((t) => t.stopped));
  assert.equal(h.contexts[1].state, "closed");
  assert.equal(game.state, "running");
  h.voice.setSpeaker(false);
  await flush();
  assert.equal(h.session.type, "ambient");
  assert.equal(h.contexts.length, 2); // Keep the original game context and BGM.
  assert.ok(game.sources.every((s) => !s.stopped));
  assert.equal(h.sfx.getSfxVolume(), 0.3);
  assert.equal(h.storage.get("gopoker-bgm-volume"), "0.07");
});

test("turning off listening pauses remote audio, and leaving detaches media and closes peers", async () => {
  const h = harness();
  await h.voice.setMic(true);
  h.voice.setSpeaker(true);
  h.voice.handleSignal({ from: "other", kind: "join", payload: { mic: true } });
  h.peers[0].ontrack({ streams: [h.stream()] });
  const audio = h.elements.find((e) => e.tag === "audio");
  assert.equal(audio.paused, false);
  h.voice.setSpeaker(false);
  assert.equal(audio.paused, true);
  assert.equal(h.session.type, "play-and-record");
  h.voice.setSpeaker(true);
  assert.equal(audio.paused, false);
  h.voice.leaveRoom();
  await flush();
  assert.equal(audio.paused, true);
  assert.equal(audio.srcObject, null);
  assert.equal(audio.removed, true);
  assert.ok(h.peers.every((p) => p.closed));
  assert.equal(h.session.type, "ambient");
});

for (const cancel of ["leave", "mic-off"]) {
  test(`late microphone permission after ${cancel} cannot restart recording`, async () => {
    const capture = deferred();
    const h = harness({ capture });
    const opening = h.voice.setMic(true);
    if (cancel === "leave") h.voice.leaveRoom();
    else await h.voice.setMic(false);
    capture.resolve(h.stream());
    await opening;
    assert.equal(h.voice.getState().micOn, false);
    assert.ok(h.tracks.every((t) => t.stopped));
    assert.equal(h.contexts.length, 0);
    assert.equal(h.session.type, "ambient");
  });
}

test("leaving during microphone AudioContext resume releases capture and context", async () => {
  const resume = deferred();
  const h = harness({ resume });
  const opening = h.voice.setMic(true);
  await flush();
  h.voice.leaveRoom();
  resume.resolve();
  await opening;
  assert.ok(h.tracks.every((t) => t.stopped));
  assert.ok(h.contexts.every((c) => c.state === "closed"));
  assert.equal(h.voice.getState().micOn, false);
  assert.equal(h.session.type, "ambient");
});

test("denied permission restores audio mode without changing volume preferences", async () => {
  const capture = deferred();
  const h = harness({ capture });
  const opening = h.voice.setMic(true);
  capture.reject(new Error("denied"));
  await opening;
  assert.equal(h.session.type, "ambient");
  assert.equal(h.voice.getState().error, "micDenied");
  assert.equal(h.sfx.getSfxVolume(), 0.3);
  assert.equal(h.sfx.getBgmVolume(), 0.07);
});

test("late cleanup from the previous mic cannot reset a newly opened mic's session", async () => {
  const close = deferred();
  const h = harness({ close });
  await h.voice.setMic(true);
  await h.voice.setMic(false);
  await h.voice.setMic(true);
  close.resolve();
  await flush();
  assert.equal(h.session.type, "play-and-record");
  assert.equal(h.voice.getState().micOn, true);
  h.voice.leaveRoom();
  await flush();
  assert.equal(h.session.type, "ambient");
  assert.ok(h.tracks.every((t) => t.stopped));
});

test("leaving during a live echo-cancellation change cannot reopen the microphone", async () => {
  const options = {};
  const h = harness(options);
  await h.voice.setMic(true);
  const apply = deferred();
  options.apply = () => apply.promise;
  const changing = h.voice.setEchoCancellation(true);
  await flush();
  h.voice.leaveRoom();
  apply.resolve();
  await changing;
  assert.equal(h.voice.getState().micOn, false);
  assert.equal(h.session.type, "ambient");
  assert.ok(h.tracks.every((t) => t.stopped));
});

test("failed mic processing closes its context before using the raw track", async () => {
  const h = harness({ graphFailure: true });
  await h.voice.setMic(true);
  assert.equal(h.voice.getState().micOn, true);
  assert.equal(h.contexts[0].state, "closed");
  await h.voice.setMic(false);
  assert.ok(h.tracks.every((t) => t.stopped));
  assert.equal(h.session.type, "ambient");
});

test("game audio created during capture cannot switch the mic out of call mode", async () => {
  const h = harness();
  await h.voice.setMic(true);
  h.sfx.startBgm("room");
  await flush();
  assert.equal(h.session.type, "play-and-record");
  await h.voice.setMic(false);
  assert.equal(h.session.type, "ambient");
  assert.equal(h.contexts[1].state, "running");
});

test("unsupported Audio Session API still cleans up and keeps game sounds", async () => {
  for (const desktop of [false, true]) {
    const h = harness({ noSession: true, desktop });
    h.sfx.startBgm("room");
    await flush();
    const game = h.contexts[0];
    await h.voice.setMic(true);
    assert.equal(game.state, "running");
    h.voice.leaveRoom();
    await flush();
    assert.ok(h.tracks.every((t) => t.stopped));
  }
});

test("echo cancellation defaults off, including older settings without the field", async () => {
  for (const settings of [
    undefined,
    { micVolume: 0.7 },
    { echoCancellation: false },
  ]) {
    const h = harness({ settings });
    assert.equal(h.voice.getState().echoCancellation, false);
    await h.voice.setMic(true);
    assert.equal(h.captures[0].audio.echoCancellation, false);
    assert.equal(h.captures[0].audio.autoGainControl, true);
  }
  const h = harness({ settings: { echoCancellation: true } });
  assert.equal(h.voice.getState().echoCancellation, true);
  await h.voice.setMic(true);
  assert.equal(h.captures[0].audio.echoCancellation, true);
});

test("live echo changes preserve capture, game audio, mic gain and processing context", async () => {
  const h = harness({ settings: { echoCancellation: true, micVolume: 2 } });
  h.sfx.startBgm("room");
  await flush();
  await h.voice.setMic(true);
  const [game, mic] = h.contexts;
  game.state = "interrupted";
  mic.state = "interrupted";
  await h.voice.setEchoCancellation(false);
  assert.equal(h.constraints[0].echoCancellation.exact, false);
  assert.equal(h.constraints[0].autoGainControl, true);
  assert.equal(h.constraints[0].noiseSuppression, true);
  assert.equal(h.captures.length, 1);
  assert.equal(h.contexts.length, 2);
  assert.ok(h.tracks.every((t) => !t.stopped));
  assert.equal(game.state, "running");
  assert.equal(mic.state, "running");
  assert.equal(mic.gains[0].gain.value, 2);
  assert.equal(game.sources[0].stopped, false);
  h.sfx.playSfx("fold");
  await flush();
  assert.equal(game.sources.length, 2);
  assert.equal(h.session.type, "play-and-record");
});

test("failed constraint changes retain a working mic and restore the previous setting", async () => {
  const h = harness({ apply: () => Promise.reject(new Error("unsupported")) });
  await h.voice.setMic(true);
  await h.voice.setEchoCancellation(true);
  assert.equal(h.voice.getState().echoCancellation, false);
  assert.equal(h.voice.getState().micOn, true);
  assert.equal(h.voice.getState().error, "voiceSettingsFailed");
  assert.equal(
    JSON.parse(h.storage.get("gopoker-voice")).echoCancellation,
    false
  );
  assert.equal(h.captures.length, 1);
  assert.ok(h.tracks.every((t) => !t.stopped));
});

test("rapid echo toggles are applied in order without reopening capture", async () => {
  const applying = deferred();
  const h = harness({ apply: () => applying.promise });
  await h.voice.setMic(true);
  const on = h.voice.setEchoCancellation(true);
  await flush();
  const off = h.voice.setEchoCancellation(false);
  assert.equal(h.constraints.length, 1);
  applying.resolve();
  await Promise.all([on, off]);
  assert.deepEqual(
    h.constraints.map((c) => c.echoCancellation.exact),
    [true, false]
  );
  assert.equal(h.voice.getState().echoCancellation, false);
  assert.equal(h.captures.length, 1);
});

for (const during of ["permission", "context resume"]) {
  test(`echo preference changed during ${during} is applied before sending`, async () => {
    const pending = deferred();
    const h = harness(
      during === "permission" ? { capture: pending } : { resume: pending }
    );
    const opening = h.voice.setMic(true);
    await flush();
    await h.voice.setEchoCancellation(true);
    pending.resolve(during === "permission" ? h.stream() : undefined);
    await opening;
    assert.equal(h.constraints.at(-1).echoCancellation.exact, true);
    assert.equal(h.voice.getState().micOn, true);
    assert.equal(h.voice.getState().echoCancellation, true);
  });
}

test("Safari interruptions resume game audio even after the first gesture", async () => {
  const h = harness();
  h.sfx.startBgm("room");
  await flush();
  const game = h.contexts[0];
  game.state = "interrupted";
  game.onstatechange();
  await flush();
  assert.equal(game.state, "running");
  for (let i = 0; i < 2; i++) {
    game.state = "interrupted";
    h.listeners.get("pointerdown")();
    await flush();
    assert.equal(game.state, "running");
  }
  assert.equal(game.sources.length, 1);
});

test("mic boost can exceed unity, persists across reload, and never amplifies game audio", async () => {
  const h = harness();
  h.sfx.startBgm("room");
  await flush();
  await h.voice.setMic(true);
  const [game, mic] = h.contexts;
  h.voice.setMicVolume(2.5);
  assert.equal(mic.gains[0].gain.value, 2.5);
  assert.equal(mic.compressors.length, 1);
  assert.equal(mic.compressors[0].threshold.value, -1);
  assert.equal(game.gains[0].gain.value, 0.07);
  const restored = harness({
    settings: JSON.parse(h.storage.get("gopoker-voice")),
  });
  await restored.voice.setMic(true);
  assert.equal(restored.contexts[0].gains[0].gain.value, 2.5);
  h.voice.setMicVolume(10);
  assert.equal(mic.gains[0].gain.value, 3);
  h.voice.setMicVolume(0);
  assert.equal(mic.gains[0].gain.value, 0);
});
