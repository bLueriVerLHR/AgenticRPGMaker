/**
 * AgenticRPGMaker — shipped player page entry (P5, RQ1).
 *
 * The portable `www` game's boot script. It is the *shipped* player page (not
 * the dev demo harness): it loads the bundled data from the portable layout
 * (`data/manifest.json` → maps + tilesets), validates every document against
 * the core schemas, reads the optional multiplayer query params, and calls the
 * runtime's `boot()`.
 *
 * Conservative-API only (docs/08-compatibility-checklist.md §3): plain fetch,
 * document, URLSearchParams, requestAnimationFrame and IndexedDB — no File
 * System Access API, no Node APIs, no remote fonts. Runs on any static host,
 * any modern browser, and JoiPlay-type mobile runtimes.
 *
 * Query params (all optional):
 *   ?server=ws://host:port/ws   connect to a multiplayer relay (VPS mode)
 *   &room=<roomId>              room to join (default "default")
 *   &name=<playerName>          display name (default "Player")
 *   &map=<mapId>                initial map override (default: project's initialMap)
 *
 * Exposes `window.__game` and `window.__logger` for E2E/debugging, mirroring
 * the dev demo harness.
 */
import { boot, Logger } from "@agenticrpg/runtime";
import { parseMapDocument, parseProjectDocument, parseTilesetDocument } from "@agenticrpg/core";
import type { MapData, ProjectData, TilesetData } from "@agenticrpg/core";

/** Build-generated load list (see scripts/build-www.mjs). */
interface Manifest {
  maps: string[];
  tilesets: string[];
}

interface WindowWithGame {
  __game?: unknown;
  __logger?: unknown;
}

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement | null;
const root = document.getElementById("root") as HTMLElement | null;
const statusEl = document.getElementById("boot-status") as HTMLElement | null;

const params = new URLSearchParams(window.location.search);
const serverUrl = params.get("server") ?? undefined;
const roomId = params.get("room") ?? undefined;
const playerName = params.get("name") ?? "Player";
const mapOverride = params.get("map") ?? undefined;

function setStatus(text: string, isError = false): void {
  if (statusEl === null) {
    return;
  }
  statusEl.textContent = text;
  statusEl.dataset.status = isError ? "error" : "ok";
  if (isError) {
    statusEl.style.color = "#ff7f7f";
  }
}

async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to load ${url} (${response.status})`);
  }
  return (await response.json()) as T;
}

/**
 * Size the canvas backing store to the device pixel ratio (capped, docs/08
 * §4.1) so the viewport math matches the displayed size — same as the demo.
 */
function sizeCanvasToDpr(): void {
  if (canvas === null) {
    return;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
}

async function loadBundle(): Promise<{
  maps: Map<string, MapData>;
  tilesets: Map<string, TilesetData>;
  project: ProjectData | null;
}> {
  const manifest = await loadJson<Manifest>("data/manifest.json");

  const maps = new Map<string, MapData>();
  for (const file of manifest.maps) {
    const doc = parseMapDocument(await loadJson<unknown>(file));
    maps.set(doc.id, doc);
  }
  if (maps.size === 0) {
    throw new Error("data/manifest.json lists no maps");
  }

  const tilesets = new Map<string, TilesetData>();
  for (const file of manifest.tilesets) {
    const doc = parseTilesetDocument(await loadJson<unknown>(file));
    tilesets.set(doc.id, doc);
  }

  let project: ProjectData | null = null;
  try {
    project = parseProjectDocument(await loadJson<unknown>("data/project.json"));
  } catch (error) {
    console.warn("[www] project.json missing or invalid; using manifest defaults", error);
  }

  return { maps, tilesets, project };
}

async function start(): Promise<void> {
  const logger = new Logger({ level: "info" });
  (window as unknown as WindowWithGame).__logger = logger;

  logger.info("www: booting", {
    server: serverUrl ?? null,
    room: roomId ?? "default",
    playerName,
    mapOverride: mapOverride ?? null,
  });
  setStatus("Loading…");

  const { maps, tilesets, project } = await loadBundle();

  const initialId = mapOverride ?? project?.settings.initialMap;
  const initialMap = initialId !== undefined ? maps.get(initialId) : undefined;
  const map = initialMap ?? [...maps.values()][0]!;
  if (initialId !== undefined && initialMap === undefined) {
    logger.warn("www: requested map not in bundle; falling back to first", { mapId: initialId });
  }

  if (canvas === null || root === null) {
    throw new Error("www: #game-canvas / #root element missing");
  }
  sizeCanvasToDpr();

  const game = await boot({
    canvas,
    root,
    mapData: map,
    tilesets,
    logger,
    serverUrl,
    roomId,
    playerName,
    playerPosition: { x: 1, y: 2 },
    playerDirection: "down",
    // Transfer loader (tasks 14/17): every manifest map is already fetched and
    // validated, so a transfer resolves in-memory — multi-map games work in
    // the deployed build with no extra requests.
    loadMap: (mapId: string) => {
      const target = maps.get(mapId);
      return target !== undefined
        ? Promise.resolve(target)
        : Promise.reject(new Error(`www: transfer target not in bundle: ${mapId}`));
    },
  });
  (window as unknown as WindowWithGame).__game = game;
  setStatus(`Ready — ${game.scene.map.name} (${game.scene.backendLabel})`);
  logger.info("www: ready", { map: game.scene.map.id, backend: game.scene.backendLabel });
}

void start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[www] boot failed", error);
  setStatus(`Boot failed: ${message}`, true);
  const el = document.createElement("div");
  el.dataset.testid = "boot-error";
  el.textContent = `boot failed: ${message}`;
  document.body.appendChild(el);
});
