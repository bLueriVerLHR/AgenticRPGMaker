/**
 * @agenticrpg/runtime — the playable game (P1c).
 *
 * The portable, framework-free game runtime (ADR-001/ADR-004;
 * docs/06-architecture.md §3/§5/§7): boot sequence, fixed-step game loop,
 * scene/state management, a MapScene with movement/collision/dialogue,
 * IndexedDB saves behind the Storage adapter, and the multiplayer client
 * behind the Transport abstraction (players-only sync, D16).
 *
 * Public surface:
 * - `boot` / `createGame` / `Game` — boot & lifecycle
 * - `Scene` / `SceneManager` / `MapScene` — scene/state management
 * - `Storage` / `MemoryStorage` / `IndexedDBStorage` — save/load (RQ1)
 * - `Transport` / `WebSocketTransport` / `NetworkClient` — multiplayer (ADR-004)
 * - `Logger` / `LogLevel` / `LogEntry` — structured JSON logging (§8)
 * - `Input` / `GameLoop` / `buildCollisionGrid` — supporting systems
 */

// Logger (docs/06-architecture.md §8).
export {
  LOG_LEVELS,
  Logger,
  createConsoleSink,
  createNoopLogger,
  defaultLogger,
  formatLogEntry,
} from "./logger.js";
export type { LogEntry, LogLevel, LoggerOptions, LogSink } from "./logger.js";

// Game loop + scenes (State pattern).
export { GameLoop, hasAnimationFrame } from "./game-loop.js";
export type { GameLoopOptions, LoopRender, LoopUpdate } from "./game-loop.js";
export { SceneManager } from "./scene.js";
export type { Scene, SceneContext, SceneManagerOptions } from "./scene.js";

// Map scene: movement / collision / dialogue (Q6).
export { MapScene } from "./map-scene.js";
export type { MapSceneOptions } from "./map-scene.js";

// Movement + collision.
export { aabbsOverlapStrict, buildCollisionGrid, checkStep, entityColliderAt } from "./movement.js";
export type { EntityCollider, SolidTileGrid, StepCheckInput, StepCheckResult } from "./movement.js";

// Input: keyboard + virtual D-pad (docs/08 §4.4).
export { Input, createKeyboardOnlyInput, DIRECTION_VECTORS, KEY_TO_DIRECTION } from "./input.js";
export type { DirectionVector, InputDirection, InputOptions } from "./input.js";

// Audio (ADR-010 §4, minimal WebAudio).
export { AudioManager } from "./audio.js";
export type { AudioContextFactory, AudioContextLike, AudioManagerOptions } from "./audio.js";

// CG presentation + title (ADR-010 §3, S3b).
export { buildCgScript } from "./cg.js";
export type { CgScript, CgStep } from "./cg.js";
export { CgScene, CG_TEXTURE_ID } from "./cg-scene.js";
export type { CgSceneOptions } from "./cg-scene.js";
export { TitleScene } from "./title-scene.js";
export type { TitleSceneOptions } from "./title-scene.js";

// Storage (RQ1 / D12).
export { MemoryStorage } from "./storage.js";
export type { Storage } from "./storage.js";
export {
  DEFAULT_INDEXEDDB_DB,
  DEFAULT_INDEXEDDB_KEY,
  DEFAULT_INDEXEDDB_STORE,
  IndexedDBStorage,
  isIndexedDBAvailable,
} from "./indexeddb-storage.js";
export type { IndexedDBStorageOptions } from "./indexeddb-storage.js";

// World-mode storage + chunk streaming (ADR-008, S3c).
export { MemoryWorldStorage, IndexedDBWorldStorage } from "./world-storage.js";
export { DEFAULT_WORLD_SAVES_KEY, DEFAULT_WORLD_SAVES_STORE } from "./world-storage.js";
export type { IndexedDBWorldStorageOptions, WorldStorage } from "./world-storage.js";
export { createChunkParser } from "./chunk-parser.js";
export type { ChunkParser, ChunkParserOptions, ChunkWorkerLike } from "./chunk-parser.js";
export { ChunkStore } from "./chunk-store.js";
export type { ChunkLoader, ChunkStoreOptions } from "./chunk-store.js";

// Transport (ADR-004).
export { TokenBucket, WS_CLOSED, WS_CLOSING, WS_CONNECTING, WS_OPEN } from "./transport.js";
export type {
  Transport,
  TransportCloseHandler,
  TransportErrorHandler,
  TransportMessageHandler,
  TransportOptions,
  TransportState,
  WebSocketFactory,
  WebSocketLike,
} from "./transport.js";
export {
  HEARTBEAT_TIMEOUT_REASON,
  NORMAL_CLOSE_CODE,
  WebSocketTransport,
} from "./websocket-transport.js";
export type {
  EnvelopeHandler,
  InboundEnvelope,
  WebSocketTransportOptions,
} from "./websocket-transport.js";

// Multiplayer client (players-only sync, D16).
export {
  DEFAULT_CHAT_RATE_HZ,
  DEFAULT_STATE_INTERVAL_MS,
  DEFAULT_STATE_RATE_HZ,
  MAX_CHAT_LENGTH,
  NetworkClient,
} from "./network-client.js";
export type {
  ChatHandler,
  NetworkClientOptions,
  RemoteLeaveHandler,
  RemotePlayer,
  RemoteStateHandler,
} from "./network-client.js";

// Boot + game lifecycle.
export { boot } from "./boot.js";
export type { BootOptions, BootResult, NetworkOptions } from "./boot.js";
export { createGame } from "./game.js";
export type { CreateGameOptions, Game } from "./game.js";
