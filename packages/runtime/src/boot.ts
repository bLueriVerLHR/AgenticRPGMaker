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
import type { Direction, MapData, TilesetData, Vec2, WorldData } from "@agenticrpg/core";
import { parseMapDocument, parseWorldDocument } from "@agenticrpg/core";
import type { Renderer, RendererLogger } from "@agenticrpg/renderer";
import { DefaultRendererFactory } from "@agenticrpg/renderer";

import { AudioManager } from "./audio.js";
import { baseDirOfWorldUrl, HttpChunkLoader } from "./chunk-fetcher.js";
import { createChunkParser, type ChunkWorkerLike } from "./chunk-parser.js";
import { ChunkStore, type ChunkLoader } from "./chunk-store.js";
import { createGame, type Game } from "./game.js";
import { IndexedDBStorage } from "./indexeddb-storage.js";
import type { LogLevel, Logger } from "./logger.js";
import { Logger as LoggerClass } from "./logger.js";
import { NetworkClient } from "./network-client.js";
import type { Storage } from "./storage.js";
import { TitleScene } from "./title-scene.js";
import type { Transport } from "./transport.js";
import { createWorldGame, type WorldGame } from "./world-game.js";
import { IndexedDBWorldStorage, type WorldStorage } from "./world-storage.js";

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
  // ------------------------------------------------------------------
  // World mode (ADR-008 §5): one of worldUrl/worldData switches the boot
  // to the WorldScene path (mapUrl/mapData then stay untouched).
  // ------------------------------------------------------------------
  /** World manifest URL (chunks resolve relative to its directory). */
  worldUrl?: string;
  /** Inline world manifest (tests). */
  worldData?: WorldData;
  /** Chunk loader override; defaults to an HTTP loader over `worldUrl`. */
  chunkLoader?: ChunkLoader;
  /** World-mode save storage; defaults to the IndexedDB world store. */
  worldStorage?: WorldStorage;
  /** Audio manager for the title/BGM/SFX; a WebAudio manager by default. */
  audio?: AudioManager | null;
  /** Title screen before the world; `false` skips it (tests). */
  worldTitle?: { title?: string; subtitle?: string } | false;
  /** Worker factory for chunk parsing; defaults to a module-worker attempt. */
  chunkWorkerFactory?: (() => ChunkWorkerLike | null) | null;
}

/** The renderer backend chosen by capability detection (for HUD/logs). */
export interface BootResult {
  game: Game;
  backend: string;
  mapId: string;
}

/**
 * Run the full boot sequence and return the started game.
 * Overloads: world mode (worldUrl or worldData) returns a `WorldGame`
 * (WorldScene + chunk streaming + title); the map path returns the P1c
 * `Game`. Rejects only when the map/world cannot load or no renderer
 * backend exists at all (unrecoverable).
 */
export async function boot(
  options: BootOptions & ({ worldUrl: string } | { worldData: WorldData }),
): Promise<WorldGame>;
export async function boot(options: BootOptions): Promise<Game>;
export async function boot(options: BootOptions): Promise<Game | WorldGame> {
  if (options.worldUrl !== undefined || options.worldData !== undefined) {
    return bootWorld(options);
  }
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

function rendererBackend(renderer: Renderer): string {
  const getBackend = (renderer as { getBackend?: () => string }).getBackend;
  // Invoke with the renderer as receiver: backend getBackend()s are prototype
  // methods that read `this`, and a detached ClassMeth() call has `this ===
  // undefined` in strict ESM (boot crash: "reading 'backend' of undefined").
  return typeof getBackend === "function" ? getBackend.call(renderer) : "unknown";
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

// ---------------------------------------------------------------------------
// World mode (ADR-008 §5, S3c part 2)
// ---------------------------------------------------------------------------

/** Boot the world path: manifest → chunk pool → WorldScene (+ optional title). */
async function bootWorld(options: BootOptions): Promise<WorldGame> {
  const logger = options.logger ?? new LoggerClass({ level: options.logLevel });
  logger.info("boot: world mode (ADR-008)");
  if (options.network !== undefined && options.network !== null) {
    logger.warn("boot: network ignored in world mode (single-player demo scope)", {});
  }

  // 1. World manifest: inline or fetched (validated against the world schema).
  const world = await loadWorld(options, logger);

  // 2. Renderer: same capability detection as the map path.
  const renderer = await createRuntimeRenderer(options, logger);
  logger.info("boot: renderer backend selected", {
    backend: rendererBackend(renderer),
  });

  // 3. Storage: world-mode save slot (IndexedDB by default, injectable).
  const storage = options.worldStorage ?? new IndexedDBWorldStorage({ logger });
  logger.info("boot: world storage ready", {
    backend: storage.available ? "indexeddb" : "unavailable",
  });

  // 4. Chunk pipeline: parser (worker when possible) + loader + store.
  const parser = createChunkParser({ workerFactory: resolveWorkerFactory(options) });
  const loader =
    options.chunkLoader ??
    new HttpChunkLoader({
      baseDir: options.worldUrl !== undefined ? baseDirOfWorldUrl(options.worldUrl) : "",
      parser,
      fetchImpl: options.fetchImpl,
      logger: logger.child("chunks"),
    });
  const chunkStore = new ChunkStore({
    world,
    loader,
    logger: logger.child("chunks"),
  });

  // 5. Audio (title unlock; BGM/SFX): a WebAudio manager unless injected.
  const audio =
    options.audio === undefined
      ? new AudioManager({ logger: logger.child("audio") })
      : options.audio;

  // 6. Assemble + start (the WorldScene handles chunk residency on enter).
  const game = createWorldGame({
    canvas: options.canvas,
    root: options.root,
    world,
    chunkStore,
    renderer,
    storage,
    logger,
    audio,
    autoLoad: options.autoLoad ?? true,
    tilesets: options.tilesets,
    loop: options.loop,
  });
  game.start();

  // 7. Optional title screen (ADR-010 §3): "press any key" unlocks audio.
  if (options.worldTitle !== false) {
    const title = new TitleScene({
      renderer,
      canvas: options.canvas,
      audio,
      uiRoot: options.root,
      title: options.worldTitle?.title,
      subtitle: options.worldTitle?.subtitle,
      logger: logger.child("title"),
      onStart: () => {
        game.sceneManager.change(game.scene);
      },
    });
    game.sceneManager.change(title);
  }
  return game;
}

async function loadWorld(options: BootOptions, logger: Logger): Promise<WorldData> {
  if (options.worldData !== undefined) {
    const parsed = parseWorldDocument(options.worldData);
    logger.info("boot: world loaded (inline)", { id: parsed.id, name: parsed.name });
    return parsed;
  }
  if (options.worldUrl === undefined) {
    throw new Error("boot: neither worldUrl nor worldData provided");
  }
  const fetcher = options.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (fetcher === undefined) {
    throw new Error("boot: no fetch available to load worldUrl");
  }
  const response = await fetcher(options.worldUrl);
  if (!response.ok) {
    throw new Error(`boot: failed to load world "${options.worldUrl}" (${response.status})`);
  }
  const raw: unknown = await response.json();
  const parsed = parseWorldDocument(raw);
  logger.info("boot: world loaded (url)", { id: parsed.id, url: options.worldUrl });
  return parsed;
}

function resolveWorkerFactory(
  options: BootOptions,
): (() => ChunkWorkerLike | null) | undefined | null {
  if (options.chunkWorkerFactory === null) {
    return null; // explicitly disabled → main-thread parsing
  }
  if (options.chunkWorkerFactory !== undefined) {
    return options.chunkWorkerFactory;
  }
  return () => {
    try {
      // Bundler-dependent seam: vite serves this as a module worker in dev;
      // build-www emits the worker as its own bundle (ADR-008 Consequences).
      const worker = new Worker(new URL("./chunk-worker.js", import.meta.url), {
        type: "module",
      });
      return worker as unknown as ChunkWorkerLike;
    } catch {
      return null; // workers unavailable → main-thread fallback
    }
  };
}
