const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../providers/WebSocket.tsx"), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }
).outputText;

function fixture() {
  let effect,
    callbacks,
    ready = 0;
  let session = { username: "Alice", table: "old-room", clientID: "old-seat" };
  const actions = [],
    sent = [];
  const noop = () => {};
  const sessionApi = {
    loadSession: () => session,
    clearSession: () => {
      session = null;
    },
    saveSession: (next) => {
      session = next;
    },
    loadUsername: () => "Alice",
    loadUser: () => "account",
    loadToken: () => "token",
    tabAuthAccount: () => "account",
    saveUser: noop,
    saveUsername: noop,
  };
  const mocks = {
    react: {
      ...React,
      useState: (v) => [v, noop],
      useContext: () => ({ dispatch: (action) => actions.push(action) }),
      useEffect: (fn) => {
        effect = fn;
      },
    },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "../lib/session": sessionApi,
    "../lib/socketConnection": {
      createSocketConnection: (options) => {
        callbacks = options;
        return { ready: () => ready++, dispose: noop };
      },
    },
    "../lib/voice": {
      voice: { setSocket: noop, leaveRoom: noop, onSocketConnected: noop },
    },
    "../lib/settings": {
      setSettingsSocket: noop,
      hasStoredSettings: () => false,
      setSettingsAccount: noop,
      pushSettingsNow: noop,
    },
    "../lib/fxBus": { emitFx: noop },
  };
  const api = { exports: {} };
  new Function("require", "module", "exports", "window", "process", code)(
    (name) => mocks[name] ?? {},
    api,
    api.exports,
    { location: { protocol: "https:", host: "poker.test" } },
    { env: {} }
  );
  api.exports.SocketProvider({ children: null });
  effect();
  const socket = { send: (data) => sent.push(JSON.parse(data)) };
  return {
    actions,
    sent,
    callbacks,
    receive: (message) =>
      callbacks.onMessage({ data: JSON.stringify(message) }, socket),
    get session() {
      return session;
    },
    get ready() {
      return ready;
    },
  };
}

test("timeout clears the saved room and transient room screens", () => {
  const f = fixture();
  f.callbacks.onTimeout();
  assert.equal(f.session, null);
  assert.ok(f.actions.some((a) => a.type === "leaveRoom"));
  for (const type of ["setSettlement", "setProfile", "setSessionView"]) {
    assert.ok(f.actions.some((a) => a.type === type && a.payload === null));
  }
});

test("reconnection after timeout releases an auto-restored seat and ignores its room events", () => {
  const f = fixture();
  f.callbacks.onTimeout();
  f.actions.length = 0;
  f.receive({
    action: "update-player-uuid",
    uuid: "old-seat",
    tablename: "old-room",
  });
  f.receive({ action: "update-game", game: {} });
  f.receive({ action: "settlement", players: [] });
  assert.deepEqual(f.sent, [{ action: "leave-table", tablename: "old-room" }]);
  assert.deepEqual(f.actions, []);
  assert.equal(f.session, null);
});

test("a deliberate new join after timeout restores normal room handling", () => {
  const f = fixture();
  f.callbacks.onTimeout();
  f.receive({ action: "join-result", ok: true, tablename: "new-room" });
  f.receive({
    action: "update-player-uuid",
    uuid: "new-seat",
    tablename: "new-room",
  });
  f.receive({ action: "update-game", game: {} });
  assert.equal(f.session.table, "new-room");
  assert.equal(f.session.clientID, "new-seat");
  assert.equal(f.ready, 1);
  assert.deepEqual(f.sent, []);
});

test("wallet refresh does not unlock a room before its restored game snapshot", () => {
  const f = fixture();
  f.receive({
    action: "user-info",
    self: true,
    uuid: "account",
    username: "Alice",
  });
  assert.equal(f.ready, 0);
  f.receive({ action: "update-game", game: {} });
  assert.equal(f.ready, 1);
});
