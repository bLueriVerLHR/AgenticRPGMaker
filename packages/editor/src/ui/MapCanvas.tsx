/**
 * Map canvas (P2, ADR-006 §feature 1–3).
 *
 * Renders the current map from the core model and hosts the interactive
 * tools: paint / erase (click-drag on the selected layer) and event
 * placement / selection. Painting accumulates cells for the current gesture
 * and commits a **single** undoable command on pointer-up (Command pattern),
 * so the store stays the single source of truth.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { MapData, TilesetData } from "@agenticrpg/core";
import type { EditorStore } from "../state/editor-store.js";
import { currentMapOf } from "../state/editor-store.js";
import { useStoreSelector } from "../use-editor-store.js";
import { isColliderLayer } from "../model/map-ops.js";
import { tileColor, tileEdgeColor } from "../tileset/placeholder.js";
import type { PaintCell } from "../model/map-ops.js";
import { addEventCommand, eraseCommand, paintCommand } from "../state/commands.js";
import { createEvent } from "../model/event-model.js";
import { newEventId } from "../model/project.js";

/** Editor canvas zoom (each tile is rendered at SCALE× its pixel size). */
const SCALE = 2;

interface Cell {
  x: number;
  y: number;
}

export function MapCanvas({ store }: { store: EditorStore }): React.JSX.Element {
  const snapshot = useStoreSelector(store, (s) => s);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const dragCellsRef = useRef<Map<string, Cell>>(new Map());
  const draggingRef = useRef(false);
  const pointerCellRef = useRef<Cell | null>(null);
  /** Bumped whenever the drag overlay changes so the redraw effect re-runs. */
  const [dragVersion, setDragVersion] = useState(0);

  const map = currentMapOf(snapshot);
  const tileset = useMemo(
    () => snapshot.tilesets.find((t) => t.id === map.tileset),
    [snapshot.tilesets, map.tileset],
  );

  // Load the tileset atlas image (data URL) for WYSIWYG tile rendering.
  const [atlas, setAtlas] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    setAtlas(null);
    const url = tileset?.image;
    if (url === undefined || url === "" || typeof Image === "undefined") {
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (!cancelled && img.naturalWidth > 0) {
        setAtlas(img);
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        setAtlas(null);
      }
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [tileset?.image]);

  // Size the canvas backing store to the rendered size (SCALE × map, × DPR).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = map.width * map.tileSize * SCALE * dpr;
    canvas.height = map.height * map.tileSize * SCALE * dpr;
    canvas.style.width = `${map.width * map.tileSize * SCALE}px`;
    canvas.style.height = `${map.height * map.tileSize * SCALE}px`;
  }, [map.width, map.height, map.tileSize]);

  // Redraw whenever anything observable changes (snapshot, hover, atlas,
  // drag overlay version).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.save();
    ctx.scale(dpr, dpr);
    drawMap(ctx, {
      map,
      tileset,
      atlas,
      selectedLayerId: snapshot.selectedLayerId,
      selectedEventId: snapshot.selectedEventId,
      hover,
      dragCells: [...dragCellsRef.current.values()],
      paletteTile: snapshot.paletteTile,
    });
    ctx.restore();
  }, [map, tileset, atlas, snapshot.selectedLayerId, snapshot.selectedEventId, hover, dragVersion]);

  const cellFromEvent = (event: { clientX: number; clientY: number }): Cell | null => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const cellPx = map.tileSize * SCALE;
    const x = Math.floor((event.clientX - rect.left) / cellPx);
    const y = Math.floor((event.clientY - rect.top) / cellPx);
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
      return null;
    }
    return { x, y };
  };

  const commitDrag = (): void => {
    const cells = [...dragCellsRef.current.values()];
    dragCellsRef.current.clear();
    setDragVersion((v) => v + 1);
    if (cells.length === 0) {
      return;
    }
    const layerId = snapshot.selectedLayerId ?? map.layers[0]?.id ?? "";
    if (layerId === "") {
      return;
    }
    if (snapshot.tool === "erase") {
      store.execute(eraseCommand(map.id, layerId, cells));
    } else if (snapshot.tool === "paint") {
      const painted: PaintCell[] = cells.map((c) => ({
        x: c.x,
        y: c.y,
        index: snapshot.paletteTile,
      }));
      store.execute(paintCommand(map.id, layerId, painted));
    }
  };

  const paintCell = (cell: Cell): void => {
    dragCellsRef.current.set(`${cell.x},${cell.y}`, cell);
    setDragVersion((v) => v + 1);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    const cell = cellFromEvent(event);
    if (cell === null) {
      return;
    }
    if (snapshot.tool === "paint" || snapshot.tool === "erase") {
      draggingRef.current = true;
      pointerCellRef.current = cell;
      paintCell(cell);
      return;
    }
    if (snapshot.tool === "event" || snapshot.tool === "select") {
      handleEventClick(cell);
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const cell = cellFromEvent(event);
    setHover(cell);
    if (!draggingRef.current) {
      return;
    }
    if (cell === null) {
      return;
    }
    const last = pointerCellRef.current;
    if (last !== null && last.x === cell.x && last.y === cell.y) {
      return;
    }
    pointerCellRef.current = cell;
    paintCell(cell);
  };

  const onPointerUp = (): void => {
    if (draggingRef.current) {
      draggingRef.current = false;
      pointerCellRef.current = null;
      commitDrag();
    }
  };

  const handleEventClick = (cell: Cell): void => {
    const existing = map.events.find((e) => e.x === cell.x && e.y === cell.y);
    if (existing !== undefined) {
      store.set({ selectedEventId: existing.id });
      return;
    }
    if (snapshot.tool !== "event") {
      store.set({ selectedEventId: null });
      return;
    }
    const event = createEvent({
      id: newEventId(),
      name: `Event ${map.events.length + 1}`,
      x: cell.x,
      y: cell.y,
    });
    store.execute(addEventCommand(map.id, event));
  };

  const toolHint =
    snapshot.tool === "paint"
      ? "Paint: click or drag on the selected layer"
      : snapshot.tool === "erase"
        ? "Erase: click or drag to remove tiles"
        : snapshot.tool === "event"
          ? "Event: click an empty tile to place an event, or an event to select it"
          : "Select: click an event to select it";

  return (
    <div className="map-canvas-wrap" data-testid="map-canvas-wrap">
      <canvas
        ref={canvasRef}
        className="map-canvas"
        data-testid="map-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
      />
      <div className="canvas-hint" data-testid="canvas-hint">
        {toolHint}
      </div>
    </div>
  );
}

interface DrawOptions {
  map: MapData;
  tileset?: TilesetData;
  atlas: HTMLImageElement | null;
  selectedLayerId: string | null;
  selectedEventId: string | null;
  hover: Cell | null;
  dragCells: Cell[];
  paletteTile: number;
}

function drawMap(ctx: CanvasRenderingContext2D, options: DrawOptions): void {
  const { map, atlas, tileset, selectedEventId, hover, dragCells, paletteTile } = options;
  const ts = map.tileSize;
  const size = ts * SCALE;

  // Ground backdrop.
  ctx.fillStyle = "#1a1c22";
  ctx.fillRect(0, 0, map.width * size, map.height * size);

  for (const layer of map.layers) {
    if (!layer.visible) {
      continue;
    }
    const collider = isColliderLayer(layer);
    for (let y = 0; y < map.height; y++) {
      const row = layer.data[y];
      if (row === undefined) {
        continue;
      }
      for (let x = 0; x < map.width; x++) {
        const index = row[x] ?? 0;
        if (index === 0) {
          continue;
        }
        const px = x * size;
        const py = y * size;
        if (collider) {
          ctx.fillStyle = "rgba(255, 60, 60, 0.4)";
          ctx.fillRect(px, py, size, size);
          ctx.strokeStyle = "rgba(255,60,60,0.6)";
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
          continue;
        }
        if (atlas !== null && tileset !== undefined && atlas.naturalWidth > 0) {
          const col = (index - 1) % tileset.columns;
          const rowIndex = Math.floor((index - 1) / tileset.columns);
          ctx.drawImage(atlas, col * ts, rowIndex * ts, ts, ts, px, py, size, size);
        } else {
          ctx.fillStyle = tileColor(index);
          ctx.fillRect(px, py, size, size);
          ctx.fillStyle = tileEdgeColor(index);
          ctx.fillRect(px, py, size, 2);
        }
      }
    }
  }

  // Grid.
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= map.width; x++) {
    ctx.moveTo(x * size + 0.5, 0);
    ctx.lineTo(x * size + 0.5, map.height * size);
  }
  for (let y = 0; y <= map.height; y++) {
    ctx.moveTo(0, y * size + 0.5);
    ctx.lineTo(map.width * size, y * size + 0.5);
  }
  ctx.stroke();

  // Events.
  for (const event of map.events) {
    const cx = (event.x + 0.5) * size;
    const cy = (event.y + 0.5) * size;
    const r = size * 0.32;
    const selected = event.id === selectedEventId;
    ctx.fillStyle = selected ? "#ffd54f" : "#c9a227";
    ctx.strokeStyle = selected ? "#fff" : "#000";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = selected ? "#000" : "#fff";
    ctx.font = `${Math.max(8, Math.floor(size * 0.22))}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(event.name.slice(0, 3), cx, cy);
  }

  // Drag overlay (paint/erase preview).
  if (dragCells.length > 0) {
    ctx.fillStyle = paletteTile === 0 ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.35)";
    for (const cell of dragCells) {
      ctx.fillRect(cell.x * size, cell.y * size, size, size);
    }
  }

  // Hover highlight.
  if (hover !== null) {
    ctx.strokeStyle = "rgba(79,140,255,0.9)";
    ctx.lineWidth = 2;
    ctx.strokeRect(hover.x * size + 1, hover.y * size + 1, size - 2, size - 2);
  }
}
