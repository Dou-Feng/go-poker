// In-room voice chat: a WebRTC audio mesh between the browsers of one room.
//
// The Go server only relays signalling (`voice-signal`, see
// backend/server/voice.go); media flows peer to peer. Peers are keyed by
// account UUID. A client is "in voice" while either its mic or its speaker is
// on; it then announces `join`, every peer already in voice opens a
// connection to it, and negotiation follows the "perfect negotiation" pattern
// so two peers announcing at once cannot deadlock. Both toggles default to
// off: nobody is recorded or hears anything until they opt in.
//
// Audio routing:
//   mic → getUserMedia → GainNode (mic input volume) → MediaStreamDestination
//       → one RTCRtpSender per peer
//   peer track → <audio> element (others' volume, per-peer local mute)
//
// Mic/speaker state lives only for the session; volumes and the per-peer mute
// list persist in localStorage.

import {
  getIceServers,
  sendVoiceSignal,
  VoiceSignalKind,
} from "../actions/actions";
import { TranslationKey } from "./translations";

export type VoicePeer = {
  id: string;
  mic: boolean;
  connected: boolean;
};

export type VoiceState = {
  /** The browser has WebRTC: voice can at least be listened to. */
  supported: boolean;
  /** The microphone API exists (secure context: https or localhost). */
  micAvailable: boolean;
  micOn: boolean;
  speakerOn: boolean;
  /** 0..1, gain applied to the outgoing mic signal. */
  micVolume: number;
  /** 0..1, playback volume for every remote peer. */
  outputVolume: number;
  /** Account UUIDs whose voice this client has muted locally. */
  mutedPeers: string[];
  /**
   * Whether the browser's acoustic echo cancellation is requested on the
   * mic. On by default; turning it off can help with a headset when the
   * canceller clips speech, and hurts badly on speakers.
   */
  echoCancellation: boolean;
  peers: Record<string, VoicePeer>;
  /** Pending user-facing error (a translation key); cleared with clearError. */
  error: TranslationKey | null;
};

type Signal = {
  from?: string;
  to?: string;
  kind: VoiceSignalKind;
  payload?: unknown;
};

type Peer = {
  id: string;
  pc: RTCPeerConnection;
  transceiver: RTCRtpTransceiver;
  /** Perfect negotiation: the polite side rolls back on offer collision. */
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  audio: HTMLAudioElement | null;
  pendingIce: RTCIceCandidateInit[];
  iceTimer: ReturnType<typeof setTimeout> | null;
  mic: boolean;
  connected: boolean;
};

const SETTINGS_KEY = "gopoker-voice";
const ICE_BATCH_MS = 150;

type StoredSettings = {
  micVolume: number;
  outputVolume: number;
  mutedPeers: string[];
  /** Browser acoustic echo cancellation on the mic (default on). */
  echoCancellation: boolean;
};

const DEFAULT_SETTINGS: StoredSettings = {
  micVolume: 1,
  outputVolume: 1,
  mutedPeers: [],
  echoCancellation: true,
};

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}

function loadSettings(): StoredSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<StoredSettings>;
    return {
      micVolume: clamp01(parsed.micVolume ?? 1),
      outputVolume: clamp01(parsed.outputVolume ?? 1),
      mutedPeers: Array.isArray(parsed.mutedPeers)
        ? parsed.mutedPeers.filter((p) => typeof p === "string")
        : [],
      echoCancellation: parsed.echoCancellation !== false,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// Build-time override of the ICE server list (a JSON array of RTCIceServer
// objects). Normally unset: the Go server hands out the bundled coturn's
// STUN/TURN URLs with fresh credentials over the socket (get-ice-servers).
function iceServersOverride(): RTCIceServer[] | null {
  const raw = process.env.NEXT_PUBLIC_ICE_SERVERS;
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RTCIceServer[]) : null;
  } catch {
    return null;
  }
}

function pageHost(): string {
  return typeof window === "undefined" ? "" : window.location.hostname;
}

// Peer connections work on any origin, so listening is always possible when
// the browser has WebRTC at all.
function webrtcSupported(): boolean {
  return (
    typeof window !== "undefined" && typeof RTCPeerConnection !== "undefined"
  );
}

// getUserMedia is only exposed in a secure context (https, or localhost).
// A phone opening http://192.168.x.x:8080 has no navigator.mediaDevices, so
// it can hear the table but cannot talk until the site is served over https.
function micAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

function isSecureContext(): boolean {
  return typeof window !== "undefined" && window.isSecureContext === true;
}

class VoiceManager {
  private socket: WebSocket | null = null;
  private myId: string | null = null;
  private room: string | null = null;
  private peers = new Map<string, Peer>();
  private listeners = new Set<() => void>();
  private state: VoiceState;

  private rawStream: MediaStream | null = null;
  private micTrack: MediaStreamTrack | null = null;
  private micCtx: AudioContext | null = null;
  private micGain: GainNode | null = null;
  private audioHost: HTMLElement | null = null;

  // ICE servers (STUN/TURN + credentials) issued by the game server, and
  // when they stop being valid. Requested on room entry and refreshed before
  // new peer connections once they near expiry.
  private serverIce: RTCIceServer[] | null = null;
  private serverIceExpiresAt = 0;
  private iceRequestedAt = 0;

  constructor() {
    const settings = loadSettings();
    this.state = {
      supported: webrtcSupported(),
      micAvailable: micAvailable(),
      micOn: false,
      speakerOn: false,
      micVolume: settings.micVolume,
      outputVolume: settings.outputVolume,
      mutedPeers: settings.mutedPeers,
      echoCancellation: settings.echoCancellation,
      peers: {},
      error: null,
    };
  }

  // ---- store API -------------------------------------------------------

  getState(): VoiceState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(patch: Partial<VoiceState> = {}) {
    const peers: Record<string, VoicePeer> = {};
    this.peers.forEach((p, id) => {
      peers[id] = { id, mic: p.mic, connected: p.connected };
    });
    this.state = { ...this.state, ...patch, peers };
    this.listeners.forEach((l) => l());
  }

  clearError() {
    if (this.state.error) {
      this.emit({ error: null });
    }
  }

  private get active(): boolean {
    return this.state.micOn || this.state.speakerOn;
  }

  isPeerMuted(id: string): boolean {
    return this.state.mutedPeers.indexOf(id) !== -1;
  }

  // ---- lifecycle wiring (WebSocket provider / Game screen) -------------

  /** The live socket, or null while disconnected. */
  setSocket(socket: WebSocket | null) {
    this.socket = socket;
  }

  /**
   * Called whenever the socket (re)connects. Peers were told we left when
   * our old connection dropped, so the mesh is rebuilt from scratch.
   */
  onSocketConnected() {
    this.teardownPeers();
    if (this.room) {
      this.requestIceServers(true);
    }
    if (this.active && this.room) {
      this.announce("join");
    }
  }

  /** Bind to a room under our account id; re-entering another room resets. */
  enterRoom(room: string, myId: string) {
    if (this.room === room && this.myId === myId) {
      return;
    }
    this.teardownPeers();
    this.room = room;
    this.myId = myId;
    // Fetch STUN/TURN details up front so the first peer connection does not
    // have to wait for them.
    this.requestIceServers(true);
    if (this.active) {
      this.announce("join");
    }
  }

  /** ice-servers reply from the game server (see backend/server/turn.go). */
  setIceServers(servers: RTCIceServer[], ttlSeconds: number) {
    this.serverIce = Array.isArray(servers) ? servers : [];
    const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 0;
    this.serverIceExpiresAt = ttl ? Date.now() + ttl * 1000 : 0;
  }

  /**
   * Ask the server for ICE servers. Unless forced, this is a no-op while the
   * current credentials are still comfortably valid or a request is in
   * flight (the reply is asynchronous; peers created before it arrives use
   * the fallback STUN URL).
   */
  private requestIceServers(force = false) {
    if (!this.socket) {
      return;
    }
    const now = Date.now();
    const soon = 10 * 60 * 1000;
    const fresh = this.serverIce && this.serverIceExpiresAt - now > soon;
    const inFlight = now - this.iceRequestedAt < 5000;
    if (!force && (fresh || inFlight)) {
      return;
    }
    this.iceRequestedAt = now;
    getIceServers(this.socket, pageHost());
  }

  private currentIceServers(): RTCIceServer[] {
    const override = iceServersOverride();
    if (override) {
      return override;
    }
    if (this.serverIce && this.serverIce.length > 0) {
      // Expired TURN credentials would be rejected by coturn; better to
      // connect directly than to stall on the relay.
      if (!this.serverIceExpiresAt || this.serverIceExpiresAt > Date.now()) {
        return this.serverIce;
      }
    }
    // No STUN/TURN (the server has not answered yet, or no coturn is
    // deployed): browsers exchange host candidates only, which connects
    // peers on the same LAN. Never guess an address the browser would wait
    // on.
    return [];
  }

  /** Leaving the room turns voice off; the server announces our departure. */
  leaveRoom() {
    this.teardownPeers();
    this.stopMic();
    this.room = null;
    this.emit({ micOn: false, speakerOn: false });
  }

  // ---- user controls ---------------------------------------------------

  async setMic(on: boolean): Promise<void> {
    if (!this.state.supported) {
      this.emit({ error: "voiceUnsupported" });
      return;
    }
    if (on && !micAvailable()) {
      // Most likely a plain-http page on a LAN address: the browser hides
      // the microphone API outside secure contexts. Say so instead of a
      // generic "unsupported".
      this.emit({
        error: isSecureContext() ? "voiceUnsupported" : "micNeedsHttps",
      });
      return;
    }
    if (on === this.state.micOn) {
      return;
    }
    const wasActive = this.active;
    if (on) {
      if (!(await this.startMic())) {
        return;
      }
    } else {
      this.stopMic();
    }
    this.state = { ...this.state, micOn: on };
    this.peers.forEach((p) => this.applyMicToPeer(p));
    this.syncPresence(wasActive);
    this.emit();
  }

  setSpeaker(on: boolean): void {
    if (!this.state.supported) {
      this.emit({ error: "voiceUnsupported" });
      return;
    }
    if (on === this.state.speakerOn) {
      return;
    }
    const wasActive = this.active;
    this.state = { ...this.state, speakerOn: on };
    this.peers.forEach((p) => this.applyOutputToPeer(p));
    this.syncPresence(wasActive);
    this.emit();
  }

  setMicVolume(v: number): void {
    const vol = clamp01(v);
    if (this.micGain) {
      this.micGain.gain.value = vol;
    }
    this.emit({ micVolume: vol });
    this.persist();
  }

  setOutputVolume(v: number): void {
    const vol = clamp01(v);
    this.state = { ...this.state, outputVolume: vol };
    this.peers.forEach((p) => this.applyOutputToPeer(p));
    this.emit();
    this.persist();
  }

  /** Local-only mute of one peer: they keep talking to everyone else. */
  toggleMutePeer(id: string): void {
    const muted = this.isPeerMuted(id)
      ? this.state.mutedPeers.filter((p) => p !== id)
      : this.state.mutedPeers.concat(id);
    this.state = { ...this.state, mutedPeers: muted };
    const peer = this.peers.get(id);
    if (peer) {
      this.applyOutputToPeer(peer);
    }
    this.emit();
    this.persist();
  }

  /**
   * Toggle the browser's echo cancellation. The constraint is fixed when the
   * mic is opened, so a live mic is reopened with the new setting and the
   * fresh track swapped into every sender (no renegotiation: the transceiver
   * direction does not change).
   */
  async setEchoCancellation(on: boolean): Promise<void> {
    if (on === this.state.echoCancellation) {
      return;
    }
    this.state = { ...this.state, echoCancellation: on };
    this.persist();
    if (this.state.micOn) {
      this.releaseMic();
      if (!(await this.startMic())) {
        // Reopening failed (permission revoked meanwhile): drop the mic
        // state so the button reflects reality.
        this.state = { ...this.state, micOn: false };
        this.peers.forEach((p) => this.applyMicToPeer(p));
        this.syncPresence(true);
      } else {
        this.peers.forEach((p) => this.applyMicToPeer(p));
      }
    }
    this.emit();
  }

  private persist() {
    if (typeof window === "undefined") {
      return;
    }
    const settings: StoredSettings = {
      micVolume: this.state.micVolume,
      outputVolume: this.state.outputVolume,
      mutedPeers: this.state.mutedPeers,
      echoCancellation: this.state.echoCancellation,
    };
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // storage unavailable: settings simply do not persist
    }
  }

  /** Announce join/leave/state after a toggle changed our presence. */
  private syncPresence(wasActive: boolean) {
    if (!this.room) {
      return;
    }
    if (this.active && !wasActive) {
      this.requestIceServers();
      this.announce("join");
    } else if (!this.active && wasActive) {
      this.announce("leave");
      this.teardownPeers();
    } else if (this.active) {
      this.announce("state");
    }
  }

  private announce(kind: "join" | "leave" | "state") {
    if (!this.socket) {
      return;
    }
    const payload = kind === "leave" ? undefined : { mic: this.state.micOn };
    sendVoiceSignal(this.socket, null, kind, payload);
  }

  private send(to: string, kind: VoiceSignalKind, payload?: unknown) {
    if (!this.socket) {
      return;
    }
    sendVoiceSignal(this.socket, to, kind, payload);
  }

  // ---- inbound signalling ---------------------------------------------

  handleSignal(sig: Signal): void {
    const from = sig.from;
    if (!from || from === this.myId || !this.room) {
      return;
    }
    switch (sig.kind) {
      case "join": {
        if (!this.active) {
          return;
        }
        // Creating the peer adds a transceiver, which fires
        // negotiationneeded and sends our offer to the newcomer.
        const peer = this.ensurePeer(from);
        peer.mic = this.payloadMic(sig.payload);
        // Tell the newcomer our mic state (they missed our join).
        this.send(from, "state", { mic: this.state.micOn });
        this.emit();
        return;
      }
      case "leave":
        this.removePeer(from);
        this.emit();
        return;
      case "state": {
        if (!this.active) {
          return;
        }
        // Only peers in voice send state. A newcomer receives the existing
        // peers' state before their offers arrive, so create the connection
        // here too; a resulting offer collision is resolved by perfect
        // negotiation.
        const peer = this.ensurePeer(from);
        peer.mic = this.payloadMic(sig.payload);
        this.emit();
        return;
      }
      case "offer":
      case "answer": {
        if (!this.active) {
          return;
        }
        const peer = this.ensurePeer(from);
        void this.handleDescription(
          peer,
          sig.payload as RTCSessionDescriptionInit
        );
        return;
      }
      case "ice": {
        const peer = this.peers.get(from);
        if (!peer) {
          return;
        }
        const list = (sig.payload as { candidates?: RTCIceCandidateInit[] })
          ?.candidates;
        if (!Array.isArray(list)) {
          return;
        }
        list.forEach((candidate) => {
          void peer.pc.addIceCandidate(candidate).catch((err) => {
            // Candidates for an offer we ignored (collision) are expected
            // to fail; anything else is worth a log line.
            if (!peer.ignoreOffer) {
              console.warn("voice: addIceCandidate", err);
            }
          });
        });
        return;
      }
    }
  }

  private payloadMic(payload: unknown): boolean {
    return !!(payload as { mic?: boolean } | undefined)?.mic;
  }

  // ---- peer connections -----------------------------------------------

  private ensurePeer(id: string): Peer {
    const existing = this.peers.get(id);
    if (existing) {
      return existing;
    }
    this.requestIceServers();
    const pc = new RTCPeerConnection({ iceServers: this.currentIceServers() });
    const transceiver = pc.addTransceiver("audio", {
      direction: this.micTrack ? "sendrecv" : "recvonly",
    });
    const peer: Peer = {
      id,
      pc,
      transceiver,
      // Deterministic and opposite on the two ends.
      polite: (this.myId ?? "") > id,
      makingOffer: false,
      ignoreOffer: false,
      audio: null,
      pendingIce: [],
      iceTimer: null,
      mic: false,
      connected: false,
    };
    this.peers.set(id, peer);

    if (this.micTrack) {
      void transceiver.sender.replaceTrack(this.micTrack).catch(() => {});
    }

    pc.onnegotiationneeded = () => {
      void this.makeOffer(peer);
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        peer.pendingIce.push(e.candidate.toJSON());
        if (!peer.iceTimer) {
          peer.iceTimer = setTimeout(() => this.flushIce(peer), ICE_BATCH_MS);
        }
      } else {
        this.flushIce(peer);
      }
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      this.attachAudio(peer, stream);
    };
    pc.onconnectionstatechange = () => {
      peer.connected = pc.connectionState === "connected";
      if (pc.connectionState === "failed") {
        // Try an ICE restart before giving up (e.g. a network change).
        if (typeof pc.restartIce === "function") {
          pc.restartIce();
        }
      }
      this.emit();
    };
    return peer;
  }

  private async makeOffer(peer: Peer) {
    const pc = peer.pc;
    try {
      peer.makingOffer = true;
      const offer = await pc.createOffer();
      // A remote offer may have arrived while we were creating ours; the
      // collision is then resolved by handleDescription, not here.
      if (pc.signalingState !== "stable") {
        return;
      }
      await pc.setLocalDescription(offer);
      if (pc.localDescription) {
        this.send(peer.id, "offer", pc.localDescription.toJSON());
      }
    } catch (err) {
      console.warn("voice: offer", err);
    } finally {
      peer.makingOffer = false;
    }
  }

  private async handleDescription(peer: Peer, desc: RTCSessionDescriptionInit) {
    const pc = peer.pc;
    if (!desc || (desc.type !== "offer" && desc.type !== "answer")) {
      return;
    }
    const collision =
      desc.type === "offer" &&
      (peer.makingOffer || pc.signalingState !== "stable");
    peer.ignoreOffer = !peer.polite && collision;
    if (peer.ignoreOffer) {
      // The impolite side keeps its own offer; the polite side will roll
      // back and answer ours.
      return;
    }
    try {
      if (collision) {
        // Polite side: drop our pending offer, then accept theirs.
        await pc.setLocalDescription({ type: "rollback" });
      }
      await pc.setRemoteDescription(desc);
      if (desc.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (pc.localDescription) {
          this.send(peer.id, "answer", pc.localDescription.toJSON());
        }
      }
    } catch (err) {
      console.warn("voice: description", err);
    }
  }

  private flushIce(peer: Peer) {
    if (peer.iceTimer) {
      clearTimeout(peer.iceTimer);
      peer.iceTimer = null;
    }
    if (peer.pendingIce.length === 0) {
      return;
    }
    const candidates = peer.pendingIce;
    peer.pendingIce = [];
    this.send(peer.id, "ice", { candidates });
  }

  private removePeer(id: string) {
    const peer = this.peers.get(id);
    if (!peer) {
      return;
    }
    this.peers.delete(id);
    if (peer.iceTimer) {
      clearTimeout(peer.iceTimer);
    }
    peer.pc.onnegotiationneeded = null;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    try {
      peer.pc.close();
    } catch {
      // already closed
    }
    if (peer.audio) {
      peer.audio.pause();
      peer.audio.srcObject = null;
      peer.audio.remove();
      peer.audio = null;
    }
  }

  private teardownPeers() {
    Array.from(this.peers.keys()).forEach((id) => this.removePeer(id));
  }

  // ---- playback -------------------------------------------------------

  private attachAudio(peer: Peer, stream: MediaStream) {
    if (typeof document === "undefined") {
      return;
    }
    if (!this.audioHost) {
      this.audioHost = document.createElement("div");
      this.audioHost.setAttribute("data-voice-audio", "");
      this.audioHost.style.display = "none";
      document.body.appendChild(this.audioHost);
    }
    if (!peer.audio) {
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "");
      this.audioHost.appendChild(audio);
      peer.audio = audio;
    }
    peer.audio.srcObject = stream;
    this.applyOutputToPeer(peer);
    void peer.audio.play().catch(() => {
      // Autoplay policies: the user gesture that turned voice on normally
      // unlocks playback; if not, the next toggle retries.
    });
  }

  private applyOutputToPeer(peer: Peer) {
    if (!peer.audio) {
      return;
    }
    peer.audio.muted = !this.state.speakerOn || this.isPeerMuted(peer.id);
    peer.audio.volume = this.state.outputVolume;
  }

  // ---- microphone -----------------------------------------------------

  private async startMic(): Promise<boolean> {
    if (this.micTrack) {
      return true;
    }
    if (!micAvailable()) {
      this.emit({
        error: isSecureContext() ? "voiceUnsupported" : "micNeedsHttps",
      });
      return false;
    }
    let raw: MediaStream;
    try {
      // Echo cancellation, noise suppression and automatic gain are the
      // browser's own WebRTC audio processing (Chrome: AEC3); we only ask
      // for them. Echo cancellation is user-toggleable (Settings).
      raw = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: this.state.echoCancellation,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch {
      this.emit({ error: "micDenied" });
      return false;
    }
    this.rawStream = raw;
    const rawTrack = raw.getAudioTracks()[0];
    if (!rawTrack) {
      this.stopMic();
      this.emit({ error: "micDenied" });
      return false;
    }
    // Route the mic through a gain node so the input volume slider works;
    // fall back to the raw track where Web Audio is unavailable.
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) {
        throw new Error("no AudioContext");
      }
      const ctx = new AC();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      const source = ctx.createMediaStreamSource(raw);
      const gain = ctx.createGain();
      gain.gain.value = this.state.micVolume;
      const dest = ctx.createMediaStreamDestination();
      source.connect(gain);
      gain.connect(dest);
      const processed = dest.stream.getAudioTracks()[0];
      if (!processed) {
        throw new Error("no processed track");
      }
      this.micCtx = ctx;
      this.micGain = gain;
      this.micTrack = processed;
    } catch {
      this.micTrack = rawTrack;
    }
    return true;
  }

  /** Release the microphone hardware and the processing graph. */
  private releaseMic() {
    if (this.rawStream) {
      this.rawStream.getTracks().forEach((t) => t.stop());
      this.rawStream = null;
    }
    if (this.micTrack) {
      this.micTrack.stop();
      this.micTrack = null;
    }
    if (this.micCtx) {
      void this.micCtx.close().catch(() => {});
      this.micCtx = null;
    }
    this.micGain = null;
  }

  /** Release the mic and stop sending to every peer (direction → recvonly). */
  private stopMic() {
    this.releaseMic();
    this.peers.forEach((p) => this.applyMicToPeer(p));
  }

  private applyMicToPeer(peer: Peer) {
    const tr = peer.transceiver;
    void tr.sender.replaceTrack(this.micTrack).catch(() => {});
    // Changing the direction renegotiates (onnegotiationneeded → offer).
    const direction: RTCRtpTransceiverDirection = this.micTrack
      ? "sendrecv"
      : "recvonly";
    if (tr.direction !== direction) {
      tr.direction = direction;
    }
  }
}

// One manager per browser tab, shared by the socket provider and the UI.
export const voice = new VoiceManager();
