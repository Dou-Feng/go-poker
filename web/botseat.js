// Seat-configurable bot for animation reproduction.
const WebSocket = require("ws");
const URL = "ws://localhost:8080/ws";
const SEAT = parseInt(process.env.SEAT || "6", 10);
const ROOM = process.env.ROOM || "animseat";
const ws = new WebSocket(URL);
const tag = "bot" + Math.floor(Math.random() * 9000 + 1000);
let me = null;
let sentReady = false;
let myPos = -1;

function send(o) {
  ws.send(JSON.stringify(o));
}
function dump(game, why) {
  const ps = (game.players || [])
    .map((p) => `[${p.position}]${p.username}(s${p.seatID},in=${p.in},tb=${p.totalBet},st=${p.stack})`)
    .join(" ");
  console.log(`${why} stage=${game.stage} run=${game.running} bet=${game.betting} action=${game.action} ${ps}`);
}

ws.on("open", () => {
  console.log("connected as", tag, "seat", SEAT);
  send({ action: "register-user", username: tag, uuid: "zzz" + Math.floor(Math.random() * 9000 + 1000), password: "testpass123", avatar: "🦊" });
  setTimeout(() => send({ action: "add-chips", amount: 5000 }), 200);
  setTimeout(() => send({ action: "join-table", tablename: ROOM }), 450);
  setTimeout(() => send({ action: "new-player", username: tag }), 650);
  setTimeout(() => send({ action: "take-seat", username: tag, seatID: SEAT, buyIn: 200 }), 900);
});

ws.on("message", (data) => {
  const e = JSON.parse(data.toString());
  switch (e.action) {
    case "update-player-uuid":
      me = e.uuid;
      break;
    case "update-game": {
      const game = e.game;
      if (!me) break;
      myPos = -1;
      for (const p of game.players || []) if (p.uuid === me) myPos = p.position;
      const mep = game.players.find((p) => p.uuid === me);
      dump(game, "evt");
      if (!game.running) {
        if (mep && !mep.ready && !sentReady) {
          console.log(">>> ready");
          sentReady = true;
          send({ action: "toggle-ready" });
        }
        break;
      }
      if (!game.betting || game.action !== myPos || !mep || !mep.in || mep.stack === 0) break;
      let maxBet = 0;
      for (const q of game.players || []) maxBet = Math.max(maxBet, q.totalBet);
      const toCall = maxBet - mep.totalBet;
      const mode = process.env.MODE || "raise6";
      if (mode === "allin") {
        console.log(">>> ALL-IN seat", mep.seatID);
        send({ action: "player-allin" });
      } else if (toCall <= 0) {
        console.log(">>> raise 6 seat", mep.seatID, "pos", myPos);
        send({ action: "player-raise", amount: 6 });
      } else {
        console.log(">>> call", toCall, "seat", mep.seatID);
        send({ action: "player-raise", amount: Math.min(toCall, mep.stack) });
      }
      break;
    }
    default:
      if (e.action === "error") console.log("ERR", JSON.stringify(e).slice(0, 120));
  }
});
console.log("running mode=" + (process.env.MODE || "raise6"));
