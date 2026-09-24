const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

// Loads a TS module from web/lib with its imports inlined (same approach as
// stats.test.cjs). translations.ts has no imports, so a plain transpile is
// enough.
function loadLib(file) {
  const code = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../lib", file), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2019,
      },
    }
  ).outputText;
  const api = { exports: {} };
  new Function("module", "exports", code)(api, api.exports);
  return api.exports;
}

const { translations } = loadLib("translations.ts");

const LOG_KEYS = [
  "logStartHand",
  "logSmallBlind",
  "logBigBlind",
  "logFolds",
  "logChecks",
  "logCalls",
  "logCallsAmount",
  "logBets",
  "logRaisesTo",
  "logAllIn",
  "logWins",
  "logChipsForfeited",
  "logBuysIn",
  "logSitsDown",
  "logTimedOutLeft",
  "logTimeoutFold",
  "logTimeoutCheck",
  "logOutOfChips",
  "logVotedSettle",
  "logCancelledVote",
  "logSettleApproved",
];

// The renderer used by LogMessage (mirrors useTranslation.tLog; split/join
// keeps "$"-containing usernames from being read as replace patterns).
function tLog(language, log) {
  if (log.key) {
    const tpl =
      (translations[language] || {})[log.key] ||
      (translations.en || {})[log.key];
    if (tpl) {
      return (log.params || []).reduce(
        (s, p, i) => s.split(`{${i}}`).join(p),
        tpl
      );
    }
  }
  return log.message;
}

test("every log key exists in both languages", () => {
  for (const key of LOG_KEYS) {
    assert.ok(translations.en[key], `missing en entry for ${key}`);
    assert.ok(translations.zh[key], `missing zh entry for ${key}`);
  }
});

test("placeholders substitute in order in both languages", () => {
  assert.equal(
    tLog("en", {
      key: "logRaisesTo",
      params: ["Ann", "120"],
      message: "Ann raises to 120",
    }),
    "Ann raises to 120"
  );
  assert.equal(
    tLog("zh", {
      key: "logRaisesTo",
      params: ["Ann", "120"],
      message: "Ann raises to 120",
    }),
    "Ann 加注到 120"
  );
  assert.equal(
    tLog("zh", {
      key: "logVotedSettle",
      params: ["Bob", "2", "3"],
      message: "",
    }),
    "Bob 投票结算（2/3）"
  );
});

test("dollar signs in usernames are literal, not replace patterns", () => {
  assert.equal(
    tLog("en", {
      key: "logWins",
      params: ["$&Bob$", "50"],
      message: "",
    }),
    "$&Bob$ wins 50"
  );
});

test("unknown keys and keyless logs fall back to the raw message", () => {
  assert.equal(
    tLog("zh", { key: "logFromTheFuture", params: [], message: "plain line" }),
    "plain line"
  );
  assert.equal(tLog("zh", { message: "plain line" }), "plain line");
});
