// Bot client #2 (robust) for animation testing.
const WebSocket = require("ws");
const URL = "ws://localhost:8080/ws";
const ws = new WebSocket(URL);
const tag = "bot" + Math.floor(Math.random()*9000+1000);
let me = null;
let sentReady = false;
let myPos = -1;

function send(o) { ws.send(JSON.stringify(o)); }

function dumpGame(game, why) {
  const ps = (game.players || []).map((p) => `[${p.position}]${p.username}(u=${p.uuid ? p.uuid.slice(0,6):''},in=${p.in},r=${p.ready},s=${p.stack})`).join(" ");
  console.log(`${why} stage=${game.stage} run=${game.running} bet=${game.betting} action=${game.action} ${ps}`);
}

ws.on("open", () => {
  console.log("connected as", tag);
  send({ action: "register-user", username: tag, uuid: "zzz" + Math.floor(Math.random()*9000+1000), password: "testpass123", avatar: "🦊" });
  setTimeout(() => send({ action: "add-chips", amount: 5000 }), 200);
  setTimeout(() => send({ action: "join-table", tablename: "animtest3" }), 450);
  setTimeout(() => send({ action: "new-player", username: tag }), 650);
  setTimeout(() => send({ action: "take-seat", username: tag, seatID: 2, buyIn: 200 }), 900);
});

ws.on("message", (data) => {
  const e = JSON.parse(data.toString());
  switch (e.action) {
    case "update-player-uuid":
      me = e.uuid; console.log("uuid:", me); break;
    case "update-game": {
      const game = e.game;
      if (!me) break;
      // find my position
      myPos = -1;
      for (const p of game.players || []) if (p.uuid === me) myPos = p.position;
      dumpGame(game, "evt");
      if (myPos < 0) break;
      const mep = game.players[myPos];
      if (!game.running) {
        if (!mep.ready && !sentReady) {
          console.log(">>> toggle ready");
          sentReady = true;
          send({ action: "toggle-ready" });
        }
        break;
      }
      if (!game.betting) break;
      if (game.action !== myPos) break;
      if (!mep.in || mep.stack === 0) break;
      // decide
      let maxBet = 0;
      for (const q of game.players || []) maxBet = Math.max(maxBet, q.totalBet);
      const toCall = maxBet - mep.totalBet;
      if (process.env.FOLD === "1" && game.stage <= 2) {
        console.log(">>> fold");
        send({ action: "player-fold" });
      } else if (toCall <= 0) {
        console.log(">>> check");
        send({ action: "player-check" });
      } else {
        console.log(">>> call", Math.min(toCall, mep.stack));
        send({ action: "player-raise", amount: Math.min(toCall, mep.stack) });
      }
      break;
    }
    default:
      if (e.action === "error") console.log("ERR-DETAIL", JSON.stringify(e));
      else if (e.action !== "new-message" && e.action !== "new-log") console.log("evt:", e.action, e.ok !== undefined ? "ok=" + e.ok : "");
  }
});
ws.on("error", (e) => console.log("wserr", e.message));
// Keep running indefinitely for the animation test session.
console.log("bot running (no timeout)");

