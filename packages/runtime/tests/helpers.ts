/**
 * Shared test helpers: a stub renderer (implements the Renderer seam with
 * call recording) and fixture maps exercising the P1c DoD scenarios.
 */
import type { MapData, Renderer } from "@agenticrpg/core";

/** A call record captured by the stub renderer. */
export type RenderCall =
  | { method: "beginFrame" }
  | { method: "endFrame" }
  | { method: "drawRect"; args: unknown[] }
  | { method: "drawTile"; args: unknown[] }
  | { method: "drawSprite"; args: unknown[] }
  | { method: "drawText"; args: unknown[] }
  | { method: "registerTexture"; args: unknown[] }
  | { method: "drawTexture"; args: unknown[] }
  | { method: "setCamera"; args: unknown[] }
  | { method: "pushTransform"; args: unknown[] }
  | { method: "popTransform"; args: unknown[] };

/** A deterministic stub implementing the Renderer interface (ADR-002 seam). */
export class StubRenderer implements Renderer {
  readonly calls: RenderCall[] = [];

  beginFrame(): void {
    this.calls.push({ method: "beginFrame" });
  }

  endFrame(): void {
    this.calls.push({ method: "endFrame" });
  }

  drawTile(...args: unknown[]): void {
    this.calls.push({ method: "drawTile", args });
  }

  drawSprite(...args: unknown[]): void {
    this.calls.push({ method: "drawSprite", args });
  }

  drawText(...args: unknown[]): void {
    this.calls.push({ method: "drawText", args });
  }

  drawRect(...args: unknown[]): void {
    this.calls.push({ method: "drawRect", args });
  }

  setCamera(...args: unknown[]): void {
    this.calls.push({ method: "setCamera", args });
  }

  pushTransform(...args: unknown[]): void {
    this.calls.push({ method: "pushTransform", args });
  }

  popTransform(...args: unknown[]): void {
    this.calls.push({ method: "popTransform", args });
  }

  /** Registered-texture ids for `textureReady`/`drawTexture` tests. */
  readonly rawTextures = new Set<string>();

  registerTexture(id: string, url: string): void {
    this.calls.push({ method: "registerTexture", args: [id, url] });
    this.rawTextures.add(id);
  }

  drawTexture(...args: unknown[]): void {
    this.calls.push({ method: "drawTexture", args });
  }

  textureReady(id: string): boolean {
    return this.rawTextures.has(id);
  }
}

/** A bare canvas stub for headless tests. */
export function stubCanvas(): HTMLCanvasElement {
  return { width: 320, height: 240 } as unknown as HTMLCanvasElement;
}

/**
 * A 12x8 fixture map: a ground layer, a "colliders" layer with a wall row,
 * one NPC (two pages — a switch-gated "welcome back" and a default greeting),
 * and an initial switch/variable.
 */
export function fixtureMap(): MapData {
  const ground: number[][] = [];
  const colliders: number[][] = [];
  for (let row = 0; row < 8; row++) {
    ground.push(new Array(12).fill(1));
    colliders.push(new Array(12).fill(0));
  }
  // Horizontal wall across the full row y=4 (solid) — walking down stops at row 3.
  for (let col = 0; col < 12; col++) {
    colliders[4]![col] = 1;
  }
  return {
    schemaVersion: 1,
    id: "map_fixture",
    name: "Fixture Map",
    tileSize: 16,
    width: 12,
    height: 8,
    tileset: "tilesets/grassland",
    layers: [
      { id: "ground", name: "Ground", type: "tile", opacity: 1, visible: true, data: ground },
      {
        id: "colliders",
        name: "Colliders",
        type: "tile",
        opacity: 1,
        visible: false,
        data: colliders,
      },
    ],
    events: [
      {
        id: "evt_innkeeper",
        name: "Innkeeper",
        x: 6,
        y: 2,
        sprite: "characters/npc_innkeeper",
        pages: [
          {
            condition: { switchId: "sw_met_innkeeper", value: true },
            commands: [
              { cmd: "showText", args: ["Welcome back!"] },
              { cmd: "setVariable", args: ["gold", "add", 10] },
            ],
          },
          {
            condition: null,
            commands: [
              { cmd: "showText", args: ["Hello, traveler!"] },
              { cmd: "setSwitch", args: ["sw_met_innkeeper", true] },
            ],
          },
        ],
      },
    ],
    variables: { gold: 0 },
    switches: { sw_met_innkeeper: false },
  };
}

/** A tiny map with no events (movement-only tests). */
export function emptyMap(width = 8, height = 6): MapData {
  const ground: number[][] = [];
  const colliders: number[][] = [];
  for (let row = 0; row < height; row++) {
    ground.push(new Array(width).fill(1));
    colliders.push(new Array(width).fill(0));
  }
  return {
    schemaVersion: 1,
    id: "map_empty",
    name: "Empty",
    tileSize: 16,
    width,
    height,
    tileset: "tilesets/grassland",
    layers: [
      { id: "ground", name: "Ground", type: "tile", opacity: 1, visible: true, data: ground },
      {
        id: "colliders",
        name: "Colliders",
        type: "tile",
        opacity: 1,
        visible: false,
        data: colliders,
      },
    ],
    events: [],
    variables: {},
    switches: {},
  };
}

/** A minimal save document for round-trip tests. */
export function saveFixture(overrides: Partial<import("@agenticrpg/core").SaveData> = {}) {
  return {
    schemaVersion: 1,
    savedAt: "2026-08-25T00:00:00.000Z",
    mapId: "map_fixture",
    player: { x: 3, y: 2, direction: "right" as const },
    variables: { gold: 10 },
    switches: { sw_met_innkeeper: true },
    ...overrides,
  };
}
