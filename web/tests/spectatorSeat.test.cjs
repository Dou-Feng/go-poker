const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../lib/spectatorSeat.ts"), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
  }
).outputText;
const api = { exports: {} };
new Function("module", "exports", code)(api, api.exports);
const { spectatorSeatState } = api.exports;
const game = () => ({
  players: [{ seatID: 1 }, { seatID: 3 }],
  reserved: [{ seatID: 2, accountUuid: "other" }],
  config: { maxPlayers: 4, buyIn: 200 },
  busted: false,
});
test("join chooses only a seat free of players and other reservations", () => {
  assert.equal(spectatorSeatState(game(), "me", 200).seatID, 4);
});
test("own reservation remains available for cancellation even with no wallet or buy-ins", () => {
  const g = game();
  g.reserved.push({ seatID: 4, accountUuid: "me" });
  g.busted = true;
  const state = spectatorSeatState(g, "me", 0);
  assert.equal(state.reservation.seatID, 4);
  assert.equal(state.blocked, "bustedOut");
});
test("full room and insufficient funds disable new claims", () => {
  const g = game();
  assert.equal(spectatorSeatState(g, "me", 199).blocked, "notEnoughChips");
  g.reserved.push({ seatID: 4, accountUuid: "third" });
  assert.equal(spectatorSeatState(g, "me", 200).blocked, "tableIsFull");
});
test("cancellation or a freed seat makes room available again", () => {
  const g = game();
  g.reserved = [];
  assert.equal(spectatorSeatState(g, "me", 200).seatID, 2);
  assert.equal(spectatorSeatState(g, "me", 200).blocked, null);
});
