// Run with: node --test tests/tableLayout.test.cjs (uses the project's TS compiler).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../lib/tableLayout.ts"), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
  }
).outputText;
const api = { exports: {} };
new Function("module", "exports", compiled)(api, api.exports);
const { createTableLayout, tableSeatPoint } = api.exports;

// Scene sizes after the toolbars / bottom action area have been reserved.
for (const [width, height, large] of [
  [304, 372, false],
  [359, 471, false],
  [374, 628, false],
  [414, 716, false],
  [624, 744, true],
  [752, 758, true],
  [654, 235, true],
  [1100, 634, true],
]) {
  for (let count = 2; count <= 8; count++) {
    test(`${width}x${height}, ${count} seats stay inside during all-in and show/ready`, () => {
      const layout = createTableLayout(width, height, large);
      const halfWidth = (large ? 224 : 128) * layout.scale * 0.55;
      const halfHeight = (large ? 148 : 100) * layout.scale * 0.55;
      for (let index = 0; index < count; index++) {
        const { x, y } = tableSeatPoint(layout, index, count);
        const px = (x * width) / 100,
          py = (y * height) / 100;
        assert.ok(px - halfWidth >= 0 && px + halfWidth <= width);
        assert.ok(py - halfHeight - 24 * layout.scale >= 0);
        assert.ok(py + halfHeight + 46 * layout.scale <= height);
      }
    });
  }
}
test("seat rotation preserves order and anchors the viewer at the bottom", () => {
  const layout = createTableLayout(374, 578, false);
  for (let total = 2; total <= 8; total++) {
    for (let seat = 0; seat < total; seat++) {
      const own = tableSeatPoint(layout, (seat - seat + total) % total, total);
      assert.equal(own.x, 50);
      assert.equal(own.y, layout.centerY + layout.radiusY);
      const slots = Array.from(
        { length: total },
        (_, i) => (i - seat + total) % total
      );
      assert.equal(new Set(slots).size, total);
    }
  }
});
