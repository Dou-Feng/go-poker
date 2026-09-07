const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../lib/preload.ts"), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
  }
).outputText;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
function harness(overrides = {}) {
  const timers = new Map(),
    images = [];
  let id = 0;
  class FakeImage {
    constructor() {
      this.decoded = deferred();
      images.push(this);
    }
    decode() {
      return this.decoded.promise;
    }
  }
  const context = {
    exports: {},
    Image: FakeImage,
    AbortController,
    setTimeout: (fn, ms) => {
      timers.set(++id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    fetch: async () => {
      throw new Error("unexpected fetch for image");
    },
    ...overrides,
  };
  vm.runInNewContext(compiled, context);
  return {
    api: context.exports,
    images,
    timers,
    expire(ms) {
      for (const [id, timer] of [...timers]) {
        if (timer.ms === ms && timers.has(id)) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
  };
}
test("concurrent consumers share a single request and progress waits for decode", async () => {
  const { api, images, timers } = harness();
  const progress = [];
  let settled = false;
  const first = api.preloadAssets(["/felt.webp", "/felt.webp"], (p) =>
    progress.push(p)
  );
  const second = api.preloadAssets(["/felt.webp"]).then(() => {
    settled = true;
  });
  await flush();
  assert.equal(images.length, 1);
  assert.equal(settled, false);
  assert.equal(api.assetsLoaded(["/felt.webp"]), false);
  assert.deepEqual(progress, [0]);
  images[0].decoded.resolve();
  assert.equal((await first).failedUrls.length, 0);
  await second;
  assert.deepEqual(progress, [0, 1]);
  await api.preloadAssets(["/felt.webp"]);
  assert.equal(images.length, 1);
  assert.equal(api.assetsLoaded(["/felt.webp"]), true);
  assert.equal(timers.size, 0);
});
test("failed decode is retried on the next open", async () => {
  const { api, images } = harness();
  const first = api.preloadAssets(["/diamond.webp"]);
  images[0].decoded.reject(new Error("decode failure"));
  assert.deepEqual(Array.from((await first).failedUrls), ["/diamond.webp"]);
  assert.equal(images[0].src, "");
  const retry = api.preloadAssets(["/diamond.webp"]);
  images[1].decoded.resolve();
  assert.equal((await retry).failedUrls.length, 0);
});
test("batch deadline resolves while another consumer continues waiting", async () => {
  const { api, images, expire, timers } = harness();
  const progress = [];
  const first = api.preloadAssets(["/felt.webp"], (p) => progress.push(p), 50);
  const second = api.preloadAssets(["/felt.webp"], undefined, 100);
  expire(50);
  assert.deepEqual(Array.from((await first).failedUrls), ["/felt.webp"]);
  assert.equal(api.assetsLoaded(["/felt.webp"]), false);
  images[0].decoded.resolve();
  assert.equal((await second).failedUrls.length, 0);
  assert.deepEqual(progress, [0, 1]);
  assert.equal(timers.size, 0);
});
test("per-file deadline releases stuck decode; late completion cannot poison a retry", async () => {
  const { api, images, expire } = harness();
  const first = api.preloadAssets(["/felt.webp"], undefined, 20_000);
  expire(12_000);
  assert.equal((await first).failedUrls.length, 1);
  const retry = api.preloadAssets(["/felt.webp"]);
  images[0].decoded.resolve();
  await flush();
  assert.equal(api.assetsLoaded(["/felt.webp"]), false);
  images[1].decoded.resolve();
  assert.equal((await retry).failedUrls.length, 0);
});
test("fallback handlers precede src even for synchronous cached loads", async () => {
  class ImageWithoutDecode {
    set src(url) {
      if (url) this.onload();
    }
  }
  const { api } = harness({ Image: ImageWithoutDecode });
  assert.equal((await api.preloadAssets(["/icon.svg"])).failedUrls.length, 0);
});
test("HTTP errors are retryable and responses without Content-Length are consumed", async () => {
  let requests = 0,
    consumed = false;
  const { api } = harness({
    fetch: async () => ({
      ok: ++requests > 1,
      status: requests === 1 ? 404 : 200,
      arrayBuffer: async () => {
        consumed = true;
        return new ArrayBuffer(1);
      },
    }),
  });
  assert.equal((await api.preloadAssets(["/data.bin"])).failedUrls.length, 1);
  assert.equal((await api.preloadAssets(["/data.bin"])).failedUrls.length, 0);
  assert.equal(consumed, true);
  assert.equal(requests, 2);
});
test("FontFaceSet.load is awaited but stuck fonts cannot block startup forever", async () => {
  const font = deferred(),
    calls = [];
  const { api, expire } = harness({
    document: {
      fonts: {
        load: (...args) => {
          calls.push(args);
          return font.promise;
        },
      },
    },
  });
  const first = api.preloadAssets(["/fonts/nunito-latin.woff2"]);
  assert.deepEqual(calls, [['16px "Nunito"', "Poker"]]);
  expire(8_000);
  assert.equal((await first).failedUrls.length, 1);
  font.resolve([{}]);
  await flush();
  assert.equal(api.assetsLoaded(["/fonts/nunito-latin.woff2"]), true);
});
test("empty groups settle without timers", async () => {
  const { api, timers } = harness();
  assert.equal((await api.preloadAssets([])).failedUrls.length, 0);
  assert.equal(timers.size, 0);
});
test("scene manifests cover published assets and select the viewport wallpaper", () => {
  for (const variant of ["portrait", "wide", "small"]) {
    const { api } = harness({
      window: {
        matchMedia: (query) => ({
          matches: query.includes("orientation")
            ? variant === "portrait"
            : variant === "wide",
        }),
      },
    });
    assert.equal(api.wallpaperVariant(), variant);
    const room = Array.from(api.roomAssetUrls()),
      idle = Array.from(api.idleAssetUrls());
    assert.equal(room.filter((url) => url.startsWith("/bg/")).length, 1);
    assert.equal(idle.filter((url) => url.startsWith("/bg/")).length, 3);
    for (const url of [...idle, ...api.criticalAssetUrls()]) {
      assert.ok(
        fs.existsSync(path.join(__dirname, "../public", url)),
        `missing asset: ${url}`
      );
    }
    for (const url of api.rechargeAssetUrls()) {
      assert.ok(url.endsWith(".webp") && idle.includes(url));
    }
    for (const sheet of ["game.css", "actionbar.css", "seat.css"]) {
      const css = fs.readFileSync(
        path.join(__dirname, "../styles", sheet),
        "utf8"
      );
      for (const [, url] of css.matchAll(/url\(["']?(\/[^"')]+)["']?\)/g)) {
        assert.ok(room.includes(url), `unpreloaded ${sheet} asset: ${url}`);
      }
    }
  }
});
