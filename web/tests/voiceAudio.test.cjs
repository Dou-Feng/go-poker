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
    timers = [];
  const storage = new Map([
    ["gopoker-sfx-volume", "0.3"],
    ["gopoker-bgm-volume", "0.07"],
  ]);
  const session = { type: "auto" };
  function stream() {
    const track = {
      stopped: false,
      stop() {
        this.stopped = true;
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
      this.destination = {};
      contexts.push(this);
    }
    resume() {
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
    addEventListener() {},
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
      getUserMedia: () => options.capture?.promise ?? Promise.resolve(stream()),
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

test("leaving during echo-cancellation restart cannot reopen the microphone", async () => {
  const options = {};
  const h = harness(options);
  await h.voice.setMic(true);
  options.capture = deferred();
  const reopening = h.voice.setEchoCancellation(false);
  h.voice.leaveRoom();
  options.capture.resolve(h.stream());
  await reopening;
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
