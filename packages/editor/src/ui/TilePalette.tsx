/**
 * Tile palette (P2, ADR-006 §feature 2): pick a tile index to paint.
 * Tile index 0 is reserved for empty (eraser); the palette shows 1..N.
 */
import type { TilesetData } from "@agenticrpg/core";
import { tileColor, tileEdgeColor } from "../tileset/placeholder.js";
import type { EditorStore } from "../state/editor-store.js";
import { useStoreSelector } from "../use-editor-store.js";

export function TilePalette({ store }: { store: EditorStore }): React.JSX.Element {
  const snapshot = useStoreSelector(store, (s) => s);
  const tileset = snapshot.tilesets[0] as TilesetData | undefined;
  const tileCount = tileset === undefined ? 64 : tileset.columns * tileset.rows;

  const tiles = Array.from({ length: tileCount }, (_, i) => i + 1);

  return (
    <div className="palette" data-testid="tile-palette">
      <div className="palette-title">Palette</div>
      <div className="palette-grid">
        <button
          type="button"
          className={`palette-tile${snapshot.paletteTile === 0 ? " active" : ""}`}
          data-testid="palette-tile-0"
          title="Eraser"
          onClick={() => store.set({ paletteTile: 0 })}
          style={{
            backgroundImage:
              "linear-gradient(135deg,#333 25%,#222 25%,#222 50%,#333 50%,#333 75%,#222 75%)",
            backgroundSize: "10px 10px",
          }}
        >
          <span className="tile-label">0</span>
        </button>
        {tiles.map((index) => (
          <button
            key={index}
            type="button"
            className={`palette-tile${snapshot.paletteTile === index ? " active" : ""}`}
            data-testid={`palette-tile-${index}`}
            title={`Tile ${index}`}
            onClick={() => store.set({ paletteTile: index })}
            style={{ backgroundColor: tileColor(index), borderColor: tileEdgeColor(index) }}
          >
            <span className="tile-label">{index}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
