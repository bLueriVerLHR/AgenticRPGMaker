/**
 * WebSocket relay transport (P1c, ADR-004).
 *
 * Implements the `Transport` seam over a `WebSocketLike`, speaking the
 * versioned `protocol.v1` envelope from core:
 * - versioned handshake state machine: connect → open → `hello` → `welcome`
 *   (the `connect()` promise resolves only once the handshake is ready);
 * - heartbeat: `ping` every 15 s, `pong` echoes the client timestamp, and a
 *   60 s silence watchdog drops a dead server (`leave`/close);
 * - join room (`hello`), `player_state`, `chat`, `leave` send helpers;
 * - inbound envelopes are version-gated and dispatched to raw-message and
 *   envelope handlers; malformed/version-mismatch messages are logged and, on
 *   a version mismatch, the connection is closed (ADR-004).
 *
 * The socket factory is injectable so tests drive a fake WebSocket; in the
 * browser the default is `new WebSocket(url)`.
 */
import {
  chat as chatEnvelope,
  decodeMessageSafe,
  encodeMessage,
  hello as helloEnvelope,
  leave as leaveEnvelope,
  ping as pingEnvelope,
  playerState as playerStateEnvelope,
  type ChatPayload,
  type HelloPayload,
  type LeavePayload,
  type PlayerStatePayload,
  type ProtocolEnvelope,
} from "@agenticrpg/core";

import type { Logger } from "./logger.js";
import { createNoopLogger } from "./logger.js";
import type {
  Transport,
  TransportCloseHandler,
  TransportErrorHandler,
  TransportMessageHandler,
  TransportOptions,
  TransportState,
  WebSocketFactory,
  WebSocketLike,
} from "./transport.js";
import { WS_CLOSED, WS_CONNECTING, WS_OPEN } from "./transport.js";

/** Options for the WebSocket transport. */
export interface WebSocketTransportOptions {
  /** Socket factory; defaults to `new WebSocket(url)` in the browser. */
  socketFactory?: WebSocketFactory;
  logger?: Logger;
  /** Injectable clock (ms). Default `performance.now` / `Date.now`. */
  now?: () => number;
  /** Handshake timeout in ms. Default 10000. */
  handshakeTimeoutMs?: number;
}

/** The reason string used when the watchdog drops a silent server. */
export const HEARTBEAT_TIMEOUT_REASON = "heartbeat_timeout";
/** Normal close code used by `close()`. */
export const NORMAL_CLOSE_CODE = 1000;

const defaultNow = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

const defaultSocketFactory: WebSocketFactory = (url: string): WebSocketLike => {
  if (typeof WebSocket === "undefined") {
    throw new Error("WebSocket is not available in this environment");
  }
  return new WebSocket(url) as unknown as WebSocketLike;
};

/** A versioned envelope + its raw wire form, dispatched together. */
export interface InboundEnvelope {
  envelope: ProtocolEnvelope;
  raw: string;
}

export type EnvelopeHandler = (inbound: InboundEnvelope) => void;

export class WebSocketTransport implements Transport {
  private readonly socketFactory: WebSocketFactory;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly handshakeTimeoutMs: number;

  private stateValue: TransportState = "idle";
  private socket: WebSocketLike | null = null;
  private optionsValue: TransportOptions & { heartbeatMs: number; timeoutMs: number } = {
    heartbeatMs: 15000,
    timeoutMs: 60000,
  };

  private seq = 0;
  private sessionIdValue: string | null = null;
  private lastActivityMs = 0;
  private lastInboundMs = 0;
  private latencyMsValue: number | null = null;
  private leaveSent = false;

  private readonly messageHandlers = new Set<TransportMessageHandler>();
  private readonly closeHandlers = new Set<TransportCloseHandler>();
  private readonly errorHandlers = new Set<TransportErrorHandler>();
  private readonly envelopeHandlers = new Set<EnvelopeHandler>();

  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: unknown) => void) | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: WebSocketTransportOptions = {}) {
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.logger = options.logger ?? createNoopLogger();
    this.now = options.now ?? defaultNow;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 10000;
  }

  /** Current handshake state. */
  get state(): TransportState {
    return this.stateValue;
  }

  /** The session id assigned by the server's `welcome`, or null. */
  get sessionId(): string | null {
    return this.sessionIdValue;
  }

  /** Most recent pong round-trip latency in ms, or null. */
  get latencyMs(): number | null {
    return this.latencyMsValue;
  }

  connect(url: string, options?: TransportOptions): Promise<void> {
    if (this.stateValue !== "idle") {
      return Promise.reject(new Error(`cannot connect from state "${this.stateValue}"`));
    }
    this.optionsValue = {
      heartbeatMs: options?.heartbeatMs ?? 15000,
      timeoutMs: options?.timeoutMs ?? 60000,
      ...options,
    };
    this.seq = 0;
    this.sessionIdValue = null;
    this.leaveSent = false;
    this.stateValue = "connecting";

    let socket: WebSocketLike;
    try {
      socket = this.socketFactory(url);
    } catch (error) {
      this.stateValue = "closed";
      this.logger.error("transport: socket factory failed", { url, error: String(error) });
      return Promise.reject(error);
    }
    this.socket = socket;
    socket.onopen = () => this.handleOpen();
    socket.onmessage = (event) => this.handleMessage(event.data);
    socket.onerror = () => this.handleSocketError();
    socket.onclose = (event) => this.handleClose(event?.code ?? 0, event?.reason ?? "");

    this.logger.info("transport: connecting", { url });
    return new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });
  }

  send(data: string): void {
    if (this.stateValue !== "ready") {
      this.logger.warn("transport: send ignored (not ready)", {
        state: this.stateValue,
        data,
      });
      return;
    }
    this.dispatchSend(data);
  }

  /**
   * Encode a versioned envelope and send it (assigning the next `seq`).
   * Works during the handshake too (the `hello` is sent while "handshaking").
   * Fails fast on an invalid envelope.
   */
  sendMessage(envelope: ProtocolEnvelope): boolean {
    const withSeq = { ...envelope, seq: this.nextSeq() };
    try {
      const raw = encodeMessage(withSeq);
      if (this.stateValue === "idle" || this.stateValue === "closed") {
        this.logger.warn("transport: sendMessage ignored (not connected)", {
          state: this.stateValue,
          type: envelope.type,
        });
        return false;
      }
      this.dispatchSend(raw);
      return true;
    } catch (error) {
      this.logger.error("transport: cannot encode outbound message", {
        type: envelope.type,
        error: String(error),
      });
      return false;
    }
  }

  /** Send the `hello` join envelope (handshake). */
  sendHello(payload: HelloPayload): boolean {
    return this.sendMessage(helloEnvelope(payload));
  }

  /** Send a `player_state` update. */
  sendPlayerState(payload: PlayerStatePayload): boolean {
    return this.sendMessage(playerStateEnvelope(payload));
  }

  /** Send a `chat` message. */
  sendChat(payload: ChatPayload): boolean {
    return this.sendMessage(chatEnvelope(payload));
  }

  /** Send a `leave` message (before closing, per ADR-004). */
  sendLeave(payload: LeavePayload = {}): boolean {
    if (this.stateValue !== "ready") {
      return false;
    }
    this.leaveSent = true;
    return this.sendMessage(leaveEnvelope(payload));
  }

  /** Register a handler for every inbound message. Returns an unsubscribe. */
  onMessage(handler: TransportMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /** Register a handler for versioned inbound envelopes. */
  onEnvelope(handler: EnvelopeHandler): () => void {
    this.envelopeHandlers.add(handler);
    return () => this.envelopeHandlers.delete(handler);
  }

  onClose(handler: TransportCloseHandler): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  onError(handler: TransportErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  close(): void {
    if (this.stateValue === "idle" || this.stateValue === "closed") {
      return;
    }
    this.logger.info("transport: closing", { state: this.stateValue });
    if (this.stateValue === "ready" && !this.leaveSent) {
      this.sendLeave({ reason: "user_quit" });
    }
    this.stateValue = "closing";
    this.stopTimers();
    this.socket?.close(NORMAL_CLOSE_CODE, "client_close");
  }

  // ------------------------------------------------------------------
  // Socket events
  // ------------------------------------------------------------------

  private handleOpen(): void {
    if (this.stateValue !== "connecting") {
      return;
    }
    this.stateValue = "handshaking";
    this.lastActivityMs = this.now();
    const helloPayload: HelloPayload = {
      playerName: this.optionsValue.playerName ?? "Player",
      roomId: this.optionsValue.roomId ?? "default",
    };
    if (this.optionsValue.projectId !== undefined) {
      helloPayload.projectId = this.optionsValue.projectId;
    }
    this.logger.info("transport: handshake started", {
      roomId: helloPayload.roomId,
      playerName: helloPayload.playerName,
    });
    this.sendHello(helloPayload);
    this.handshakeTimer = setTimeout(() => {
      this.logger.error("transport: handshake timed out");
      this.rejectConnect(new Error("handshake timed out"));
      this.forceClose(1000, "handshake_timeout");
    }, this.handshakeTimeoutMs);
  }

  private handleMessage(data: unknown): void {
    const raw = typeof data === "string" ? data : String(data);
    this.lastActivityMs = this.now();
    this.lastInboundMs = this.lastActivityMs;
    const decoded = decodeMessageSafe(raw);
    if (!decoded.ok) {
      this.logger.warn("transport: inbound decode failed", {
        error: String(decoded.error),
        raw,
      });
      this.notifyError(decoded.error);
      return;
    }
    const envelope = decoded.message;
    if (envelope.type === "welcome" && this.stateValue === "handshaking") {
      this.completeHandshake(envelope);
    }
    this.notifyEnvelope({ envelope, raw });
    for (const handler of this.messageHandlers) {
      handler(raw);
    }
  }

  private handleSocketError(): void {
    this.logger.warn("transport: socket error", { state: this.stateValue });
    const error = new Error("websocket error");
    this.notifyError(error);
    if (this.stateValue === "connecting" || this.stateValue === "handshaking") {
      this.rejectConnect(error);
    }
  }

  private handleClose(code: number, reason: string): void {
    this.logger.info("transport: closed", { code, reason, state: this.stateValue });
    this.stopTimers();
    if (this.connectReject !== null && this.stateValue !== "ready") {
      this.rejectConnect(new Error(`connection closed before handshake ready: ${reason}`));
    }
    this.stateValue = "closed";
    this.sessionIdValue = null;
    this.socket = null;
    for (const handler of this.closeHandlers) {
      handler(code, reason);
    }
  }

  // ------------------------------------------------------------------
  // Handshake / heartbeat internals
  // ------------------------------------------------------------------

  private completeHandshake(envelope: ProtocolEnvelope): void {
    if (this.handshakeTimer !== null) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
    const payload = envelope.payload as { sessionId?: string; roomId?: string };
    this.sessionIdValue = payload.sessionId ?? null;
    this.stateValue = "ready";
    this.logger.info("transport: handshake complete", {
      sessionId: this.sessionIdValue,
      roomId: payload.roomId,
    });
    this.connectResolve?.();
    this.connectResolve = null;
    this.connectReject = null;
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    this.stopTimers();
    const heartbeatMs = this.optionsValue.heartbeatMs;
    const timeoutMs = this.optionsValue.timeoutMs;
    this.pingTimer = setInterval(() => {
      this.sendPing();
    }, heartbeatMs);
    this.watchdogTimer = setInterval(
      () => {
        // Watch for a silent *server*: no inbound message for `timeoutMs`.
        const idleMs = this.now() - this.lastInboundMs;
        if (idleMs > timeoutMs) {
          this.logger.warn("transport: heartbeat timeout, dropping connection", {
            idleMs,
            timeoutMs,
          });
          this.forceClose(4000, HEARTBEAT_TIMEOUT_REASON);
        }
      },
      Math.min(heartbeatMs, 1000),
    );
  }

  private sendPing(): void {
    if (this.stateValue !== "ready") {
      return;
    }
    this.lastActivityMs = this.now();
    this.sendMessage(pingEnvelope({ clientTimeMs: this.now() }));
  }

  /** Handle a `pong` (echoed client timestamp → round-trip latency). */
  handlePong(payload: { clientTimeMs?: number }): void {
    const clientTimeMs = payload.clientTimeMs;
    if (typeof clientTimeMs === "number") {
      this.latencyMsValue = this.now() - clientTimeMs;
      this.logger.debug("transport: pong", { latencyMs: this.latencyMsValue });
    }
  }

  private dispatchSend(raw: string): void {
    this.lastActivityMs = this.now();
    this.socket?.send(raw);
  }

  private notifyEnvelope(inbound: InboundEnvelope): void {
    if (inbound.envelope.type === "pong") {
      this.handlePong(inbound.envelope.payload as { clientTimeMs?: number });
    }
    for (const handler of this.envelopeHandlers) {
      handler(inbound);
    }
  }

  private notifyError(error: unknown): void {
    for (const handler of this.errorHandlers) {
      handler(error);
    }
  }

  private rejectConnect(error: unknown): void {
    this.connectReject?.(error);
    this.connectResolve = null;
    this.connectReject = null;
  }

  private forceClose(code: number, reason: string): void {
    this.stopTimers();
    this.stateValue = "closing";
    this.socket?.close(code, reason);
  }

  private stopTimers(): void {
    if (this.handshakeTimer !== null) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }
}

/** Re-export the WebSocket constants for convenience. */
export { WS_CLOSED, WS_CONNECTING, WS_OPEN };
