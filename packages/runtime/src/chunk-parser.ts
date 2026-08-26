/**
 * Chunk parser (ADR-008 §4, S3c).
 *
 * Parses + validates fetched chunk documents (map v1) through a Web Worker
 * when one can be created (injectable factory — tests use a fake worker);
 * otherwise parses on the main thread. Either path is correctness-equal:
 * the core schema is the only validator. A failed worker (no `onmessage`
 * wiring, construction throw) falls back to main-thread parsing.
 */
import type { MapData } from "@agenticrpg/core";
import { parseMapDocument } from "@agenticrpg/core";

/** The structural Worker surface the parser drives (fakes in tests). */
export interface ChunkWorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror?: ((event: unknown) => void) | null;
}

export interface ChunkParserOptions {
  /** Creates the worker; returns null / throws / omitted ⇒ main thread. */
  workerFactory?: (() => ChunkWorkerLike | null) | null;
}

interface WorkerReply {
  id: number;
  type: "parsed";
  ok: boolean;
  map?: unknown;
  error?: string;
}

interface PendingParse {
  resolve: (map: MapData) => void;
  reject: (error: Error) => void;
  file: string;
}

export interface ChunkParser {
  parse(source: unknown, fileName: string): Promise<MapData>;
  dispose(): void;
}

export function createChunkParser(options: ChunkParserOptions = {}): ChunkParser {
  let worker: ChunkWorkerLike | null = null;
  try {
    worker = options.workerFactory?.() ?? null;
  } catch {
    worker = null; // construction failed → main-thread path
  }

  const pending = new Map<number, PendingParse>();
  let nextId = 1;

  if (worker !== null) {
    worker.onmessage = (event) => {
      const reply = event.data as WorkerReply;
      if (reply === null || reply.type !== "parsed") {
        return;
      }
      const entry = pending.get(reply.id);
      if (entry === undefined) {
        return;
      }
      pending.delete(reply.id);
      if (reply.ok && reply.map !== undefined) {
        entry.resolve(reply.map as MapData);
      } else {
        entry.reject(new Error(`chunk parse failed ${entry.file}: ${reply.error ?? "unknown"}`));
      }
    };
  }

  return {
    parse(source: unknown, fileName: string): Promise<MapData> {
      if (worker !== null) {
        const id = nextId++;
        return new Promise<MapData>((resolve, reject) => {
          pending.set(id, { resolve, reject, file: fileName });
          worker?.postMessage({ id, type: "parse", file: fileName, source });
        });
      }
      // Main-thread path (no worker, or worker broken).
      try {
        return Promise.resolve(parseMapDocument(source));
      } catch (error) {
        return Promise.reject(new Error(`chunk parse failed ${fileName}: ${String(error)}`));
      }
    },

    dispose(): void {
      const failures = [...pending.values()];
      pending.clear();
      worker?.terminate();
      worker = null;
      for (const entry of failures) {
        entry.reject(new Error(`chunk parse cancelled ${entry.file}: parser disposed`));
      }
    },
  };
}
