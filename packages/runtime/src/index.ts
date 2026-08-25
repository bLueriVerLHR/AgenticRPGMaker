/**
 * @agenticrpg/runtime — boot seam + Transport interface stubs (P0 scaffold).
 *
 * The runtime is the playable game (ADR-001): boot sequence, game loop, scene
 * management, IndexedDB saves, and the multiplayer client. P1c implements the
 * real thing. This file only pins the two seams the rest of the system depends
 * on, so they compile and their contracts are visible before P1c:
 *
 * - the boot seam (06-architecture.md §3 boot flow);
 * - the Transport abstraction (ADR-001 patterns / ADR-004 protocol).
 */
import type { Renderer } from "@agenticrpg/renderer";

/**
 * Boot options for `boot()`. Mirrors the boot flow from 06-architecture.md §3:
 * core init -> renderer capability detection -> runtime boot -> scene -> loop.
 */
export interface BootOptions {
  /** Canvas the renderer draws into. */
  canvas: HTMLCanvasElement;
  /** Renderer chosen by capability detection (injected, so it is mockable). */
  renderer: Renderer;
  /** URL of the portable game data package (index.html + data/ + js/ + ...). */
  dataUrl: string;
  /** Optional multiplayer server URL (ws:// or wss://); omitted = offline. */
  serverUrl?: string;
  /** Logging callback; structured JSON entries (03-wal-process.md §2). */
  log?: (entry: {
    level: "trace" | "debug" | "info" | "warn" | "error";
    message: string;
    data?: unknown;
  }) => void;
}

/** Handle returned by `boot()`; the owner can stop the game loop cleanly. */
export interface RuntimeHandle {
  /** Stop the game loop and release resources. */
  destroy(): void;
}

/**
 * Boot seam stub. P1c replaces the body with the real boot sequence. Throwing
 * here (at call time, not import time) makes the seam explicit and testable.
 */
export function boot(_options: BootOptions): RuntimeHandle {
  throw new Error("packages/runtime boot is not implemented yet (P1c). P0 defines the seam only.");
}

/**
 * Transport — the networking abstraction (ADR-001 pattern catalog; ADR-004
 * protocol v1 over WebSocket). P1c ships the WebSocket relay client; future
 * authoritative/proxy transports implement the same interface.
 *
 * The transport is byte/JSON-transparent: callers serialize protocol envelopes
 * (ADR-004) and pass strings; the transport is responsible for connectivity,
 * framing, and lifecycle only.
 */
export interface Transport {
  /** Open a connection to `url` and resolve once the handshake is ready. */
  connect(url: string, options?: TransportOptions): Promise<void>;
  /** Send one serialized protocol message (JSON envelope string). */
  send(data: string): void;
  /** Close the connection (sends `leave` if applicable, then closes). */
  close(): void;
  /** Register a handler for every inbound message. */
  onMessage(handler: TransportMessageHandler): void;
  /** Register a handler fired when the connection closes. */
  onClose(handler: (code: number, reason: string) => void): void;
  /** Register a handler fired on transport-level errors. */
  onError(handler: (error: unknown) => void): void;
}

export interface TransportOptions {
  /** Session/room to join (ADR-004 `hello` payload). */
  roomId?: string;
  playerName?: string;
  projectId?: string;
  /** Heartbeat interval in ms (default 15000 per ADR-004). */
  heartbeatMs?: number;
}

export type TransportMessageHandler = (data: string) => void;

/** Factory so the runtime can construct transports behind the interface. */
export interface TransportFactory {
  create(options?: TransportOptions): Transport;
}
