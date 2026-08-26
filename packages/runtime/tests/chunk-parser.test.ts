/**
 * Chunk parser tests (ADR-008 §4, S3c).
 *
 * Both correctness-equal paths: main-thread parsing (no worker) and the
 * worker path driven through a fake worker (message capture + scripted
 * replies, including an error reply and dispose-cancels-pending).
 */
import { describe, expect, it, vi } from "vitest";

import { createChunkParser, type ChunkWorkerLike } from "../src/chunk-parser.js";
import { fixtureMap } from "./helpers.js";

function makeWorker(): ChunkWorkerLike & {
  sent: unknown[];
  terminate: ReturnType<typeof vi.fn>;
  onmessage: ((event: { data: unknown }) => void) | null;
} {
  const worker = {
    sent: [] as unknown[],
    onmessage: null as ((event: { data: unknown }) => void) | null,
    terminate: vi.fn(),
    postMessage: vi.fn((message: unknown) => {
      worker.sent.push(message);
    }),
  };
  return worker;
}

describe("ChunkParser — main thread", () => {
  it("parses a valid chunk document without a worker", async () => {
    const parser = createChunkParser();
    const map = fixtureMap();
    await expect(parser.parse(map as unknown, "maps/a.json")).resolves.toEqual(map);
    parser.dispose();
  });

  it("rejects an invalid document with the file name in the error", async () => {
    const parser = createChunkParser();
    await expect(parser.parse({ schemaVersion: 99 }, "maps/bad.json")).rejects.toThrow(
      /chunk parse failed maps\/bad\.json/,
    );
    parser.dispose();
  });

  it("falls back to main thread when the worker factory throws", async () => {
    const parser = createChunkParser({
      workerFactory: () => {
        throw new Error("no workers here");
      },
    });
    const map = fixtureMap() as never;
    await expect(parser.parse(map, "maps/a.json")).resolves.toEqual(map);
    parser.dispose();
  });
});

describe("ChunkParser — worker", () => {
  it("routes parse requests through the worker and resolves replies", async () => {
    const worker = makeWorker();
    const parser = createChunkParser({ workerFactory: () => worker });
    const map = fixtureMap();
    const pending = parser.parse(map as never, "maps/a.json");

    expect(worker.sent).toHaveLength(1);
    const request = worker.sent[0] as { id: number; type: string; file: string; source: unknown };
    expect(request.type).toBe("parse");
    expect(request.file).toBe("maps/a.json");

    worker.onmessage?.({ data: { id: request.id, type: "parsed", ok: true, map } });
    await expect(pending).resolves.toEqual(map);
    parser.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("propagates worker parse errors as rejections", async () => {
    const worker = makeWorker();
    const parser = createChunkParser({ workerFactory: () => worker });
    const pending = parser.parse({ schemaVersion: 99 }, "maps/bad.json");
    const request = worker.sent[0] as { id: number };
    worker.onmessage?.({
      data: { id: request.id, type: "parsed", ok: false, error: "map is corrupt" },
    });
    await expect(pending).rejects.toThrow(/maps\/bad\.json.*map is corrupt|map is corrupt/);
    parser.dispose();
  });

  it("dispose cancels pending parses", async () => {
    const worker = makeWorker();
    const parser = createChunkParser({ workerFactory: () => worker });
    const pending = parser.parse(fixtureMap() as never, "maps/a.json");
    parser.dispose();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
