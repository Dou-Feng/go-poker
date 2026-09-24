export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

type ConnectionOptions = {
  url: string;
  onOpen: (socket: WebSocket) => void;
  onMessage: (event: MessageEvent, socket: WebSocket) => void;
  onDisconnect: () => void;
  onStatus: (status: ConnectionStatus) => void;
  onTimeout: () => void;
};

// Own exactly one socket, including during half-open connections and delayed
// close events. Only an application snapshot marks a restored session ready.
export function createSocketConnection(options: ConnectionOptions) {
  let socket: WebSocket | null = null;
  let disposed = false;
  let expired = false;
  let lastReply = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempt: ReturnType<typeof setTimeout> | null = null;
  let outage: ReturnType<typeof setTimeout> | null = null;
  let probe: ReturnType<typeof setTimeout> | null = null;

  const disconnect = () => {
    if (attempt) clearTimeout(attempt);
    if (probe) clearTimeout(probe);
    attempt = probe = null;
    const old = socket;
    socket = null;
    if (old) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      old.close();
    }
    options.onDisconnect();
  };

  const beginOutage = () => {
    if (outage || expired) return;
    outage = setTimeout(() => {
      outage = null;
      expired = true;
      options.onStatus("disconnected");
      options.onTimeout();
      // Discard room-rejoin replies already in flight before continuing
      // background reconnection for the lobby.
      fail();
    }, 30000);
  };

  const fail = () => {
    if (disposed) return;
    disconnect();
    if (!expired) options.onStatus("reconnecting");
    beginOutage();
    if (!retry) retry = setTimeout(connect, 1000);
  };

  const ping = () => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify({ action: "ping" }));
    } catch {
      fail();
    }
  };

  const connect = () => {
    retry = null;
    if (disposed) return;
    disconnect();
    beginOutage();
    const current = new WebSocket(options.url);
    socket = current;
    const live = () => !disposed && socket === current;
    // Bounds CONNECTING and authentication/room restoration, not just TCP.
    attempt = setTimeout(fail, 10000);
    current.onopen = () => {
      if (!live()) return;
      lastReply = Date.now();
      options.onOpen(current);
      ping();
    };
    current.onmessage = (event) => {
      if (!live()) return;
      lastReply = Date.now();
      options.onMessage(event, current);
    };
    current.onclose = () => {
      if (live()) fail();
    };
    current.onerror = () => {
      if (live()) fail();
    };
  };

  const ready = () => {
    if (disposed || socket?.readyState !== WebSocket.OPEN) return;
    if (attempt) clearTimeout(attempt);
    if (outage) clearTimeout(outage);
    attempt = outage = null;
    expired = false;
    options.onStatus("connected");
  };

  const heartbeat = setInterval(() => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastReply >= 12000) fail();
    else ping();
  }, 5000);

  const wake = () => {
    if (document.visibilityState === "hidden") return;
    if (socket?.readyState !== WebSocket.OPEN) {
      if (retry) clearTimeout(retry);
      connect();
      return;
    }
    const current = socket;
    const before = lastReply;
    ping();
    if (probe) clearTimeout(probe);
    probe = setTimeout(() => {
      probe = null;
      if (socket === current && lastReply === before) fail();
    }, 2500);
  };
  const offline = () => fail();
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);
  window.addEventListener("pageshow", wake);
  window.addEventListener("online", wake);
  window.addEventListener("offline", offline);
  options.onStatus("connecting");
  connect();

  return {
    ready,
    dispose() {
      disposed = true;
      if (retry) clearTimeout(retry);
      if (outage) clearTimeout(outage);
      clearInterval(heartbeat);
      disconnect();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("pageshow", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", offline);
    },
  };
}
