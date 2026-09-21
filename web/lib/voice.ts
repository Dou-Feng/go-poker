// In-room voice chat on LiveKit (livekit-client): every browser sends and
// receives audio through one self-hosted LiveKit SFU instead of a mesh of
// direct peer connections. WebRTC signalling, NAT traversal and TURN relaying
// all live inside the LiveKit server; the game server only mints the
// short-lived access token (`get-livekit-token`, see
// backend/server/livekit.go) that admits each account (identity = account
// UUID) to the room `gopoker-<tablename>`.
//
// A client is "in voice" while either its mic or its speaker is on; the first
// activation fetches a token and connects. Both toggles default to off:
// nobody is recorded or hears anything until they opt in.
//
// Audio routing:
//   mic → getUserMedia → GainNode (mic input volume) → MediaStreamDestination
//       → published to LiveKit as a microphone LocalAudioTrack
//   remote track → <audio> element (others' volume, per-peer local mute)
//
// Mic/speaker state lives only for the session; volumes and the per-peer mute
// list persist in localStorage.

import {
  ConnectionState,
  LocalAudioTrack,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import { getLiveKitToken } from "../actions/actions";
import { TranslationKey } from "./translations";
import { resumeAudioContext, setVoiceAudioState } from "./sfx";

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
  /** 0..3, gain applied to the outgoing mic signal; 1 is the original level. */
  micVolume: number;
  /** 0..1, playback volume for every remote peer. */
  outputVolume: number;
  /** Account UUIDs whose voice this client has muted locally. */
  mutedPeers: string[];
  /**
   * Whether the browser's acoustic echo cancellation is requested on the
   * mic. Off by default; the user's explicit choice persists.
   */
  echoCancellation: boolean;
  /**
   * Whether the AI (Krisp) noise filter processes the outgoing mic instead
   * of the browser's built-in noise suppression. Off by default: the model
   * is a ~6 MB download, fetched only once the player opts in.
   */
  noiseCancellation: boolean;
  peers: Record<string, VoicePeer>;
  /** Pending user-facing error (a translation key); cleared with clearError. */
  error: TranslationKey | null;
};

const SETTINGS_KEY = "gopoker-voice";
/** Reconnect backoff after an unexpected LiveKit disconnect. */
const RECONNECT_DELAY_MS = 1000;
/** Ask for a fresh token when the current one has less than this left. */
const TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;
/** Minimum spacing between token requests (the reply is asynchronous). */
const TOKEN_REQUEST_SPACING_MS = 5000;

type StoredSettings = {
  micVolume: number;
  outputVolume: number;
  mutedPeers: string[];
  /** Browser acoustic echo cancellation on the mic (default off). */
  echoCancellation: boolean;
  /** AI (Krisp) noise filter on the outgoing mic (default off). */
  noiseCancellation: boolean;
};

const DEFAULT_SETTINGS: StoredSettings = {
  micVolume: 1,
  outputVolume: 1,
  mutedPeers: [],
  echoCancellation: false,
  noiseCancellation: false,
};

export const MAX_MIC_VOLUME = 3;

function clampMicVolume(v: number): number {
  return Math.min(MAX_MIC_VOLUME, Math.max(0, Number.isFinite(v) ? v : 0));
}

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
      micVolume: clampMicVolume(parsed.micVolume ?? 1),
      outputVolume: clamp01(parsed.outputVolume ?? 1),
      mutedPeers: Array.isArray(parsed.mutedPeers)
        ? parsed.mutedPeers.filter((p) => typeof p === "string")
        : [],
      echoCancellation: parsed.echoCancellation === true,
      noiseCancellation: parsed.noiseCancellation === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// Build-time override of the LiveKit server address (normally unset: the Go
// server hands out the address together with the token). The value must be
// reachable from the browser, e.g. wss://voice.example.com.
function livekitUrlOverride(): string | null {
  const raw = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  return raw ? raw : null;
}

// Build-time override of the ICE server list handed to the LiveKit SDK (a
// JSON array of RTCIceServer objects). Rarely needed — the LiveKit server
// distributes its own ICE configuration — but kept for exotic deployments.
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

// LiveKit, like the raw mesh before it, is WebRTC: without RTCPeerConnection
// there is nothing to listen with.
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

// The AI noise filter (LiveKit's Krisp plugin) ships as a ~6 MB bundle with
// the model inlined, so it is loaded on demand — only a player who turns the
// setting on ever downloads it. The promise is cached so repeated toggles
// reuse one module instance; a failed load is dropped so a flaky network can
// be retried.
type KrispModule = typeof import("@livekit/krisp-noise-filter");
let krispModule: Promise<KrispModule> | null = null;

function loadKrisp(): Promise<KrispModule> {
  if (!krispModule) {
    krispModule = import("@livekit/krisp-noise-filter").catch((err) => {
      krispModule = null;
      throw err;
    });
  }
  return krispModule;
}

/** Live bookkeeping for one remote participant (keyed by account UUID). */
type LivePeer = {
  mic: boolean;
};

class VoiceManager {
  private socket: WebSocket | null = null;
  private myId: string | null = null;
  private room: string | null = null;
  private listeners = new Set<() => void>();
  private state: VoiceState;

  // The LiveKit room connection, and the token that admits us.
  private lk: Room | null = null;
  private connectGen = 0;
  private token: string | null = null;
  private tokenUrl = "";
  private tokenExpiresAt = 0;
  private tokenRequestedAt = 0;

  // Remote participants and their playback elements, keyed by account UUID.
  private livePeers = new Map<string, LivePeer>();
  private audioElements = new Map<string, HTMLAudioElement>();
  private audioHost: HTMLElement | null = null;

  // The published mic track, if any (wraps this.micTrack).
  private published: LocalAudioTrack | null = null;

  private rawStream: MediaStream | null = null;
  private micTrack: MediaStreamTrack | null = null;
  private micCtx: AudioContext | null = null;
  private micGain: GainNode | null = null;
  private micRequest = 0;
  private micRequested = false;
  private micEchoCancellation = false;
  // Serializes changes to the capture track (echo cancellation, AI noise
  // filter) so rapid toggles cannot apply older settings after the latest.
  private captureRevision = 0;
  private captureChange: Promise<void> = Promise.resolve();

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
      noiseCancellation: settings.noiseCancellation,
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
    this.livePeers.forEach((p, id) => {
      peers[id] = { id, mic: p.mic, connected: true };
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
   * Called whenever the game socket (re)connects. The LiveKit media
   * connection is independent of it, so nothing is torn down; if voice is
   * active but the room is gone (server restart), reconnect now.
   */
  onSocketConnected() {
    if (this.active) {
      void this.ensureConnected();
    }
  }

  /** Bind to a room under our account id; re-entering another room resets. */
  enterRoom(room: string, myId: string) {
    if (this.room === room && this.myId === myId) {
      return;
    }
    this.teardownRoom();
    this.room = room;
    this.myId = myId;
    // Fetch a token up front so the first activation does not have to wait.
    this.requestToken();
    if (this.active) {
      void this.ensureConnected();
    }
  }

  /**
   * `livekit-token` reply from the game server (see
   * backend/server/livekit.go). An empty token means this server has no
   * LiveKit credentials: voice chat is unavailable here.
   */
  setLiveKitToken(url: string, token: string, ttlSeconds: number) {
    if (!token) {
      if (this.active) {
        this.emit({ error: "voiceUnavailable" });
      }
      return;
    }
    this.tokenUrl = url;
    this.token = token;
    const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 0;
    this.tokenExpiresAt = ttl ? Date.now() + ttl * 1000 : 0;
    if (this.active) {
      void this.ensureConnected();
    }
  }

  /**
   * Ask the server for a LiveKit token. Unless forced, this is a no-op while
   * the current token is still comfortably valid or a request is in flight.
   */
  private requestToken(force = false) {
    if (!this.socket || !this.room) {
      return;
    }
    const now = Date.now();
    const fresh =
      this.token &&
      (!this.tokenExpiresAt ||
        this.tokenExpiresAt - now > TOKEN_REFRESH_MARGIN_MS);
    const inFlight = now - this.tokenRequestedAt < TOKEN_REQUEST_SPACING_MS;
    if (!force && (fresh || inFlight)) {
      return;
    }
    this.tokenRequestedAt = now;
    getLiveKitToken(this.socket);
  }

  /** Leaving the room turns voice off and disconnects from LiveKit. */
  leaveRoom() {
    this.micRequested = false;
    this.micRequest++;
    this.unpublishMic();
    this.releaseMic();
    this.room = null;
    this.token = null;
    this.tokenExpiresAt = 0;
    this.teardownRoom();
    this.emit({ micOn: false, speakerOn: false });
    this.syncAudioSession();
  }

  // ---- LiveKit connection ----------------------------------------------

  /** Connect to the LiveKit room when voice is active and we have a token. */
  private async ensureConnected() {
    if (!this.room || !this.active) {
      return;
    }
    const st = this.lk?.state;
    if (
      st === ConnectionState.Connected ||
      st === ConnectionState.Connecting ||
      st === ConnectionState.Reconnecting
    ) {
      return;
    }
    if (!this.token || this.tokenExpiresAt - Date.now() < 60 * 1000) {
      // No (or nearly expired) token: ask and retry when the reply arrives.
      this.requestToken();
      return;
    }
    await this.connectRoom();
  }

  private async connectRoom() {
    const token = this.token;
    const url = livekitUrlOverride() ?? this.tokenUrl;
    if (!token || !url) {
      return;
    }
    if (!this.lk) {
      this.lk = this.createRoom();
    }
    const room = this.lk;
    const gen = ++this.connectGen;
    try {
      await room.connect(url, token);
    } catch (err) {
      if (gen !== this.connectGen) {
        return;
      }
      console.warn("voice: connect", err);
      // The token may be stale or the room gone: drop it so the next
      // activation asks for a fresh one instead of looping on a bad one.
      this.token = null;
      // Say so in the UI. Failing silently left players with toggles that
      // looked "on", no audio at all, and nothing to act on — the browser
      // console was the only trace.
      this.emit({ error: "voiceConnectFailed" });
      return;
    }
    if (gen !== this.connectGen) {
      return;
    }
    // Someone turned the mic on while we were connecting.
    await this.publishMic();
    // Participants already in the room do not fire ParticipantConnected.
    room.remoteParticipants.forEach((p) => this.notePeer(p));
    this.emit();
  }

  private createRoom(): Room {
    const rtcConfig = iceServersOverride();
    const room = new Room({
      adaptiveStream: false,
      dynacast: false,
      ...(rtcConfig ? { rtcConfig: { iceServers: rtcConfig } } : {}),
    });
    // Every handler first ignores events from a room we already left: the
    // Disconnected event of a torn-down room arrives asynchronously.
    room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
      if (this.lk !== room) {
        return;
      }
      this.notePeer(p);
      this.emit();
    });
    room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      if (this.lk !== room) {
        return;
      }
      this.livePeers.delete(p.identity);
      this.detachAudio(p.identity);
      this.emit();
    });
    room.on(
      RoomEvent.TrackSubscribed,
      (
        track: RemoteTrack,
        _pub: RemoteTrackPublication,
        p: RemoteParticipant
      ) => {
        if (this.lk !== room) {
          return;
        }
        if (track.kind === Track.Kind.Audio) {
          this.attachAudio(p.identity, track as RemoteAudioTrack);
        }
        this.notePeer(p);
        this.emit();
      }
    );
    room.on(RoomEvent.TrackUnsubscribed, (track, _pub, p) => {
      if (this.lk !== room) {
        return;
      }
      if (track.kind === Track.Kind.Audio) {
        this.detachAudio(p.identity, track as RemoteAudioTrack);
      }
      this.emit();
    });
    room.on(RoomEvent.TrackMuted, (_pub, p) => {
      if (this.lk !== room) {
        return;
      }
      this.notePeer(p);
      this.emit();
    });
    room.on(RoomEvent.TrackUnmuted, (_pub, p) => {
      if (this.lk !== room) {
        return;
      }
      this.notePeer(p);
      this.emit();
    });
    room.on(RoomEvent.Disconnected, () => {
      if (this.lk !== room) {
        return;
      }
      // Unexpected loss (leaveRoom disconnects via teardownRoom, which
      // clears this.lk first): drop everything and try again shortly. The
      // published track dies with the room, and leaving the reference behind
      // would make the next publishMic() a no-op — the mic would look on
      // while nobody could hear it.
      this.lk = null;
      this.connectGen++;
      this.published = null;
      this.dropAudioElements();
      this.livePeers.clear();
      this.emit();
      if (this.active && this.room) {
        this.requestToken(true);
        setTimeout(() => {
          if (this.active) {
            void this.ensureConnected();
          }
        }, RECONNECT_DELAY_MS);
      }
    });
    return room;
  }

  private teardownRoom() {
    this.connectGen++;
    this.published = null;
    this.dropAudioElements();
    this.livePeers.clear();
    const room = this.lk;
    this.lk = null;
    if (room) {
      try {
        room.disconnect();
      } catch {
        // already disconnected
      }
    }
    this.emit();
  }

  private dropAudioElements() {
    this.audioElements.forEach((el) => {
      el.pause();
      el.srcObject = null;
      el.remove();
    });
    this.audioElements.clear();
    this.audioHost?.remove();
    this.audioHost = null;
  }

  // ---- remote participants ---------------------------------------------

  /** (Re)record a participant's mic state from their microphone track. */
  private notePeer(p: Participant) {
    // Mute events deliver the base Participant type; only remote
    // participants carry track publications.
    const remote = p as RemoteParticipant;
    const pub = remote.getTrackPublication
      ? remote.getTrackPublication(Track.Source.Microphone)
      : undefined;
    this.livePeers.set(p.identity, { mic: pub ? !pub.isMuted : false });
  }

  private attachAudio(id: string, track: RemoteAudioTrack) {
    if (typeof document === "undefined") {
      return;
    }
    if (!this.audioHost) {
      this.audioHost = document.createElement("div");
      this.audioHost.setAttribute("data-voice-audio", "");
      this.audioHost.style.display = "none";
      document.body.appendChild(this.audioHost);
    }
    let audio = this.audioElements.get(id);
    if (!audio) {
      audio = document.createElement("audio");
      audio.setAttribute("playsinline", "");
      this.audioHost.appendChild(audio);
      this.audioElements.set(id, audio);
    }
    try {
      track.attach(audio);
    } catch (err) {
      console.warn("voice: attach track", err);
    }
    this.applyOutput(id);
  }

  private detachAudio(id: string, track?: RemoteAudioTrack) {
    const audio = this.audioElements.get(id);
    if (!audio) {
      return;
    }
    if (track) {
      try {
        track.detach(audio);
      } catch {
        // element is gone either way
      }
    }
    audio.pause();
    audio.srcObject = null;
    audio.remove();
    this.audioElements.delete(id);
  }

  private applyOutput(id: string) {
    const audio = this.audioElements.get(id);
    if (!audio) {
      return;
    }
    audio.muted = !this.state.speakerOn || this.isPeerMuted(id);
    audio.volume = this.state.outputVolume;
    if (audio.muted) {
      audio.pause();
    } else {
      void audio.play().catch(() => {
        // The next speaker toggle retries if autoplay was blocked.
      });
    }
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
    if (on === this.micRequested) {
      return;
    }
    this.micRequested = on;
    const request = ++this.micRequest;
    if (on) {
      this.syncAudioSession();
      const started = await this.startMic(request);
      if (request !== this.micRequest) {
        return;
      }
      if (!started) {
        this.micRequested = false;
        this.syncAudioSession();
        return;
      }
    } else {
      this.unpublishMic();
      this.releaseMic();
    }
    const wasActive = this.active;
    this.state = { ...this.state, micOn: on };
    if (this.active && !wasActive) {
      void this.ensureConnected();
    }
    this.syncAudioSession();
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
    if (on) {
      this.syncAudioSession();
      if (!wasActive) {
        void this.ensureConnected();
      }
    }
    this.audioElements.forEach((_el, id) => this.applyOutput(id));
    this.syncAudioSession();
    this.emit();
  }

  setMicVolume(v: number): void {
    const vol = clampMicVolume(v);
    if (this.micGain) {
      this.micGain.gain.value = vol;
    }
    this.emit({ micVolume: vol });
    this.persist();
  }

  setOutputVolume(v: number): void {
    const vol = clamp01(v);
    this.state = { ...this.state, outputVolume: vol };
    this.audioElements.forEach((_el, id) => this.applyOutput(id));
    this.emit();
    this.persist();
  }

  /** Local-only mute of one peer: they keep talking to everyone else. */
  toggleMutePeer(id: string): void {
    const muted = this.isPeerMuted(id)
      ? this.state.mutedPeers.filter((p) => p !== id)
      : this.state.mutedPeers.concat(id);
    this.state = { ...this.state, mutedPeers: muted };
    this.applyOutput(id);
    this.emit();
    this.persist();
  }

  /**
   * Update the live capture track without stopping the hardware, WebAudio
   * graph or the published track. Serialize changes so rapid toggles cannot
   * apply older settings after the latest choice.
   */
  async setEchoCancellation(on: boolean): Promise<void> {
    if (on === this.state.echoCancellation) {
      return;
    }
    const revision = ++this.captureRevision;
    this.emit({ echoCancellation: on });
    this.persist();
    if (!this.state.micOn) {
      return; // startMic picks up changes made while permission is pending.
    }
    const request = this.micRequest;
    this.captureChange = this.captureChange.then(async () => {
      if (request !== this.micRequest || revision !== this.captureRevision) {
        return;
      }
      try {
        await this.applyCaptureConstraints();
        if (request !== this.micRequest) {
          return;
        }
        this.micEchoCancellation = on;
      } catch {
        // `{exact: on}` is the part browsers may refuse; keep the previous
        // setting rather than guessing what was applied.
        if (request === this.micRequest && revision === this.captureRevision) {
          this.emit({
            echoCancellation: this.micEchoCancellation,
            error: "voiceSettingsFailed",
          });
          this.persist();
        }
      }
      if (request === this.micRequest) {
        this.syncAudioSession();
        void resumeAudioContext(this.micCtx);
      }
    });
    await this.captureChange;
  }

  /**
   * Switch the outgoing mic between the browser's built-in noise suppression
   * and the AI (Krisp) filter. Turning it on downloads the model on first
   * use; if that is impossible the browser keeps doing the job and the
   * setting reverts, so the player never ends up with no noise handling at
   * all (or with two stages fighting each other).
   */
  async setNoiseCancellation(on: boolean): Promise<void> {
    if (on === this.state.noiseCancellation) {
      return;
    }
    const revision = ++this.captureRevision;
    this.emit({ noiseCancellation: on });
    this.persist();
    // With the mic off there is nothing to process yet: publishMic attaches
    // the filter when the capture starts.
    if (!this.state.micOn) {
      return;
    }
    const request = this.micRequest;
    this.captureChange = this.captureChange.then(async () => {
      if (request !== this.micRequest || revision !== this.captureRevision) {
        return;
      }
      let failed = false;
      if (on) {
        // Nothing published yet (still connecting): publishMic attaches it.
        failed = this.published
          ? !(await this.attachKrisp(this.published))
          : false;
      } else {
        await this.detachKrisp();
      }
      if (request !== this.micRequest || revision !== this.captureRevision) {
        return;
      }
      if (failed) {
        this.emit({
          noiseCancellation: false,
          error: "noiseCancellationFailed",
        });
        this.persist();
      }
      // Whatever ended up active decides how the hardware is constrained:
      // browser suppression is requested only while the AI filter is idle.
      try {
        await this.applyCaptureConstraints();
      } catch {
        // Echo cancellation is the setting that may be refused; it already
        // reported on its own path if so.
      }
    });
    await this.captureChange;
  }

  /**
   * Constraints for the hardware capture track. Exactly one noise reducer is
   * asked for: while the player wants the AI filter, the browser's own
   * suppression stays off (cascading two of them smears speech). If the
   * model turns out to be unusable, the setting reverts and this flips back
   * to browser suppression.
   */
  private micConstraints(): MediaTrackConstraints {
    return {
      echoCancellation: this.state.echoCancellation,
      // Gain control stays independent of both echo and noise handling.
      autoGainControl: true,
      noiseSuppression: !this.state.noiseCancellation,
    };
  }

  /**
   * Apply the capture constraints to the live hardware track. Echo
   * cancellation is pinned with `exact` so the browser either honours the
   * choice or reports failure (handled by the caller) instead of silently
   * overriding it.
   */
  private async applyCaptureConstraints(): Promise<boolean> {
    const track = this.rawStream?.getAudioTracks()[0];
    if (!track) {
      return true; // nothing captured yet: startMic uses the current state
    }
    await track.applyConstraints({
      ...this.micConstraints(),
      echoCancellation: { exact: this.state.echoCancellation },
    });
    return true;
  }

  /**
   * Attach the AI noise filter to a published track. Returns false when the
   * filter is unavailable (unsupported browser, load failure) or could not
   * be set up, in which case the caller keeps browser noise suppression.
   */
  private async attachKrisp(track: LocalAudioTrack): Promise<boolean> {
    // Processors need an AudioContext on the track (livekit-client throws
    // otherwise). We always publish a track built from our WebAudio graph,
    // so ours is the same context the graph runs on — sample rates match and
    // no second context is spun up.
    if (!this.micCtx) {
      return false;
    }
    try {
      const mod = await loadKrisp();
      if (!mod.isKrispNoiseFilterSupported()) {
        return false;
      }
      const processor = mod.KrispNoiseFilter();
      await track.setProcessor(processor);
      // LiveKit only auto-enables a processor through its onPublish hook,
      // which fires when the track is published *with* the processor already
      // attached. Attaching one to an already-published track (the player
      // flipping the switch mid-hand) skips that, so enable it explicitly —
      // setEnabled is a no-op when the state already matches.
      try {
        await processor.setEnabled(true);
      } catch (err) {
        // Half-installed filter: leave the chain as we found it.
        await track.stopProcessor().catch(() => {});
        throw err;
      }
      return true;
    } catch (err) {
      console.warn("voice: AI noise filter", err);
      return false;
    }
  }

  private async detachKrisp() {
    const track = this.published;
    if (!track) {
      return;
    }
    try {
      await track.stopProcessor();
    } catch (err) {
      console.warn("voice: stop AI noise filter", err);
    }
  }

  private syncAudioSession() {
    setVoiceAudioState(this.micRequested, this.state.speakerOn);
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
      noiseCancellation: this.state.noiseCancellation,
    };
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // storage unavailable: settings simply do not persist
    }
  }

  // ---- microphone -----------------------------------------------------

  /** Publish the processed mic track to LiveKit (no-op while disconnected). */
  private async publishMic() {
    const room = this.lk;
    if (
      !this.micTrack ||
      this.published ||
      !room ||
      room.state !== ConnectionState.Connected
    ) {
      return;
    }
    // We own the track (custom WebAudio chain): LiveKit must not manage it.
    // The graph's AudioContext travels with it because livekit-client refuses
    // to set up a processor on a track that has none.
    const local = new LocalAudioTrack(
      this.micTrack,
      undefined,
      true,
      this.micCtx ?? undefined
    );
    this.published = local;
    // Attach the AI filter before the track goes out — LiveKit then creates
    // the sender from processedTrack, so the first audio is already cleaned.
    if (this.state.noiseCancellation) {
      const attached = await this.attachKrisp(local);
      // Browser suppression was left off at capture time in anticipation of
      // the model; re-apply the constraints either way so the hardware track
      // matches whatever is actually in the chain.
      void this.applyCaptureConstraints().catch(() => {});
      if (!attached) {
        this.emit({
          noiseCancellation: false,
          error: "noiseCancellationFailed",
        });
        this.persist();
      }
    }
    try {
      await room.localParticipant.publishTrack(local, {
        source: Track.Source.Microphone,
      });
    } catch (err) {
      if (this.published === local) {
        this.published = null;
      }
      console.warn("voice: publish mic", err);
    }
  }

  /** Stop publishing (and stop sending) our mic. */
  private unpublishMic() {
    const room = this.lk;
    const track = this.published;
    this.published = null;
    if (room && track) {
      try {
        room.localParticipant.unpublishTrack(track, true);
      } catch {
        // room already gone
      }
    }
  }

  private async startMic(request: number): Promise<boolean> {
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
    let echoCancellation = this.state.echoCancellation;
    try {
      // Echo cancellation, noise suppression and automatic gain are the
      // browser's own WebRTC audio processing (Chrome: AEC3); we only ask
      // for them. Echo cancellation is user-toggleable (Settings), and noise
      // suppression steps aside when the AI filter is doing the job.
      raw = await navigator.mediaDevices.getUserMedia({
        audio: this.micConstraints(),
        video: false,
      });
    } catch {
      if (request === this.micRequest) {
        this.emit({ error: "micDenied" });
      }
      return false;
    }
    // Permission can resolve after turning the mic off or leaving the room.
    // Never attach a late stream or resurrect the recording session.
    if (request !== this.micRequest) {
      raw.getTracks().forEach((t) => t.stop());
      this.syncAudioSession();
      return false;
    }
    this.rawStream = raw;
    const rawTrack = raw.getAudioTracks()[0];
    if (!rawTrack) {
      this.releaseMic();
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
      this.micCtx = ctx;
      ctx.onstatechange = () => {
        if (this.micCtx === ctx && (ctx.state as string) === "interrupted") {
          void resumeAudioContext(ctx);
        }
      };
      await resumeAudioContext(ctx);
      if (request !== this.micRequest) {
        return false;
      }
      const source = ctx.createMediaStreamSource(raw);
      const gain = ctx.createGain();
      gain.gain.value = this.state.micVolume;
      const dest = ctx.createMediaStreamDestination();
      // Let quiet microphones be amplified above 100%, while compressing
      // loud peaks before encoding instead of clipping the outgoing signal.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.1;
      source.connect(gain);
      gain.connect(limiter);
      limiter.connect(dest);
      const processed = dest.stream.getAudioTracks()[0];
      if (!processed) {
        throw new Error("no processed track");
      }
      this.micCtx = ctx;
      this.micGain = gain;
      this.micTrack = processed;
    } catch {
      if (request !== this.micRequest) {
        return false;
      }
      if (this.micCtx) {
        void this.micCtx.close().catch(() => {});
        this.micCtx = null;
      }
      this.micTrack = rawTrack;
    }
    try {
      while (echoCancellation !== this.state.echoCancellation) {
        echoCancellation = this.state.echoCancellation;
        await rawTrack.applyConstraints({
          ...this.micConstraints(),
          echoCancellation: { exact: echoCancellation },
        });
        if (request !== this.micRequest) {
          return false;
        }
      }
    } catch {
      if (request === this.micRequest) {
        this.releaseMic();
        this.emit({ error: "voiceSettingsFailed" });
      }
      return false;
    }
    this.micEchoCancellation = echoCancellation;
    void resumeAudioContext(this.micCtx);
    // LiveKit publish happens after connectRoom too, in case the room was
    // not up yet; here it covers the mic-first, connect-later order.
    void this.publishMic();
    return true;
  }

  /** Release the microphone hardware and the processing graph. */
  private releaseMic() {
    this.captureChange = Promise.resolve();
    if (this.rawStream) {
      this.rawStream.getTracks().forEach((t) => t.stop());
      this.rawStream = null;
    }
    if (this.micTrack) {
      this.micTrack.stop();
      this.micTrack = null;
    }
    if (this.micCtx) {
      void this.micCtx
        .close()
        .catch(() => {})
        .then(() => this.syncAudioSession());
      this.micCtx = null;
    }
    this.micGain = null;
  }
}

// One manager per browser tab, shared by the socket provider and the UI.
export const voice = new VoiceManager();
