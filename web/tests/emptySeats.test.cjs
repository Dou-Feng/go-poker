const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");

function load(relativePath, mocks = {}) {
  const code = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, relativePath), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
      },
    }
  ).outputText;
  const api = { exports: {} };
  new Function("require", "module", "exports", "React", code)(
    (name) => mocks[name] ?? { default: () => null },
    api,
    api.exports,
    React
  );
  return api.exports;
}
const seatHelpers = load("../lib/spectatorSeat.ts");
function fixture({
  chips = 200,
  clientID = null,
  players = [],
  busted = false,
  running = false,
} = {}) {
  const calls = [];
  const stateChanges = [];
  const appState = {
    uuid: "guest-account",
    username: "guest",
    clientID,
    chips,
    game: {
      players,
      busted,
      running,
      reserved: [],
      spectators: [],
      host: "host-account",
      config: { buyIn: 200, maxPlayers: 6 },
    },
  };
  const mocks = {
    react: {
      ...React,
      useContext: () => ({ appState, dispatch: () => {} }),
      useState: (initial) => [
        typeof initial === "function" ? initial() : initial,
        (value) => stateChanges.push(value),
      ],
      useRef: (value) => ({ current: value }),
      useEffect: () => {},
    },
    "../hooks/useSocket": { useSocket: () => ({}) },
    "../hooks/useTranslation": { useTranslation: () => ({ t: (key) => key }) },
    "../hooks/useVoice": { useVoice: () => ({ peers: {} }) },
    "../lib/spectatorSeat": seatHelpers,
    "../actions/actions": Object.fromEntries(
      ["takeSeat", "moveSeat", "sendLog"].map((name) => [
        name,
        (...args) => calls.push({ name, args }),
      ])
    ),
  };
  return { appState, calls, stateChanges, mocks };
}
function emptySeat(f) {
  return load("../components/Seat.tsx", f.mocks).default({
    player: null,
    id: 2,
    reveal: false,
  });
}

test("a non-host with 199 chips sees insufficient funds for a 200 buy-in", () => {
  const f = fixture({ chips: 199 });
  const seat = emptySeat(f);
  assert.equal(seat.props.disabled, true);
  assert.equal(seat.props.caption, "notEnoughChips");
  f.appState.chips = 200;
  const available = emptySeat(f);
  assert.ok(!available.props.disabled);
  available.props.onClick();
  assert.equal(f.calls[0].name, "takeSeat");
});

test("settlement's stale seat ID does not block a new seat or send a move request", () => {
  const f = fixture({ clientID: "old-seat" });
  emptySeat(f).props.onClick();
  assert.equal(f.calls[0].name, "takeSeat");
});

test("a stale seat ID also allows a spectator to reserve during a hand", () => {
  const f = fixture({ clientID: "old-seat", running: true });
  const seat = emptySeat(f);
  assert.equal(seat.props.caption, "nextHand");
  seat.props.onClick();
  assert.equal(f.calls[0].name, "takeSeat");
});

test("seated players can move without wallet chips, but ready players cannot", () => {
  const f = fixture({
    clientID: "seat",
    chips: 0,
    players: [{ uuid: "seat", ready: false }],
  });
  emptySeat(f).props.onClick();
  assert.equal(f.calls[0].name, "moveSeat");
  f.appState.game.players[0].ready = true;
  assert.equal(emptySeat(f).props.disabled, true);
});

test("tournament elimination stays blocked even after topping up", () => {
  const seat = emptySeat(fixture({ busted: true, chips: 1000 }));
  assert.equal(seat.props.disabled, true);
  assert.equal(seat.props.caption, "bustedOut");
});

function descendants(node) {
  if (!node || typeof node !== "object") return [];
  return [
    node,
    ...React.Children.toArray(node.props?.children).flatMap(descendants),
  ];
}
test("an idle spectator sees their balance, buy-in and working top-up entry", () => {
  const f = fixture({ chips: 199 });
  const RoomDock = load("../components/RoomDock.tsx", f.mocks).default;
  const elements = descendants(RoomDock({ dockRef: null }));
  const notice = elements.find((node) => node.props.role === "status");
  assert.ok(notice);
  assert.match(JSON.stringify(notice), /199/);
  assert.match(JSON.stringify(notice), /200/);
  const button = descendants(notice).find((node) => node.type === "button");
  assert.equal(button.props.children, "recharge");
  button.props.onClick();
  assert.deepEqual(f.stateChanges, [true]);
  f.appState.chips = 200;
  assert.ok(
    !descendants(RoomDock({ dockRef: null })).some(
      (node) => node.props.role === "status"
    )
  );
});
