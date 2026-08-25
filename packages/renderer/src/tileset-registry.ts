/**
 * Tileset registry (P1b, ADR-002/ADR-003).
 *
 * Both backends need to resolve a `tilesetId` (the map's `tileset` reference)
 * to a texture + frame grid before drawing tiles. The registry loads the
 * tileset's atlas image through the TextureManager and binds its grid. Shared
 * so the WebGL and Canvas2D backends behave identically.
 */
import type { TilesetData } from "@agenticrpg/core";
import type { TextureId } from "./index.js";
import type { AtlasTextureManager } from "./texture-manager.js";
import type { RendererLogger } from "./logger.js";

export interface TilesetBinding {
  textureId: TextureId;
  columns: number;
  rows: number;
  tileSize: number;
}

export class TilesetRegistry {
  private readonly bindings = new Map<string, TilesetBinding>();

  constructor(
    private readonly textureManager: AtlasTextureManager,
    private readonly logger: RendererLogger,
  ) {}

  /** Load + bind a tileset; repeated registration is a no-op. */
  register(tileset: TilesetData): void {
    if (this.bindings.has(tileset.id)) {
      this.logger.debug("registerTileset: already registered", { tilesetId: tileset.id });
      return;
    }
    this.bindings.set(tileset.id, {
      textureId: "",
      columns: tileset.columns,
      rows: tileset.rows,
      tileSize: tileset.tileSize,
    });
    void this.textureManager
      .load(tileset.image)
      .then((textureId) => {
        this.textureManager.setGrid(textureId, tileset.columns, tileset.rows);
        const binding = this.bindings.get(tileset.id);
        if (binding !== undefined) {
          binding.textureId = textureId;
        }
      })
      .catch((error: unknown) => {
        this.logger.error("registerTileset: failed to load tileset image", {
          tilesetId: tileset.id,
          error: String(error),
        });
        this.bindings.delete(tileset.id);
      });
  }

  bindingFor(tilesetId: string): TilesetBinding | undefined {
    return this.bindings.get(tilesetId);
  }
}
