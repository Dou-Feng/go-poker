const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../lib/betting.ts"), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
  }
).outputText;
const api = { exports: {} };
new Function("module", "exports", code)(api, api.exports);
const { raisePresetAmounts, totalPot } = api.exports;

test("pot total includes every side pot", () => {
  assert.equal(totalPot([{ amount: 150 }, { amount: 100 }], []), 250);
  assert.equal(
    totalPot([], [{ totalBet: 10 }, { totalBet: 20 }, { totalBet: 20 }]),
    50
  );
});

test("raise presets show the chips added by this action", () => {
  // Heads-up preflop: the small blind has already posted 1. Calling costs 1;
  // a pot-size raise adds 5 chips and leaves a street total of 6.
  assert.deepEqual(raisePresetAmounts(3, 1, 2, 3, 199), {
    min: 3,
    half: 3,
    pot: 5,
    double: 9,
  });
  // The displayed pot already includes the opponent's outstanding 20 bet.
  assert.deepEqual(raisePresetAmounts(120, 0, 20, 40, 500), {
    min: 40,
    half: 90,
    pot: 160,
    double: 300,
  });
});

test("preset amounts respect the remaining-stack ceiling", () => {
  assert.deepEqual(raisePresetAmounts(100, 10, 20, 30, 65), {
    min: 30,
    half: 65,
    pot: 65,
    double: 65,
  });
});

test("a short stack can still select its all-in below a full raise", () => {
  assert.deepEqual(raisePresetAmounts(100, 10, 50, 25, 25), {
    min: 25,
    half: 25,
    pot: 25,
    double: 25,
  });
});
