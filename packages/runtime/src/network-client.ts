/**
 * Multiplayer client (P1c, ADR-004; docs/06-architecture.md §5).
 *
 * The high-level client above the `Transport` seam: performs the versioned
 * handshake (hello → welcome), joins a room, heartbeats (handled by the
 * transport), sends the local player's state rate-limited to ~10 Hz
 * (coalescing to the latest), receives remote `player_state` broadcasts and
 * applies them to interpolated `RemotePlayer` views, and handles chat/leave.
 *
 * Sync scope = **players only** (D16): position/direction/animation,
 * join/leave, chat. World-state sync (doors/switches/NPCs) is a documented
 * MVP limitation.
 *
 * Rate limits (ADR-004): player_state 10 Hz (burst 15, latest wins); chat
 * 2 msg/s, 200 chars max. A `TokenBucket` gates both; state is coalesced to
 * the latest before sending.
 */
import {
  decodeMessageSafe,
  makeEnvelope,
  type ChatPayload,
  type PlayerState,
  type PlayerStatePayload,
  type ProtocolEnvelope,
  type WelcomePayload,
} from "@agenticrpg/core";

import type { Logger } from "./logger.js";
import { createNoopLogger } from "./logger.js";
import type { Transport, TransportOptions } from "./transport.js";
import { TokenBucket } from "./transport.js";
import { WebSocketTransport } from "./websocket-transport.js";

/** Default state send interval (10 Hz per ADR-004). */
export const DEFAULT_STATE_INTERVAL_MS = 100;
/** Default chat rate: 2 messages per second (ADR-004). */
export const DEFAULT_CHAT_RATE_HZ = 2;
/** Default state rate: 10 Hz (ADR-004). */
export const DEFAULT_STATE_RATE_HZ = 10;
/** Max chat length in characters (ADR-004). */
export const MAX_CHAT_LENGTH = 200;

export interface NetworkClientOptions {
  /** Transport to use; defaults to a `WebSocketTransport`. */
  transport?: Transport;
  /** Session/room to join (ADR-004). */
  roomId?: string;
  playerName?: string;
  projectId?: string;
  /** State send rate in Hz. Default 10. */
  stateRateHz?: number;
  /** Chat rate in Hz. Default 2. */
  chatRateHz?: number;
  logger?: Logger;
  /** Injectable clock for rate limiting/timers (ms). */
  now?: () => number;
  /** Interval used for the coalescing send loop (default 100 ms). */
  sendLoopMs?: number;
}

/** A remote player's interpolated view (players-only sync scope, D16). */
export interface RemotePlayer {
  sessionId: string;
  playerName: string;
  /** Interpolated (display) position, in tile units. */
  x: number;
  y: number;
  direction: PlayerState["direction"];
  animation: string;
  /** Latest received target position (the state being interpolated toward). */
  targetX: number;
  targetY: number;
  /** Display position at the last received state (interpolation baseline). */
  prevX: number;
  prevY: number;
  /** Interpolation progress in [0,1]. */
  interpT: number;
}

/** Interpolation window in ms for remote positions. */
const INTERPOLATION_WINDOW_MS = 120;

export type RemoteStateHandler = (player: RemotePlayer) => void;
export type RemoteLeaveHandler = (sessionId: string, reason?: string) => void;
export type ChatHandler = (payload: ChatPayload & { playerName?: string }) => void;

/**
 * The multiplayer client. Construct one per connection; call `connect(url)`
 * to join a room, `setLocalState` each tick (rate-limited), and `close()` to
 * leave.
 */
export class NetworkClient {
  private readonly transport: Transport;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly stateRateHz: number;
  private readonly chatRateHz: number;
  private readonly sendLoopMs: number;

  private readonly roomId: string;
  private readonly playerName: string;
  private readonly projectId: string | undefined;

  private sessionIdValue: string | null = null;
  private connectedValue = false;

  private readonly remoteValue = new Map<string, RemotePlayer>();
  private readonly stateBucket: TokenBucket;
  private readonly chatBucket: TokenBucket;
  private pendingState: PlayerState | null = null;
  private lastSentState: PlayerState | null = null;

  private readonly stateHandlers = new Set<RemoteStateHandler>();
  private readonly leaveHandlers = new Set<RemoteLeaveHandler>();
  private readonly chatHandlers = new Set<ChatHandler>();
  private readonly unsuscribes: Array<() => void> = [];

  private sendTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: NetworkClientOptions = {}) {
    this.transport = options.transport ?? new WebSocketTransport();
    this.logger = options.logger ?? createNoopLogger();
    this.now =
      options.now ?? (typeof performance !== "undefined" ? () => performance.now() : Date.now);
    this.stateRateHz = options.stateRateHz ?? DEFAULT_STATE_RATE_HZ;
    this.chatRateHz = options.chatRateHz ?? DEFAULT_CHAT_RATE_HZ;
    this.sendLoopMs = options.sendLoopMs ?? DEFAULT_STATE_INTERVAL_MS;
    this.roomId = options.roomId ?? "default";
    this.playerName = options.playerName ?? "Player";
    this.projectId = options.projectId;
    this.stateBucket = new TokenBucket(
      this.stateRateHz,
      Math.max(1, Math.round(this.stateRateHz * 1.5)),
      this.now,
    );
    this.chatBucket = new TokenBucket(this.chatRateHz, this.chatRateHz, this.now);
  }

  /** Whether the handshake completed and the client is in a room. */
  get connected(): boolean {
    return this.connectedValue;
  }

  /** The session id assigned by the server (after `welcome`). */
  get sessionId(): string | null {
    return this.sessionIdValue;
  }

  /** The underlying transport (exposed for tests/inspection). */
  get transportImpl(): Transport {
    return this.transport;
  }

  /** Remote players currently in the room (read-only snapshot). */
  get remotePlayers(): ReadonlyMap<string, RemotePlayer> {
    return this.remoteValue;
  }

  /**
   * Connect to `url`, perform the versioned handshake, and join the room.
   * Resolves after `welcome`. Remote players from the welcome payload are
   * spawned (excluding the joiner).
   */
  async connect(url: string, options?: TransportOptions): Promise<void> {
    const transportOptions: TransportOptions = {
      roomId: options?.roomId ?? this.roomId,
      playerName: options?.playerName ?? this.playerName,
      projectId: options?.projectId ?? this.projectId,
      heartbeatMs: options?.heartbeatMs,
      timeoutMs: options?.timeoutMs,
    };
    // Subscribe before connecting so `welcome` is not missed.
    this.unsuscribes.push(this.subscribeEnvelopes());

    await this.transport.connect(url, transportOptions);
    this.connectedValue = true;
    this.logger.info("network: connected", { sessionId: this.sessionIdValue, roomId: this.roomId });
    this.sendTimer = setInterval(() => {
      this.flushPendingState();
    }, this.sendLoopMs);
  }

  /**
   * Set the latest local player state (called every tick). Rate-limited to
   * ~10 Hz; intermediate states are coalesced (latest wins, ADR-004).
   */
  setLocalState(state: PlayerState): void {
    this.pendingState = { ...state };
  }

  /** Send a chat message (rate-limited, 200 chars max). Returns false when dropped. */
  sendChat(text: string): boolean {
    if (!this.connectedValue) {
      this.logger.warn("network: chat ignored (not connected)");
      return false;
    }
    const trimmed = text.slice(0, MAX_CHAT_LENGTH);
    if (trimmed.length === 0) {
      return false;
    }
    if (!this.chatBucket.tryTake()) {
      this.logger.debug("network: chat rate-limited");
      return false;
    }
    const payload: ChatPayload = { text: trimmed };
    this.sendEnvelope(makeEnvelope("chat", payload));
    return true;
  }

  /** Register a handler for remote player state updates. */
  onRemotePlayerState(handler: RemoteStateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  /** Register a handler fired when a remote player leaves. */
  onRemotePlayerLeave(handler: RemoteLeaveHandler): () => void {
    this.leaveHandlers.add(handler);
    return () => this.leaveHandlers.delete(handler);
  }

  /** Register a handler for inbound chat. */
  onChat(handler: ChatHandler): () => void {
    this.chatHandlers.add(handler);
    return () => this.chatHandlers.delete(handler);
  }

  /** Advance remote-player interpolation by `dt` seconds (call each tick). */
  update(dt: number): void {
    for (const player of this.remoteValue.values()) {
      this.interpolate(player, dt * 1000);
    }
  }

  /** Close the connection: sends `leave` then closes the transport. */
  close(reason = "user_quit"): void {
    if (this.sendTimer !== null) {
      clearInterval(this.sendTimer);
      this.sendTimer = null;
    }
    if (this.connectedValue) {
      const raw = JSON.stringify(
        makeEnvelope("leave", { reason, sessionId: this.sessionIdValue ?? undefined }),
      );
      try {
        this.transport.send(raw);
      } catch {
        // best-effort leave; the close below still proceeds
      }
    }
    this.transport.close();
    this.connectedValue = false;
    this.remoteValue.clear();
    for (const unsubscribe of this.unsuscribes) {
      unsubscribe();
    }
    this.unsuscribes.length = 0;
    this.logger.info("network: closed", { reason });
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private subscribeEnvelopes(): () => void {
    const transport = this.transport as Transport & {
      onEnvelope?: (
        handler: (inbound: { envelope: ProtocolEnvelope; raw: string }) => void,
      ) => () => void;
    };
    if (typeof transport.onEnvelope !== "function") {
      // Fall back to raw message parsing for transports without envelope hooks.
      return this.transport.onMessage((raw) => {
        this.handleRaw(raw);
      });
    }
    return transport.onEnvelope((inbound) => {
      this.handleEnvelope(inbound.envelope);
    });
  }

  private handleRaw(raw: string): void {
    const decoded = decodeMessageSafe(raw);
    if (decoded.ok) {
      this.handleEnvelope(decoded.message);
    }
  }

  private handleEnvelope(envelope: ProtocolEnvelope): void {
    switch (envelope.type) {
      case "welcome":
        this.handleWelcome(envelope.payload as WelcomePayload);
        break;
      case "player_state":
        this.handleRemoteState(envelope.payload as PlayerStatePayload);
        break;
      case "chat":
        this.handleChat(envelope.payload as ChatPayload);
        break;
      case "leave":
        this.handleRemoteLeave(envelope.payload as { sessionId?: string; reason?: string });
        break;
      case "error":
        this.logger.warn("network: server error", {
          payload: envelope.payload as Record<string, unknown>,
        });
        break;
      case "ping":
        // Server-initiated ping: reply with pong (echo clientTimeMs).
        this.sendEnvelope(makeEnvelope("pong", envelope.payload as Record<string, unknown>));
        break;
      default:
        // Additive protocol extension: ignore unknown types (ADR-004).
        this.logger.debug("network: ignoring unknown message type", {
          type: envelope.type,
        });
        break;
    }
  }

  private handleWelcome(payload: WelcomePayload): void {
    this.sessionIdValue = payload.sessionId;
    this.logger.info("network: welcome", {
      sessionId: payload.sessionId,
      roomId: payload.roomId,
      playerCount: payload.players.length,
    });
    for (const player of payload.players) {
      if (player.sessionId === payload.sessionId) {
        continue; // self — not a remote
      }
      this.remoteValue.set(player.sessionId, {
        sessionId: player.sessionId,
        playerName: player.playerName,
        x: player.state.x,
        y: player.state.y,
        direction: player.state.direction,
        animation: player.state.animation ?? "idle",
        targetX: player.state.x,
        targetY: player.state.y,
        prevX: player.state.x,
        prevY: player.state.y,
        interpT: 1,
      });
    }
    this.logger.debug("network: remote players from welcome", {
      count: this.remoteValue.size,
    });
  }

  private handleRemoteState(payload: PlayerStatePayload): void {
    const sessionId = payload.sessionId;
    if (sessionId === undefined) {
      this.logger.warn("network: player_state without sessionId ignored");
      return;
    }
    const existing = this.remoteValue.get(sessionId);
    const state = payload.state;
    if (existing === undefined) {
      this.remoteValue.set(sessionId, {
        sessionId,
        playerName: sessionId,
        x: state.x,
        y: state.y,
        direction: state.direction,
        animation: state.animation ?? "idle",
        targetX: state.x,
        targetY: state.y,
        prevX: state.x,
        prevY: state.y,
        interpT: 1,
      });
    } else {
      // Baseline the interpolation from the current display position.
      existing.prevX = existing.x;
      existing.prevY = existing.y;
      existing.targetX = state.x;
      existing.targetY = state.y;
      existing.direction = state.direction;
      existing.animation = state.animation ?? existing.animation;
      existing.interpT = 0;
    }
    const player = this.remoteValue.get(sessionId);
    if (player !== undefined) {
      this.notifyState(player);
    }
  }

  private handleChat(payload: ChatPayload): void {
    this.logger.debug("network: chat received");
    for (const handler of this.chatHandlers) {
      handler(payload as ChatPayload & { playerName?: string });
    }
  }

  private handleRemoteLeave(payload: { sessionId?: string; reason?: string }): void {
    const sessionId = payload.sessionId;
    if (sessionId === undefined) {
      return;
    }
    const player = this.remoteValue.get(sessionId);
    if (player !== undefined) {
      this.remoteValue.delete(sessionId);
      for (const handler of this.leaveHandlers) {
        handler(sessionId, payload.reason);
      }
    }
  }

  private interpolate(player: RemotePlayer, dtMs: number): void {
    if (player.interpT >= 1) {
      player.x = player.targetX;
      player.y = player.targetY;
      player.prevX = player.x;
      player.prevY = player.y;
      return;
    }
    player.interpT = Math.min(1, player.interpT + dtMs / INTERPOLATION_WINDOW_MS);
    const t = player.interpT;
    player.x = player.prevX + (player.targetX - player.prevX) * t;
    player.y = player.prevY + (player.targetY - player.prevY) * t;
  }

  private flushPendingState(): void {
    if (this.pendingState === null || !this.connectedValue) {
      return;
    }
    if (this.stateBucket.tryTake()) {
      const state = this.pendingState;
      this.lastSentState = { ...state };
      const payload: PlayerStatePayload = {
        state,
        clientTimeMs: this.now(),
      };
      this.sendEnvelope(makeEnvelope("player_state", payload));
      this.logger.debug("network: player_state sent", { state });
    } else {
      // Coalesce: the latest pending state is kept; the next tick sends it.
      this.logger.trace("network: player_state rate-limited (coalesced)");
    }
  }

  private sendEnvelope(envelope: ProtocolEnvelope): void {
    const raw = JSON.stringify(envelope);
    this.transport.send(raw);
  }

  private notifyState(player: RemotePlayer): void {
    for (const handler of this.stateHandlers) {
      handler({ ...player });
    }
  }
}
