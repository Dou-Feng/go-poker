const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../lib/time.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }
).outputText;
const api = { exports: {} };
new Function("module", "exports", code)(api, api.exports);
const { formatLocalTime } = api.exports;

test("timestamps use the viewer's timezone, including midnight and DST", () => {
  const originalTZ = process.env.TZ;
  try {
    process.env.TZ = "Asia/Shanghai";
    assert.equal(formatLocalTime("2026-09-24T15:04:00Z"), "23:04");
    assert.equal(formatLocalTime("2026-09-24T16:04:00Z"), "00:04");
    assert.equal(formatLocalTime("2026-09-24T23:04:00+08:00"), "23:04");
    process.env.TZ = "America/New_York";
    assert.equal(formatLocalTime("2026-07-24T15:04:00Z"), "11:04");
    assert.equal(formatLocalTime("2026-01-24T15:04:00Z"), "10:04");
    process.env.TZ = "UTC";
    assert.equal(formatLocalTime("2026-09-24T15:04:00Z"), "15:04");
  } finally {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }
});

test("legacy and invalid timestamps remain readable", () => {
  for (const value of ["15:04", "9:04", "", "invalid"]) {
    assert.equal(formatLocalTime(value), value);
  }
});
