const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../lib/stats.ts"), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
  }
).outputText;
const api = { exports: {} };
new Function("module", "exports", code)(api, api.exports);
const { vpipRate, positionVpipRate } = api.exports;
const fixture = (extra = {}) => ({
  positionStatsVersion: 2,
  handsPlayed: 4,
  vpip: 2,
  vpipByPos: [0, 0, 0, 2, 0, 0],
  handsByPos: [0, 0, 0, 4, 0, 0],
  ...extra,
});

test("1100% and other invalid VPIP counts are unavailable, not capped to 100%", () => {
  for (const [n, d] of [
    [11, 1],
    [1, 0],
    [-1, 10],
    [NaN, 1],
    [1, Infinity],
  ])
    assert.equal(vpipRate(n, d), "—");
  assert.equal(vpipRate(0, 5), "0%");
  assert.equal(vpipRate(5, 5), "100%");
  assert.equal(vpipRate(1, 3), "33%");
});
test("positional rates reject legacy mismatches even when a percentage looks possible", () => {
  assert.equal(positionVpipRate(fixture(), 3), "50%");
  for (const version of [undefined, 0, 1]) {
    assert.equal(
      positionVpipRate(fixture({ positionStatsVersion: version }), 3),
      "—"
    );
  }
  assert.equal(
    positionVpipRate(
      fixture({
        vpipByPos: [0, 0, 0, 11, 0, 0],
        handsByPos: [0, 0, 0, 1, 0, 0],
      }),
      3
    ),
    "—"
  );
});
test("versioned sample can cover fewer hands than lifetime history", () => {
  const stats = fixture({
    handsPlayed: 100,
    vpip: 40,
    positionStatsVersion: 2,
  });
  assert.equal(positionVpipRate(stats, 3), "50%");
  assert.equal(positionVpipRate(stats, 0), "—");
  assert.equal(positionVpipRate({ ...stats, positionStatsVersion: 3 }, 3), "—");
});
test("missing and malformed positional data stays unavailable", () => {
  for (const stats of [
    null,
    fixture({ handsByPos: [] }),
    fixture({ vpipByPos: undefined }),
    fixture({ handsPlayed: 1 }),
    fixture({ handsByPos: [0, 0, 0, NaN, 0, 0] }),
  ])
    assert.equal(positionVpipRate(stats, 3), "—");
});

test("3-bet rate uses versioned preflop opportunities, not total hands", () => {
  const { threeBetRate } = api.exports;
  const stats = {
    handsPlayed: 100,
    threeBets: 2,
    threeBetOpportunities: 5,
    threeBetStatsVersion: 1,
  };
  assert.equal(threeBetRate(stats), "40%");
  assert.equal(threeBetRate({ ...stats, threeBets: 0 }), "0%");
  for (const bad of [
    null,
    { ...stats, threeBetStatsVersion: undefined },
    { ...stats, threeBetStatsVersion: 2 },
    { ...stats, threeBetOpportunities: undefined },
    { ...stats, threeBetOpportunities: 0 },
    { ...stats, threeBets: 6 },
    { ...stats, threeBetOpportunities: 101 },
    { ...stats, threeBetOpportunities: NaN },
  ]) {
    assert.equal(threeBetRate(bad), "—");
  }
});
