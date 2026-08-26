/**
 * Chunk store: the world's resident-chunk pool (ADR-008 §4, S3c).
 *
 * Pure residency policy over an injected loader: `updateTo(cell)` ensures
 * every chunk within the prefetch radius (default 1, Chebyshev distance) and
 * evicts resident chunks farther than the evict radius (default 2). Loads are
 * deduplicated while in flight; a failed load is retried on the next
 * `updateTo` (the world treats a missing chunk as blocked ground, ADR-008 §4).
 *
 * The store owns no fetching itself: the loader contract is
 * `load(chunk) → Promise<MapData>` — the harness wires an HTTP+parser loader
 * (chunk-parser.js) or a test fake.
 */
import type { MapData, WorldChunk, WorldData } from "@agenticrpg/core";
import { chunkCellAt, type ChunkCell } from "@agenticrpg/core";

import type { Logger } from "./logger.js";
import { createNoopLogger } from "./logger.js";

export interface ChunkLoader {
  load(chunk: WorldChunk): Promise<MapData>;
}

export interface ChunkStoreOptions {
  world: WorldData;
  loader: ChunkLoader;
  /** Chunks within this Chebyshev radius are kept resident. Default 1. */
  prefetchRadius?: number;
  /** Chunks farther than this radius are evicted. Default 2. */
  evictRadius?: number;
  logger?: Logger;
  onChunkLoaded?: (chunkId: string) => void;
  onChunkEvicted?: (chunkId: string) => void;
}

interface ResidentChunk {
  chunk: WorldChunk;
  map: MapData;
}

export class ChunkStore {
  private readonly world: WorldData;
  private readonly loader: ChunkLoader;
  private readonly prefetchRadius: number;
  private readonly evictRadius: number;
  private readonly logger: Logger;
  private readonly onChunkLoaded?: (chunkId: string) => void;
  private readonly onChunkEvicted?: (chunkId: string) => void;

  private readonly resident = new Map<string, ResidentChunk>();
  private readonly inflight = new Map<string, Promise<MapData>>();
  private readonly byCell = new Map<string, WorldChunk>();

  constructor(options: ChunkStoreOptions) {
    this.world = options.world;
    this.loader = options.loader;
    this.prefetchRadius = Math.max(0, options.prefetchRadius ?? 1);
    this.evictRadius = Math.max(this.prefetchRadius, options.evictRadius ?? 2);
    this.logger = options.logger ?? createNoopLogger();
    this.onChunkLoaded = options.onChunkLoaded;
    this.onChunkEvicted = options.onChunkEvicted;
    for (const chunk of this.world.chunks) {
      this.byCell.set(`${chunk.col}:${chunk.row}`, chunk);
    }
  }

  /** The world chunk for a grid cell (or null when out of bounds/unlisted). */
  chunkAtCell(cell: ChunkCell): WorldChunk | null {
    const col = Math.max(0, Math.min(this.world.grid.cols - 1, cell.col));
    const row = Math.max(0, Math.min(this.world.grid.rows - 1, cell.row));
    return this.byCell.get(`${col}:${row}`) ?? null;
  }

  /** The resident map for a grid cell (or null when not loaded). */
  mapAtCell(cell: ChunkCell): MapData | null {
    const chunk = this.chunkAtCell(cell);
    return chunk === null ? null : (this.resident.get(chunk.id)?.map ?? null);
  }

  /** The resident map for an explicit chunk id (or null). */
  getChunk(chunkId: string): MapData | null {
    return this.resident.get(chunkId)?.map ?? null;
  }

  /** The world chunk entry for an explicit id. */
  getWorldChunk(chunkId: string): WorldChunk | null {
    return this.world.chunks.find((chunk) => chunk.id === chunkId) ?? null;
  }

  /** Resident chunk ids (insertion order). */
  residentIds(): string[] {
    return [...this.resident.keys()];
  }

  /**
   * Make the chunk resident (deduplicated while in flight). Resolves with the
   * map; rejects when the loader fails (callers log + treat as not-resident).
   */
  ensure(chunkId: string): Promise<MapData> {
    const existing = this.resident.get(chunkId);
    if (existing !== undefined) {
      return Promise.resolve(existing.map);
    }
    const inflight = this.inflight.get(chunkId);
    if (inflight !== undefined) {
      return inflight;
    }
    const chunk = this.getWorldChunk(chunkId);
    if (chunk === null) {
      return Promise.reject(new Error(`chunk store: unknown chunk id "${chunkId}"`));
    }
    const attempt = this.loader
      .load(chunk)
      .then((map) => {
        this.inflight.delete(chunkId);
        this.resident.set(chunkId, { chunk, map });
        this.logger.info("chunk loaded", {
          chunkId,
          events: map.events.length,
          size: map.width * map.height,
        });
        this.onChunkLoaded?.(chunkId);
        return map;
      })
      .catch((error: unknown) => {
        this.inflight.delete(chunkId);
        throw error;
      });
    this.inflight.set(chunkId, attempt);
    return attempt;
  }

  /**
   * Sync residency to the player's chunk cell: ensure the prefetch set, then
   * evict residents beyond the evict radius. Individual load failures are
   * caught and logged (a missing chunk blocks ground, it does not crash the
   * world). Resolves when all stays have settled.
   */
  async updateTo(playerCell: ChunkCell): Promise<void> {
    const wanted = new Set<string>();
    for (let dCol = -this.prefetchRadius; dCol <= this.prefetchRadius; dCol++) {
      for (let dRow = -this.prefetchRadius; dRow <= this.prefetchRadius; dRow++) {
        const chunk = this.chunkAtCell({
          col: playerCell.col + dCol,
          row: playerCell.row + dRow,
        });
        if (chunk !== null) {
          wanted.add(chunk.id);
        }
      }
    }

    const results = await Promise.allSettled([...wanted].map((id) => this.ensure(id)));
    for (const result of results) {
      if (result.status === "rejected") {
        this.logger.warn("chunk load failed", { error: String(result.reason) });
      }
    }

    for (const [chunkId, resident] of [...this.resident.entries()]) {
      const distance = Math.max(
        Math.abs(resident.chunk.col - playerCell.col),
        Math.abs(resident.chunk.row - playerCell.row),
      );
      if (distance > this.evictRadius) {
        this.resident.delete(chunkId);
        this.logger.info("chunk evicted", { chunkId, distance });
        this.onChunkEvicted?.(chunkId);
      }
    }
  }

  /** The chunk cell a global tile coordinate lives in (core coords helper). */
  cellOf(x: number, y: number): ChunkCell {
    return chunkCellAt(x, y, this.world.chunkSize);
  }
}
