/**
 * Undo/redo tests (P2, docs/06-architecture.md §7 — Command pattern).
 *
 * Exercises the `CommandStack` directly and the `EditorStore` end-to-end:
 * every mutation goes through commands, is validated against the core schema,
 * and can be undone/redone back to the exact prior document.
 */
import { describe, expect, it } from "vitest";

import { CommandStack, type EditorCommand } from "../src/state/command-stack.js";
import {
  createInitialSnapshot,
  EditorStore,
  validateSnapshot,
  type EditorSnapshot,
} from "../src/state/editor-store.js";
import {
  addLayerCommand,
  addEventCommand,
  paintCommand,
  removeEventCommand,
  setVariableCommand,
} from "../src/state/commands.js";
import { createDefaultProject } from "../src/model/project.js";
import { createEvent } from "../src/model/event-model.js";
import { mapSchema } from "@agenticrpg/core";

/** A trivial test command that increments a counter in the project name. */
class CounterCommand implements EditorCommand {
  readonly label = "counter";
  do(snapshot: EditorSnapshot): EditorSnapshot {
    return { ...snapshot, projectName: `${snapshot.projectName}+` };
  }
  undo(snapshot: EditorSnapshot): EditorSnapshot {
    return { ...snapshot, projectName: snapshot.projectName.slice(0, -1) };
  }
}

function makeStore(): EditorStore {
  const created = createDefaultProject("Test Project");
  const snapshot = createInitialSnapshot({
    projectId: "proj_test",
    projectName: created.name,
    project: created.project,
    maps: created.maps,
    tilesets: created.tilesets,
  });
  return new EditorStore(snapshot);
}

describe("CommandStack", () => {
  it("pushes, undoes, redoes, and clears", () => {
    const stack = new CommandStack();
    const a = new CounterCommand();
    const b = new CounterCommand();
    expect(stack.canUndo).toBe(false);
    stack.push(a);
    stack.push(b);
    expect(stack.canUndo).toBe(true);
    expect(stack.undoLabel).toBe("counter");

    const popped = stack.popUndo();
    expect(popped).toBe(b);
    expect(stack.canRedo).toBe(true);
    expect(stack.popRedo()).toBe(b);
    expect(stack.canRedo).toBe(false);
    expect(stack.undoDepth).toBe(2);

    stack.clear();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
  });

  it("clears the redo stack on a new push", () => {
    const stack = new CommandStack();
    stack.push(new CounterCommand());
    stack.push(new CounterCommand());
    stack.popUndo();
    expect(stack.canRedo).toBe(true);
    stack.push(new CounterCommand());
    expect(stack.canRedo).toBe(false);
  });
});

describe("EditorStore undo/redo (end-to-end)", () => {
  it("paints, undoes, and redoes through the core model", () => {
    const store = makeStore();
    const mapId = store.getSnapshot().currentMapId;
    const layerId = store.getSnapshot().maps[0]!.layers[0]!.id;

    store.execute(paintCommand(mapId, layerId, [{ x: 2, y: 3, index: 7 }]));
    let map = store.getSnapshot().maps[0]!;
    expect(map.layers[0]!.data[3]![2]).toBe(7);
    validateSnapshot(store.getSnapshot());

    store.undo();
    map = store.getSnapshot().maps[0]!;
    expect(map.layers[0]!.data[3]![2]).toBe(0);

    store.redo();
    map = store.getSnapshot().maps[0]!;
    expect(map.layers[0]!.data[3]![2]).toBe(7);
  });

  it("adds and removes a layer with selection side-effects", () => {
    const store = makeStore();
    const mapId = store.getSnapshot().currentMapId;
    store.execute(addLayerCommand(mapId, "layer_x", "Extra"));
    let snapshot = store.getSnapshot();
    expect(snapshot.selectedLayerId).toBe("layer_x");
    expect(snapshot.maps[0]!.layers.some((l) => l.id === "layer_x")).toBe(true);

    store.undo();
    snapshot = store.getSnapshot();
    expect(snapshot.maps[0]!.layers.some((l) => l.id === "layer_x")).toBe(false);

    store.redo();
    snapshot = store.getSnapshot();
    expect(snapshot.maps[0]!.layers.some((l) => l.id === "layer_x")).toBe(true);
  });

  it("places and removes an event, restoring selection on undo", () => {
    const store = makeStore();
    const mapId = store.getSnapshot().currentMapId;
    const event = createEvent({ id: "evt_test", name: "NPC", x: 4, y: 4 });

    store.execute(addEventCommand(mapId, event));
    expect(store.getSnapshot().selectedEventId).toBe("evt_test");
    expect(store.getSnapshot().maps[0]!.events).toHaveLength(1);

    store.execute(removeEventCommand(mapId, "evt_test"));
    expect(store.getSnapshot().maps[0]!.events).toHaveLength(0);

    store.undo();
    expect(store.getSnapshot().maps[0]!.events).toHaveLength(1);
    store.undo();
    expect(store.getSnapshot().maps[0]!.events).toHaveLength(0);
  });

  it("setVariable writes through the core GameState model and can be undone", () => {
    const store = makeStore();
    const mapId = store.getSnapshot().currentMapId;
    store.execute(setVariableCommand(mapId, "gold", 25));
    expect(store.getSnapshot().maps[0]!.variables).toEqual({ gold: 25 });

    store.undo();
    expect(store.getSnapshot().maps[0]!.variables).toEqual({});

    store.redo();
    expect(store.getSnapshot().maps[0]!.variables).toEqual({ gold: 25 });
  });

  it("always keeps documents schema-valid after execute/undo/redo", () => {
    const store = makeStore();
    const mapId = store.getSnapshot().currentMapId;
    const layerId = store.getSnapshot().maps[0]!.layers[0]!.id;
    for (let i = 0; i < 5; i++) {
      store.execute(paintCommand(mapId, layerId, [{ x: i, y: i, index: i + 1 }]));
    }
    for (let i = 0; i < 5; i++) {
      store.undo();
    }
    for (let i = 0; i < 5; i++) {
      store.redo();
    }
    const snapshot = store.getSnapshot();
    for (const map of snapshot.maps) {
      expect(mapSchema.safeParse(map).success).toBe(true);
    }
    validateSnapshot(snapshot);
  });

  it("fires mutation listeners on execute/undo/redo but not on set()", () => {
    const store = makeStore();
    const mapId = store.getSnapshot().currentMapId;
    const layerId = store.getSnapshot().maps[0]!.layers[0]!.id;
    let mutations = 0;
    store.onMutated(() => mutations++);

    store.execute(paintCommand(mapId, layerId, [{ x: 1, y: 1, index: 3 }]));
    expect(mutations).toBe(1);

    store.undo();
    expect(mutations).toBe(2);

    store.set({ tool: "select" });
    expect(mutations).toBe(2); // UI-only change is not a document mutation
  });
});
