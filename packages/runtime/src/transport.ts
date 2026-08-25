/**
 * Transport abstraction (P1c, docs/06-architecture.md §7 "Transport /
 * protocol abstraction", ADR-004).
 *
 * The Adapter/Strategy seam that hides the socket: game and network code talk
 * to the `Transport` interface (connect/send/close/onMessage/onClose/onError),
 * never to a concrete WebSocket. P1c ships the `WebSocketTransport` relay
 * client; future authoritative/proxy transports implement the same interface.
 *
 * This module also defines the structural `WebSocketLike` adapter (so the
 * real `WebSocket` and test fakes are interchangeable), the WebSocket ready
 * states, and the `TokenBucket` rate limiter used for the ADR-004 rate limits
 * (player_state 10 Hz burst 15, chat 2 msg/s).
 */

/** Options passed to `Transport.connect`. */
export interface TransportOptions {
  /** Session/room to join (ADR-004 `hello` payload). */
  roomId?: string;
  playerName?: string;
  projectId?: string;
  /** Heartbeat ping interval in ms (ADR-004 default 15000). */
  heartbeatMs?: number;
  /** Silence timeout in ms; the client drops a silent server (default 60000). */
  timeoutMs?: number;
}

/** One inbound message handler (raw wire string). */
export type TransportMessageHandler = (data: string) => void;
/** Close callback: (code, reason). */
export type TransportCloseHandler = (code: number, reason: string) => void;
/** Error callback. */
export type TransportErrorHandler = (error: unknown) => void;

/** The transport seam every networking backend implements. */
export interface Transport {
  /** Open a connection and resolve once the versioned handshake is ready. */
  connect(url: string, options?: TransportOptions): Promise<void>;
  /** Send one serialized protocol message (a JSON envelope string). */
  send(data: string): void;
  /** Close the connection (sends `leave` if applicable, then closes). */
  close(): void;
  /** Register a handler for every inbound message. Returns an unsubscribe. */
  onMessage(handler: TransportMessageHandler): () => void;
  /** Register a handler fired when the connection closes. */
  onClose(handler: TransportCloseHandler): () => void;
  /** Register a handler fired on transport-level errors. */
  onError(handler: TransportErrorHandler): () => void;
}

/** WebSocket ready states (RFC 6455, mirrored for fakes). */
export const WS_CONNECTING = 0;
export const WS_OPEN = 1;
export const WS_CLOSING = 2;
export const WS_CLOSED = 3;

/**
 * The minimal WebSocket surface the transport needs. The real `WebSocket`
 * satisfies this structurally; tests inject a fake.
 */
export interface WebSocketLike {
  readonly url: string;
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** Factory for socket instances (browser default: `new WebSocket(url)`). */
export type WebSocketFactory = (url: string) => WebSocketLike;

/** Handshake lifecycle states for the WebSocket transport. */
export type TransportState = "idle" | "connecting" | "handshaking" | "ready" | "closing" | "closed";

/**
 * A token-bucket rate limiter (ADR-004 guidance: "coalesce before you
 * rate-limit"). `tryTake()` consumes a token when available; used to gate
 * outbound messages. Injectable clock for tests.
 */
export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private tokens: number;
  private lastRefillMs: number;
  private readonly now: () => number;

  constructor(ratePerSecond: number, burst: number, now: () => number = Date.now) {
    this.capacity = burst;
    this.refillPerMs = ratePerSecond / 1000;
    this.tokens = burst;
    this.lastRefillMs = now();
    this.now = now;
  }

  /** Try to consume one token; returns false when the bucket is empty. */
  tryTake(): boolean {
    this.refill();
    if (this.tokens < 1) {
      return false;
    }
    this.tokens -= 1;
    return true;
  }

  /** Number of tokens currently available (for tests/debug). */
  get availableTokens(): number {
    this.refill();
    return this.tokens;
  }

  private refill(): void {
    const now = this.now();
    const elapsed = Math.max(0, now - this.lastRefillMs);
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
      this.lastRefillMs = now;
    }
  }
}
