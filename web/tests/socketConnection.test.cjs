const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../lib/socketConnection.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }
).outputText;

function fixture() {
  let now = 0,
    nextID = 0;
  const timers = new Map();
  const schedule = (fn, delay, repeat = false) => {
    const id = ++nextID;
    timers.set(id, { fn, at: now + delay, delay, repeat });
    return id;
  };
  const tick = (ms) => {
    const end = now + ms;
    while (true) {
      const due = [...timers]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, timer] = due;
      now = timer.at;
      if (timer.repeat) timer.at += timer.delay;
      else timers.delete(id);
      timer.fn();
    }
    now = end;
  };
  const events = new Map();
  const target = {
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: (name) => events.delete(name),
    visibilityState: "visible",
  };
  const sockets = [];
  class Socket {
    static OPEN = 1;
    readyState = 0;
    sent = [];
    constructor() {
      sockets.push(this);
    }
    open() {
      this.readyState = 1;
      this.onopen?.();
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
    message(data = { action: "pong" }) {
      this.onmessage?.({ data: JSON.stringify(data) });
    }
  }
  const api = { exports: {} };
  new Function(
    "module",
    "exports",
    "WebSocket",
    "window",
    "document",
    "Date",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    code
  )(
    api,
    api.exports,
    Socket,
    target,
    target,
    { now: () => now },
    schedule,
    (id) => timers.delete(id),
    (fn, delay) => schedule(fn, delay, true),
    (id) => timers.delete(id)
  );
  const statuses = [],
    messages = [];
  let timeouts = 0,
    disconnects = 0;
  const connection = api.exports.createSocketConnection({
    url: "ws://test/ws",
    onOpen: () => {},
    onMessage: (event) => messages.push(event.data),
    onDisconnect: () => disconnects++,
    onStatus: (status) => statuses.push(status),
    onTimeout: () => timeouts++,
  });
  return {
    connection,
    sockets,
    tick,
    timers,
    events,
    statuses,
    messages,
    get timeouts() {
      return timeouts;
    },
    get disconnects() {
      return disconnects;
    },
  };
}

test("opening a socket waits for application state before enabling the room", () => {
  const f = fixture();
  f.sockets[0].open();
  assert.equal(f.statuses.at(-1), "connecting");
  f.connection.ready();
  assert.equal(f.statuses.at(-1), "connected");
  f.connection.dispose();
});

test("a silent open socket is detected, detached and replaced", () => {
  const f = fixture();
  const old = f.sockets[0];
  old.open();
  f.connection.ready();
  f.tick(15000);
  assert.equal(old.readyState, 3);
  assert.equal(f.statuses.at(-1), "reconnecting");
  f.tick(1000);
  assert.equal(f.sockets.length, 2);
  assert.equal(f.timeouts, 0);
  f.connection.dispose();
});

test("late events from the previous socket cannot drop or update its replacement", () => {
  const f = fixture();
  const old = f.sockets[0];
  old.open();
  f.connection.ready();
  const lateClose = old.onclose,
    lateMessage = old.onmessage;
  old.close();
  f.tick(1000);
  f.sockets[1].open();
  f.connection.ready();
  lateClose();
  lateMessage({ data: "stale" });
  assert.equal(f.statuses.at(-1), "connected");
  assert.equal(f.messages.length, 0);
  f.connection.dispose();
});

test("30 seconds without recovery returns to the lobby once, while retries continue", () => {
  const f = fixture();
  f.sockets[0].open();
  f.connection.ready();
  f.sockets[0].close();
  f.tick(30000);
  assert.equal(f.timeouts, 1);
  assert.equal(f.statuses.at(-1), "disconnected");
  f.tick(30000);
  assert.equal(f.timeouts, 1);
  assert.ok(f.sockets.length > 3);
  f.sockets.at(-1).open();
  f.connection.ready();
  assert.equal(f.statuses.at(-1), "connected");
  f.connection.dispose();
});

test("a half-open connection or missing room snapshot cannot retry forever", () => {
  for (const open of [false, true]) {
    const f = fixture();
    if (open) f.sockets[0].open();
    f.tick(10000);
    assert.equal(f.sockets[0].readyState, 3);
    f.tick(20000);
    assert.equal(f.timeouts, 1);
    f.connection.dispose();
  }
});

test("successful recovery cancels the old timeout and starts a fresh outage budget", () => {
  const f = fixture();
  f.sockets[0].open();
  f.connection.ready();
  f.sockets[0].close();
  f.tick(1000);
  f.sockets[1].open();
  f.connection.ready();
  for (let i = 0; i < 8; i++) {
    f.tick(4000);
    f.sockets[1].message();
  }
  assert.equal(f.timeouts, 0);
  f.sockets[1].close();
  f.tick(30000);
  assert.equal(f.timeouts, 1);
  f.connection.dispose();
});

test("returning to a suspended tab probes a socket that only appears open", () => {
  const f = fixture();
  f.sockets[0].open();
  f.connection.ready();
  f.events.get("focus")();
  f.tick(2500);
  assert.equal(f.statuses.at(-1), "reconnecting");
  f.connection.dispose();
  assert.equal(f.timers.size, 0);
  assert.equal(f.events.size, 0);
});
