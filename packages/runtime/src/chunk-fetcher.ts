/**
 * HTTP chunk loader (ADR-008 §4, S3c part 2).
 *
 * The default `ChunkLoader` for the world path: fetches a chunk document from
 * a base directory and validates it through the shared `ChunkParser`
 * (worker-backed when possible). The load contract is "fetch → JSON → parse";
 * the parser is where off-main-thread validation happens.
 */
import type { MapData, WorldChunk } from "@agenticrpg/core";

import type { ChunkLoader } from "./chunk-store.js";
import type { ChunkParser } from "./chunk-parser.js";
import type { Logger } from "./logger.js";
import { createNoopLogger } from "./logger.js";

export interface HttpChunkLoaderOptions {
  /** Base directory the chunk `file` paths resolve against (trailing `/`). */
  baseDir: string;
  parser: ChunkParser;
  /** Injectable fetch (tests); defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  logger?: Logger;
}

export class HttpChunkLoader implements ChunkLoader {
  private readonly baseDir: string;
  private readonly parser: ChunkParser;
  private readonly fetchImpl: ((url: string) => Promise<Response>) | undefined;
  private readonly logger: Logger;

  constructor(options: HttpChunkLoaderOptions) {
    this.baseDir = options.baseDir.endsWith("/") ? options.baseDir : `${options.baseDir}/`;
    this.parser = options.parser;
    // Wrap the native fetch in a closure: calling it as `this.fetchImpl(url)`
    // would detach `this` and throw "Illegal invocation" in browsers.
    this.fetchImpl =
      options.fetchImpl ?? (typeof fetch === "function" ? (url: string) => fetch(url) : undefined);
    this.logger = options.logger ?? createNoopLogger();
  }

  async load(chunk: WorldChunk): Promise<MapData> {
    const url = `${this.baseDir}${chunk.file}`;
    if (this.fetchImpl === undefined) {
      throw new Error(`chunk loader: no fetch available for "${url}"`);
    }
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`chunk loader: failed to load "${url}" (${response.status})`);
    }
    const raw: unknown = await response.json();
    return this.parser.parse(raw, chunk.file);
  }
}

/** Derive a chunk base directory from a world manifest URL ("data/" → "data/"). */
export function baseDirOfWorldUrl(worldUrl: string): string {
  const idx = worldUrl.lastIndexOf("/");
  return idx < 0 ? "" : worldUrl.slice(0, idx + 1);
}
