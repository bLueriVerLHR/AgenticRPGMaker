/**
 * Boot sequence (P1c, docs/06-architecture.md §3).
 *
 * ```
 * index.html → core.init → detect.renderer (WebGL? → WebGLRenderer
 *              else Canvas2DRenderer)
 *          → runtime.boot → scene.enter → game loop (update/render)
 *          → saves: IndexedDB (load/save) → network: WS → server
 * ```
 *
 * `boot()` performs the async steps (map load, renderer capability detection,
 * storage, network connect) then assembles the game via `createGame` and
 * starts the loop. If the server URL is absent the game runs fully
 * single-player; a failed network connect degrades to single-player with a
 * logged error rather than failing the boot.
 */
import type { Direction, MapData, TilesetData, Vec2 } from "@agenticrpg/core";
import { parseMapDocument } from "@agenticrpg/core";
import type { Renderer, RendererBackend, RendererLogger } from "@agenticrpg/renderer";
import { DefaultRendererFactory } from "@agenticrpg/renderer";

import { createGame, type Game } from "./game.js";
import { IndexedDBStorage } from "./indexeddb-storage.js";
import type { LogLevel, Logger } from "./logger.js";
import { Logger as LoggerClass } from "./logger.js";
import { NetworkClient } from "./network-client.js";
import { probePlatformCapabilities } from "./platform.js";
import type { Storage } from "./storage.js";
import type { Transport } from "./transport.js";

/** Multiplayer options (absent ⇒ single-player, D16 players-only scope). */
export interface NetworkOptions {
  /** WebSocket server URL (ws:// or wss://). */
  url: string;
  roomId?: string;
  playerName?: string;
  projectId?: string;
  heartbeatMs?: number;
  timeoutMs?: number;
  /** Transport to use; defaults to a `WebSocketTransport`. */
  transport?: Transport;
}

export interface BootOptions {
  /** Canvas the renderer draws into. */
  canvas: HTMLCanvasElement;
  /** DOM root for the HUD, dialogue box, and virtual controls. */
  root: HTMLElement;
  /** Load the map document from this URL (either mapUrl or mapData is required). */
  mapUrl?: string;
  /** Inline map document (either mapUrl or mapData is required). */
  mapData?: MapData;
  /** Injected renderer; otherwise capability-detected (WebGL → Canvas2D). */
  renderer?: Renderer;
  /** Injected storage; otherwise an IndexedDB adapter. */
  storage?: Storage;
  /** Multiplayer options; omitted/null ⇒ single-player. */
  network?: NetworkOptions | null;
  /** Legacy shorthand for `network.url`. */
  serverUrl?: string;
  logger?: Logger;
  logLevel?: LogLevel;
  playerName?: string;
  roomId?: string;
  projectId?: string;
  playerPosition?: Vec2;
  playerDirection?: Direction;
  /** Auto-load the latest save on boot. Default true. */
  autoLoad?: boolean;
  tilesets?: ReadonlyMap<string, TilesetData>;
  /** Game-loop overrides (tests inject a manual raf/clock). */
  loop?: {
    fixedDt?: number;
    maxFrameDt?: number;
    raf?: (callback: (timeMs: number) => void) => number;
    cancelRaf?: (handle: number) => void;
    now?: () => number;
  };
  /** Injectable fetch (defaults to global fetch). */
  fetchImpl?: typeof fetch;
}

/** The renderer backend chosen by capability detection (for HUD/logs). */
export interface BootResult {
  game: Game;
  backend: string;
  mapId: string;
}

/**
 * Run the full boot sequence and return the started `Game`.
 * Resolves with the game; rejects only when the map cannot load or no
 * renderer backend exists at all (unrecoverable).
 */
export async function boot(options: BootOptions): Promise<Game> {
  const logger = options.logger ?? new LoggerClass({ level: options.logLevel });
  logger.info("boot: core init (schemas v1 ready)");

  // 1. Map: inline or fetched (both validated against the core map schema).
  const map = await loadMap(options, logger);

  // 2. Renderer capability detection (WebGL default, Canvas2D fallback).
  const renderer = await createRuntimeRenderer(options, logger);
  const backend = rendererBackend(renderer);
  logger.info("boot: renderer backend selected", { backend });

  // 3. Storage: IndexedDB by default, injectable for tests.
  const storage = options.storage ?? new IndexedDBStorage({ logger });
  logger.info("boot: storage ready", { backend: storage.available ? "indexeddb" : "unavailable" });

  // 3.5 Platform capabilities snapshot (D21/D23): one read-only report of the
  // runtime environment (renderer backend probe, input, storage, audio) — the
  // portable-first seam that lets browser/JoiPlay run as configurations of the
  // same runtime. Logged at info for first-class diagnosability (ADR-002).
  // The renderer backend is passed in (already known from step 2) so the probe
  // does NOT create a second canvas/WebGL context at boot (task 11).
  const platform = probePlatformCapabilities({ rendererBackend: backend });
  logger.info("boot: platform capabilities", { platform });

  // 4. Network: single-player unless a server URL is configured.
  const network = await createNetworkClient(options, logger);

  // 5. Runtime boot → scene → game loop.
  const game = createGame({
    canvas: options.canvas,
    root: options.root,
    map,
    renderer,
    storage,
    logger,
    network,
    playerPosition: options.playerPosition,
    playerDirection: options.playerDirection,
    autoLoad: options.autoLoad ?? true,
    tilesets: options.tilesets,
    loop: options.loop,
  });

  game.start();
  return game;
}

async function loadMap(options: BootOptions, logger: Logger): Promise<MapData> {
  if (options.mapData !== undefined) {
    const parsed = parseMapDocument(options.mapData);
    logger.info("boot: map loaded (inline)", { id: parsed.id, name: parsed.name });
    return parsed;
  }
  if (options.mapUrl === undefined) {
    throw new Error("boot: neither mapUrl nor mapData provided");
  }
  const fetcher = options.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (fetcher === undefined) {
    throw new Error("boot: no fetch available to load mapUrl");
  }
  const response = await fetcher(options.mapUrl);
  if (!response.ok) {
    throw new Error(`boot: failed to load map "${options.mapUrl}" (${response.status})`);
  }
  const raw = await response.json();
  const parsed = parseMapDocument(raw);
  logger.info("boot: map loaded (url)", { id: parsed.id, url: options.mapUrl });
  return parsed;
}

async function createRuntimeRenderer(options: BootOptions, logger: Logger): Promise<Renderer> {
  if (options.renderer !== undefined) {
    return options.renderer;
  }
  const rendererLogger: RendererLogger = {
    debug: (message, meta) => logger.debug(message, meta),
    info: (message, meta) => logger.info(message, meta),
    warn: (message, meta) => logger.warn(message, meta),
    error: (message, meta) => logger.error(message, meta),
  };
  const factory = new DefaultRendererFactory({ logger: rendererLogger });
  try {
    return factory.create({ canvas: options.canvas });
  } catch (error) {
    throw new Error(`boot: no renderer backend available: ${String(error)}`);
  }
}

function rendererBackend(renderer: Renderer): RendererBackend | null {
  // `getBackend` is not on the `Renderer` interface, but both concrete backends
  // implement it and need it called as a method (it returns `this.backend`).
  // Keep the cast, but call through the object so `this` stays bound.
  const withBackend = renderer as { getBackend?: () => RendererBackend };
  return typeof withBackend.getBackend === "function" ? withBackend.getBackend() : null;
}

async function createNetworkClient(
  options: BootOptions,
  logger: Logger,
): Promise<NetworkClient | null> {
  const networkOptions = resolveNetworkOptions(options);
  if (networkOptions === null) {
    logger.info("boot: network disabled (single-player)");
    return null;
  }
  const client = new NetworkClient({
    transport: networkOptions.transport,
    roomId: networkOptions.roomId ?? options.roomId ?? "default",
    playerName: networkOptions.playerName ?? options.playerName ?? "Player",
    projectId: networkOptions.projectId ?? options.projectId,
    logger,
  });
  try {
    await client.connect(networkOptions.url, {
      roomId: networkOptions.roomId ?? options.roomId,
      playerName: networkOptions.playerName ?? options.playerName,
      projectId: networkOptions.projectId ?? options.projectId,
      heartbeatMs: networkOptions.heartbeatMs,
      timeoutMs: networkOptions.timeoutMs,
    });
  } catch (error) {
    logger.error("boot: network connect failed; continuing single-player", {
      error: String(error),
    });
  }
  return client;
}

function resolveNetworkOptions(options: BootOptions): NetworkOptions | null {
  if (options.network !== null && options.network !== undefined) {
    return options.network;
  }
  if (options.serverUrl !== undefined && options.serverUrl !== "") {
    return { url: options.serverUrl };
  }
  return null;
}
