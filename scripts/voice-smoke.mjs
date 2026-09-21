// Throwaway end-to-end check for the voice path: registers two accounts over
// the game socket, joins them to one room, asks for LiveKit tokens and lets
// LiveKit validate each one. Verifies the whole server-side chain (credentials
// loaded, table attached, JWT accepted) without needing a browser.
//
//   node scripts/voice-smoke.mjs [ws://localhost:8080/ws] [http://127.0.0.1:7880]
const wsUrl = process.argv[2] ?? "ws://localhost:8080/ws";
const lkHttp = process.argv[3] ?? "http://127.0.0.1:7880";
const room = `smoke${Date.now().toString(36)}`;
// Account ids are user-chosen: at least five alphanumerics (server-side
// validUUID), not a canonical UUID.
const accountId = (label) =>
  `smoke${label}${Math.random().toString(36).slice(2, 10)}`;

function connect() {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    const waiter = pending.get(msg.action);
    if (waiter) {
      pending.delete(msg.action);
      waiter(msg);
    }
  });
  const wait = (action, timeout = 8000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting ${action}`)), timeout);
      pending.set(action, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error(`cannot connect ${wsUrl}`)), { once: true });
  });
  const send = (msg) => ws.send(JSON.stringify(msg));
  return { ws, wait, ready, send };
}

async function account(label) {
  const username = `smoke-${label}-${Date.now().toString(36)}`;
  const c = connect();
  await c.ready;
  c.send({
    action: "register-user",
    username,
    uuid: accountId(label.toUpperCase()),
    password: "smoke-pass-123",
  });
  const reg = await c.wait("register-result");
  if (!reg.ok) throw new Error(`register ${username}: ${reg.message}`);
  return { ...c, accountUUID: reg.uuid };
}

async function joinTable(c) {
  c.send({ action: "list-tables" });
  const list = await c.wait("table-list");
  const existing = (list.tables ?? []).find((t) => !t.password);
  if (existing) {
    c.send({ action: "join-table", tablename: existing.name, password: "" });
    const res = await c.wait("join-result");
    if (res.ok) return existing.name;
  }
  c.send({
    action: "create-table",
    tablename: room,
    password: "",
    sb: 5,
    bb: 10,
    buyIn: 200,
    maxBuy: 400,
    maxPlayers: 6,
    handsLimit: 0,
    tournament: false,
    actionTimeout: 0,
    botType: "normal",
  });
  const created = await c.wait("create-result");
  if (!created.ok) throw new Error(`create-table: ${created.message}`);
  return room;
}

async function token(c, tablename) {
  c.send({ action: "get-livekit-token" });
  const reply = await c.wait("livekit-token");
  if (!reply.ok) throw new Error(`token refused: ok=false (server has no LiveKit credentials or no table)`);
  const res = await fetch(`${lkHttp}/rtc/validate?access_token=${reply.token}`);
  if (!res.ok) throw new Error(`LiveKit rejected the token: HTTP ${res.status} ${await res.text()}`);
  // Decode the payload to show what the client would use.
  const claims = JSON.parse(Buffer.from(reply.token.split(".")[1], "base64url").toString());
  return { url: reply.url, room: claims.video?.room, identity: claims.identity, ttl: reply.ttl };
}

const a = await account("a");
const b = await account("b");
const tablename = await joinTable(a);
await joinTable(b);
console.log(`room: poker=${tablename}`);
for (const [label, c] of [["A", a], ["B", b]]) {
  const info = await token(c, tablename);
  console.log(
    `${label}: ${info.identity} -> ${info.url} room=${info.room} ttl=${info.ttl}s  ✓ LiveKit accepted`
  );
}
a.ws.close();
b.ws.close();
console.log("OK: 服务端签发 + LiveKit 校验全部通过（浏览器应能连上）");
