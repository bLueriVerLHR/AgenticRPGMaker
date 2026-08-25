/**
 * App flow integration test (P2, ADR-006 boot flow + D12).
 *
 * Boots the real `<App>` component in jsdom with fake-indexeddb backing the
 * repository, then drives the full P2 flow that the browser E2E would cover:
 * project list → create project → editor screen → document mutations through
 * the store (window.__editor) → debounced autosave → remount (reload) →
 * re-open → mutations persisted.
 *
 * This runs where Playwright browsers are unavailable (CI / minimal sandbox),
 * so the E2E's scenario is exercised at the integration level with the real
 * React tree and the real IndexedDB repository path.
 */
import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { App } from "../src/App.js";
import {
  setDefaultEditorDbName,
  type ProjectRepository,
} from "../src/storage/project-repository.js";

interface EditorHandle {
  store: {
    getSnapshot(): unknown;
    execute(cmd: unknown): void;
  };
  repository: ProjectRepository | null;
}

/** A minimal structural view of the editor snapshot used by the test. */
interface MapLayerView {
  id: string;
  name: string;
  data: number[][];
}

interface EditorSnapshotView {
  projectId: string | null;
  projectName: string;
  currentMapId: string;
  maps: {
    id: string;
    layers: MapLayerView[];
    events: { id: string; pages: { commands: { cmd: string; args: unknown[] }[] }[] }[];
  }[];
}

function editorState(): EditorSnapshotView | null {
  const ed = (globalThis as unknown as { __editor?: EditorHandle }).__editor;
  if (ed === undefined) {
    return null;
  }
  return ed.store.getSnapshot() as EditorSnapshotView;
}

function editorStore(): EditorHandle["store"] | null {
  const ed = (globalThis as unknown as { __editor?: EditorHandle }).__editor;
  return ed?.store ?? null;
}

function editorRepository(): ProjectRepository | null {
  const ed = (globalThis as unknown as { __editor?: EditorHandle }).__editor;
  return ed?.repository ?? null;
}

/** A unique DB name per test run so the fake IndexedDB never collides. */
let dbCounter = 0;
function uniqueDbName(): string {
  dbCounter += 1;
  return `agenticrpg-editor-test-${dbCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Returns the current editor state, failing the test when unavailable. */
function requireState(): EditorSnapshotView {
  const state = editorState();
  if (state === null) {
    throw new Error("expected window.__editor store state to be present");
  }
  return state;
}

/** Poll the repository until the autosaved project reflects the mutations. */
async function waitForPersisted(
  projectId: string,
  expectTileAt: [number, number],
  eventId: string,
): Promise<void> {
  const repository = editorRepository();
  expect(repository).not.toBeNull();
  await vi.waitUntil(
    async () => {
      const stored = await repository!.open(projectId);
      if (stored === null) {
        return false;
      }
      const [y, x] = expectTileAt;
      const layer = stored.maps[0]?.layers[0];
      const hasTile = layer?.data?.[y]?.[x] === 9;
      const hasEvent = (stored.maps[0]?.events ?? []).some((event) => event.id === eventId);
      return hasTile && hasEvent;
    },
    { timeout: 10000, interval: 50 },
  );
}

describe("App flow (integration)", () => {
  beforeEach(() => {
    setDefaultEditorDbName(uniqueDbName());
    (globalThis as unknown as { __editor?: unknown }).__editor = undefined;
  });

  afterEach(() => {
    cleanup();
  });

  it("creates a project, mutates documents, autosaves, and persists across remount", async () => {
    const first = render(<App />);
    await screen.findByTestId("project-list", undefined, { timeout: 10000 });

    // Create a project through the UI.
    fireEvent.change(screen.getByTestId("new-project-name"), { target: { value: "Flow Test" } });
    fireEvent.click(screen.getByTestId("new-project-create"));
    await screen.findByTestId("app-editor", undefined, { timeout: 10000 });

    let state = requireState();
    expect(state.projectName).toBe("Flow Test");
    expect(state.projectId).not.toBeNull();
    expect(state.maps).toHaveLength(1);
    expect(state.maps[0]!.layers[0]!.data[0]![0]).toBe(0);

    // Mutate documents through the real store (the same path the UI uses).
    const store = editorStore()!;
    const snapshot = requireState();
    const mapId = snapshot.currentMapId;
    const layerId = snapshot.maps[0]!.layers[0]!.id;

    const { paintCommand, addEventCommand } = await import("../src/state/commands.js");
    const { createEvent } = await import("../src/model/event-model.js");

    store.execute(paintCommand(mapId, layerId, [{ x: 3, y: 4, index: 9 }]));
    store.execute(addEventCommand(mapId, createEvent({ id: "evt_flow", name: "NPC", x: 7, y: 5 })));

    state = requireState();
    expect(state.maps[0]!.layers[0]!.data[4]![3]).toBe(9);
    expect(state.maps[0]!.events).toHaveLength(1);

    // Wait for the 500ms autosave debounce to fire and persist. Poll the
    // repository for the actual condition (tile + event durable) instead of
    // sleeping a fixed wall-clock guess, so a loaded event loop can never
    // outrun the debounce and remount before the write lands.
    const projectId = state.projectId!;
    await waitForPersisted(projectId, [4, 3], "evt_flow");

    first.unmount();

    // Remount = a fresh page load. The project should be listed and reopen.
    const second = render(<App />);
    await screen.findByTestId("project-list", undefined, { timeout: 10000 });
    const row = await screen.findByTestId(/^project-row-/, undefined, { timeout: 10000 });
    fireEvent.click(row);
    await screen.findByTestId("app-editor", undefined, { timeout: 10000 });

    const persisted = requireState();
    expect(persisted.maps[0]!.layers[0]!.data[4]![3]).toBe(9);
    expect(persisted.maps[0]!.events[0]!.id).toBe("evt_flow");
    expect(persisted.projectName).toBe("Flow Test");

    second.unmount();
  });

  it("shows the project list with an empty state on first boot", async () => {
    const { unmount } = render(<App />);
    await screen.findByTestId("project-list", undefined, { timeout: 10000 });
    expect(screen.getByText(/No projects yet/)).toBeTruthy();
    unmount();
  });
});
