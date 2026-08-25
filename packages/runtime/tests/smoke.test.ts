/**
 * Runtime smoke test (P1c): the package's public surface is importable and the
 * seam contracts hold. Real behavior is covered by the subsystem suites
 * (logger, game loop, scenes, map scene, storage, transport).
 */
import { describe, expect, it } from "vitest";

import {
  boot,
  buildCollisionGrid,
  createGame,
  IndexedDBStorage,
  Input,
  Logger,
  MapScene,
  MemoryStorage,
  NetworkClient,
  SceneManager,
  WebSocketTransport,
} from "../src/index.js";

describe("@agenticrpg/runtime (P1c public surface)", () => {
  it("exports the boot + lifecycle API", () => {
    expect(typeof boot).toBe("function");
    expect(typeof createGame).toBe("function");
  });

  it("exports the scene/state API", () => {
    expect(typeof SceneManager).toBe("function");
    expect(typeof MapScene).toBe("function");
  });

  it("exports the storage adapters", () => {
    expect(typeof MemoryStorage).toBe("function");
    expect(typeof IndexedDBStorage).toBe("function");
  });

  it("exports the transport + multiplayer client", () => {
    expect(typeof WebSocketTransport).toBe("function");
    expect(typeof NetworkClient).toBe("function");
  });

  it("exports the logger and input systems", () => {
    expect(typeof Logger).toBe("function");
    expect(typeof Input).toBe("function");
    expect(typeof buildCollisionGrid).toBe("function");
  });
});
